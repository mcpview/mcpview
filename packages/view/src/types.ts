/**
 * Public type surface for `@mcpview/view`.
 *
 * View-side SDK for MCP Apps: bootstraps the ext-apps `App`, performs the
 * `ui/initialize` handshake, and runs a memory-based view router inside the
 * iframe. Authors compose views with {@link defineView} and start the app
 * with {@link createMcpApp}.
 *
 * No implementation lives in this file — only signatures. Runtime code is in
 * sibling modules (`app.ts`, `router.ts`, `capabilities.ts`).
 *
 * @module
 */

import type {
  App,
  McpUiAppCapabilities,
  McpUiHostCapabilities,
  McpUiHostContext,
  McpUiToolInputNotification,
  McpUiToolInputPartialNotification,
  McpUiToolResultNotification,
} from "@modelcontextprotocol/ext-apps";
import type { CallToolResult, Implementation } from "@modelcontextprotocol/client";

import type { SampleArgs, SampleResult } from "./sample.ts";
import type { ComposeEventClient, ComposeEventPayload } from "./compose-events.ts";
import type { TeardownLifecycleCallback } from "./lifecycle.ts";
import type { ToolsHandle, ViewToolDef } from "./tools.ts";

export type { SampleArgs, SampleResult } from "./sample.ts";
export type { TeardownLifecycleCallback, TeardownReason } from "./lifecycle.ts";
export type { InferToolArgs, ToolsHandle, ViewToolDef } from "./tools.ts";

// ---------------------------------------------------------------------------
// Rendering primitives
// ---------------------------------------------------------------------------

/**
 * Output of a view's `render` function.
 *
 * - `string` — HTML string, inserted via `innerHTML`. Pick this for vanilla
 *   template-literal views (the default path).
 * - `Node` — a pre-built DOM node, appended as-is. Pick this when you build
 *   the tree imperatively and want to preserve element identity / event
 *   listeners across re-renders of unrelated views.
 *
 * Framework adapters (React, Vue, …) will ship in separate sub-exports and
 * are responsible for bridging their VDOM into one of these two forms.
 */
export type ViewOutput = string | Node;

// ---------------------------------------------------------------------------
// Host notification lifecycle
// ---------------------------------------------------------------------------

/**
 * Callback invoked when the host sends the complete arguments for the tool
 * that opened or updates this App. It receives a fully initialized handle.
 */
export type ToolInputLifecycleCallback<S> = (
  params: McpUiToolInputNotification["params"],
  app: AppHandle<S>,
) => void | Promise<void>;

/**
 * Callback invoked for streaming partial tool arguments. It receives a fully
 * initialized handle, even when the host notification arrived during the
 * `ui/initialize` handshake.
 */
export type ToolInputPartialLifecycleCallback<S> = (
  params: McpUiToolInputPartialNotification["params"],
  app: AppHandle<S>,
) => void | Promise<void>;

/**
 * Callback invoked when the host sends a completed tool result. It receives a
 * fully initialized handle, even when the host notification arrived during
 * the `ui/initialize` handshake.
 */
export type ToolResultLifecycleCallback<S> = (
  params: McpUiToolResultNotification["params"],
  app: AppHandle<S>,
) => void | Promise<void>;

/**
 * Optional lifecycle callbacks for the three common MCP Apps one-shot
 * notifications. `createMcpApp` installs its ext-apps handlers before
 * `connect()` and buffers events until the `AppHandle` is fully ready.
 *
 * Callbacks run in host arrival order across all three notification kinds.
 * Async callbacks are serialized: a later callback waits for the previous one
 * to settle. Errors are logged and do not prevent later notifications from
 * being delivered.
 */
export interface AppLifecycleCallbacks<S> {
  onToolInput?: ToolInputLifecycleCallback<S>;
  onToolInputPartial?: ToolInputPartialLifecycleCallback<S>;
  onToolResult?: ToolResultLifecycleCallback<S>;

  /**
   * Cleanup invoked for either host `ui/resource-teardown` or manual
   * `dispose()`, whichever arrives first. Registered before `connect()` and
   * called at most once with a fully initialized handle.
   */
  onTeardown?: TeardownLifecycleCallback<S>;
}

/**
 * Resource-level handler for one validated recorded-session envelope.
 * `app` is a facade whose two navigation entry points are synchronously
 * revoked when the session dispatcher is disposed.
 */
export type ViewerSessionHandler<S, TSession> = (
  session: TSession,
  payload: ComposeEventPayload,
  app: AppHandle<S>,
) => void | Promise<void>;

/**
 * App-owned contract for the whole-resource `viewer.session.apply` action.
 * The host payload remains `unknown` until `validate` accepts it.
 */
