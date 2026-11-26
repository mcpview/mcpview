import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";

import { createMcpApp, defineView, mountDeclaredSessionApp } from "./app.ts";
import { App } from "@modelcontextprotocol/ext-apps";
import { MCPViewError } from "./errors.ts";
import type { AppConfig } from "./types.ts";

// ---------------------------------------------------------------------------
// Validation tests — these exercise createMcpApp's config guards BEFORE any
// transport is touched, so they don't need a DOM/window mock.
// ---------------------------------------------------------------------------

const minimalInfo = { name: "TestApp", version: "0.0.0" };

Deno.test("AppConfig accepts ext-apps runtime options (compile-time)", () => {
  // Smoke test — the value is asserted, but the real assertion is that this
  // file type-checks: AppConfig must surface the three new pass-through
  // fields so consumers can opt in. createMcpApp forwards them to the
  // ext-apps `App` constructor; verifying the actual forwarding requires a
  // browser DOM mock and is left to the integration test rig.
  const cfg: AppConfig<Record<string, never>> = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: { home: { render: () => "" } },
    initialView: "home",
    strict: true,
    allowUnsafeEval: false,
    autoResize: true,
  };
  assertEquals(cfg.strict, true);
  assertEquals(cfg.allowUnsafeEval, false);
  assertEquals(cfg.autoResize, true);
});

Deno.test("AppConfig exposes typed one-shot tool notification callbacks", () => {
  const cfg: AppConfig<Record<string, never>> = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: { home: { render: () => "" } },
    initialView: "home",
    onToolInput: (params, app) => {
      assertEquals(params.arguments?.id, "input");
      assertEquals(app.currentView, "home");
    },
    onToolInputPartial: (params, app) => {
      assertEquals(params.arguments?.id, "partial");
      assertEquals(app.currentView, "home");
    },
    onToolResult: (params, app) => {
      assertEquals(params.content, []);
      assertEquals(app.currentView, "home");
    },
  };
  assertEquals(typeof cfg.onToolInput, "function");
  assertEquals(typeof cfg.onToolInputPartial, "function");
  assertEquals(typeof cfg.onToolResult, "function");
});

Deno.test("AppConfig exposes a typed whole-resource session lifecycle", () => {
  interface Session {
    readonly schema: "io.casys.test.session/1.0";
  }
  const cfg: AppConfig<Record<string, never>, Session> = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: { home: { render: () => "" } },
    initialView: "home",
    viewerSession: {
      validate: (value): value is Session =>
        typeof value === "object" && value !== null &&
        (value as { schema?: unknown }).schema === "io.casys.test.session/1.0",
      onSession: (session, _payload, app) => {
        assertEquals(session.schema, "io.casys.test.session/1.0");
        assertEquals(app.currentView, "home");
      },
    },
  };
  assertEquals(typeof cfg.viewerSession?.validate, "function");
});

Deno.test("createMcpApp rejects when initialView is not a registered view", async () => {
  const cfg = {
    info: minimalInfo,
    // Cast: in a browser root would be HTMLElement; we never reach any DOM op
    // because validation fires first.
    root: {} as unknown as HTMLElement,
    views: {
      list: defineView<Record<string, never>>({ render: () => "" }),
    },
    initialView: "missing",
  } as unknown as AppConfig;

  await assertRejects(
    () => createMcpApp(cfg),
    Error,
    'initialView "missing" is not a registered view',
  );
});

Deno.test("createMcpApp rejects when views is empty", async () => {
  const cfg = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: {},
    initialView: "x",
  } as unknown as AppConfig;

  await assertRejects(
    () => createMcpApp(cfg),
    Error,
    "`views` must contain at least one view",
  );
});

Deno.test("createMcpApp rejects when root is missing", async () => {
  const cfg = {
    info: minimalInfo,
    views: {
      list: defineView<Record<string, never>>({ render: () => "" }),
    },
    initialView: "list",
  } as unknown as AppConfig;

  await assertRejects(() => createMcpApp(cfg), Error, "`root` is required");
});

