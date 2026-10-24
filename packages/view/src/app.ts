/**
 * View-side SDK bootstrap: wraps ext-apps `App`, performs the
 * `ui/initialize` handshake via `PostMessageTransport`, then mounts the
 * initial view.
 *
 * Public entry points: {@link createMcpApp} and {@link defineView}. All
 * other exports are type-only and flow through `mod.ts`.
 *
 * @module
 */

import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps";
import type { McpUiHostCapabilities, McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import type { AppConfig, AppContext, AppHandle, ToolResult, ViewDefinition } from "./types.ts";
import { Router } from "./router.ts";
import { createComposeEventClient } from "./compose-events.ts";
import { callServerToolGated } from "./capabilities.ts";
import { MCPViewError } from "./errors.ts";
import { wireLifecycleCallbacks, wireTeardownLifecycle } from "./lifecycle.ts";
import { sampleGated } from "./sample.ts";
import { ToolRegistry, viewsDeclareTools } from "./tools.ts";
import { onViewerSession } from "./viewer-session.ts";

/**
 * Identity function: lets TS infer `S`, `A`, `D` at the call site from the
 * shape of the hooks. No runtime behaviour.
 */
export function defineView<S, A = void, D = void>(
  view: ViewDefinition<S, A, D>,
): ViewDefinition<S, A, D> {
  return view;
}

/**
 * Bootstrap the view-side runtime.
 *
 * Steps (see `spec.md` §Lifecycle):
 * 1. Instantiate `App` with app info + capabilities.
 * 2. Register configured one-shot tool notification handlers.
 * 3. `connect()` with `PostMessageTransport(window.parent, window.parent)`.
 * 4. Snapshot `hostCapabilities` returned by the handshake.
 * 5. Build the `AppContext` and hand it to the router.
 * 6. `router.goto(initialView, initialArgs)`, create the handle, then replay
 *    any notification buffered during bootstrap.
 *
 * Throws if `window.parent` is unavailable (must run inside an iframe),
 * if `initialView` is not a registered view, or if the handshake fails.
 */
export async function createMcpApp<S = Record<string, never>, TSession = never>(
  config: AppConfig<S, TSession>,
): Promise<AppHandle<S>> {
  validateConfig(config);

  // Auto-advertise the `tools.listChanged` capability if any view declares
  // tools — ext-apps refuses registerTool() otherwise. We merge with the
  // user-supplied capabilities rather than overwriting, so authors keep
  // full control of unrelated caps.
  const baseCaps = config.capabilities ?? {};
  const finalCaps = viewsDeclareTools(config.views)
    ? { ...baseCaps, tools: { listChanged: true, ...(baseCaps.tools ?? {}) } }
    : baseCaps;

  // Forward ext-apps AppOptions opt-ins. When the user opted into nothing,
  // we pass no third arg so ext-apps' default-parameter assignment runs in
  // full — passing `{}` would clobber `autoResize: true` because the
  // 1.7.1 constructor uses a default-parameter assignment, not a merge.
  const appOptions = buildAppOptions(config);
  const app = appOptions
    ? new App(config.info, finalCaps, appOptions)
    : new App(config.info, finalCaps);

  // ext-apps treats these as one-shot notifications and warns (or throws in
  // strict mode) if their handlers are first installed after connect(). The
  // dispatcher buffers anything the host sends while the handshake and the
  // initial route are still creating the AppHandle.
  const lifecycle = wireLifecycleCallbacks(app, config);
  const teardown = wireTeardownLifecycle(app, config.onTeardown);

  const frame = getFrameWindow();
  const parent = frame.parent;
  const events = createComposeEventClient(parent, frame);
  // Install the whole-resource session action synchronously before connect.
  // The dispatcher retains validated early actions until the handle exists.
  const viewerSession = config.viewerSession
    ? onViewerSession(events, config.viewerSession)
    : undefined;
  const transport = new PostMessageTransport(parent, parent);
  try {
    await app.connect(transport);
  } catch (error) {
    viewerSession?.dispose();
    events.destroy();
    teardown.abort(error);
    throw error;
  }

  const hostCaps = app.getHostCapabilities();
  if (!hostCaps) {
    // Defensive: ext-apps guarantees this is set after connect() resolves,
    // but a malformed host could in theory skip the handshake response.
    const error = new MCPViewError(
      "HANDSHAKE_NO_CAPABILITIES",
      "ui/initialize handshake completed without host capabilities — the host response was malformed.",
    );
    viewerSession?.dispose();
    events.destroy();
    teardown.abort(error);
    await transport.close().catch(() => {});
    throw error;
  }
  const capabilities: McpUiHostCapabilities = Object.freeze({ ...hostCaps });

  // Host context: theme, styles, locale, displayMode, etc. Merged mutably
  // because `ui/notifications/host-context-changed` sends partial updates
  // the SDK applies on top of the snapshot.
  const autoTheme = config.autoTheme ?? true;
  let currentHostContext: McpUiHostContext = { ...(app.getHostContext() ?? {}) };

  if (autoTheme) applyHostContextSideEffects(currentHostContext);

  // Re-apply on host-context-changed. Using addEventListener (not
  // onhostcontextchanged) so we don't clobber user handlers they may wire
  // via `ctx.app.onhostcontextchanged = ...`. The listener is always wired
  // so `ctx.hostContext` stays current even when autoTheme=false.
  const onHostContextChanged = (params: McpUiHostContext) => {
    currentHostContext = { ...currentHostContext, ...params };
    if (autoTheme) applyHostContextSideEffects(currentHostContext);
  };
  app.addEventListener("hostcontextchanged", onHostContextChanged);

  let handle: AppHandle<S>;
  try {
    const router = new Router<S>(config.views, config.root);
    const toolRegistry = new ToolRegistry<S>(app);

    // Build the context. `navigate` and `callTool` close over `router` and
    // `app` respectively; the same object reference is reused for the whole
    // app lifetime, as documented in AppHandle.
    const state = (config.initialState ?? {}) as S;
    const ctx: AppContext<S> = {
      navigate: (name, args) => router.goto(name, args),
      callTool: (name, args): Promise<ToolResult> =>
        callServerToolGated(app, capabilities, name, args),
      sample: (args) => sampleGated(app, capabilities, args),
      capabilities,
      get hostContext() {
        return currentHostContext;
      },
      state,
      tools: toolRegistry,
      events,
      app,
    };
    toolRegistry.setContext(ctx);
    router.setContext(ctx);
    router.setToolRegistry(toolRegistry);

    await router.goto(config.initialView, config.initialArgs);

    let transportClosePromise: Promise<void> | undefined;
    const closeTransport = (): Promise<void> => {
      transportClosePromise ??= transport.close();
      return transportClosePromise;
    };
    const cleanup = async (): Promise<void> => {
      viewerSession?.dispose();
      try {
        await router.dispose();
      } finally {
        app.removeEventListener("hostcontextchanged", onHostContextChanged);
        events.destroy();
      }
    };
    handle = {
      ctx,
      events,
      get currentView() {
        return router.currentView;
      },
      navigate: (name, args) => router.goto(name, args),
      dispose: async () => {
        let cleanupError: unknown;
        try {
          await teardown.dispose();
        } catch (error) {
          cleanupError = error;
        }
        // Host teardown intentionally leaves the transport open long enough
        // for ext-apps to send its response. Manual disposal owns closure.
        await closeTransport();
        if (cleanupError !== undefined) throw cleanupError;
      },
    };
    teardown.activate(handle, cleanup);

    // The handle is now complete (including the initial route), so replay
    // early host notifications and serialise any arrivals during that replay.
    await lifecycle.activate(handle);
    await viewerSession?.activate(handle);
  } catch (err) {
    app.removeEventListener("hostcontextchanged", onHostContextChanged);
    viewerSession?.dispose();
    events.destroy();
    teardown.abort(err);
    await transport.close().catch(() => {}); // best-effort, rethrowing
    throw err;
  }
  return handle;
}

/**
 * Apply the theme + CSS variables + font rules from a host context to the
 * document. Each call is narrow: only the fields present in `ctx` trigger
 * an application, so partial updates from `host-context-changed` can be
 * piped through directly.
 *
 * Exception à la policy "propagate errors" (spec §Error contract) :
 * ces helpers touchent le DOM ; un crash ici ne doit pas empêcher le
 * bootstrap/update d'aboutir, on préfère un warn visible.
 */
function applyHostContextSideEffects(ctx: McpUiHostContext): void {
  try {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
  } catch (err) {
    console.warn("[mcp-view] applyDocumentTheme failed:", err);
  }
  try {
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  } catch (err) {
    console.warn("[mcp-view] applyHostStyleVariables failed:", err);
  }
  try {
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  } catch (err) {
    console.warn("[mcp-view] applyHostFonts failed:", err);
  }
}

function validateConfig<S, TSession>(config: AppConfig<S, TSession>): void {
  if (!config.root) {
    throw new MCPViewError("INVALID_CONFIG_ROOT", "createMcpApp: `root` is required");
  }
  if (!config.views || Object.keys(config.views).length === 0) {
    throw new MCPViewError(
      "INVALID_CONFIG_VIEWS",
      "createMcpApp: `views` must contain at least one view",
    );
  }
  if (!config.initialView) {
    throw new MCPViewError(
      "INVALID_CONFIG_INITIAL_VIEW",
      "createMcpApp: `initialView` is required",
    );
  }
  if (!config.views[config.initialView]) {
    throw new MCPViewError(
      "ORPHAN_INITIAL_VIEW",
      `createMcpApp: initialView "${config.initialView}" is not a registered view. ` +
        `Registered: ${Object.keys(config.views).join(", ")}`,
      { initialView: config.initialView, registered: Object.keys(config.views) },
    );
  }
  for (const [name, view] of Object.entries(config.views)) {
    if (typeof view.render !== "function") {
      throw new MCPViewError(
        "MISSING_RENDER",
        `View "${name}" is missing a render function`,
        { view: name },
      );
    }
  }
}

/**
 * Resolve the iframe window used by `PostMessageTransport` and the optional
 * Compose event client. Split out for
 * test injection: tests can override `globalThis.window` before calling
 * `createMcpApp`.
 */
function getFrameWindow(): Window {
  // deno-lint-ignore no-explicit-any
  const w = (globalThis as any).window as Window | undefined;
  if (!w || !w.parent) {
    throw new MCPViewError(
      "NO_PARENT_WINDOW",
      "createMcpApp: no `window.parent` available. This SDK must run " +
        "inside an iframe hosted by an MCP Apps-compatible client.",
    );
  }
  return w;
}

/**
 * Build the ext-apps `AppOptions` payload from `AppConfig`. Returns
 * `undefined` when the user opted into nothing, so the caller can skip the
 * third constructor arg entirely and let the ext-apps default-parameter
 * assignment apply (`{ autoResize: true }`). Returning `{}` would silently
 * disable `autoResize` because ext-apps' constructor uses a default
 * parameter, not a per-field merge.
 *
 * When at least one option is set, we mirror the ext-apps defaults for the
 * other fields so that, for example, `{ strict: true }` doesn't accidentally
 * disable `autoResize`. The mirrored defaults are documented inline; if
 * ext-apps changes them in a future version, this list must move with it.
 */
function buildAppOptions<S, TSession>(
  config: AppConfig<S, TSession>,
): { strict?: boolean; allowUnsafeEval?: boolean; autoResize?: boolean } | undefined {
  const anySet = config.strict !== undefined ||
    config.allowUnsafeEval !== undefined ||
    config.autoResize !== undefined;
  if (!anySet) return undefined;

  // ext-apps 2.0.3 defaults (mirror these here so partial opt-ins don't
  // accidentally drop the unset fields):
  //   autoResize: true
  //   strict: false              (ext-apps warns instead of throwing)
  //   allowUnsafeEval: false     (ext-apps applies z.config({ jitless: true }))
  return {
    autoResize: config.autoResize ?? true,
    ...(config.strict !== undefined && { strict: config.strict }),
    ...(config.allowUnsafeEval !== undefined && { allowUnsafeEval: config.allowUnsafeEval }),
  };
}
