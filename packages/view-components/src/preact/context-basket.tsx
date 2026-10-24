/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

/** Minimum presentation identity; the owning controller retains the full payload. */
export interface ContextBasketSelection {
  readonly scopeKey: string;
  readonly item: {
    readonly id: string;
    readonly label: string;
    readonly view?: string;
    readonly value?: string;
  };
}

/** A caller-projected group: identities, membership and summaries remain caller-owned. */
export interface ContextBasketGroup {
  readonly scopeKey: string;
  readonly id: string;
  readonly label: string;
  readonly summary?: string;
  readonly view?: string;
  readonly value?: string;
}

export type ContextBasketEntry<T extends ContextBasketSelection = ContextBasketSelection> =
  | { readonly kind: "single"; readonly selection: T }
  | { readonly kind: "group"; readonly group: ContextBasketGroup };

/** Every visible message and accessible name follows the caller's locale. */
export interface ContextBasketLabels {
  readonly active: string;
  readonly items: string;
  readonly remove: (label: string) => string;
  readonly clearAll: string;
  readonly pending: string;
  readonly error: string;
  readonly retry: string;
  readonly evicted: (label: string) => string;
}

export type ContextBasketSlot =
  | "root"
  | "single"
  | "activeLabel"
  | "singleLabel"
  | "remove"
  | "trigger"
  | "chevron"
  | "popover"
  | "list"
  | "item"
  | "itemContent"
  | "itemLabel"
  | "itemDetail"
  | "clearAll"
  | "pending"
  | "spinner"
  | "error"
  | "errorLabel"
  | "eviction"
  | "pendingLabel"
  | "retry";

export type ContextMutation = () => unknown | Promise<unknown>;

