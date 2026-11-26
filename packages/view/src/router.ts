/**
 * Memory-based view router for MCP App views.
 *
 * The router owns two pieces of state — `currentView` and the DOM root —
 * and orchestrates the `onLeave → onEnter → render → mount` sequence. No
 * URL, no history, no reactivity. Re-navigating to the current view is
 * allowed and re-runs the full lifecycle.
 *
 * Errors in `onEnter` / `render` / `onLeave` propagate out of
 * {@link Router.goto}. The router does NOT swallow them; silent error
 * handling in a routing layer masks bugs.
 *
 * Note on innerHTML: views that opt into the `string` render path are
 * trusting their own template output. Authors concerned about XSS should
 * return a `Node` built via safe DOM APIs instead.
 *
 * @module
 */

import type { AppContext, ViewMap, ViewOutput } from "./types.ts";
import type { ToolRegistry } from "./tools.ts";
import { MCPViewError } from "./errors.ts";

/**
 * Internal router state. Constructed by `app.ts`; not exported publicly.
 */
export class Router<S> {
  readonly views: ViewMap<S>;
  readonly root: HTMLElement;
  private _currentView: string | null = null;
  private _context: AppContext<S> | null = null;
  private _queue: Promise<void> = Promise.resolve();
  private _toolRegistry: ToolRegistry<S> | null = null;
  private _disposed = false;
  private _disposePromise: Promise<void> | null = null;

  constructor(views: ViewMap<S>, root: HTMLElement, private readonly mountSignal?: AbortSignal) {
    this.views = views;
    this.root = root;
  }

  /**
   * Wire the context. Must be called before {@link goto}. The context is
   * constructed in `app.ts` after the router instance (the context's
   * `navigate` binds back to this router), so injection happens post-hoc.
   */
  setContext(ctx: AppContext<S>): void {
    this._context = ctx;
  }

  /**
   * Inject the tool registry. Optional: when absent, view-declared tools
   * are silently skipped (used by router_test which doesn't exercise the
   * tools surface). When present, the router calls `unregisterAll()` after
   * the previous view's `onLeave` (so user cleanup can still touch
   * `ctx.tools.*` on its own tools) and `registerForView(target.tools)`
   * after the target's `onEnter` (so data-loading runs before the host can
   * call them). Net effect: the host sees only the active view's tools.
   */
  setToolRegistry(registry: ToolRegistry<S>): void {
    this._toolRegistry = registry;
  }

  get currentView(): string {
    if (this._currentView === null) {
      throw new Error(
        "Router.currentView read before initial navigation — " +
          "did you forget to await createMcpApp()?",
      );
    }
    return this._currentView;
  }

  /**
   * Returns a promise that resolves when all pending navigations complete.
   * Useful for graceful shutdown before closing the transport.
   */
  drain(): Promise<void> {
    return this._queue;
  }

  /**
   * Switch to a registered view. Calls are serialized: concurrent `goto`
   * calls are queued and executed one at a time to prevent interleaved
   * lifecycle hooks.
   *
   * Runs the previous view's `onLeave`, then the target's `onEnter`, then
   * its `render`, then mounts the output into the DOM root.
   */
  goto(name: string, args: unknown): Promise<void> {
    if (this._disposed) {
      return Promise.reject(new Error("Router has been disposed"));
    }
    // Chain onto the existing queue. The onReject branch keeps the queue alive
    // even if the previous navigation threw, so subsequent gotos still run.
    this._queue = this._queue.then(
      () => this._doGoto(name, args),
      () => this._doGoto(name, args),
    );
    return this._queue;
  }

  /**
   * Leave the active view and clear its tools/DOM. Serialized after any
   * navigation already in flight and idempotent across host/manual teardown.
   */
  dispose(): Promise<void> {
    if (this._disposePromise) return this._disposePromise;
    this._disposed = true;
    this._disposePromise = this._queue.then(
      () => this._doDispose(),
      () => this._doDispose(),
    );
    this._queue = this._disposePromise;
    return this._disposePromise;
  }

  private async _doGoto(name: string, args: unknown): Promise<void> {
    this.mountSignal?.throwIfAborted();
    if (this._context === null) {
      throw new MCPViewError(
        "ROUTER_NOT_INITIALIZED",
        "Router.goto called before setContext",
      );
    }
    const target = this.views[name];
    if (!target) {
      throw new MCPViewError(
        "UNKNOWN_VIEW",
        `Unknown view "${name}". Registered views: ${
          Object.keys(this.views).join(", ") || "(none)"
        }`,
        { view: name, registered: Object.keys(this.views) },
      );
    }

    // Snapshot and clear _currentView before any async lifecycle hook.
    // This ensures that if onLeave or onEnter throws, the router does not
    // keep a stale pointer to the half-left view.
    const prevName = this._currentView;
    this._currentView = null;

    if (prevName !== null) {
      const prev = this.views[prevName];
      if (prev?.onLeave) {
        await prev.onLeave(this._context);
      }
      // Unregister the previous view's tools after onLeave so that any
      // cleanup the user does there can still call ctx.tools.* on its
      // own tools. ext-apps emits tools/list_changed per-tool internally.
      this._toolRegistry?.unregisterAll();
    }

    this.mountSignal?.throwIfAborted();
    const data = target.onEnter ? await target.onEnter(this._context, args) : undefined;
    this.mountSignal?.throwIfAborted();

    // Register tools after onEnter so the user's data-loading code runs
    // before the host can call them. ext-apps emits tools/list_changed
    // per-tool internally — no batching at this layer.
    this._toolRegistry?.registerForView(target.tools);

    const output = target.render(this._context, data);

    this.mountSignal?.throwIfAborted();
    mount(this.root, output);
    this._currentView = name;
  }

  private async _doDispose(): Promise<void> {
    const activeName = this._currentView;
    this._currentView = null;
    const errors: unknown[] = [];

    try {
      if (activeName !== null && this._context !== null) {
        await this.views[activeName]?.onLeave?.(this._context);
      }
    } catch (error) {
      errors.push(error);
    }

    // Framework cleanup continues even when an adapter's onLeave hook fails,
    // so teardown cannot strand tools or renderer-owned DOM.
    try {
      this._toolRegistry?.unregisterAll();
    } catch (error) {
      errors.push(error);
    }
    try {
      this.root.replaceChildren();
    } catch (error) {
      errors.push(error);
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, "mcp-view active route cleanup failed");
    }
  }
}

/**
 * Replace the contents of `root` with `output`. Accepts HTML strings or
 * pre-built DOM nodes. See module docstring on innerHTML trust model.
 */
function mount(root: HTMLElement, output: ViewOutput): void {
  if (typeof output === "string") {
    // deno-lint-ignore no-explicit-any
    (root as any).innerHTML = output;
    return;
  }
  root.replaceChildren(output);
}
