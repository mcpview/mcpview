/**
 * Subscription registry for subscriptions/listen (spec 2026-07-28, SEP-2575).
 *
 * Owns the lifecycle of long-lived notification streams opened by the client
 * via subscriptions/listen. Handles filter intersection, fan-out, keep-alive,
 * and both client- and server-initiated teardown.
 *
 * Everything here is pure-function-first and testable without a real HTTP
 * server. The SubscriptionSink interface is the seam: in production it wraps
 * a ReadableStreamDefaultController; in tests it can be an in-memory array.
 *
 * SSE format: spec 2026-07-28 drops resumable streams (Last-Event-ID is
 * ignored, event IDs MUST NOT be emitted). Every event is just:
 *   data: {json}\n\n
 * Keep-alive lines are SSE comment lines:
 *   :\n\n
 *
 * @module lib/server/subscriptions/subscription-registry
 */

// ── Spec constants ────────────────────────────────────────────────────────────

/** _meta key identifying the subscription (spec 2026-07-28). */
const SUBSCRIPTION_ID_KEY = "io.modelcontextprotocol/subscriptionId";

/**
 * _meta key carrying server identity in results (spec 2026-07-28, SHOULD).
 * Duplicated from mcp-app.ts to keep this module self-contained and testable
 * without importing from the app layer.
 */
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

// ── Interfaces ────────────────────────────────────────────────────────────────

/**
 * Notification filter from params.notifications of a subscriptions/listen
 * request. All fields optional — an omitted field means "not subscribed".
 */
export interface SubscriptionFilter {
  readonly toolsListChanged?: boolean;
  readonly promptsListChanged?: boolean;
  readonly resourcesListChanged?: boolean;
  /** URIs for which the client wants notifications/resources/updated events. */
  readonly resourceSubscriptions?: readonly string[];
  /**
   * Task ids for which the client wants `notifications/tasks` (Tasks extension).
   *
   * Recognising this field is not optional even though *pushing* task updates is:
   * a client that asks for task notifications without declaring the Tasks
   * extension MUST be refused with the missing-capability error, and a filter that
   * does not know the field cannot tell the difference between that and a client
   * asking for nothing.
   */
  readonly taskIds?: readonly string[];
}

/**
 * Injectable stream sink. In production wraps a ReadableStreamDefaultController.
 * In tests, an in-memory collector.
 *
 * Implementations MUST silently swallow errors from writing to an already-
 * closed controller — the ReadableStream cancel() callback fires before
 * unregister(), so a race window exists on every HTTP client disconnect.
 */
export interface SubscriptionSink {
  enqueue(chunk: Uint8Array): void;
  /** Idempotent: calling twice MUST NOT throw. */
  close(): void;
  /** True once close() has been called or the underlying stream errored. */
  readonly isClosed: boolean;
}

// ── Pure functions ────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Compute the subset of requestedFilter the server agrees to honour.
 *
 * Spec: "The notifications field in the acknowledgment reflects the subset
 * the server agreed to honor. Notification types the server does not support
 * are omitted."
 *
 * For boolean fields: include only when both the client requested (true) AND
 * the server supports (true). For resourceSubscriptions: accept all requested
 * URIs when the server mask has a non-empty or undefined resourceSubscriptions
 * (undefined = "accept all"). A server that sets serverSupports.resourceSubscriptions
 * to [] opts out of resource URI tracking entirely.
 */
