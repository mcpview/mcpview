/**
 * Result-driven MCP App over one component registry, renderer-neutral.
 *
 * Every componentized viewer repeats the same lifecycle: install the theme,
 * show a status until the host sends a result, project that result into a
 * data model, mount the host-selected surface, remount it when the host
 * context changes, and make sure only the latest mount survives. Copies of
 * that loop drifted — one lost the generation guard in its error path,
 * another buffered recorded sessions by hand. This module is the loop, once.
 * Renderers plug in through `renderStatus`; `startPreactSurfaceApp` binds it
 * to the Preact `StateMessage`.
 */

import {
  type AppConfig,
  type AppContext,
  type AppHandle,
  createMcpApp,
  defineView,
  readResultData,
  type ResultData,
} from "@mcpview/view";
import {
  activeComponentSurface,
  applySurfaceContext,
  componentCatalogCapabilities,
  type ComponentSurface,
  defineComponentSurface,
  mountComponentSurface,
  type MountedComponentSurface,
  type ViewComponentRegistry,
} from "./components.ts";
import type { ComponentTone } from "./component-primitives.ts";
import { installMcpViewTheme } from "./theme.ts";
import { type McpViewMessages, mcpViewMessages, type Translator } from "./i18n.ts";

export type SurfaceLabel = string | ((locale?: string) => string);

export interface SurfaceAppState<TData> {
  currentData?: TData;
}

export type SurfaceAppContext<TData> = AppContext<SurfaceAppState<TData>>;

/** The host tool result exactly as `createMcpApp` delivers it. */
export type SurfaceToolResult = Parameters<
  NonNullable<AppConfig<SurfaceAppState<unknown>>["onToolResult"]>
>[0];

type HostApp = AppContext<SurfaceAppState<unknown>>["app"];

/** The server reads an App may need while projecting a result or a session. */
export interface SurfaceHostAccess {
  /** Presentation locale at projection time, never an input to domain validation. */
  readonly locale?: string;
  readonly readServerResource: (
    uri: string,
  ) => ReturnType<HostApp["readServerResource"]>;
}

export type SurfaceStatusTone = ComponentTone;

/**
 * What the App displays. `result` mounts the component surface; every other
 * kind renders one status through `renderStatus`. `notice` carries a
 * caller-owned presentation for domain states such as "recorded evidence
 * unresolved" that are neither an error nor an absence of data. `code` is a
 * caller-owned machine identifier, forwarded verbatim to the status.
 * `error` and `notice` `title`/`message` accept `SurfaceLabel` callbacks,
 * resolved on each visible status render; literal strings stay unchanged.
 */
export type SurfaceDisplayState<TData> =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | {
    readonly kind: "error";
    readonly message: SurfaceLabel;
    readonly title?: SurfaceLabel;
    readonly code?: string;
  }
  | {
    readonly kind: "notice";
    readonly message: SurfaceLabel;
    readonly title?: SurfaceLabel;
    readonly tone?: SurfaceStatusTone;
    readonly busy?: boolean;
    readonly code?: string;
  }
  | { readonly kind: "result"; readonly result: TData };

type SurfaceStatusState<TData> = Exclude<
  SurfaceDisplayState<TData>,
  { readonly kind: "result" }
>;

type RejectionTitleKey = "resultRejectedTitle" | "sessionRejectedTitle";

/** Status stored between renders. The extra error field is not part of the public contract. */
type ActiveStatus<TData> =
  | Exclude<SurfaceStatusState<TData>, { readonly kind: "error" }>
  | {
    readonly kind: "error";
    readonly message: SurfaceLabel;
    readonly title?: SurfaceLabel;
    readonly code?: string;
    readonly rejectionTitleKey?: RejectionTitleKey;
  };

export type SurfaceMessageKind =
  | "loading"
  | "empty"
  | "error"
  | "notice"
  | "surface-required";

/** One status resolved to its presentation, ready for a renderer. */
export interface SurfaceStatus {
  readonly kind: SurfaceMessageKind;
  readonly message: string;
  readonly title?: string;
  readonly tone: SurfaceStatusTone;
  readonly busy: boolean;
  /** Caller-owned identifier from a `notice` or `error` state, never invented. */
  readonly code?: string;
}

export type SurfaceProjection<TInput, TData> = (
  input: TInput,
  host: SurfaceHostAccess,
) => SurfaceDisplayState<TData> | Promise<SurfaceDisplayState<TData>>;

