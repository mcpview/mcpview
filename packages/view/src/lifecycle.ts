/**
 * Lifecycle notifications received from an MCP Apps host while a view-side
 * application is bootstrapping.
 *
 * ext-apps requires its one-shot notification handlers to be registered
 * before `App.connect()`. `createMcpApp`, however, can only expose its
 * `AppHandle` after the handshake and initial route are ready. This module
 * bridges that gap: it captures early notifications, then replays every
 * callback in arrival order once a handle is available.
 *
 * @module
 */

import type { App } from "@modelcontextprotocol/ext-apps";
import type {
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";

import type { AppHandle, AppLifecycleCallbacks } from "./types.ts";

/** Source of the first teardown request that wins the idempotency race. */
export type TeardownReason = "host" | "dispose";

/** Author cleanup hook, invoked at most once with a fully initialized handle. */
export type TeardownLifecycleCallback<S> = (
  handle: AppHandle<S>,
  reason: TeardownReason,
) => void | Promise<void>;

/** Notification payload for a completed tool-input notification. */
export type ToolInputParams = McpUiToolInputNotification["params"];

/** Notification payload for a streaming, partial tool-input notification. */
export type ToolInputPartialParams = McpUiToolInputPartialNotification["params"];

/** Notification payload for a completed tool-result notification. */
export type ToolResultParams = McpUiToolResultNotification["params"];

/**
 * The three one-shot MCP Apps notifications that authors may observe through
 * {@link AppLifecycleCallbacks}. This union intentionally stays internal: the
 * public API is the named callbacks, which are easier to discover and type.
 */
type LifecycleEvent =
  | { kind: "toolInput"; params: ToolInputParams }
  | { kind: "toolInputPartial"; params: ToolInputPartialParams }
  | { kind: "toolResult"; params: ToolResultParams };

/** Structural minimum needed to install the ext-apps one-shot callbacks. */
type OneShotEventSource = Pick<App, "ontoolinput" | "ontoolinputpartial" | "ontoolresult">;

/** Structural minimum needed to register host teardown before connect. */
type TeardownEventSource = Pick<App, "onteardown">;

/**
 * Register the ext-apps one-shot notification handlers immediately.
 *
 * This function must run before `App.connect()`. It is deliberately separate
 * from activation so unit tests can verify the protocol ordering without a
 * DOM or a real postMessage transport.
 */
export function wireLifecycleCallbacks<S>(
  app: OneShotEventSource,
  callbacks: AppLifecycleCallbacks<S>,
): LifecycleDispatcher<S> {
  const dispatcher = new LifecycleDispatcher(callbacks);
  app.ontoolinput = (params) => dispatcher.capture({ kind: "toolInput", params });
  app.ontoolinputpartial = (params) => dispatcher.capture({ kind: "toolInputPartial", params });
  app.ontoolresult = (params) => dispatcher.capture({ kind: "toolResult", params });
  return dispatcher;
}

/**
 * Register `ui/resource-teardown` before `App.connect()` and coordinate it
 * with manual `AppHandle.dispose()`. Both paths share one cleanup operation.
 */
export function wireTeardownLifecycle<S>(
  app: TeardownEventSource,
  callback?: TeardownLifecycleCallback<S>,
): TeardownDispatcher<S> {
  const dispatcher = new TeardownDispatcher(callback);
  app.onteardown = async () => {
    await dispatcher.request("host");
    return {};
  };
  return dispatcher;
}

/** Internal cleanup function installed once the router and handle exist. */
type InternalCleanup = () => void | Promise<void>;

/**
 * Defers an early host request until activation, then runs author and
 * framework cleanup exactly once. Transport closure remains the manual
 * dispose caller's responsibility so the host request can still be replied to.
 */
export class TeardownDispatcher<S> {
  private readonly callback?: TeardownLifecycleCallback<S>;
  private handle?: AppHandle<S>;
  private cleanup?: InternalCleanup;
  private cleanupPromise?: Promise<void>;
  private pending?: {
    readonly reason: TeardownReason;
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  };

  constructor(callback?: TeardownLifecycleCallback<S>) {
    this.callback = callback;
  }

  /** Supply the fully initialized handle and framework cleanup operation. */
  activate(handle: AppHandle<S>, cleanup: InternalCleanup): void {
    if (this.handle) throw new Error("TeardownDispatcher.activate() may only be called once");
    this.handle = handle;
    this.cleanup = cleanup;
    if (!this.pending) return;

    const pending = this.pending;
    this.pending = undefined;
    this.run(pending.reason).then(pending.resolve, pending.reject);
  }

  /** Manual-dispose entry point. */
  dispose(): Promise<void> {
    return this.request("dispose");
  }

  /** Reject a host request buffered during a failed bootstrap. */
  abort(error: unknown): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    pending.reject(error);
  }

  /** Shared host/manual idempotency gate. */
  request(reason: TeardownReason): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (this.handle && this.cleanup) {
      this.cleanupPromise = this.run(reason);
      return this.cleanupPromise;
    }

    this.cleanupPromise = new Promise<void>((resolve, reject) => {
      this.pending = { reason, resolve, reject };
    });
    return this.cleanupPromise;
  }

  private async run(reason: TeardownReason): Promise<void> {
    if (!this.handle || !this.cleanup) {
      throw new Error("TeardownDispatcher cleanup ran before activation");
    }

    const errors: unknown[] = [];
    try {
      await this.callback?.(this.handle, reason);
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.cleanup();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "mcp-view teardown callbacks failed");
    }
  }
}

/**
 * Buffers host notifications until an {@link AppHandle} exists, then invokes
 * user callbacks one at a time. A slow asynchronous callback therefore never
 * lets a later notification overtake an earlier one.
 */
export class LifecycleDispatcher<S> {
  private readonly callbacks: AppLifecycleCallbacks<S>;
  private readonly pending: LifecycleEvent[] = [];
  private handle: AppHandle<S> | undefined;
  private queue: Promise<void> = Promise.resolve();

  constructor(callbacks: AppLifecycleCallbacks<S>) {
    this.callbacks = callbacks;
  }

  /** Capture an event synchronously. It is either buffered or queued. */
  capture(event: LifecycleEvent): void {
    if (!this.handle) {
      this.pending.push(event);
      return;
    }
    this.enqueue(event);
  }

  /**
   * Make the handle visible to callbacks and replay the early-notification
   * buffer. Resolves only after that replay completes, including async user
   * callbacks. Events arriving during replay append after the buffered FIFO.
   */
  async activate(handle: AppHandle<S>): Promise<void> {
    if (this.handle) {
      throw new Error("LifecycleDispatcher.activate() may only be called once");
    }
    this.handle = handle;
    for (const event of this.pending.splice(0)) this.enqueue(event);
    await this.drain();
  }

  /** Wait until all notifications observed so far have been delivered. */
  drain(): Promise<void> {
    return this.queue;
  }

  private enqueue(event: LifecycleEvent): void {
    this.queue = this.queue.then(async () => {
      if (!this.handle) return;
      try {
        switch (event.kind) {
          case "toolInput":
            await this.callbacks.onToolInput?.(event.params, this.handle);
            break;
          case "toolInputPartial":
            await this.callbacks.onToolInputPartial?.(event.params, this.handle);
            break;
          case "toolResult":
            await this.callbacks.onToolResult?.(event.params, this.handle);
            break;
        }
      } catch (error) {
        // Host notification handlers cannot report a response. Surface the
        // application error without poisoning the FIFO and losing later events.
        console.error(`[mcp-view] ${event.kind} lifecycle callback failed:`, error);
      }
    });
  }
}