Deno.test("createMcpApp rejects when no window.parent is available", async () => {
  // Deno's default global has no `window.parent`. Confirm we throw the
  // documented message instead of crashing mid-transport.
  const cfg: AppConfig = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: {
      list: defineView<Record<string, never>>({ render: () => "ok" }),
    },
    initialView: "list",
  };

  await assertRejects(
    () => createMcpApp(cfg),
    Error,
    "no `window.parent` available",
  );
});

// ---------------------------------------------------------------------------
// MCPViewError code tests — each validation path must carry a stable .code
// ---------------------------------------------------------------------------

Deno.test("createMcpApp error for missing root carries INVALID_CONFIG_ROOT", async () => {
  const cfg = {
    info: minimalInfo,
    views: { list: defineView<Record<string, never>>({ render: () => "" }) },
    initialView: "list",
  } as unknown as AppConfig;
  try {
    await createMcpApp(cfg);
    throw new Error("expected rejection");
  } catch (err) {
    assertInstanceOf(err, MCPViewError);
    assertEquals((err as MCPViewError).code, "INVALID_CONFIG_ROOT");
  }
});

Deno.test("createMcpApp error for empty views carries INVALID_CONFIG_VIEWS", async () => {
  const cfg = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: {},
    initialView: "x",
  } as unknown as AppConfig;
  try {
    await createMcpApp(cfg);
    throw new Error("expected rejection");
  } catch (err) {
    assertInstanceOf(err, MCPViewError);
    assertEquals((err as MCPViewError).code, "INVALID_CONFIG_VIEWS");
  }
});

Deno.test("createMcpApp error for orphan initialView carries ORPHAN_INITIAL_VIEW with data", async () => {
  const cfg = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: { list: defineView<Record<string, never>>({ render: () => "" }) },
    initialView: "missing",
  } as unknown as AppConfig;
  try {
    await createMcpApp(cfg);
    throw new Error("expected rejection");
  } catch (err) {
    assertInstanceOf(err, MCPViewError);
    assertEquals((err as MCPViewError).code, "ORPHAN_INITIAL_VIEW");
    assertEquals((err as MCPViewError).data.initialView, "missing");
  }
});

Deno.test("createMcpApp error for missing render carries MISSING_RENDER with data", async () => {
  const cfg = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    // deno-lint-ignore no-explicit-any
    views: { broken: {} as any },
    initialView: "broken",
  } as unknown as AppConfig;
  try {
    await createMcpApp(cfg);
    throw new Error("expected rejection");
  } catch (err) {
    assertInstanceOf(err, MCPViewError);
    assertEquals((err as MCPViewError).code, "MISSING_RENDER");
    assertEquals((err as MCPViewError).data.view, "broken");
  }
});

Deno.test("createMcpApp error for no window.parent carries NO_PARENT_WINDOW", async () => {
  const cfg: AppConfig = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: { list: defineView<Record<string, never>>({ render: () => "ok" }) },
    initialView: "list",
  };
  try {
    await createMcpApp(cfg);
    throw new Error("expected rejection");
  } catch (err) {
    assertInstanceOf(err, MCPViewError);
    assertEquals((err as MCPViewError).code, "NO_PARENT_WINDOW");
  }
});

Deno.test("defineView is an identity function", () => {
  const v = {
    render: () => "x",
  };
  const out = defineView<Record<string, never>>(v);
  // Same reference: no wrapping, no side effects.
  assertEquals(out, v);
});

Deno.test("validateConfig throws when a view is missing render", async () => {
  const cfg = {
    info: minimalInfo,
    root: {} as unknown as HTMLElement,
    views: {
      // deno-lint-ignore no-explicit-any
      broken: {} as any, // no render function
    },
    initialView: "broken",
  } as unknown as AppConfig;

  await assertRejects(
    () => createMcpApp(cfg),
    Error,
    'View "broken" is missing a render function',
  );
});