export function intersectFilter(
  requested: SubscriptionFilter,
  serverSupports: SubscriptionFilter,
): SubscriptionFilter {
  const result: Record<string, boolean | string[]> = {};

  if (requested.toolsListChanged && serverSupports.toolsListChanged) {
    result.toolsListChanged = true;
  }
  if (requested.promptsListChanged && serverSupports.promptsListChanged) {
    result.promptsListChanged = true;
  }
  if (requested.resourcesListChanged && serverSupports.resourcesListChanged) {
    result.resourcesListChanged = true;
  }

  if (
    Array.isArray(requested.resourceSubscriptions) &&
    requested.resourceSubscriptions.length > 0
  ) {
    // Server's resourceSubscriptions mask: undefined means "accept all",
    // empty array means "refuse all", non-empty array means "accept only these".
    const serverMask = serverSupports.resourceSubscriptions;
    if (serverMask === undefined) {
      // No server-side restriction — accept all requested URIs.
      result.resourceSubscriptions = [...requested.resourceSubscriptions];
    } else if (serverMask.length > 0) {
      const allowed = new Set(serverMask);
      const intersection = requested.resourceSubscriptions.filter((u) =>
        allowed.has(u)
      );
      if (intersection.length > 0) result.resourceSubscriptions = intersection;
    }
    // serverMask === [] → no URI tracking, field omitted.
  }

  // taskIds mirrors resourceSubscriptions: same undefined/empty/non-empty mask
  // semantics. Carried through so the acknowledgement tells the client which task
  // ids the server actually agreed to track.
  if (Array.isArray(requested.taskIds) && requested.taskIds.length > 0) {
    const serverMask = serverSupports.taskIds;
    if (serverMask === undefined) {
      result.taskIds = [...requested.taskIds];
    } else if (serverMask.length > 0) {
      const allowed = new Set(serverMask);
      const intersection = requested.taskIds.filter((tid) => allowed.has(tid));
      if (intersection.length > 0) result.taskIds = intersection;
    }
  }

  return result as SubscriptionFilter;
}

/**
 * Build the notifications/subscriptions/acknowledged JSON-RPC notification.
 *
 * Spec (subscriptions page — Acknowledgment): MUST be the first message;
 * MUST carry subscriptionId in _meta; MUST echo only the agreed filter.
 */
export function buildAcknowledgedMessage(
  subscriptionId: string | number,
  agreedFilter: SubscriptionFilter,
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    method: "notifications/subscriptions/acknowledged",
    params: {
      _meta: { [SUBSCRIPTION_ID_KEY]: subscriptionId },
      notifications: agreedFilter,
    },
  };
}

/**
 * Inject io.modelcontextprotocol/subscriptionId into a notification's _meta.
 *
 * Called on every outgoing notification before it is enqueued on the stream.
 * Merges rather than replaces _meta so that other _meta fields are preserved.
 * Merges rather than replaces params so non-_meta fields (e.g. uri) survive.
 */
export function stampSubscriptionMeta(
  message: Record<string, unknown>,
  subscriptionId: string | number,
): Record<string, unknown> {
  const existingParams = isRecord(message["params"]) ? message["params"] : {};
  const existingMeta = isRecord(existingParams["_meta"])
    ? existingParams["_meta"]
    : {};
  return {
    ...message,
    params: {
      ...existingParams,
      _meta: {
        ...existingMeta,
        [SUBSCRIPTION_ID_KEY]: subscriptionId,
      },
    },
  };
}

/**
 * Build the graceful-close JSON-RPC response for the subscriptions/listen
 * request.
 *
 * Spec (subscriptions page — Graceful Closure): server SHOULD respond to the
 * original subscriptions/listen request with an empty result before closing
 * the stream. The result carries resultType: "complete" and subscriptionId in
 * _meta, identifying which subscription is closing.
 *
 * The id in the response is the JSON-RPC id of the original request, which
 * is the same value as the subscriptionId.
 */
export function buildGracefulCloseResult(
  subscriptionId: string | number,
  serverInfo: { readonly name: string; readonly version: string },
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: subscriptionId,
    result: {
      resultType: "complete",
      _meta: {
        [SUBSCRIPTION_ID_KEY]: subscriptionId,
        [SERVER_INFO_KEY]: serverInfo,
      },
    },
  };
}