export interface ViewerSessionSubscription<S, TSession> {
  readonly validate: (value: unknown) => value is TSession;
  readonly onSession: ViewerSessionHandler<S, TSession>;
  readonly onInvalid?: (payload: ComposeEventPayload) => void;
  readonly onError?: (error: unknown) => void;
}

/**
 * A view's render function. Pure: must depend only on `ctx` and `data`.
 *
 * Called after `onEnter` resolves. If `onEnter` is omitted, `data` is
 * `undefined`.
 *
 * @typeParam S - User state shape, shared across views via `ctx.state`.
 * @typeParam D - Data shape returned by this view's `onEnter`.
 */
export type ViewRenderer<S, D> = (
  ctx: AppContext<S>,
  data: D,
) => ViewOutput;

/**
 * Lifecycle hooks for a view.
 *
 * - `onEnter` runs before `render`. Fetch remote data here via
 *   `ctx.callTool`. Whatever is returned is forwarded to `render` as `data`.
 *   Throw to abort navigation (the error propagates out of `ctx.navigate`).
 * - `onLeave` runs before the next view's `onEnter`. Use for cleanup of
 *   listeners / timers attached during `render`. Return value is ignored.
 *
 * @typeParam S - User state shape.
 * @typeParam A - Args shape accepted by `onEnter` (forwarded from
 *   `ctx.navigate(name, args)`).
 * @typeParam D - Data shape produced by `onEnter` and consumed by `render`.
 */
export interface ViewLifecycle<S, A, D> {
  /**
   * Resolve the data needed by `render`. Optional; omit for static views.
   *
   * @param ctx - App context (navigate, callTool, capabilities, state).
   * @param args - Args passed by the caller of `ctx.navigate(name, args)`.
   *   Typed via the view's `A` generic; at the `navigate` call site the
   *   type is inferred from the views map (see {@link AppConfig}).
   */
  onEnter?(ctx: AppContext<S>, args: A): D | Promise<D>;

  /**
   * Called when leaving this view (including when re-navigating to self
   * with new args). Intended for listener/timer cleanup.
   */
  onLeave?(ctx: AppContext<S>): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// View definition
// ---------------------------------------------------------------------------

/**
 * Complete view contract returned by {@link defineView}.
 *
 * @typeParam S - User state shape.
 * @typeParam A - Args accepted on entry. `void` means no args required.
 * @typeParam D - Data produced by `onEnter`. `void`/`undefined` for static
 *   views (no `onEnter`).
 */
export interface ViewDefinition<S, A = void, D = void> extends ViewLifecycle<S, A, D> {
  /**
   * Render the view. Receives the `data` returned by `onEnter` (or
   * `undefined` if none).
   */
  render: ViewRenderer<S, D>;

  /**
   * Tools this view exposes to the host (and its agent) while mounted.
   * Auto-registered after `onEnter` resolves and removed before the next
   * view's `onEnter` runs.
   *
   * Notifications: ext-apps emits `tools/list_changed` from each
   * `registerTool` and `RegisteredAppTool.remove` call internally — the
   * wrapper does not batch on top, so the host sees one notification per
   * tool per transition. Tool maps are typically small (a few entries) so
   * the wire chatter is acceptable.
   *
   * For dynamic availability ("save" only when a form is dirty), use
   * `ctx.tools.disable(name)` / `enable(name)` rather than re-creating
   * the view.
   *
   * Each tool's `handler(ctx, args)` is invoked with the live `AppContext`
   * and the schema-validated args. Return a `CallToolResult` (the SDK
   * shape — `{ content: [...], isError? }`).
   */
  // deno-lint-ignore no-explicit-any
  tools?: Record<string, ViewToolDef<S, any>>;
}

// ---------------------------------------------------------------------------
// Context (passed to every hook)
// ---------------------------------------------------------------------------

/**
 * Result shape of `ctx.callTool`.
 *
 * Re-export of `CallToolResult` from the MCP SDK (surfaced via ext-apps).
 * Note: tool-level errors arrive as `{ isError: true, content: [...] }` —
 * they are NOT thrown. Transport errors and missing-capability errors ARE
 * thrown. See spec.md §"Error contract".
 */
export type ToolResult = CallToolResult;

/**
 * Runtime context passed to every view hook (`onEnter`, `render`, `onLeave`).
 *
 * Designed to be extended: new methods (`sendMessage`, `requestDisplayMode`, …)
 * can be added as optional fields in future minor versions without breaking
 * existing views.
 *
 * @typeParam S - User state shape declared in {@link AppConfig}.
 */
export interface AppContext<S> {
  /**
   * Switch to another view. Memory-only: does not hit the host.
   *
   * @param name - Key from the `views` map declared in {@link AppConfig}.
   * @param args - Args forwarded to the target view's `onEnter`. Typed as
   *   `unknown` at this level because `AppContext` is not generic over the
   *   views map; concrete apps can tighten via a local helper type.
   * @throws Error when `name` is not a registered view.
   */
  navigate(name: string, args?: unknown): Promise<void>;

