/**
 * Pointer intent arbitration with no context write before a single click wins.
 *
 * Wire both `click` (passing MouseEvent.detail) and `dblclick`. A pointer single
 * previews desired selection immediately when onPreview is supplied and waits
 * for the configured delay before committing; a native second click cancels it before the
 * double-click opens local detail. No context toggle or compensation is sent.
 * Browsers do not expose the OS double-click interval: configure the delay to
 * cover the interval supported by the viewer. A double arriving after the
 * delay cannot retract an already committed single without an intermediate
 * context write. Keyboard and explicit detail actions need no such delay.
 */

/** A receipt exposed by context controllers; this arbiter never invokes undo. */
export interface ClickIntentRevert {
  (): boolean | void | Promise<boolean | void>;
  /** Releases the controller's gesture journal after the single commits. */
  release?: () => void;
}

/** Structural compatibility with asynchronous context-controller receipts. */
export interface ClickIntentCommit extends Promise<undefined | ClickIntentRevert> {
  retainPending?: () => () => void;
}

export type ClickIntentSingleResult =
  | void
  | ClickIntentRevert
  | Promise<void | ClickIntentRevert>;

/** A local-only preview. Cancellation must restore intent without a host write. */
export interface ClickIntentPreview {
  commit(): ClickIntentSingleResult;
  cancel(): void;
}

/** Default arbitration delay; override for the supported double-click interval. */
export const CLICK_INTENT_DELAY_MS = 500;

/** Schedules a callback and returns its cancellation function. */
export type ClickIntentSchedule = (run: () => void, delayMs: number) => () => void;

interface ClickIntentIdentity {
  /** Stable identity of the row, bar, point, or other target. */
  key: string;
  /** Root dataset identity. Cancel when replacing the root, not opening local detail. */
  scope?: string;
}

export interface ContextClickIntent extends ClickIntentIdentity {
  clickAction?: "context";
  /** Runs only after a pointer single wins, or immediately for Space. */
  onSingle: () => ClickIntentSingleResult;
  /** Optional immediate pointer feedback, committed only after arbitration. */
  onPreview?: () => ClickIntentPreview;
  /** Local detail only; never sends a conversation message. */
  onDouble: () => void;
}

/** A target without context support opens local detail on its first click. */
export interface DetailClickIntent extends ClickIntentIdentity {
  clickAction: "detail";
  doublePolicy: "local";
  onDouble: () => void;
  onSingle?: never;
  onPreview?: never;
  runConversation?: never;
}

export type ClickIntent = ContextClickIntent | DetailClickIntent;

export function detailOnClickIntent(
  key: string,
  onOpen: () => void,
  scope?: string,
): DetailClickIntent {
  return { key, scope, clickAction: "detail", doublePolicy: "local", onDouble: onOpen };
}

export function isDetailClickIntent(intent: ClickIntent): intent is DetailClickIntent {
  return intent.clickAction === "detail";
}

export interface ClickIntentKeyEvent {
  key: string;
  repeat?: boolean;
  preventDefault(): void;
}

export interface ClickIntentOptions {
  doubleClickDelayMs?: number;
  schedule?: ClickIntentSchedule;
  /** Receives single-action failures and receipt-release failures. */
  onError?: (error: unknown, intent: ContextClickIntent) => void;
}

export interface ClickIntentArbiter {
  /** Pass the native click detail; detail=0 is an explicit/assistive single. */
  click(intent: ClickIntent, clickCount?: number): void;
  /** Cancels the unresolved single and opens detail once per native burst. */
  doubleClick(intent: ClickIntent): void;
  /** Space selects context; Enter opens detail. Repeated keys are ignored. */
  keyDown(intent: ClickIntent, event: ClickIntentKeyEvent): void;
  /** Touch/explicit detail button: cancels an unresolved same-target single. */
  activateDetail(intent: ClickIntent): void;
  /** Cancels unresolved work only; already started context writes are preserved. */
  cancel(key: string, scope?: string): void;
  /** Call before replacing a root dataset so its deferred singles cannot fire. */
  cancelScope(scope: string): void;
  cancelAll(): void;
  /** Cancels unresolved work and permanently makes this arbiter inert. */
  dispose(): void;
}

interface PendingSingle {
  intent: ContextClickIntent;
  cancelTimer: () => void;
  preview?: ClickIntentPreview;
}