export interface ActiveContextChipProps<T extends ContextBasketSelection = ContextBasketSelection> {
  readonly selections: readonly T[];
  /** Overrides the visible list, e.g. one entry per group instead of its projected members. */
  readonly entries?: readonly ContextBasketEntry<T>[];
  readonly labels: ContextBasketLabels;
  readonly failed?: boolean;
  readonly pending?: boolean;
  readonly evictedLabel?: string | null;
  readonly onRemove?: (selection: T) => unknown | Promise<unknown>;
  readonly onRemoveGroup?: (group: ContextBasketGroup) => unknown | Promise<unknown>;
  readonly onClear: ContextMutation;
  readonly onRetry?: ContextMutation;
  readonly compact?: boolean;
  readonly popoverAlign?: "start" | "end";
  readonly className?: string;
  readonly classes?: Partial<Record<ContextBasketSlot, string>>;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function accepted(result: unknown): boolean {
  return result === "shared" || result === "cleared";
}

function outsideFocusable(wrapper: HTMLElement | null): HTMLElement | null {
  if (!wrapper) return null;
  const elements = Array.from(
    wrapper.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  );
  const current = elements.indexOf(wrapper.ownerDocument.activeElement as HTMLElement);
  return elements.slice(current + 1).find((element) => !wrapper.contains(element)) ??
    elements.slice(0, Math.max(0, current)).reverse().find((element) =>
      !wrapper.contains(element)
    ) ??
    null;
}

function entryKey(entry: ContextBasketEntry): string {
  return entry.kind === "group"
    ? JSON.stringify(["group", entry.group.scopeKey, entry.group.id])
    : JSON.stringify(["single", entry.selection.scopeKey, entry.selection.item.id]);
}

function display(entry: ContextBasketEntry) {
  return entry.kind === "group" ? entry.group : entry.selection.item;
}

/** Controlled basket. Acknowledged selections and mutation results remain caller-owned. */
export function ActiveContextChip<T extends ContextBasketSelection>(
  {
    selections,
    entries,
    labels,
    failed = false,
    pending = false,
    evictedLabel,
    onRemove,
    onRemoveGroup,
    onClear,
    onRetry,
    compact = false,
    popoverAlign = "end",
    className,
    classes,
  }: ActiveContextChipProps<T>,
): JSX.Element | null {
  const slot = (name: ContextBasketSlot) =>
    [`mcp-view-context-${name}`, classes?.[name]].filter(Boolean).join(" ");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const singleRemoveRef = useRef<HTMLButtonElement>(null);
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const popoverId = useId();
  const visible = entries ??
    selections.map((selection) => ({ kind: "single" as const, selection }));
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const count = visible.length;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current++;
    };
  }, []);
  useEffect(() => {
    if (count <= 1) setOpen(false);
  }, [count]);
  useEffect(() => {
    if (!open) return;
    const doc = wrapperRef.current!.ownerDocument;
    function pointer(event: Event) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        operationRef.current++;
        setOpen(false);
      }
    }
    function key(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      operationRef.current++;
      setOpen(false);
      triggerRef.current?.focus();
    }
    doc.addEventListener("pointerdown", pointer);
    doc.addEventListener("keydown", key);
    return () => {
      doc.removeEventListener("pointerdown", pointer);
      doc.removeEventListener("keydown", key);
    };
  }, [open]);

  // Run after the controlled render, and never steal focus back from a user who moved away.
  function afterAccepted(operation: number, origin: Element | null, callback: () => void) {
    queueMicrotask(() => {
      if (!mountedRef.current || operation !== operationRef.current) return;
      const current = origin?.ownerDocument.activeElement;
      // A removed button naturally loses browser focus; a deliberate focus change wins.
      if (origin && current !== origin && current !== origin.ownerDocument.body) return;
      callback();
    });
  }

  async function remove(entry: ContextBasketEntry<T>, index: number) {
    const operation = ++operationRef.current;
    const origin = wrapperRef.current?.ownerDocument.activeElement ?? null;
    const external = outsideFocusable(wrapperRef.current);
    let result: unknown;
    try {
      result = await (entry.kind === "group"
        ? onRemoveGroup?.(entry.group)
        : onRemove
        ? onRemove(entry.selection)
        : count === 1
        ? onClear()
        : undefined);
    } catch {
      return;
    }
    if (!accepted(result)) return;
    afterAccepted(operation, origin, () => {
      const remaining = visibleRef.current;
      if (!remaining.length) {
        if (external?.isConnected) external.focus({ preventScroll: true });
      } else if (remaining.length === 1) {
        singleRemoveRef.current?.focus({ preventScroll: true });
      } else {
        const neighbour = remaining[Math.min(index, remaining.length - 1)];
        (removeRefs.current.get(entryKey(neighbour)) ?? triggerRef.current)?.focus({
          preventScroll: true,
        });
      }
    });
  }

  async function clear() {
    const operation = ++operationRef.current;
    const origin = wrapperRef.current?.ownerDocument.activeElement ?? null;
    const external = outsideFocusable(wrapperRef.current);
    let result: unknown;
    try {
      result = await onClear();
    } catch {
      return;
    }
    if (!accepted(result)) return;
    afterAccepted(operation, origin, () => {
      setOpen(false);
      if (external?.isConnected) external.focus({ preventScroll: true });
    });
  }

  async function retry() {
    const operation = ++operationRef.current;
    const origin = wrapperRef.current?.ownerDocument.activeElement ?? null;
    const external = outsideFocusable(wrapperRef.current);
    let result: unknown;
    try {
      result = await onRetry?.();
    } catch {
      return;
    }
    if (!accepted(result)) return;
    afterAccepted(operation, origin, () => {
      // Retry may clear the basket, remove one item, or retain its confirmed list.
      // Choose from the controlled render after ACK rather than the failed intent.
      const retained = visibleRef.current.length === 1
        ? singleRemoveRef.current
        : triggerRef.current;
      if (retained?.isConnected && !retained.disabled) {
        retained.focus({ preventScroll: true });
      } else if (origin?.isConnected) {
        (origin as HTMLElement).focus({ preventScroll: true });
      } else if (external?.isConnected) {
        external.focus({ preventScroll: true });
      }
    });
  }

  function removeButton(entry: ContextBasketEntry<T>, index: number, single = false) {
    const item = display(entry);
    return (
      <button
        type="button"
        class={slot("remove")}
        ref={(element) => {
          if (single) singleRemoveRef.current = element;
          if (element) removeRefs.current.set(entryKey(entry), element);
          else removeRefs.current.delete(entryKey(entry));
        }}
        disabled={pending || (entry.kind === "group" ? !onRemoveGroup : !onRemove && count > 1)}
        aria-label={labels.remove(item.label)}
        title={labels.remove(item.label)}
        onClick={() => void remove(entry, index)}
      >
        <span aria-hidden="true">×</span>
      </button>
    );
  }

  if (count === 0 && !failed && !pending && !evictedLabel) return null;
  return (
    <span
      ref={wrapperRef}
      aria-busy={pending || undefined}
      class={[slot("root"), className].filter(Boolean).join(" ")}
      data-compact={compact || undefined}
    >
      {count === 1 && (
        <span class={slot("single")} aria-live="polite" aria-atomic="true">
          <span class={slot("activeLabel")}>{labels.active}</span>
          <span class={slot("singleLabel")} title={display(visible[0]).label}>
            {display(visible[0]).label}
          </span>
          {removeButton(visible[0], 0, true)}
        </span>
      )}
      {count > 1 && (
        <>
          <button
            ref={triggerRef}
            type="button"
            class={slot("trigger")}
            aria-expanded={open}
            aria-controls={open ? popoverId : undefined}
            aria-haspopup="dialog"
            onClick={() => {
              operationRef.current++;
              setOpen((value) => !value);
            }}
          >
            <span aria-live="polite" aria-atomic="true">{labels.active} · {count}</span>
            <span aria-hidden="true" class={slot("chevron")}>{open ? "▴" : "▾"}</span>
          </button>
          {open && (
            <span
              id={popoverId}
              role="dialog"
              aria-label={labels.items}
              class={slot("popover")}
              data-align={popoverAlign}
            >
              <span role="list" class={slot("list")}>
                {visible.map((entry, index) => {
                  const item = display(entry);
                  const summary = entry.kind === "group" ? entry.group.summary : undefined;
                  return (
                    <span role="listitem" key={entryKey(entry)} class={slot("item")}>
                      <span class={slot("itemContent")}>
                        <span class={slot("itemLabel")}>{item.label}</span>
                        <span class={slot("itemDetail")}>
                          {summary ?? [item.view, item.value].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {removeButton(entry, index)}
                    </span>
                  );
                })}
              </span>
              <button
                type="button"
                class={slot("clearAll")}
                disabled={pending}
                onClick={() => void clear()}
              >
                {labels.clearAll}
              </button>
            </span>
          )}
        </>
      )}
      {pending && (
        <span role="status" aria-live="polite" class={slot("pending")} title={labels.pending}>
          <span aria-hidden="true" class={slot("spinner")}>◌</span>
          <span class={slot("pendingLabel")}>{labels.pending}</span>
        </span>
      )}
      {failed && (
        <span role="status" class={slot("error")} title={labels.error}>
          <span aria-hidden="true">!</span>
          <span class={slot("errorLabel")} data-hidden={compact && count > 0 || undefined}>
            {labels.error}
          </span>
          {onRetry && (
            <button
              type="button"
              class={slot("retry")}
              disabled={pending}
              onClick={() => void retry()}
            >
              {labels.retry}
            </button>
          )}
        </span>
      )}
      {evictedLabel && (
        <span
          role="status"
          aria-live="polite"
          class={slot("eviction")}
          title={labels.evicted(evictedLabel)}
        >
          {labels.evicted(evictedLabel)}
        </span>
      )}
    </span>
  );
}