  /**
   * Call a tool on the originating MCP server (proxied through the host).
   *
   * Thin wrapper around `App.callServerTool`. Checks the host advertised
   * the `serverTools` capability before calling.
   *
   * @throws Error if `capabilities.serverTools` is absent.
   * @throws Error on transport failure, timeout, or host refusal.
   * @returns Tool result. Check `result.isError` for tool-level failures.
   */
  callTool(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<ToolResult>;

  /**
   * Frozen snapshot of host capabilities received during `ui/initialize`.
   * Undefined guard not needed: `createMcpApp` never resolves before the
   * handshake completes.
   */
  readonly capabilities: McpUiHostCapabilities;

  /**
   * Live host context snapshot (theme, styles, locale, timezone, displayMode,
   * `toolInfo` about the call that instantiated this App, etc.). Getter —
   * the returned reference is updated when `ui/notifications/host-context-
   * changed` fires, so readers always see the current state.
   *
   * The SDK automatically applies `theme`, `styles.variables`, and
   * `styles.css.fonts` to the document on initialize and on every host-
   * context-changed notification. Read this for the non-styling fields
   * (`locale`, `timezone`, `displayMode`, `toolInfo`).
   */
  readonly hostContext: McpUiHostContext;

  /**
   * Shared mutable user state. Authors can mutate fields directly; views
   * must re-render (via `navigate(currentView, args)`) to reflect changes.
   * No reactivity is provided by design.
   */
  state: S;

  /**
   * Request an LLM completion from the host (MCP `sampling/createMessage`).
   *
   * Capability-gated on `host.capabilities.sampling`. Throws
   * `MCPViewError("MISSING_SAMPLING_CAPABILITY")` if absent.
   *
   * Two forms (mutually exclusive at the type level):
   * - `{ prompt }` — sugar for a single user message.
   * - `{ messages }` — explicit multi-turn array.
   *
   * Returns `{ text, stopReason, model, raw }`. `text` is the concatenation
   * of every `type: "text"` block in the response; for multimodal output or
   * tool-use loops, read `raw` directly or call
   * `ctx.app.createSamplingMessage(...)` for full control.
   */
  sample(args: SampleArgs): Promise<SampleResult>;

  /**
   * Imperative handle to the tools the current view declared via
   * `defineView({ tools })`. Use this when availability depends on runtime
   * state (form dirty, selection size, …) — `disable` / `enable` flip the
   * advertised availability without unmounting the view.
   *
   * `remove(name)` is permanent for the rest of the view's lifetime; the
   * tool will only come back if the view is re-entered. For schema swaps,
   * remove and re-register on the next view rather than mutating in place.
   *
   * Throws `MCPViewError("UNKNOWN_TOOL")` when the named tool is not
   * registered by the active view.
   */
  readonly tools: ToolsHandle;

  /**
   * Optional cross-viewer event channel. It is always safe to subscribe;
   * events are delivered only when the host routes `ui/compose/event`.
   * This API is standalone and does not depend on `@mcpview/compose`.
   */
  readonly events?: ComposeEventClient;

  /**
   * Escape hatch: the underlying ext-apps `App` instance. Use for anything
   * the SDK does not wrap (sendMessage, updateModelContext, event listeners,
   * `createSamplingMessage` with `tools`, raw `registerTool` handles, …).
   */
  readonly app: App;
}

// ---------------------------------------------------------------------------
// App configuration
// ---------------------------------------------------------------------------

/**
 * Map of view name → view definition. The keys form the valid argument set
 * for `ctx.navigate` and `AppConfig.initialView`.
 *
 * Using `ViewDefinition<S, any, any>` here is deliberate: args and data
 * shapes vary per view, and a heterogeneous map cannot be typed more
 * precisely without forcing a tuple/const-map pattern that would hurt
 * ergonomics. Per-view types remain enforced inside each `defineView` call.
 */
// deno-lint-ignore no-explicit-any
export type ViewMap<S> = Record<string, ViewDefinition<S, any, any>>;

/**
 * Config passed to {@link createMcpApp}.
 *
 * @typeParam S - User state shape. Defaults to an empty object.
 */
export interface AppConfig<S = Record<string, never>, TSession = never>
  extends AppLifecycleCallbacks<S> {
  /**
   * App identity advertised to the host in `ui/initialize`.
   */
  info: Implementation;

  /**
   * DOM element where views mount. Its contents are replaced on every
   * navigation. Typically `document.getElementById("root")`.
   */
  root: HTMLElement;

  /**
   * Map of view name → {@link ViewDefinition}.
   */
  views: ViewMap<S>;

  /**
   * Name of the view to mount after the handshake. Must be a key of
   * `views`. Runtime validates this.
   */
  initialView: keyof ViewMap<S> & string;

  /**
   * Args passed to `initialView.onEnter`. Type left as `unknown` for the
   * same reason as `navigate` — the map is heterogeneous.
   */
  initialArgs?: unknown;

  /**
   * Initial user state. Reference kept live as `ctx.state`.
   */
  initialState?: S;

  /**
   * Optional whole-resource recorded-session lifecycle. The runtime installs
   * it before `connect()`, buffers valid early sessions until the App handle
   * exists, and disposes it with the resource. Disposal synchronously revokes
   * navigation on the callback handle/context facade; it does not wait for
   * arbitrary callback code already in flight. Individual components must not
   * subscribe to `viewer.session.apply`.
   */
  viewerSession?: ViewerSessionSubscription<S, TSession>;

  /**
   * Capabilities advertised to the host. Default: `{}` (no app-side
   * capabilities). Set this if the view itself exposes tools via
   * `ctx.app.oncalltool`.
   */
  capabilities?: McpUiAppCapabilities;

  /**
   * Auto-apply theme + CSS variables + font rules from host context to the
   * document on handshake and on every `host-context-changed` notification.
   *
   * Default: `true`. Set to `false` if the App manages its own theming (e.g.
   * ships with its own complete stylesheet that ignores host-provided vars).
   *
   * When `false`, `ctx.hostContext` still reflects the live host context —
   * only the side-effects (calls to `applyDocumentTheme`,
   * `applyHostStyleVariables`, `applyHostFonts`) are skipped.
   */
  autoTheme?: boolean;

  /**
   * Throw on detected ext-apps misuse instead of logging `console.warn`.
   *
   * Forwarded to the ext-apps `App` constructor as `AppOptions.strict`.
   * Currently affects calling host-bound methods (e.g. `callServerTool`,
   * `sendMessage`) before `connect()` completes the `ui/initialize`
   * handshake, and registering one-shot event handlers after `connect()`.
   *
   * Default: `false` (warn only). Recommended: `true` in dev to surface
   * ordering bugs early; ext-apps documents that throw will become the
   * default in a future major release.
   */
  strict?: boolean;

  /**
   * Allow runtime expression compilation (`eval`-class APIs) in ext-apps
   * internals — currently affects Zod's JIT path only.
   *
   * Forwarded to the ext-apps `App` constructor as
   * `AppOptions.allowUnsafeEval`. Default: `false` — runs under strict CSP
   * (`z.config({ jitless: true })`) so a host with `Content-Security-Policy:
   * script-src 'self'` does not crash the app. Set to `true` only when the
   * host's CSP explicitly allows `unsafe-eval` and the JIT path is needed
   * for performance.
   */
  allowUnsafeEval?: boolean;

  /**
   * Automatically report iframe size changes to the host via a
   * `ResizeObserver` watching `document.body` and `document.documentElement`.
   *
   * Forwarded to the ext-apps `App` constructor as `AppOptions.autoResize`.
   * Default (per ext-apps): `true`. Set to `false` if the App manages its
   * own size negotiation explicitly (e.g. for fixed-aspect-ratio embeds).
   */
  autoResize?: boolean;
}

// ---------------------------------------------------------------------------
// createMcpApp return value
// ---------------------------------------------------------------------------

/**
 * Handle returned by {@link createMcpApp}. Exposes the live context plus
 * imperative navigation from outside any view (e.g. from a top-level
 * DOM event listener installed before the first view mounts).
 */
export interface AppHandle<S> {
  /**
   * The context that views receive. Same object reference across the
   * app's lifetime.
   */
  readonly ctx: AppContext<S>;

  /** Same standalone event client exposed as `ctx.events`. */
  readonly events?: ComposeEventClient;

  /**
   * Name of the currently-mounted view.
   */
  readonly currentView: string;

  /**
   * Imperative navigate; equivalent to `handle.ctx.navigate(...)`.
   */
  navigate(name: string, args?: unknown): Promise<void>;

  /**
   * Tear down the router and close the transport. Idempotent.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Factory signatures (implementation lives in sibling modules)
// ---------------------------------------------------------------------------

/**
 * Identity function over {@link ViewDefinition}; exists for type inference
 * of `S`, `A`, `D` at the call site.
 */
export declare function defineView<S, A = void, D = void>(
  view: ViewDefinition<S, A, D>,
): ViewDefinition<S, A, D>;

/**
 * Bootstrap an MCP App view-side runtime. See spec.md §"Lifecycle".
 */
export declare function createMcpApp<S = Record<string, never>, TSession = never>(
  config: AppConfig<S, TSession>,
): Promise<AppHandle<S>>;