function scheduleTimeout(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

/** The schedule-function overload preserves the original test/integration API. */
export function createClickIntentArbiter(
  options: ClickIntentOptions | ClickIntentSchedule = {},
): ClickIntentArbiter {
  const settings = typeof options === "function" ? { schedule: options } : options;
  const delay = settings.doubleClickDelayMs ?? CLICK_INTENT_DELAY_MS;
  if (!Number.isFinite(delay) || delay < 0) {
    throw new RangeError("doubleClickDelayMs must be a finite non-negative number");
  }
  const schedule = settings.schedule ?? scheduleTimeout;
  const pending = new Map<string, Set<PendingSingle>>();
  const consumedDoubles = new Map<string, string | undefined>();
  let disposed = false;

  function identity(key: string, scope?: string): string {
    // Encode a tuple rather than joining strings: keys/scopes can contain separators.
    return JSON.stringify([scope ?? null, key]);
  }

  function cancel(key: string, scope?: string): void {
    const id = identity(key, scope);
    const entries = pending.get(id);
    pending.delete(id);
    consumedDoubles.delete(id);
    for (const entry of entries ?? []) cancelEntry(entry);
  }

  function report(error: unknown, intent: ContextClickIntent) {
    if (!disposed) settings.onError?.(error, intent);
  }
  function cancelEntry(entry: PendingSingle | undefined) {
    if (!entry) return;
    entry.cancelTimer();
    try {
      entry.preview?.cancel();
    } catch (error) {
      report(error, entry.intent);
    }
  }

  function cancelAll(): void {
    const entries = [...pending.values()].flatMap((entries) => [...entries]);
    pending.clear();
    consumedDoubles.clear();
    for (const entry of entries) cancelEntry(entry);
  }

  function runSingle(intent: ContextClickIntent, preview?: ClickIntentPreview): void {
    // Async work already started belongs to the context controller. Cleanup does
    // not undo it, and detail navigation does not wait for unrelated writes.
    const report = (error: unknown) => {
      if (!disposed) settings.onError?.(error, intent);
    };
    const release = (receipt: void | ClickIntentRevert) => receipt?.release?.();
    try {
      const result = preview ? preview.commit() : intent.onSingle();
      if (typeof result === "function" || result === undefined) {
        release(result);
      } else {
        void Promise.resolve(result).then(release).catch(report);
      }
    } catch (error) {
      report(error);
    }
  }

  function commitPending(id: string, entry: PendingSingle): void {
    if (disposed || !pending.get(id)?.delete(entry)) return;
    if (pending.get(id)?.size === 0) pending.delete(id);
    entry.cancelTimer();
    runSingle(entry.intent, entry.preview);
  }

  function openDetail(intent: ClickIntent): void {
    cancel(intent.key, intent.scope);
    intent.onDouble();
  }

  return {
    click(intent, clickCount = 1) {
      if (disposed) return;
      if (isDetailClickIntent(intent)) {
        // Context support can disappear between the first and second click.
        // Even an ignored second detail click must cancel the old context intent.
        cancel(intent.key, intent.scope);
        if (clickCount < 2) openDetail(intent);
        return;
      }
      const id = identity(intent.key, intent.scope);
      if (clickCount >= 2) {
        // The second click arrives before dblclick. Cancel now, including when
        // another handler prevents the later dblclick from reaching this viewer.
        const entries = pending.get(id);
        pending.delete(id);
        for (const entry of entries ?? []) cancelEntry(entry);
        return;
      }
      consumedDoubles.delete(id);
      if (clickCount === 0) {
        cancel(intent.key, intent.scope);
        runSingle(intent);
        return;
      }
      // Every detail=1 starts an independent sequence with its own deadline.
      // Earlier same-target previews remain provisional until their timers fire.
      if (disposed) return;
      const entry: PendingSingle = { intent, cancelTimer: () => {} };
      const entries = pending.get(id) ?? new Set<PendingSingle>();
      entries.add(entry);
      pending.set(id, entries);
      try {
        entry.preview = intent.onPreview?.();
      } catch (error) {
        entries.delete(entry);
        if (entries.size === 0) pending.delete(id);
        report(error, intent);
        return;
      }
      // A synchronous subscriber may cancel/dispose during preview publication.
      if (disposed || !pending.get(id)?.has(entry)) {
        cancelEntry(entry);
        return;
      }
      entry.cancelTimer = schedule(() => commitPending(id, entry), delay);
      // A synchronous scheduler may already have consumed or cancelled it.
      if (!pending.get(id)?.has(entry)) entry.cancelTimer();
    },
    doubleClick(intent) {
      if (disposed) return;
      if (isDetailClickIntent(intent)) {
        cancel(intent.key, intent.scope);
        return;
      }
      const id = identity(intent.key, intent.scope);
      if (consumedDoubles.has(id)) return;
      cancel(intent.key, intent.scope);
      consumedDoubles.set(id, intent.scope);
      intent.onDouble();
    },
    keyDown(intent, event) {
      if (disposed || event.repeat || (event.key !== " " && event.key !== "Enter")) return;
      event.preventDefault();
      if (event.key === "Enter" || isDetailClickIntent(intent)) {
        openDetail(intent);
      } else {
        cancel(intent.key, intent.scope);
        runSingle(intent);
      }
    },
    activateDetail(intent) {
      if (!disposed) openDetail(intent);
    },
    cancel,
    cancelScope(scope) {
      for (const entry of [...pending.values()].flatMap((entries) => [...entries])) {
        if (entry.intent.scope === scope) cancel(entry.intent.key, scope);
      }
      for (const [id, consumedScope] of consumedDoubles) {
        if (consumedScope === scope) consumedDoubles.delete(id);
      }
    },
    cancelAll,
    dispose() {
      disposed = true;
      cancelAll();
    },
  };
}
