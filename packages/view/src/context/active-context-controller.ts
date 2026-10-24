import {
  type ActiveContextError,
  type ActiveContextHost,
  type ActiveContextMutation,
  type ActiveContextPolicy,
  type ActiveContextQueue,
  type ActiveContextResult,
  type ActiveContextSelection,
  type ContextSelectionItem,
} from "./active-context.ts";
import type { ClickIntentCommit, ClickIntentPreview, ClickIntentRevert } from "./click-intent.ts";

export type ActiveContextSelectionState = "selected" | "adding" | "removing" | "none";
type JournalMutation = ActiveContextMutation & { provisional?: boolean };

export type ActiveContextActivation = "context" | "none" | "superseded" | "unsupported";
export type ActiveContextReconcileResult = ActiveContextResult | "unchanged";
export interface ActiveContextState {
  /** Host-acknowledged truth; these alone may appear as shared chips. */
  selections: ActiveContextSelection[];
  /** Local intent, including queued and failed changes. */
  desiredSelections: ActiveContextSelection[];
  supported: boolean;
  pending: boolean;
  failed: boolean;
  error: ActiveContextError | null;
  evictedLabel: string | null;
}
export interface ActiveContextActions {
  activate(
    item: ContextSelectionItem,
    toggling?: boolean,
  ): Promise<ActiveContextActivation>;
  toggle(item: ContextSelectionItem): Promise<ActiveContextActivation>;
  select(
    items: readonly ContextSelectionItem[],
    mode?: "replace" | "add" | "remove",
  ): Promise<ActiveContextResult>;
  activateReversible(item: ContextSelectionItem, toggling?: boolean): ClickIntentCommit;
  toggleReversible(item: ContextSelectionItem): ClickIntentCommit;
  /** Updates desired state now; the receipt alone may commit the host write. */
  previewToggle(item: ContextSelectionItem): ClickIntentPreview;
  remove(target: ActiveContextSelection): Promise<ActiveContextReconcileResult>;
  clear(): Promise<ActiveContextResult>;
  reconcile(candidates: readonly ContextSelectionItem[]): Promise<ActiveContextReconcileResult>;
  reconcileGroup(
    group: string,
    candidates: readonly ContextSelectionItem[],
  ): Promise<ActiveContextReconcileResult>;
  reconcileView(
    group: string,
    candidates: readonly ContextSelectionItem[],
  ): Promise<ActiveContextReconcileResult>;
  reconcileDocument(
    documentId: string,
    candidates: readonly ContextSelectionItem[],
  ): Promise<ActiveContextReconcileResult>;
  isSelected(item: Pick<ContextSelectionItem, "id">): boolean;
  isDesired(item: Pick<ContextSelectionItem, "id">): boolean;
  selectionState(itemOrId: string | Pick<ContextSelectionItem, "id">): ActiveContextSelectionState;
  itemRevision(item: Pick<ContextSelectionItem, "id">): number;
  runConversation(action: () => void, restored: Promise<boolean>): Promise<boolean>;
}
export interface ActiveContextController {
  getSnapshot(): ActiveContextState;
  subscribe(listener: (state: ActiveContextState) => void): () => void;
  setScope(scope: string): void;
  scopeVersion(): number;
  clearPreviousScope(): Promise<ActiveContextResult> | undefined;
  dismissEviction(): void;
  dismissFailure(): void;
  retry(): Promise<ActiveContextResult>;
  settled(): Promise<void>;
  dispose(): Promise<ActiveContextResult>;
  actionsForScope(scope: string): ActiveContextActions;
  /** Call only for a host event that explicitly identifies removed item IDs. */
  reconcileHostRemoval(ids: readonly string[]): Promise<ActiveContextReconcileResult>;
}

// App instances share the transport queue even if an author accidentally makes
// two controllers. Host replacement calls can never overtake one another.
const queues = new WeakMap<ActiveContextHost, ActiveContextQueue>();

