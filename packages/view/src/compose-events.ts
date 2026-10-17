/**
 * Standalone viewer-side client for the optional mcp-compose event channel.
 *
 * The channel is deliberately independent from the MCP Apps protocol and
 * from `@mcpview/compose`: direct ext-apps viewers remain valid, while
 * mcp-view authors get a small typed API when their host supports composition.
 *
 * @module
 */

/** Dedicated JSON-RPC method routed by a compatible composition host. */
export const COMPOSE_EVENT_METHOD = "ui/compose/event";

/** Validated payload delivered to an event handler. */
export interface ComposeEventPayload {
  readonly data: unknown;
  readonly sourceSlot?: number;
  readonly sharedContext?: Readonly<Record<string, unknown>>;
}

export type ComposeEventHandler = (payload: ComposeEventPayload) => void;

/** Minimal parent-frame surface, kept injectable for standalone tests. */
export interface ComposeEventTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/** Minimal current-window surface, kept injectable for standalone tests. */
export interface ComposeEventSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Viewer-side handle exposed as `ctx.events` and `handle.events`. */
export interface ComposeEventClient {
  /** Emit a named event for host-declared routing to sibling viewers. */
  emit(event: string, data?: unknown): void;

  /** Subscribe to an action routed by the host. Returns an idempotent unsubscribe. */
  on(action: string, handler: ComposeEventHandler): () => void;

  /** Remove the message listener and all handlers. Idempotent. */
  destroy(): void;
}

/**
 * Create a standalone client for the optional `ui/compose/event` channel.
 *
 * Browser callers normally use the `ctx.events` instance created by
 * `createMcpApp`. The injectable form is public for framework adapters and
 * tests; it does not require an ext-apps `App` or mcp-compose dependency.
 */
export function createComposeEventClient(
  target?: ComposeEventTarget,
  source?: ComposeEventSource,
): ComposeEventClient {
  const parent = target ?? browserParent();
  const currentWindow = source ?? browserSource();
  const handlers = new Map<string, Set<ComposeEventHandler>>();
  let nextId = 1;
  let destroyed = false;

  const onMessage = (event: MessageEvent): void => {
    if (destroyed || event.source !== parent as unknown as MessageEventSource) return;
    const envelope = parseIncomingEnvelope(event.data);
    if (!envelope) return;
    const actionHandlers = handlers.get(envelope.action);
    if (!actionHandlers) return;

    const payload: ComposeEventPayload = {
      data: envelope.data,
      ...(envelope.sourceSlot !== undefined && { sourceSlot: envelope.sourceSlot }),
      ...(envelope.sharedContext !== undefined && { sharedContext: envelope.sharedContext }),
    };
    for (const handler of [...actionHandlers]) {
      try {
        handler(payload);
      } catch (error) {
        // One faulty consumer must not prevent sibling handlers from seeing
        // the same host event. Event notifications have no response channel.
        console.error("[mcp-view] compose event handler failed:", error);
      }
    }
  };
  currentWindow.addEventListener("message", onMessage);

  return {
    emit(event: string, data?: unknown): void {
      assertAlive(destroyed);
      assertName(event, "event");
      parent.postMessage({
        jsonrpc: "2.0",
        method: COMPOSE_EVENT_METHOD,
        id: nextId++,
        params: { event, data },
      }, "*");
    },

    on(action: string, handler: ComposeEventHandler): () => void {
      assertAlive(destroyed);
      assertName(action, "action");
      if (typeof handler !== "function") {
        throw new TypeError("createComposeEventClient.on: handler must be a function");
      }
      const actionHandlers = handlers.get(action) ?? new Set<ComposeEventHandler>();
      actionHandlers.add(handler);
      handlers.set(action, actionHandlers);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        actionHandlers.delete(handler);
        if (actionHandlers.size === 0) handlers.delete(action);
      };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      currentWindow.removeEventListener("message", onMessage);
      handlers.clear();
    },
  };
}

interface IncomingEnvelope {
  readonly action: string;
  readonly data: unknown;
  readonly sourceSlot?: number;
  readonly sharedContext?: Readonly<Record<string, unknown>>;
}

function parseIncomingEnvelope(value: unknown): IncomingEnvelope | undefined {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.method !== COMPOSE_EVENT_METHOD) {
    return undefined;
  }
  const params = value.params;
  if (!isRecord(params) || !isNonEmptyString(params.action)) return undefined;
  if (
    params.sourceSlot !== undefined &&
    (!Number.isInteger(params.sourceSlot) || (params.sourceSlot as number) < 0)
  ) return undefined;
  if (params.sharedContext !== undefined && !isRecord(params.sharedContext)) return undefined;

  return {
    action: params.action,
    data: params.data,
    ...(params.sourceSlot !== undefined && { sourceSlot: params.sourceSlot as number }),
    ...(params.sharedContext !== undefined && {
      sharedContext: params.sharedContext as Readonly<Record<string, unknown>>,
    }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertName(value: string, field: "event" | "action"): void {
  if (!isNonEmptyString(value)) {
    throw new TypeError(`createComposeEventClient.${field}: name must be a non-empty string`);
  }
}

function assertAlive(destroyed: boolean): void {
  if (destroyed) throw new Error("ComposeEventClient has been destroyed");
}

function browserParent(): ComposeEventTarget {
  if (typeof globalThis.window === "undefined" || !globalThis.window.parent) {
    throw new Error(
      "[mcp-view] No parent window available for the optional Compose event channel.",
    );
  }
  return globalThis.window.parent;
}

function browserSource(): ComposeEventSource {
  if (typeof globalThis.window === "undefined") {
    throw new Error(
      "[mcp-view] No window available for the optional Compose event channel.",
    );
  }
  return globalThis.window;
}