/**
 * Build the notifications/cancelled notification the server MUST emit when it
 * tears down a subscription on its own initiative.
 *
 * Spec (cancellation page — §2): "A server MUST send notifications/cancelled
 * referencing a subscriptions/listen request ID when it tears down that
 * subscription stream."
 *
 * On HTTP the sequence is: enqueue this, then enqueue the graceful-close
 * result, then close the stream. On stdio it travels on the shared channel.
 */
export function buildServerCancelledNotification(
  subscriptionId: string | number,
): Record<string, unknown> {
  // Stamped like every other message on the stream. The rule is unconditional —
  // "All notifications delivered on the stream carry
  // io.modelcontextprotocol/subscriptionId in _meta" — and on stdio, where every
  // subscription shares one channel, it is the only way a client can tell which
  // subscription is being torn down.
  return stampSubscriptionMeta({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: {
      requestId: subscriptionId,
    },
  }, subscriptionId);
}

/**
 * Encode a JSON-RPC message as a single SSE event chunk.
 *
 * Format: "data: {json}\n\n" — NO "id:" line.
 * Spec 2026-07-28 drops resumable streams: SSE event IDs MUST NOT be emitted
 * (streamable-http page — Earlier Streamable HTTP Revisions: "Resumable SSE
 * streams via Last-Event-ID are not supported").
 */
