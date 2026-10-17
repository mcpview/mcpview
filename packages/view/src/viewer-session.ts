/** Whole-resource recorded-session action lifecycle. */

import { VIEWER_SESSION_APPLY_ACTION } from "@mcpview/contracts";

import type { ComposeEventClient, ComposeEventPayload } from "./compose-events.ts";
import type { AppContext, AppHandle, ViewerSessionSubscription } from "./types.ts";

interface PendingSession<TSession> {
  readonly session: TSession;
  readonly payload: ComposeEventPayload;
}

/**
 * Resource-level session dispatcher returned by {@link onViewerSession}.
 *
 * `activate()` supplies the fully initialized App handle and replays any
 * session captured during the handshake. `dispose()` synchronously removes
 * the resource subscription, drops pending sessions, and revokes navigation
 * on the callback facade. It deliberately does not await or cancel arbitrary
 * callback code already in flight. Framework components never own this
 * lifecycle.
 */
export interface ViewerSessionDispatcher<S> {
  activate(handle: AppHandle<S>): Promise<void>;
  /** Explicitly wait for callbacks observed so far; never called by `dispose()`. */
  drain(): Promise<void>;
  /** Synchronous unsubscribe and navigation revocation. */
  dispose(): void;
}

/**
 * Install the resource-level `viewer.session.apply` action immediately.
 *
 * Call this before `App.connect()` (as `createMcpApp` does for its
 * `viewerSession` option). The host transports `payload.data` unchanged;
 * only the owning App validator may interpret it. Valid sessions received
 * before `activate()` are retained in FIFO order, then all callbacks are
 * serialized so a later session cannot overtake an earlier one.
 */
export function onViewerSession<S, TSession>(
  events: ComposeEventClient | undefined,
  subscription: ViewerSessionSubscription<S, TSession>,
): ViewerSessionDispatcher<S> {
  if (typeof subscription.validate !== "function") {
    throw new TypeError("onViewerSession: validate must be a function");
  }
  if (typeof subscription.onSession !== "function") {
    throw new TypeError("onViewerSession: onSession must be a function");
  }

  const pending: PendingSession<TSession>[] = [];
  let handle: AppHandle<S> | undefined;
  let queue = Promise.resolve();
  let disposed = false;

  const reportError = (error: unknown): void => {
    if (subscription.onError) {
      try {
        subscription.onError(error);
        return;
      } catch (sinkError) {
        console.error("[mcp-view] viewer session error sink failed:", sinkError);
      }
    }
    console.error("[mcp-view] viewer session handler failed:", error);
  };

  const enqueue = (entry: PendingSession<TSession>): void => {
    queue = queue.then(async () => {
      if (!handle || disposed) return;
      try {
        await subscription.onSession(entry.session, entry.payload, handle);
      } catch (error) {
        reportError(error);
      }
    });
  };

  const drain = async (): Promise<void> => {
    while (true) {
      const observed = queue;
      await observed;
      if (observed === queue) return;
    }
  };

  const off = events?.on(VIEWER_SESSION_APPLY_ACTION, (payload) => {
    if (disposed) return;
    let session: TSession;
    try {
      if (!subscription.validate(payload.data)) {
        try {
          subscription.onInvalid?.(payload);
        } catch (error) {
          reportError(error);
        }
        return;
      }
      session = payload.data;
    } catch (error) {
      reportError(error);
      return;
    }
    const entry = { session, payload };
    if (!handle) pending.push(entry);
    else enqueue(entry);
  });

  return {
    async activate(nextHandle): Promise<void> {
      if (disposed) throw new Error("ViewerSessionDispatcher has been disposed");
      if (handle) throw new Error("ViewerSessionDispatcher.activate() may only be called once");
      handle = createRevocableSessionHandle(nextHandle, () => disposed);
      for (const entry of pending.splice(0)) enqueue(entry);
      await drain();
    },
    drain(): Promise<void> {
      return drain();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pending.splice(0);
      off?.();
    },
  };
}

function createRevocableSessionHandle<S>(
  handle: AppHandle<S>,
  isRevoked: () => boolean,
): AppHandle<S> {
  const navigate: AppHandle<S>["navigate"] = (name, args) => {
    if (isRevoked()) {
      return Promise.reject(
        new Error("Viewer session navigation is revoked after dispatcher disposal"),
      );
    }
    return handle.navigate(name, args);
  };
  const context: AppContext<S> = Object.freeze({
    navigate,
    callTool: (name, args) => handle.ctx.callTool(name, args),
    get capabilities() {
      return handle.ctx.capabilities;
    },
    get hostContext() {
      return handle.ctx.hostContext;
    },
    get state() {
      return handle.ctx.state;
    },
    set state(value: S) {
      handle.ctx.state = value;
    },
    sample: (args) => handle.ctx.sample(args),
    get tools() {
      return handle.ctx.tools;
    },
    get events() {
      return handle.ctx.events;
    },
    get app() {
      return handle.ctx.app;
    },
  });

  return Object.freeze({
    ctx: context,
    get events() {
      return handle.events;
    },
    get currentView() {
      return handle.currentView;
    },
    navigate,
    dispose: () => handle.dispose(),
  });
}