/** Whole-view `viewer.session.apply` handling, installed before the App connects. */
export interface SurfaceViewerSession<TData, TSession> {
  readonly validate: (value: unknown) => value is TSession;
  /** Project one validated session exactly as a tool result would be. */
  readonly toState: SurfaceProjection<TSession, TData>;
  readonly onInvalid?: (value: unknown) => void;
}

export interface SurfaceAppOptions<TData, TSession = never> {
  readonly root: HTMLElement;
  readonly info: { readonly name: string; readonly version: string };
  readonly registry: ViewComponentRegistry<TData, SurfaceAppContext<TData>>;
  /**
   * Project one host tool result into a display state. Without it the result's
   * structured content (or JSON text) is the data, checked by `validate`.
   *
   * A throw becomes an `error` status and drops the remembered result, like
   * any non-`result` state. To keep the last values visible under a failure,
   * return a `result` state that carries the failure — the scaffold does.
   */
  readonly fromToolResult?: SurfaceProjection<SurfaceToolResult, TData>;
  /** Domain guard for the default projection. Exclusive with `fromToolResult`. */
  readonly validate?: (value: unknown) => value is TData;
  readonly viewerSession?: SurfaceViewerSession<TData, TSession>;
  /**
   * The surface a result owns. A returned surface composes that result as is:
   * neither the host selection nor the registry default is consulted, so a
   * recorded session that replaces the whole read model can compose itself.
   * `undefined` keeps the host flow (host-selected surface, then the registry
   * default). Called on every mount of the result, remounts included.
   */
  readonly surfaceFor?: (data: TData) => ComponentSurface | undefined;
  /** Detail of the `loading` status. Default `Waiting for data…`. */
  readonly loadingLabel?: SurfaceLabel;
  /** Detail of the `empty` status. Default `No structured data received.`. */
  readonly emptyLabel?: SurfaceLabel;
  /**
   * Detail of the `surface-required` status. Default
   * `This App exposes components and requires a host-selected surface.`.
   */
  readonly surfaceRequiredLabel?: SurfaceLabel;
  /** Translate interface wording only; domain messages and codes remain caller-owned. */
  readonly messages?: (locale?: string) => Translator<keyof McpViewMessages>;
  /**
   * Sets `document.documentElement.lang` at boot and when the host locale
   * changes. Pass `messages.locale` from `createTranslator` so the document
   * language identifies the selected dictionary. Omit to leave `lang` as is.
   * Independent of remount policy; not inferred from message callbacks.
   */
  readonly documentLanguage?: (hostLocale?: string) => string;
  /**
   * Opt into in-place theme-only updates when components follow CSS tokens (or
   * observe them, e.g. a 3D scene). Other context changes still remount the surface.
   * Default `remount` preserves components that read the theme only at mount.
   * In-place mode compares non-theme fields structurally so equal JSON snapshots
   * with new object identities do not remount.
   */
  readonly themeUpdates?: "remount" | "in-place";
  /** Class of the element wrapping the mounted surface. Default `mcp-view-surface-shell`. */
  readonly surfaceClassName?: string;
  /**
   * Install the shared mcp-view stylesheet at boot. Default `true`. Only the
   * boot install is skipped: kit primitives still install it when they mount,
   * and the host theme (`createMcpApp`'s `autoTheme`) is unaffected.
   */
  readonly theme?: boolean;
  /** Forwarded to `createMcpApp`; unset keeps its default (`false`). */
  readonly strict?: boolean;
  /** Render one resolved status as the element the router mounts. */
  readonly renderStatus: (status: SurfaceStatus) => Node;
  /** Receives every failure the lifecycle absorbs. Default `console.error`. */
  readonly onError?: (error: unknown) => void;
  /**
   * Runs once when the host tears the App down or `dispose()` runs, before
   * the router disposes the surface. For what the App holds outside its
   * surface — a bridge to the parent page, a subscription — since the handle
   * has no other end-of-life signal. A throw is absorbed through `onError`.
   */
  readonly onTeardown?: () => void | Promise<void>;
}

export interface SurfaceAppHandle<TData> {
  /**
   * Route one display state exactly as a host tool result would be. Rejects
   * with `SURFACE_APP_CLOSED` once the host tore the App down or `dispose()`
   * ran: there is no router left to show anything.
   */
  show(state: SurfaceDisplayState<TData>): Promise<void>;
  /** Manual disposal. Host teardown needs no call. */
  dispose(): Promise<void>;
}