export function encodeSSEEvent(message: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * Emit a bare SSE comment line as a keep-alive heartbeat.
 *
 * Format: ":\n\n" — per the SSE spec any line beginning with ":" is a
 * comment; clients MUST ignore it. Spec 2026-07-28 explicitly encourages
 * servers to use these for long-lived streams to prevent intermediary timeouts.
 */
export function encodeSSEKeepAlive(): Uint8Array {
  return new TextEncoder().encode(":\n\n");
}

// ── Registry ──────────────────────────────────────────────────────────────────

export interface SubscriptionRegistryOptions {
  /** Server identity echoed in graceful-close results. */
  readonly serverInfo: { readonly name: string; readonly version: string };
  /**
   * Interval between keep-alive SSE comment lines. Default: 30_000 ms.
   * "Periodically" per spec; 30 s is the de-facto SSE convention and avoids
   * intermediate proxy idle timeouts (nginx default keepalive_timeout: 65 s).
   */
  readonly keepAliveIntervalMs?: number;
  /**
   * Server capability mask — which notification types this server can deliver.
   *
   * An **allowlist**: a supplied mask must name every type it wants delivered,
   * because an omitted field means "not supported". This is deliberate — an
   * operator narrowing delivery should not have a type they forgot to mention
   * granted back to them.
   *
   * Omit the option entirely (the default) to support all four types. Supplying
   * `{}` therefore supports none, which is a legal way to accept subscriptions
   * while delivering nothing.
   */
  readonly serverSupports?: SubscriptionFilter;
}

interface SubscriptionEntry {
  /** JSON-RPC id of the subscriptions/listen request — echoed in every message. */
  readonly subscriptionId: string | number;
  /** The agreed (intersected) filter for this subscription. */
  readonly agreedFilter: SubscriptionFilter;
  readonly sink: SubscriptionSink;
}

// Map notification-filter field names to their wire method names.
const TYPE_TO_METHOD: Readonly<
  Record<
    "toolsListChanged" | "promptsListChanged" | "resourcesListChanged",
    string
  >
> = {
  toolsListChanged: "notifications/tools/list_changed",
  promptsListChanged: "notifications/prompts/list_changed",
  resourcesListChanged: "notifications/resources/list_changed",
};

/**
 * Registry that owns live subscriptions and their fan-out.
 *
 * Keyed internally by a random UUID generated at register() time — NOT by the
 * client-visible subscriptionId, because two concurrent HTTP connections MAY
 * legitimately use the same JSON-RPC id value (e.g., both send id: 1). The
 * UUID is the opaque key returned to the caller for later unregister() calls.
 *
 * Thread-safety note: Deno is single-threaded, so concurrent access between
 * the register/unregister path and the fan-out path is serialised by the event
 * loop. No locking is needed, but async gaps (await) inside register/unregister
 * must not be introduced.
 */
export class SubscriptionRegistry {
  private readonly entries = new Map<string, SubscriptionEntry>();
  private readonly opts: Required<SubscriptionRegistryOptions>;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SubscriptionRegistryOptions) {
    // Default: all four notification types supported.
    const defaultSupports: SubscriptionFilter = {
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: undefined, // undefined = accept all URIs
      taskIds: undefined, // undefined = accept all task ids
    };
    this.opts = {
      serverInfo: options.serverInfo,
      keepAliveIntervalMs: options.keepAliveIntervalMs ?? 30_000,
      // Whole-object fallback, deliberately: a supplied mask is an ALLOWLIST, so
      // an omitted field means "not supported". Merging per-field would instead
      // make a partial mask grant everything it forgot to mention — the opposite
      // of what an operator restricting delivery intends. Fail closed.
      serverSupports: options.serverSupports ?? defaultSupports,
    };
  }

  /**
   * The subset of `requested` this server will actually honour.
   *
   * Exposed so a caller can build the acknowledgement from the same value the
   * registry will enforce. Computing it independently on both sides is how a
   * client ends up told it subscribed to something the registry then ignores.
   */
  computeAgreedFilter(requested: SubscriptionFilter): SubscriptionFilter {
    return intersectFilter(requested, this.opts.serverSupports);
  }

  /**
   * Register a new subscription.
   *
   * MUST be called AFTER the acknowledged message has been successfully
   * enqueued on the sink. The spec requires the acknowledged message to be the
   * FIRST message on the stream — registering before sending it would allow a
   * concurrent fanOut to race ahead of the acknowledged message.
   *
   * @returns Opaque internal key — pass to unregister().
   */
  register(
    subscriptionId: string | number,
    requestedFilter: SubscriptionFilter,
    sink: SubscriptionSink,
  ): string {
    const agreedFilter = intersectFilter(
      requestedFilter,
      this.opts.serverSupports,
    );
    const internalKey = crypto.randomUUID();
    this.entries.set(internalKey, { subscriptionId, agreedFilter, sink });
    return internalKey;
  }

  /**
   * Remove a subscription by its internal key.
   *
   * Server-initiated teardown ("server"):
   *   1. Enqueue notifications/cancelled (spec MUST, cancellation page §2).
   *   2. Enqueue graceful-close result (spec SHOULD, subscriptions page).
   *   3. Close the sink.
   *
   * Client-initiated (HTTP SSE cancel() callback, "client"):
   *   Remove the entry only. The client already closed the stream — enqueue
   *   attempts would silently fail or throw, and the spec says no further
   *   messages are required or expected when the client disconnects.
   *
   * No-op when the key is not found (race between shutdown and disconnect).
   */
  unregister(
    internalKey: string,
    initiator: "client" | "server" = "client",
  ): void {
    const entry = this.entries.get(internalKey);
    if (!entry) return;
    this.entries.delete(internalKey);

    if (initiator === "server") {
      // MUST send notifications/cancelled before the graceful-close result.
      // (spec: cancellation page §2 — server MUST send this when tearing down
      // a subscription on its own initiative.)
      entry.sink.enqueue(
        encodeSSEEvent(
          buildServerCancelledNotification(entry.subscriptionId),
        ),
      );
      // SHOULD send the empty graceful-close result (spec: subscriptions page
      // — Graceful Closure). Lets the client distinguish a clean shutdown from
      // an unexpected transport drop.
      entry.sink.enqueue(
        encodeSSEEvent(
          buildGracefulCloseResult(entry.subscriptionId, this.opts.serverInfo),
        ),
      );
      entry.sink.close();
    }
    // "client": entry removed above; nothing else to do.
  }

  /**
   * Fan-out a list-changed notification to every subscription that opted in.
   *
   * Prunes sinks whose isClosed is true (client disconnected between the
   * cancel() callback and the next fanOut call). A closed sink is removed from
   * the map so it does not accumulate indefinitely.
   *
   * MUST NOT be called with request-scoped types (progress, message).
   */
  fanOut(
    type: "toolsListChanged" | "promptsListChanged" | "resourcesListChanged",
  ): void {
    const method = TYPE_TO_METHOD[type];
    for (const [key, entry] of this.entries) {
      if (entry.sink.isClosed) {
        // Dead entry — prune it now rather than waiting for unregister.
        this.entries.delete(key);
        continue;
      }
      if (!entry.agreedFilter[type]) continue;
      const notification = stampSubscriptionMeta(
        { jsonrpc: "2.0", method, params: {} },
        entry.subscriptionId,
      );
      entry.sink.enqueue(encodeSSEEvent(notification));
    }
  }

  /**
   * Fan-out a notifications/resources/updated event to subscriptions whose
   * agreed filter includes the given URI.
   */
  fanOutResourceUpdated(uri: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.sink.isClosed) {
        this.entries.delete(key);
        continue;
      }
      const uris = entry.agreedFilter.resourceSubscriptions;
      if (!Array.isArray(uris) || !uris.includes(uri)) continue;
      const notification = stampSubscriptionMeta(
        {
          jsonrpc: "2.0",
          method: "notifications/resources/updated",
          params: { uri },
        },
        entry.subscriptionId,
      );
      entry.sink.enqueue(encodeSSEEvent(notification));
    }
  }

  /**
   * Gracefully shut down all live subscriptions (call from McpApp.stop()).
   *
   * Equivalent to unregister(key, "server") for every live entry, then
   * stopping the keep-alive timer.
   */
  shutdown(): void {
    // Snapshot keys to avoid mutation-while-iterating issues.
    const keys = [...this.entries.keys()];
    for (const key of keys) {
      this.unregister(key, "server");
    }
    this.stopKeepAlive();
  }

  /** Count of live (not-yet-unregistered) subscriptions. */
  get count(): number {
    return this.entries.size;
  }

  /**
   * Start the periodic keep-alive timer.
   *
   * Injectable setInterval and unref so tests can use fake timers and the
   * timer does not prevent process exit. Calling again while a timer is
   * already running is a no-op (guards against double-start in embedded mode
   * where startHttp may be called via getFetchHandler).
   */
  startKeepAlive(
    setIntervalFn: (
      fn: () => void,
      ms: number,
    ) => ReturnType<typeof setInterval> = globalThis.setInterval,
    unrefFn?: (id: ReturnType<typeof setInterval>) => void,
  ): void {
    if (this.keepAliveTimer !== null) return;
    this.keepAliveTimer = setIntervalFn(
      () => this._sendKeepAlive(),
      this.opts.keepAliveIntervalMs,
    );
    if (unrefFn) unrefFn(this.keepAliveTimer);
  }

  /** Stop the keep-alive timer (called internally by shutdown()). */
  stopKeepAlive(): void {
    if (this.keepAliveTimer === null) return;
    clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /**
   * Emit a keep-alive comment line on every live sink.
   *
   * Spec (streamable-http page — Receiving Messages Note): "servers are
   * encouraged to periodically emit an SSE comment line (a line beginning
   * with a colon, e.g. `:\r\n`) as a keep-alive".
   *
   * Internal — called by the interval timer. Not private so tests can invoke
   * it directly without fake timers.
   */
  _sendKeepAlive(): void {
    const ping = encodeSSEKeepAlive();
    for (const [key, entry] of this.entries) {
      if (entry.sink.isClosed) {
        this.entries.delete(key);
        continue;
      }
      entry.sink.enqueue(ping);
    }
  }
}