/** Keep this controller outside the render tree; hooks merely subscribe to it. */
export function createActiveContextController(
  app: ActiveContextHost,
  initialScope: string,
  policy: ActiveContextPolicy,
): ActiveContextController {
  let scope = initialScope;
  let generation = 0;
  let disposed = false;
  let pendingCount = 0;
  let base: ActiveContextSelection[] = [];
  let journal: JournalMutation[] = [];
  let mutationId = 0;
  let scopeClear: Promise<ActiveContextResult> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let nextPresentation = 0;
  let lastPresentation = 0;
  const revisions = new Map<string, number>();
  const listeners = new Set<(state: ActiveContextState) => void>();
  const queue = queues.get(app) ?? policy.createActiveContextQueue();
  queues.set(app, queue);
  let state: ActiveContextState = {
    selections: [],
    desiredSelections: [],
    pending: false,
    failed: false,
    supported: policy.canReplaceActiveContext(app.getHostCapabilities()),
    error: null,
    evictedLabel: null,
  };
  function publish(patch: Partial<ActiveContextState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      // A UI listener is not part of a host transaction. A render exception must
      // never turn an acknowledged host write into a rejection or retry.
      try {
        listener(state);
      } catch { /* Other subscribers must still run. */ }
    }
  }
  function compact() {
    const next = policy.compactActiveContextMutations(base, journal);
    base = next.base;
    journal = next.mutations as JournalMutation[];
  }
  function revisionKey(selection: ActiveContextSelection) {
    return JSON.stringify([selection.scopeKey, selection.item.id]);
  }
  function setDesired(next: ActiveContextSelection[]) {
    const previous = state.desiredSelections;
    if (policy.sameActiveContextSelections(previous, next)) return;
    const unique = new Map(
      [...previous, ...next].map((selection) => [revisionKey(selection), selection]),
    );
    for (const selection of unique.values()) {
      const key = revisionKey(selection);
      const before = previous.find((s) => revisionKey(s) === key);
      const after = next.find((s) => revisionKey(s) === key);
      if (before !== after) revisions.set(key, (revisions.get(key) ?? 0) + 1);
    }
    publish({ desiredSelections: next });
  }
  function committedSelections(entries = journal): ActiveContextSelection[] {
    return policy.replayActiveContextMutations(entries.filter((entry) => !entry.provisional), base);
  }
  function publishPending() {
    publish({
      pending: pendingCount > 0 || journal.some((entry) => entry.active && entry.provisional),
    });
  }
  function record(
    apply: ActiveContextMutation["apply"],
    reversible = false,
    provisional = false,
  ) {
    const next = apply(state.desiredSelections);
    if (next.length > policy.ACTIVE_CONTEXT_MAX_ITEMS) {
      throw new TypeError("Selection exceeds configured capacity");
    }
    const mutation: JournalMutation = {
      id: ++mutationId,
      active: true,
      reversible: reversible || provisional,
      provisional,
      apply,
    };
    // Validate both projections before changing the journal. A normal write must
    // never depend on an uncommitted preview to make its snapshot valid.
    if (!provisional) committedSelections([...journal, mutation]);
    journal.push(mutation);
    setDesired(next);
    compact();
    if (provisional) publishPending();
    return mutation;
  }
  function cancelPreviews() {
    journal = journal.filter((entry) => !entry.provisional);
    setDesired(committedSelections());
    compact();
    publishPending();
  }
  function failure(cause: unknown): ActiveContextResult {
    lastPresentation = ++nextPresentation;
    publish({
      failed: true,
      error: {
        code: cause instanceof Error && "code" in cause && cause.code === "resource-too-large"
          ? "resource-too-large"
          : "invalid-snapshot",
        message: cause instanceof Error ? cause.message : String(cause),
      },
    });
    return "error";
  }
  function write(
    target: ActiveContextSelection[],
    actionGeneration: number,
    evictedLabel?: string | null,
  ): Promise<ActiveContextResult> {
    const presentation = ++nextPresentation;
    const supported = policy.canReplaceActiveContext(app.getHostCapabilities());
    publish({ supported });
    if (!supported) return Promise.resolve("unsupported");
    pendingCount++;
    publish({ pending: true });
    const operation = queue.run(async (): Promise<ActiveContextResult> => {
      try {
        if (actionGeneration !== generation) return "superseded";
        const result = await policy.writeActiveContext(
          app,
          target.map((selection) => selection.item),
        );
        if (result.result === "shared" || result.result === "cleared") {
          // Once sent, an ACK remains host truth even if a root changed while
          // awaiting it. The queued new-root clear has not landed yet.
          const status = presentation >= lastPresentation
            ? {
              failed: false,
              error: null,
              ...(evictedLabel === undefined ? {} : { evictedLabel }),
            }
            : {};
          if (presentation >= lastPresentation) lastPresentation = presentation;
          publish({ selections: target, ...status });
        } else if (result.result === "error" && presentation >= lastPresentation) {
          lastPresentation = presentation;
          publish({
            failed: true,
            error: result.error ?? { code: "transport-error", message: "Context update failed" },
          });
        }
        return actionGeneration === generation ? result.result : "superseded";
      } finally {
        pendingCount--;
        publishPending();
      }
    });
    tail = operation;
    return operation;
  }
  function change(
    apply: ActiveContextMutation["apply"],
    actionGeneration: number,
    reportEviction = false,
  ): Promise<ActiveContextResult> {
    if (disposed || actionGeneration !== generation) return Promise.resolve("superseded");
    if (!policy.canReplaceActiveContext(app.getHostCapabilities())) {
      publish({ supported: false });
      return Promise.resolve("unsupported");
    }
    try {
      const before = state.desiredSelections;
      record(apply);
      const dropped = reportEviction
        ? before.find((s) =>
          !state.desiredSelections.some((next) =>
            next.scopeKey === s.scopeKey && next.item.id === s.item.id
          )
        )
        : undefined;
      return write(
        committedSelections(),
        actionGeneration,
        reportEviction ? dropped?.item.label ?? null : undefined,
      );
    } catch (cause) {
      return Promise.resolve(failure(cause));
    }
  }
  function clear(): Promise<ActiveContextResult> {
    if (disposed) return Promise.resolve("superseded");
    cancelPreviews();
    try {
      record(() => []);
      return write([], generation, null);
    } catch (cause) {
      return Promise.resolve(failure(cause));
    }
  }
  function actionsForScope(actionScope: string): ActiveContextActions {
    const actionGeneration = generation;
    const current = () => !disposed && actionGeneration === generation && actionScope === scope;
    function selectionMutation(
      item: ContextSelectionItem,
      toggling: boolean,
    ): ActiveContextMutation["apply"] {
      const selected = toggling &&
        state.desiredSelections.find((s) => s.scopeKey === actionScope && s.item.id === item.id);
      if (selected) return (items) => policy.removeActiveContextSelection(items, selected);
      return (items) =>
        policy.addActiveContextSelection(
          policy.activeContextSelectionsForScope(items, actionScope),
          actionScope,
          item,
        );
    }
    async function activate(
      item: ContextSelectionItem,
      toggling = false,
    ): Promise<ActiveContextActivation> {
      if (!current()) return "superseded";
      const adding = !toggling ||
        !state.desiredSelections.some((s) => s.scopeKey === actionScope && s.item.id === item.id);
      const result = await change(selectionMutation(item, toggling), actionGeneration, adding);
      if (result === "shared" || result === "cleared") return "context";
      return result === "superseded" || result === "unsupported" ? result : "none";
    }
    function activateReversible(item: ContextSelectionItem, toggling = false): ClickIntentCommit {
      let mutation: ActiveContextMutation | undefined;
      let operation: Promise<ActiveContextResult>;
      if (!current()) operation = Promise.resolve("superseded");
      else if (!policy.canReplaceActiveContext(app.getHostCapabilities())) {
        operation = Promise.resolve("unsupported");
      } else {
        try {
          const before = state.desiredSelections;
          const adding = !toggling ||
            !before.some((s) => s.scopeKey === actionScope && s.item.id === item.id);
          mutation = record(selectionMutation(item, toggling), true);
          const dropped = adding
            ? before.find((s) =>
              !state.desiredSelections.some((next) => next.item.id === s.item.id)
            )
            : undefined;
          operation = write(committedSelections(), actionGeneration, dropped?.item.label ?? null);
        } catch (cause) {
          operation = Promise.resolve(failure(cause));
        }
      }
      const receipt = operation.then((result): ClickIntentRevert => {
        if (!mutation || (result !== "shared" && result !== "cleared" && result !== "superseded")) {
          if (mutation) {
            mutation.reversible = false;
            compact();
          }
          return () => false;
        }
        const entry = mutation;
        const revert: ClickIntentRevert = async () => {
          if (!current()) return false;
          if (!entry.active || !journal.includes(entry)) return true;
          let restored: ActiveContextSelection[];
          let hostTarget: ActiveContextSelection[];
          try {
            const prepared = journal.map((mutation) =>
              mutation === entry ? { ...mutation, active: false } : mutation
            );
            restored = policy.replayActiveContextMutations(prepared, base);
            hostTarget = committedSelections(prepared);
          } catch (cause) {
            failure(cause);
            return false;
          }
          entry.active = false;
          setDesired(restored);
          // A queued replacement can still overwrite the current ACK. Only skip
          // compensation when no outstanding host write can change that truth.
          if (
            pendingCount === 0 && policy.sameActiveContextSelections(hostTarget, state.selections)
          ) {
            return true;
          }
          const result = await write(hostTarget, actionGeneration);
          if (result === "shared" || result === "cleared") return true;
          // Failed compensation remains desired intent for retry. Re-enabling
          // the old mutation here could resurrect it beneath a newer queued ACK.
          return false;
        };
        revert.release = () => {
          entry.reversible = false;
          compact();
        };
        return revert;
      });
      return Object.assign(receipt, {
        retainPending: () => {
          pendingCount++;
          publish({ pending: true });
          let retained = true;
          return () => {
            if (retained) {
              retained = false;
              pendingCount--;
              publishPending();
            }
          };
        },
      });
    }
    function previewToggle(item: ContextSelectionItem): ClickIntentPreview {
      let entry: JournalMutation | undefined;
      let finished = false;
      let evictedLabel: string | null = null;
      if (current() && policy.canReplaceActiveContext(app.getHostCapabilities())) {
        try {
          const before = state.desiredSelections;
          const adding = !before.some((s) => s.scopeKey === actionScope && s.item.id === item.id);
          entry = record(selectionMutation(item, true), false, true);
          if (adding) {
            evictedLabel = before.find((s) =>
              !state.desiredSelections.some((next) =>
                next.scopeKey === s.scopeKey && next.item.id === s.item.id
              )
            )?.item.label ?? null;
          }
        } catch (cause) {
          failure(cause);
        }
      }
      return {
        commit() {
          if (finished) return;
          finished = true;
          if (!entry || !current() || !journal.includes(entry)) return;
          try {
            const prepared = journal.map((mutation) =>
              mutation === entry ? { ...mutation, provisional: false } : mutation
            );
            const target = committedSelections(prepared);
            entry.provisional = false;
            entry.reversible = false;
            compact();
            // write starts pending synchronously, so there is no idle frame
            // between arbitration and the host acknowledgement.
            const operation = write(target, actionGeneration, evictedLabel);
            publishPending();
            return operation.then(() => undefined);
          } catch (cause) {
            cancelEntry();
            failure(cause);
          }
        },
        cancel() {
          if (finished) return;
          finished = true;
          cancelEntry();
        },
      };
      function cancelEntry() {
        if (!entry || !current() || !journal.includes(entry)) return;
        const prepared = journal.filter((mutation) => mutation !== entry);
        try {
          const restored = policy.replayActiveContextMutations(prepared, base);
          journal = prepared;
          setDesired(restored);
          compact();
          publishPending();
        } catch (cause) {
          // Under reject-on-full, a later preview can depend on this preview's
          // removal. Drop only previews that can no longer replay; preserve
          // unrelated previews and all independently validated committed intent.
          let restored = base.slice();
          const retained: JournalMutation[] = [];
          for (const mutation of prepared) {
            try {
              if (mutation.active) restored = mutation.apply(restored);
              retained.push(mutation);
            } catch {
              if (!mutation.provisional) {
                // A committed mutation is validated without any previews when
                // recorded. Fall back to that projection if a custom policy's
                // replay is no longer consistent with its earlier result.
                cancelPreviews();
                failure(cause);
                return;
              }
            }
          }
          journal = retained;
          setDesired(restored);
          compact();
          publishPending();
          failure(cause);
        }
      }
    }
    function reconcile(
      apply: ActiveContextMutation["apply"],
    ): Promise<ActiveContextReconcileResult> {
      if (!current()) return Promise.resolve("superseded");
      try {
        const next = apply(state.desiredSelections);
        const committed = committedSelections();
        const committedNext = apply(committed);
        if (
          policy.sameActiveContextSelections(next, state.desiredSelections) &&
          policy.sameActiveContextSelections(committedNext, committed)
        ) {
          // Keep refresh intent in the journal: a later undo can restore an
          // older item, which must also see this refresh/removal.
          record(apply);
          return Promise.resolve("unchanged");
        }
      } catch (cause) {
        return Promise.resolve(failure(cause));
      }
      return change(apply, actionGeneration);
    }
    const reconcileGroup = (group: string, candidates: readonly ContextSelectionItem[]) =>
      reconcile((items) =>
        policy.reconcileActiveContextViewSelections(items, actionScope, group, candidates)
      );
    return {
      activate,
      toggle: (item) => activate(item, true),
      select(items, mode = "replace") {
        if (!current()) return Promise.resolve("superseded");
        return change(
          (currentItems) => {
            if (mode === "remove") {
              const ids = new Set(items.map((item) => item.id));
              return currentItems.filter((s) => s.scopeKey !== actionScope || !ids.has(s.item.id));
            }
            let next = mode === "replace"
              ? []
              : policy.activeContextSelectionsForScope(currentItems, actionScope);
            const incoming = new Map(items.map((item) => {
              // Validate resource policy even for an existing batch identity.
              const normalized = policy.addActiveContextSelection([], actionScope, item)[0].item;
              return [item.id, normalized] as const;
            }));
            // Batch updates keep existing order; the last duplicate supplies data.
            next = next.map((selection) => {
              const refreshed = incoming.get(selection.item.id);
              if (!refreshed) return selection;
              incoming.delete(selection.item.id);
              const retained = !("resource" in refreshed) && selection.item.resource
                ? { ...refreshed, resource: selection.item.resource }
                : refreshed;
              return { scopeKey: actionScope, item: retained };
            });
            for (const item of incoming.values()) {
              next = policy.addActiveContextSelection(
                next,
                actionScope,
                item,
              );
            }
            return next;
          },
          actionGeneration,
          mode === "add",
        );
      },
      activateReversible,
      previewToggle,
      toggleReversible: (item) => activateReversible(item, true),
      remove: (target) => reconcile((items) => policy.removeActiveContextSelection(items, target)),
      clear: () => current() ? clear() : Promise.resolve("superseded"),
      reconcile: (candidates) =>
        reconcile((items) =>
          policy.reconcileActiveContextSelections(items, actionScope, candidates)
        ),
      reconcileGroup,
      reconcileView: reconcileGroup,
      reconcileDocument: (documentId, candidates) =>
        reconcile((items) =>
          policy.reconcileActiveContextDocumentSelections(
            items,
            actionScope,
            documentId,
            candidates,
          )
        ),
      isSelected: (item) =>
        current() &&
        state.selections.some((s) => s.scopeKey === actionScope && s.item.id === item.id),
      isDesired: (item) =>
        current() &&
        state.desiredSelections.some((s) => s.scopeKey === actionScope && s.item.id === item.id),
      selectionState(itemOrId) {
        if (!current()) return "none";
        const id = typeof itemOrId === "string" ? itemOrId : itemOrId.id;
        const selected = state.selections.some((s) =>
          s.scopeKey === actionScope && s.item.id === id
        );
        const desired = state.desiredSelections.some((s) =>
          s.scopeKey === actionScope && s.item.id === id
        );
        return selected ? desired ? "selected" : "removing" : desired ? "adding" : "none";
      },
      itemRevision: (item) => revisions.get(JSON.stringify([actionScope, item.id])) ?? 0,
      async runConversation(action, restored) {
        if (!await restored || !current()) return false;
        while (current()) {
          if (state.pending) {
            await new Promise<void>((resolve) => {
              const listener = (next: ActiveContextState) => {
                if (!next.pending) {
                  listeners.delete(listener);
                  resolve();
                }
              };
              listeners.add(listener);
            });
          }
          const outcome = await queue.run(() => {
            if (!current() || state.failed) return Promise.resolve("cancel");
            if (state.pending) return Promise.resolve("retry");
            action();
            return Promise.resolve("sent");
          });
          if (outcome !== "retry") return outcome === "sent";
        }
        return false;
      },
    };
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setScope(next) {
      if (scope === next || disposed) return;
      scope = next;
      generation++;
      // Root intent is cleared immediately. Confirmed old chips remain until
      // the clear ACK, including when the clear fails and can be retried.
      scopeClear = clear();
    },
    scopeVersion: () => generation,
    clearPreviousScope: () => scopeClear,
    dismissEviction: () => publish({ evictedLabel: null }),
    dismissFailure: () => publish({ failed: false, error: null }),
    retry: () =>
      disposed ? Promise.resolve("superseded") : write(committedSelections(), generation),
    async settled() {
      while (true) {
        const observed = tail;
        await observed;
        if (observed === tail) return;
      }
    },
    async dispose() {
      if (disposed) return "superseded";
      const result = clear();
      disposed = true;
      return await result;
    },
    actionsForScope,
    reconcileHostRemoval: (ids) => {
      const removed = new Set(ids);
      return change(
        (items) => items.filter((selection) => !removed.has(selection.item.id)),
        generation,
      );
    },
  };
}

export const createContextController: typeof createActiveContextController =
  createActiveContextController;