/**
 * Injection seam for tests that cannot open an ext-apps transport. It is not
 * a production extension point: a viewer never passes it.
 */
export interface SurfaceAppRuntime {
  readonly createApp: typeof createMcpApp;
}

export type SurfaceAppErrorCode =
  | "SURFACE_APP_PROJECTION_CONFLICT"
  | "SURFACE_APP_CLOSED";

/** Options refused at the boundary. Match on `code`, not on `message`. */
export class SurfaceAppError extends TypeError {
  readonly code: SurfaceAppErrorCode;
  readonly data: Readonly<Record<string, unknown>>;

  constructor(
    code: SurfaceAppErrorCode,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SurfaceAppError";
    this.code = code;
    this.data = Object.freeze({ ...data });
  }
}

const DEFAULT_RUNTIME: SurfaceAppRuntime = { createApp: createMcpApp };

/**
 * Start a result-driven MCP App backed by a component registry.
 *
 * The registry may expose a default surface or be component-only. In the
 * latter case a host-selected surface is required and no artificial
 * standalone composition is invented.
 */
export async function startSurfaceApp<TData, TSession = never>(
  options: SurfaceAppOptions<TData, TSession>,
  runtime: SurfaceAppRuntime = DEFAULT_RUNTIME,
): Promise<SurfaceAppHandle<TData>> {
  if (options.fromToolResult && options.validate) {
    throw new SurfaceAppError(
      "SURFACE_APP_PROJECTION_CONFLICT",
      "startSurfaceApp accepts either fromToolResult or validate, not both",
      { recovery: "Keep fromToolResult and validate inside it, or drop it and keep validate." },
    );
  }
  if (options.theme !== false) installMcpViewTheme();

  type State = SurfaceAppState<TData>;
  type HostContext = SurfaceAppContext<TData>["hostContext"];
  const state: State = {};
  const project = options.fromToolResult ?? defaultProjection(options.validate);
  const session = options.viewerSession;
  let mounted: MountedComponentSurface | undefined;
  let pendingMount: Promise<void> | undefined;
  let mountGeneration = 0;
  let navigation: Promise<void> = Promise.resolve();
  let renderedHostContext: HostContext | undefined;
  let hostLocale: string | undefined;
  let renderedStatusLocale: string | undefined;
  let activeStatus: ActiveStatus<TData> | undefined = { kind: "loading" };
  let closed = false;
  let removeHostContextListener: (() => void) | undefined;

  const reportError = (error: unknown): void => {
    if (options.onError) options.onError(error);
    else console.error("[mcp-view-components] Surface App failed", error);
  };

  const message: Translator<keyof McpViewMessages> = (key, values) =>
    (options.messages ?? mcpViewMessages)(hostLocale)(key, values);
  const resolveLabel = (value: SurfaceLabel): string =>
    typeof value === "function" ? value(hostLocale) : value;
  const label = (override: SurfaceLabel | undefined, key: keyof McpViewMessages): string =>
    override === undefined ? message(key) : resolveLabel(override);

  const resolve = (display: ActiveStatus<TData>): SurfaceStatus => {
    switch (display.kind) {
      case "loading":
        return {
          kind: "loading",
          title: message("loadingTitle"),
          message: label(options.loadingLabel, "loadingMessage"),
          tone: "info",
          busy: true,
        };
      case "empty":
        return {
          kind: "empty",
          title: message("emptyTitle"),
          message: label(options.emptyLabel, "emptyMessage"),
          tone: "neutral",
          busy: false,
        };
      case "error":
        return {
          kind: "error",
          title: display.title === undefined
            ? message(display.rejectionTitleKey ?? "errorTitle")
            : resolveLabel(display.title),
          message: resolveLabel(display.message),
          tone: "danger",
          busy: false,
          ...(display.code === undefined ? {} : { code: display.code }),
        };
      case "notice":
        return {
          kind: "notice",
          title: display.title === undefined ? undefined : resolveLabel(display.title),
          message: resolveLabel(display.message),
          tone: display.tone ?? "neutral",
          busy: display.busy ?? false,
          ...(display.code === undefined ? {} : { code: display.code }),
        };
    }
  };

  const failure = (title: string, message: string): SurfaceStatus => ({
    kind: "error",
    title,
    message,
    tone: "danger",
    busy: false,
  });

  /**
   * Every navigation the App issues is chained here. The router serializes
   * navigations too, but a step chained behind the last one observes the
   * router settled — never a view mid-transition, when `currentView` throws
   * and `currentData` still names a result on its way out.
   */
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    const next = navigation.then(step);
    navigation = next.catch(() => {});
    return next;
  };

  const show = (
    navigate: AppHandle<State>["navigate"],
    display: SurfaceDisplayState<TData> | ActiveStatus<TData>,
  ): Promise<void> =>
    enqueue(() => {
      activeStatus = display.kind === "result" ? undefined : display;
      return display.kind === "result"
        ? navigate("surface", display.result)
        : navigate("status", resolve(display));
    });

  /** A projection that throws shows its failure; it never breaks the lifecycle. */
  const settle = async (
    compute: () => SurfaceDisplayState<TData> | Promise<SurfaceDisplayState<TData>>,
    rejectionTitleKey: RejectionTitleKey,
  ): Promise<SurfaceDisplayState<TData> | ActiveStatus<TData>> => {
    try {
      return await compute();
    } catch (error) {
      reportError(error);
      return { kind: "error", message: errorMessage(error), rejectionTitleKey };
    }
  };

  const hostAccess = (app: AppHandle<State>): SurfaceHostAccess => ({
    locale: app.ctx.hostContext.locale,
    readServerResource: (uri) => app.ctx.app.readServerResource({ uri }),
  });

  const disposeSurface = async (): Promise<void> => {
    mountGeneration += 1;
    await pendingMount;
    pendingMount = undefined;
    const active = mounted;
    mounted = undefined;
    await active?.dispose();
  };

  const status = defineView<State, SurfaceStatus, SurfaceStatus>({
    onEnter(_context, next) {
      state.currentData = undefined;
      return next;
    },
    render: (context, next) => {
      hostLocale = context.hostContext.locale;
      renderedStatusLocale = hostLocale;
      return options.renderStatus(activeStatus ? resolve(activeStatus) : next);
    },
    onLeave: disposeSurface,
  });

  const surface = defineView<State, TData, TData>({
    onEnter(_context, data) {
      state.currentData = data;
      return data;
    },
    render(context, data) {
      hostLocale = context.hostContext.locale;
      renderedHostContext = context.hostContext;
      const shell = document.createElement("div");
      shell.className = options.surfaceClassName ?? "mcp-view-surface-shell";
      let selected: ReturnType<typeof activeComponentSurface>;
      // Named before the call: a `surfaceFor` that throws is the data-owned
      // path failing, not the host selection it was asked to replace.
      let owner = options.surfaceFor ? "data-owned" : "host-selected";
      try {
        const owned = options.surfaceFor?.(data);
        if (!owned) owner = "host-selected";
        selected = owned
          ? defineComponentSurface(owned)
          : activeComponentSurface(options.registry, context.hostContext);
      } catch (error) {
        // A malformed surface must not unmount the route: the App stays on
        // its surface view and says why nothing is composed.
        reportError(error);
        shell.replaceChildren(options.renderStatus(failure(
          message("surfaceInvalidTitle"),
          message("surfaceInvalidMessage", { owner, error: errorMessage(error) }),
        )));
        return shell;
      }
      if (!selected) {
        shell.replaceChildren(options.renderStatus({
          kind: "surface-required",
          title: message("surfaceRequiredTitle"),
          message: label(options.surfaceRequiredLabel, "surfaceRequiredMessage"),
          tone: "warning",
          busy: false,
        }));
        return shell;
      }

      const generation = ++mountGeneration;
      pendingMount = mountComponentSurface({
        root: shell,
        registry: options.registry,
        data,
        appContext: context,
        hostContext: context.hostContext,
        surface: selected,
      }).then(async (next) => {
        if (generation !== mountGeneration) {
          await next.dispose();
          return;
        }
        mounted = next;
      }).catch((error) => {
        reportError(error);
        // A superseded mount that fails must not overwrite the newer route.
        if (generation !== mountGeneration) return;
        shell.replaceChildren(options.renderStatus(failure(
          message("surfaceFailedTitle"),
          message("surfaceFailedMessage", { error: errorMessage(error) }),
        )));
      });
      return shell;
    },
    onLeave: disposeSurface,
  });

  const handle = await runtime.createApp<State, TSession>({
    info: options.info,
    root: options.root,
    ...(options.strict === undefined ? {} : { strict: options.strict }),
    views: { status, surface },
    initialView: "status",
    initialArgs: resolve({ kind: "loading" }),
    initialState: state,
    ...(session
      ? {
        viewerSession: {
          validate: session.validate,
          onSession: async (value, _payload, app) => {
            hostLocale = app.ctx.hostContext.locale;
            const next = await settle(
              () => session.toState(value, hostAccess(app)),
              "sessionRejectedTitle",
            );
            await show(app.navigate, next);
          },
          onInvalid: (payload) => session.onInvalid?.(payload.data),
          onError: reportError,
        },
      }
      : {}),
    capabilities: {
      experimental: componentCatalogCapabilities(options.registry),
    },
    // Either notification means a run is under way: a host that does not
    // stream arguments sends only the complete `tool-input`.
    onToolInput: async (_params, app) => {
      await show(app.navigate, { kind: "loading" });
    },
    onToolInputPartial: async (_params, app) => {
      await show(app.navigate, { kind: "loading" });
    },
    onToolResult: async (result, app) => {
      hostLocale = app.ctx.hostContext.locale;
      const next = await settle(
        () => project(result, hostAccess(app)),
        "resultRejectedTitle",
      );
      await show(app.navigate, next);
    },
    onTeardown: async () => {
      // The router runs the active view's onLeave, which disposes the surface.
      closed = true;
      removeHostContextListener?.();
      removeHostContextListener = undefined;
      try {
        await options.onTeardown?.();
      } catch (error) {
        reportError(error);
      }
    },
  });

  const surfaceHandle: SurfaceAppHandle<TData> = {
    show: (display) =>
      closed
        ? Promise.reject(
          new SurfaceAppError("SURFACE_APP_CLOSED", "The surface App has been torn down", {
            recovery: "Start a new App with startSurfaceApp; this handle cannot show anything.",
          }),
        )
        : show(handle.navigate, display),
    dispose: () => handle.dispose(),
  };

  // A host teardown buffered during the handshake has already run: there is
  // no App left to listen to.
  if (closed) return surfaceHandle;

  /** Remount the displayed result when the host context moved since it rendered. */
  const remountIfStale = (): Promise<void> =>
    enqueue(async () => {
      const data = state.currentData;
      if (closed) return;
      if (data === undefined) {
        if (activeStatus && hostLocale !== renderedStatusLocale) {
          await handle.navigate("status", resolve(activeStatus));
        }
        return;
      }
      if (handle.ctx.hostContext === renderedHostContext) {
        return;
      }
      if (
        options.themeUpdates === "in-place" && renderedHostContext &&
        onlyThemeChanged(renderedHostContext, handle.ctx.hostContext)
      ) {
        renderedHostContext = handle.ctx.hostContext;
        return;
      }
      await handle.navigate("surface", data);
    });

  const onHostContextChanged = (): void => {
    hostLocale = handle.ctx.hostContext.locale;
    if (options.documentLanguage) {
      document.documentElement.lang = options.documentLanguage(hostLocale);
    }
    applySurfaceContext(handle.ctx.hostContext, document.documentElement);
    remountIfStale().catch(reportError);
  };
  handle.ctx.app.addEventListener("hostcontextchanged", onHostContextChanged);
  removeHostContextListener = () => {
    handle.ctx.app.removeEventListener("hostcontextchanged", onHostContextChanged);
  };
  // Host notifications replayed by `createMcpApp` may have rendered a result
  // and then moved the host context before this listener existed.
  onHostContextChanged();

  return surfaceHandle;
}

/**
 * Conservative: only `theme` is exempt. Any other field whose JSON-shaped value
 * changed retains the normal remount behavior. Object key order is ignored;
 * array order is kept. No stringify, no coercion.
 */
function onlyThemeChanged(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return [...keys].every((key) => key === "theme" || jsonValueEqual(previous[key], next[key]));
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonValueEqual(item, right[index]));
  }
  if (!isPlainJsonObject(left) || !isPlainJsonObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) =>
    Object.hasOwn(right, key) && jsonValueEqual(left[key], right[key])
  );
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function defaultProjection<TData>(
  validate: ((value: unknown) => value is TData) | undefined,
): SurfaceProjection<SurfaceToolResult, TData> {
  return (result) => {
    const data = readResultData<ResultData>(result, {
      fallback: "json-text",
      ...(validate ? { validate: (value: unknown): value is ResultData => validate(value) } : {}),
    });
    return data === undefined
      ? { kind: "empty" }
      : { kind: "result", result: data as unknown as TData };
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
