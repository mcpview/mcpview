/**
 * Test doubles for `startSurfaceApp`: a `createMcpApp` stand-in that runs the
 * same serialized view sequence without a transport, a linkedom document
 * scope, and a bounded microtask wait for background mounts.
 *
 * The double mirrors the runtime where the lifecycle depends on it: the
 * router clears `currentView` for the whole transition (reading it then
 * throws), host notifications run one at a time, a host context change
 * replaces the context object, and teardown runs the author callback before
 * the router disposes the active view.
 *
 * Not published; excluded through `deno.json` `publish.exclude`.
 */

import { assert } from "@std/assert";

import type { AppConfig, AppHandle, ViewDefinition } from "@mcpview/view";
import { defineComponentRegistry, defineViewComponent } from "../components.ts";
import type { SurfaceAppRuntime, SurfaceAppState, SurfaceStatus } from "../surface-app.ts";

export interface Data {
  readonly title: string;
}

export type State = SurfaceAppState<Data>;

export const PERMISSIONS = { read: true, env: true, run: true } as const;

export async function withDocument(
  fn: (root: HTMLElement) => Promise<void>,
): Promise<void> {
  const documentModule = await import("npm:linkedom@0.18.12");
  const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  try {
    await fn(dom.document.getElementById("root") as unknown as HTMLElement);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
}

/** Renders one status as a plain element so assertions read its presentation. */
export function renderStatus(status: SurfaceStatus): HTMLElement {
  const node = document.createElement("p");
  node.className = "status";
  node.dataset.kind = status.kind;
  node.dataset.tone = status.tone;
  node.dataset.busy = String(status.busy);
  if (status.title !== undefined) node.dataset.title = status.title;
  if (status.code !== undefined) node.dataset.code = status.code;
  node.textContent = status.message;
  return node;
}

export function statusOf(root: HTMLElement): Record<string, string | undefined> {
  const node = root.querySelector(".status") as HTMLElement | null;
  assert(node, `expected a status element, got ${root.innerHTML}`);
  return {
    kind: node.dataset.kind,
    tone: node.dataset.tone,
    busy: node.dataset.busy,
    title: node.dataset.title,
    message: node.textContent ?? undefined,
    ...(node.dataset.code === undefined ? {} : { code: node.dataset.code }),
  };
}

export interface Mounts {
  readonly mounted: string[];
  readonly cleaned: string[];
}

/**
 * Two components: `test.title` composes the default surface, `test.caption`
 * only mounts when a host-selected surface names it.
 */
export function registry(
  mounts: Mounts,
  mount: (target: HTMLElement, data: Data) => Promise<void> | void = (target, data) => {
    target.textContent = data.title;
  },
) {
  return defineComponentRegistry<Data>({
    components: {
      "test.title": defineViewComponent<Data>({
        descriptor: { title: "Title" },
        async mount(target, context) {
          await mount(target, context.data);
          mounts.mounted.push(context.data.title);
          return () => {
            mounts.cleaned.push(context.data.title);
          };
        },
      }),
      "test.caption": defineViewComponent<Data>({
        descriptor: { title: "Caption" },
        mount(target, context) {
          target.textContent = `caption:${context.data.title}`;
          mounts.mounted.push(`caption:${context.data.title}`);
          return () => {
            mounts.cleaned.push(`caption:${context.data.title}`);
          };
        },
      }),
    },
    defaultSurface: {
      layout: { type: "stack", gap: "sm" },
      components: [{ id: "title", component: "test.title" }],
    },
  });
}

/** A `createMcpApp` double: the same view sequence, no transport. */
export interface FakeApp {
  readonly runtime: SurfaceAppRuntime;
  readonly listeners: Map<string, Set<() => void>>;
  readonly reads: string[];
  readonly disposed: string[];
  /** View transitions in order: `leave <view>`, `enter <view>`. */
  readonly log: string[];
  config(): AppConfig<State, unknown>;
  handle(): AppHandle<State>;
  toolResult(result: unknown): Promise<void>;
  toolInput(): Promise<void>;
  toolInputPartial(): Promise<void>;
  session(value: unknown): Promise<void>;
  /** Merge one partial host context into a new object, then notify, like the runtime. */
  hostContextChanged(params?: Record<string, unknown>): void;
  /** Host teardown: the author callback, then the router disposes the active view. */
  teardown(): Promise<void>;
  /** Settle every navigation queued so far, like the real router's queue. */
  idle(): Promise<void>;
}

export interface FakeAppOptions {
  readonly hostContext?: Record<string, unknown>;
  /**
   * Host notifications the runtime replays before `createMcpApp` returns:
   * runs inside `createApp`, once the handle exists.
   */
  readonly replay?: (fake: FakeApp) => Promise<void>;
}

export function fakeApp(root: HTMLElement, options: FakeAppOptions = {}): FakeApp {
  let hostContext: Record<string, unknown> = { ...(options.hostContext ?? {}) };
  let config: AppConfig<State, unknown> | undefined;
  let handle: AppHandle<State> | undefined;
  const listeners = new Map<string, Set<() => void>>();
  const reads: string[] = [];
  const disposed: string[] = [];
  const log: string[] = [];
  let queue: Promise<void> = Promise.resolve();
  let notifications: Promise<void> = Promise.resolve();
  const app = {
    addEventListener(name: string, listener: () => void) {
      listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
    },
    removeEventListener(name: string, listener: () => void) {
      listeners.get(name)?.delete(listener);
    },
    readServerResource(params: { uri: string }) {
      reads.push(params.uri);
      return Promise.resolve({ contents: [{ uri: params.uri, text: "resource" }] });
    },
  };
  const current = () => {
    assert(handle && config, "the App was not created");
    return { handle, config };
  };
  /** Lifecycle callbacks run one at a time, as the runtime dispatcher does. */
  const notify = (run: () => Promise<void> | void): Promise<void> => {
    const next = notifications.then(run);
    notifications = next.catch(() => {});
    return next;
  };
  const createApp = async (next: AppConfig<State, unknown>) => {
    config = next;
    let currentView: string | undefined;
    const views = next.views as Record<string, ViewDefinition<State, unknown, unknown>>;
    const ctx = {
      get hostContext() {
        return hostContext;
      },
      state: next.initialState,
      app,
      navigate: (name: string, args?: unknown) => goto(name, args),
    } as unknown as AppHandle<State>["ctx"];
    const leave = async (): Promise<void> => {
      const leaving = currentView;
      currentView = undefined;
      if (!leaving) return;
      log.push(`leave ${leaving}`);
      await views[leaving]?.onLeave?.(ctx);
    };
    const transition = async (name: string, args?: unknown): Promise<void> => {
      await leave();
      const view = views[name];
      if (!view) throw new Error(`Unknown view ${name}`);
      log.push(`enter ${name}`);
      const data = await view.onEnter?.(ctx, args);
      const output = view.render(ctx, data);
      root.replaceChildren(
        typeof output === "string" ? document.createTextNode(output) : output,
      );
      currentView = name;
    };
    let routerDisposed = false;
    const goto = (name: string, args?: unknown): Promise<void> => {
      // `Router.goto` after `dispose()` (router.ts:91-92).
      if (routerDisposed) return Promise.reject(new Error("Router has been disposed"));
      queue = queue.then(() => transition(name, args), () => transition(name, args));
      return queue;
    };
    /** `TeardownDispatcher.run`: the author callback, then the router, both always. */
    const runTeardown = async (reason: "host" | "dispose"): Promise<void> => {
      let failure: unknown;
      try {
        await next.onTeardown?.(handle!, reason);
      } catch (error) {
        failure = error;
      }
      await queue.catch(() => {});
      routerDisposed = true;
      await leave();
      if (failure !== undefined) throw failure;
    };
    /** `TeardownDispatcher.request`: one run per App, whoever asks first. */
    let teardownPromise: Promise<void> | undefined;
    const teardown = (reason: "host" | "dispose"): Promise<void> =>
      teardownPromise ??= runTeardown(reason);
    await goto(next.initialView, next.initialArgs);
    handle = {
      ctx,
      get currentView() {
        if (currentView === undefined) throw new Error("Router.currentView read mid-transition");
        return currentView;
      },
      navigate: goto,
      dispose: async () => {
        disposed.push("manual");
        await teardown("dispose");
      },
    };
    hostTeardown = () => teardown("host");
    await options.replay?.(fake);
    return handle;
  };
  let hostTeardown: (() => Promise<void>) | undefined;
  const fake: FakeApp = {
    runtime: { createApp: createApp as unknown as SurfaceAppRuntime["createApp"] },
    listeners,
    reads,
    disposed,
    log,
    config: () => current().config,
    handle: () => current().handle,
    toolResult: (result) =>
      notify(() => current().config.onToolResult?.(result as never, current().handle)),
    toolInput: () => notify(() => current().config.onToolInput?.({} as never, current().handle)),
    toolInputPartial: () =>
      notify(() => current().config.onToolInputPartial?.({} as never, current().handle)),
    session: (value) =>
      notify(async () => {
        const subscription = current().config.viewerSession;
        assert(subscription, "no viewerSession was installed");
        if (!subscription.validate(value)) {
          subscription.onInvalid?.({ data: value });
          return;
        }
        await subscription.onSession(value, { data: value }, current().handle);
      }),
    hostContextChanged: (params = {}) => {
      hostContext = { ...hostContext, ...params };
      for (const listener of listeners.get("hostcontextchanged") ?? []) listener();
    },
    teardown: async () => {
      assert(hostTeardown, "the App was not created");
      await hostTeardown();
    },
    idle: () => queue,
  };
  return fake;
}

/** Background mounts settle over a few microtasks; wait for them, bounded. */
export async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 64; i += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  assert(condition(), `timed out waiting for ${what}`);
}