Deno.test("aborting the first mounted session releases its router without touching the host", async () => {
  const entered = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  const cleaned = Promise.withResolvers<void>();
  let listeners = 0;
  let teardowns = 0;
  const host = Object.freeze({
    getHostContext: () => ({}),
    getHostCapabilities: () => ({}),
    addEventListener: () => listeners++,
    removeEventListener: () => listeners--,
  }) as unknown as App;
  const root = { replaceChildren() {}, innerHTML: "" } as unknown as HTMLElement;
  const abort = new AbortController();
  const config: AppConfig<Record<string, never>, string> = {
    info: minimalInfo,
    root,
    autoTheme: false,
    views: { home: defineView({ render: () => "" }) },
    initialView: "home",
    onTeardown: () => {
      teardowns++;
    },
    viewerSession: {
      validate: (value): value is string => typeof value === "string",
      onSession: async () => {
        entered.resolve();
        await unblock.promise;
      },
    },
  };
  const mounting = mountDeclaredSessionApp(host, "first", abort.signal, async (runtime) => {
    const handle = await runtime.createApp(config);
    return {
      dispose: async () => {
        await handle.dispose();
        cleaned.resolve();
      },
    };
  });
  await entered.promise;
  assertEquals(listeners, 1);
  abort.abort();
  await cleaned.promise;
  assertEquals(listeners, 0);
  unblock.resolve();
  const mounted = await mounting;
  mounted.dispose();
  assertEquals(teardowns, 1);
});

Deno.test("aborting an initial route immediately detaches the mounted App from its host", async () => {
  const entered = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  let listeners = 0;
  let rendered = false;
  const host = {
    getHostContext: () => ({}),
    getHostCapabilities: () => ({}),
    addEventListener: () => listeners++,
    removeEventListener: () => listeners--,
  } as unknown as App;
  const controller = new AbortController();
  const mounting = mountDeclaredSessionApp(
    host,
    "first",
    controller.signal,
    ({ createApp }) =>
      createApp({
        info: minimalInfo,
        root: { replaceChildren() {} } as unknown as HTMLElement,
        autoTheme: false,
        views: {
          home: defineView({
            async onEnter() {
              entered.resolve();
              await unblock.promise;
            },
            render() {
              rendered = true;
              return "";
            },
          }),
        },
        initialView: "home",
        viewerSession: {
          validate: (value): value is string => typeof value === "string",
          onSession() {},
        },
      }),
  );
  await entered.promise;
  assertEquals(listeners, 1);
  controller.abort();
  const listenersAtAbort = listeners;
  unblock.resolve();
  const error = await assertRejects(() => mounting, DOMException);
  assertEquals(error.name, "AbortError");
  assertEquals(listenersAtAbort, 0);
  assertEquals(listeners, 0);
  assertEquals(rendered, false);
});

Deno.test("mounted Apps release tools on a failed render or before an async onLeave completes", async () => {
  const host = new App(minimalInfo, {});
  host.getHostCapabilities = () => ({});
  const leaving = Promise.withResolvers<void>();
  const unblock = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const mount = (render: () => string, onLeave?: () => Promise<void>, onDispose?: () => void) =>
    mountDeclaredSessionApp(host, "first", new AbortController().signal, async ({ createApp }) => {
      const app = await createApp({
        info: minimalInfo,
        root: { replaceChildren() {} } as unknown as HTMLElement,
        autoTheme: false,
        views: {
          home: defineView({
            tools: {
              refresh: { description: "Refresh details", handler: () => ({ content: [] }) },
            },
            render,
            onLeave,
          }),
        },
        initialView: "home",
        viewerSession: {
          validate: (value): value is string => typeof value === "string",
          onSession() {},
        },
      });
      return {
        async dispose() {
          await app.dispose();
          onDispose?.();
        },
      };
    });

  await assertRejects(
    () =>
      mount(() => {
        throw new Error("render failed");
      }),
    Error,
    "render failed",
  );
  const first = await mount(() => "", async () => {
    leaving.resolve();
    await unblock.promise;
  }, released.resolve);
  first.dispose();
  await leaving.promise;
  try {
    const next = await mount(() => "");
    next.dispose();
  } finally {
    unblock.resolve();
    await released.promise;
  }
});
