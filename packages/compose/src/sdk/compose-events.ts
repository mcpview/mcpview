/**
 * UI-side helpers for cross-UI event routing via mcp-compose.
 *
 * Uses a dedicated `ui/compose/event` JSON-RPC method, separate from
 * the MCP Apps protocol. No dependency on `@modelcontextprotocol/ext-apps`.
 *
 * Works alongside the MCP Apps `App` class without interfering —
 * each protocol has its own channel.
 *
 * @module sdk/compose-events
 */

/** JSON-RPC method for compose events. */
export const COMPOSE_EVENT_METHOD = "ui/compose/event";

/**
 * Payload received by an `on()` handler.
 */
export interface ComposeEventPayload {
  /** The data sent by the emitting UI. */
  data: unknown;
  /** Slot index of the source UI. */
  sourceSlot?: number;
  /** Shared context from the composition. */
  sharedContext?: Record<string, unknown>;
}

/**
 * Handler function for incoming compose events.
 */
export type ComposeEventHandler = (payload: ComposeEventPayload) => void;

/**
 * Compose events interface returned by `composeEvents()`.
 */
export interface ComposeEvents {
  /**
   * Emit an event to other UIs via the mcp-compose event bus.
   *
   * Sends a `ui/compose/event` JSON-RPC message to the parent frame.
   * The event bus routes it to target UIs based on matching sync rules.
   *
   * @param event - Event name (must match a declared `emits` value)
   * @param data - Arbitrary data payload
   *
   * @example
   * ```typescript
   * events.emit("invoice.selected", { invoiceId: "INV-001" });
   * ```
   */
  emit(event: string, data?: unknown): void;

  /**
   * Listen for an incoming action routed by the mcp-compose event bus.
   *
   * @param action - Action name (must match a declared `accepts` value)
   * @param handler - Callback invoked when the action is received
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const off = events.on("filter.apply", (payload) => {
   *   applyFilter(payload.data);
   * });
   * // Later: off() to stop listening
   * ```
   */
  on(action: string, handler: ComposeEventHandler): () => void;

  /**
   * Stop listening to all compose events and clean up the message listener.
   */
  destroy(): void;
}

/**
 * Minimal interface for the parent window (for testability).
 * In the browser, pass `window.parent`.
 */
export interface ComposeTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * Minimal interface for the event source (for testability).
 * In the browser, pass `window`.
 */
export interface ComposeSource {
  addEventListener(type: "message", listener: (e: MessageEvent) => void): void;
  removeEventListener(
    type: "message",
    listener: (e: MessageEvent) => void,
  ): void;
}

/**
 * Create a compose events channel for cross-UI communication.
 *
 * Uses a dedicated `ui/compose/event` JSON-RPC method via postMessage,
 * completely separate from the MCP Apps protocol. The MCP Apps `App`
 * instance handles standard protocol methods; `composeEvents` handles
 * composition events. No interference between the two.
 *
 * @param parent - The parent window to send messages to (default: `window.parent`)
 * @param source - The window to listen on (default: `window`)
 * @returns Compose events interface with `emit`, `on`, and `destroy` methods
 *
 * @example Browser usage
 * ```typescript
 * import { composeEvents } from "@mcpview/compose/sdk";
 *
 * const events = composeEvents();
 *
 * // Emit when user selects an invoice
 * events.emit("invoice.selected", { invoiceId: "INV-001" });
 *
 * // Listen for filter actions from other UIs
 * events.on("filter.apply", (payload) => {
 *   applyFilter(payload.data);
 * });
 *
 * // Cleanup when done
 * events.destroy();
 * ```
 *
 * @example With MCP Apps App (no conflict)
 * ```typescript
 * import { App } from "@modelcontextprotocol/ext-apps";
 * import { composeEvents } from "@mcpview/compose/sdk";
 *
 * // MCP Apps — standard protocol
 * const app = new App({ name: "Invoice Viewer", version: "1.0.0" });
 * await app.connect();
 * app.ontoolresult = (result) => hydrateData(result);
 *
 * // Compose — separate channel, no interference
 * const events = composeEvents();
 * events.emit("invoice.selected", { id: "INV-001" });
 * events.on("filter.apply", (p) => applyFilter(p.data));
 * ```
 */
export function composeEvents(
  parent?: ComposeTarget,
  source?: ComposeSource,
): ComposeEvents {
  const handlers = new Map<string, Set<ComposeEventHandler>>();
  let nextId = 1;

  // Resolve parent/source — use globals only when available (browser)
  const _parent: ComposeTarget | undefined = parent ??
    ("parent" in globalThis
      ? (globalThis as unknown as Record<string, unknown>).parent as ComposeTarget
      : undefined);

  const _source: ComposeSource | undefined = source ??
    ("addEventListener" in globalThis ? globalThis as unknown as ComposeSource : undefined);

  // Message listener for incoming compose events
  const onMessage = (e: MessageEvent) => {
    const msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.jsonrpc !== "2.0") return;
    if (msg.method !== COMPOSE_EVENT_METHOD) return;

    const params = msg.params;
    if (!params || typeof params.action !== "string") return;

    const actionHandlers = handlers.get(params.action);
    if (!actionHandlers) return;

    const payload: ComposeEventPayload = {
      data: params.data,
      sourceSlot: params.sourceSlot,
      sharedContext: params.sharedContext,
    };

    for (const handler of actionHandlers) {
      handler(payload);
    }
  };

  _source?.addEventListener("message", onMessage);

  return {
    emit(event: string, data?: unknown): void {
      if (!_parent) {
        throw new Error(
          "[mcp-compose] No parent window available. composeEvents() must run inside an iframe.",
        );
      }
      _parent.postMessage(
        {
          jsonrpc: "2.0",
          method: COMPOSE_EVENT_METHOD,
          id: nextId++,
          params: { event, data },
        },
        "*",
      );
    },

    on(action: string, handler: ComposeEventHandler): () => void {
      if (!handlers.has(action)) {
        handlers.set(action, new Set());
      }
      handlers.get(action)!.add(handler);

      return () => {
        const set = handlers.get(action);
        if (set) {
          set.delete(handler);
          if (set.size === 0) handlers.delete(action);
        }
      };
    },

    destroy(): void {
      _source?.removeEventListener("message", onMessage);
      handlers.clear();
    },
  };
}
