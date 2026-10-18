/** Tests the generated browser event bus with a small DOM/postMessage harness. */

import { assert, assertEquals } from "@std/assert";
import { buildCompositeUi } from "../../../core/composer/composer.ts";
import { resolveRendererSlots } from "../html-generator.ts";
import { generateEventBusScript } from "./event-bus.ts";

interface PostedMessage {
  readonly message: unknown;
  readonly targetOrigin: string;
}

class FakeChildWindow {
  readonly posts: PostedMessage[] = [];

  postMessage(message: unknown, targetOrigin: string): void {
    this.posts.push({ message, targetOrigin });
  }
}

interface FakeIframe {
  readonly dataset: { readonly slot: string };
  readonly contentWindow: FakeChildWindow;
  getBoundingClientRect?(): { width: number; height: number };
}

interface FakeMessageEvent {
  readonly data: unknown;
  readonly source: FakeChildWindow;
  readonly origin: string;
}

type MessageListener = (event: FakeMessageEvent) => void;

function createHarness(
  script: string,
  iframes: readonly FakeIframe[],
  fetchFn: (input: string, init: RequestInit) => Promise<unknown>,
  prefersDark = false,
): {
  emit(source: FakeChildWindow, data: unknown, origin?: string): void;
  resize(): void;
} {
  const listeners: MessageListener[] = [];
  const resizeListeners: Array<() => void> = [];
  const fakeWindow = {
    matchMedia: () => ({ matches: prefersDark }),
    addEventListener(type: string, listener: MessageListener | (() => void)) {
      if (type === "message") listeners.push(listener as MessageListener);
      if (type === "resize") resizeListeners.push(listener as () => void);
    },
  };
  const fakeDocument = {
    body: { classList: { contains: () => false } },
    documentElement: { classList: { contains: () => false } },
    querySelectorAll(selector: string): readonly FakeIframe[] {
      return selector === "iframe[data-slot]" ? iframes : [];
    },
  };
  const silentConsole = { debug: () => {}, log: () => {}, warn: () => {} };

  const run = new Function("window", "document", "fetch", "console", script) as (
    window: typeof fakeWindow,
    document: typeof fakeDocument,
    fetch: (input: string, init: RequestInit) => Promise<unknown>,
    console: typeof silentConsole,
  ) => void;
  run(fakeWindow, fakeDocument, fetchFn, silentConsole);

  return {
    emit(source, data, origin = "http://legacy-slot.test") {
      for (const listener of listeners) listener({ source, data, origin });
    },
    resize() {
      for (const listener of resizeListeners) listener();
    },
  };
}

function findPost(
  source: FakeChildWindow,
  predicate: (message: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  for (const post of source.posts) {
    if (typeof post.message === "object" && post.message !== null) {
      const message = post.message as Record<string, unknown>;
      if (predicate(message)) return message;
    }
  }
  return undefined;
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

Deno.test("generated event bus rejects unsupported ui/message requests without false success", () => {
  const descriptor = buildCompositeUi(
    [{ source: "console_snapshot", resourceUri: "ui://console/snapshot", slot: 0 }],
    { layout: "stack" },
  );
  const expectedOrigin = "http://127.0.0.1:45678";
  const slots = resolveRendererSlots(descriptor, {
    slots: { 0: { iframeSrc: `${expectedOrigin}/ui`, expectedOrigin } },
  });
  const child = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, slots),
    [{ dataset: { slot: "0" }, contentWindow: child }],
    () => Promise.reject(new Error("not used")),
  );
  const params = { role: "user", content: [{ type: "text", text: "Explain this result" }] };

  harness.emit(
    child,
    { jsonrpc: "2.0", id: "initialize", method: "ui/initialize", params: {} },
    expectedOrigin,
  );
  harness.emit(
    child,
    { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
    expectedOrigin,
  );
  child.posts.length = 0;

  // Même un viewer qui ignore les capacités doit recevoir un refus explicite.
  for (const id of ["message-request", 0]) {
    harness.emit(child, { jsonrpc: "2.0", id, method: "ui/message", params }, expectedOrigin);
    assertEquals(child.posts.at(-1), {
      message: {
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "[mcp-compose] ui/message is not supported" },
      },
      targetOrigin: expectedOrigin,
    });
  }
  assertEquals(child.posts.length, 2);

  // Une notification sans identifiant ne reçoit aucune réponse JSON-RPC.
  harness.emit(child, { jsonrpc: "2.0", method: "ui/message", params }, expectedOrigin);
  assertEquals(child.posts.length, 2);
});

Deno.test("generated event bus hosts slot-local MCP Apps lifecycle and proxy", async () => {
  const descriptor = buildCompositeUi(
    [
      { source: "console_snapshot", resourceUri: "ui://console/snapshot", slot: 0 },
      { source: "requirements_trace", resourceUri: "ui://syson/trace", slot: 1 },
    ],
    {
      layout: "stack",
      sync: [{
        from: "console_snapshot",
        event: "filter",
        to: "requirements_trace",
        action: "refresh",
      }],
    },
  );
  const initialResult = {
    content: [{ type: "text", text: '{"status":"ready"}' }],
    structuredContent: { runs: [{ id: "run-1", status: "healthy" }] },
    _meta: { ui: { resourceUri: "ui://console/snapshot" } },
    isError: false,
  };
  const slots = resolveRendererSlots(descriptor, {
    slots: {
      0: {
        iframeSrc: "/ui/0",
        capabilities: { serverTools: true, serverResources: true },
        initialToolResult: initialResult,
      },
      1: { iframeSrc: "/ui/1" },
    },
  });
  const child0 = new FakeChildWindow();
  const child1 = new FakeChildWindow();
  const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
  const harness = createHarness(
    generateEventBusScript(descriptor, slots),
    [
      { dataset: { slot: "0" }, contentWindow: child0 },
      { dataset: { slot: "1" }, contentWindow: child1 },
    ],
    (input, init) => {
      fetchCalls.push({ input, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            jsonrpc: "2.0",
            id: "proxy-may-not-change-client-id",
            result: {
              content: [{ type: "text", text: "proxied" }],
              structuredContent: { ok: true },
            },
          }),
      });
    },
  );

  harness.emit(child0, { jsonrpc: "2.0", id: "init-0", method: "ui/initialize", params: {} });
  harness.emit(child1, { jsonrpc: "2.0", id: "init-1", method: "ui/initialize", params: {} });

  const firstHandshake = findPost(child0, (message) => message.id === "init-0");
  const secondHandshake = findPost(child1, (message) => message.id === "init-1");
  assert(firstHandshake);
  assert(secondHandshake);
  const firstCapabilities = (firstHandshake.result as Record<string, unknown>)
    .hostCapabilities as Record<string, unknown>;
  const secondCapabilities = (secondHandshake.result as Record<string, unknown>)
    .hostCapabilities as Record<string, unknown>;
  // Aucune livraison au modèle : ni le slot interactif ni le slot statique n'annonce message.
  assertEquals("message" in firstCapabilities, false);
  assertEquals("message" in secondCapabilities, false);
  assert("serverTools" in firstCapabilities);
  assert("serverResources" in firstCapabilities);
  assertEquals("serverTools" in secondCapabilities, false);
  assertEquals("serverResources" in secondCapabilities, false);
  assertEquals(
    findPost(child0, (message) => message.method === "ui/notifications/tool-result"),
    undefined,
  );

  // The result must not be sent until after the MCP Apps initialized notification.
  harness.emit(child0, { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  harness.emit(child0, { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} });
  const deliveredInitialResult = findPost(
    child0,
    (message) => message.method === "ui/notifications/tool-result",
  );
  assert(deliveredInitialResult);
  assertEquals(deliveredInitialResult.params, initialResult);
  assertEquals(
    child0.posts.filter((post) =>
      (post.message as Record<string, unknown>).method === "ui/notifications/tool-result"
    ).length,
    1,
  );

  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "tool-request",
    method: "tools/call",
    params: { name: "console_refresh", arguments: { runId: "run-1" } },
  });
  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "resource-request",
    method: "resources/read",
    params: { uri: "ui://console/other" },
  });
  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "tools-list-request",
    method: "tools/list",
    params: {},
  });
  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "resources-list-request",
    method: "resources/list",
    params: {},
  });
  await flushPromises();

  assertEquals(fetchCalls.length, 4);
  assertEquals(fetchCalls[0].input, "/api/slots/0/mcp");
  assertEquals(JSON.parse(String(fetchCalls[0].init.body)), {
    jsonrpc: "2.0",
    id: "tool-request",
    method: "tools/call",
    params: { name: "console_refresh", arguments: { runId: "run-1" } },
  });
  assertEquals(fetchCalls[1].input, "/api/slots/0/mcp");
  assertEquals(JSON.parse(String(fetchCalls[1].init.body)), {
    jsonrpc: "2.0",
    id: "resource-request",
    method: "resources/read",
    params: { uri: "ui://console/other" },
  });
  assertEquals(JSON.parse(String(fetchCalls[2].init.body)), {
    jsonrpc: "2.0",
    id: "tools-list-request",
    method: "tools/list",
    params: {},
  });
  assertEquals(JSON.parse(String(fetchCalls[3].init.body)), {
    jsonrpc: "2.0",
    id: "resources-list-request",
    method: "resources/list",
    params: {},
  });
  assertEquals(
    findPost(child0, (message) => message.id === "tool-request")?.result,
    { content: [{ type: "text", text: "proxied" }], structuredContent: { ok: true } },
  );
  assertEquals(
    findPost(child0, (message) => message.id === "resource-request")?.result,
    { content: [{ type: "text", text: "proxied" }], structuredContent: { ok: true } },
  );
  assertEquals(
    findPost(child0, (message) => message.id === "tools-list-request")?.result,
    { content: [{ type: "text", text: "proxied" }], structuredContent: { ok: true } },
  );
  assertEquals(
    findPost(child0, (message) => message.id === "resources-list-request")?.result,
    { content: [{ type: "text", text: "proxied" }], structuredContent: { ok: true } },
  );

  harness.emit(child1, {
    jsonrpc: "2.0",
    id: "blocked-tool",
    method: "tools/call",
    params: { name: "console_refresh", arguments: {} },
  });
  assertEquals(fetchCalls.length, 4);
  assertEquals(
    (findPost(child1, (message) => message.id === "blocked-tool")?.error as Record<string, unknown>)
      .code,
    -32601,
  );

  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "display-mode",
    method: "ui/request-display-mode",
    params: { mode: "fullscreen" },
  });
  assertEquals(findPost(child0, (message) => message.id === "display-mode")?.result, {
    mode: "inline",
  });

  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "size-ack",
    method: "ui/notifications/size-changed",
    params: { width: 640, height: 480 },
  });
  assertEquals(findPost(child0, (message) => message.id === "size-ack")?.result, {});

  harness.emit(child0, {
    jsonrpc: "2.0",
    id: "compose-event",
    method: "ui/compose/event",
    params: { event: "filter", data: { requirementId: "REQ-1" } },
  });
  assertEquals(
    findPost(child1, (message) => message.method === "ui/compose/event")?.params,
    {
      action: "refresh",
      data: { requirementId: "REQ-1" },
      sourceSlot: 0,
      sharedContext: {},
    },
  );
});

Deno.test("generated event bus ignores unknown windows", () => {
  const descriptor = buildCompositeUi(
    [{ source: "console_snapshot", resourceUri: "ui://console/snapshot", slot: 0 }],
    { layout: "stack" },
  );
  const child = new FakeChildWindow();
  const stranger = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [{ dataset: { slot: "0" }, contentWindow: child }],
    () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: {} }),
      }),
  );

  harness.emit(stranger, { jsonrpc: "2.0", id: "init", method: "ui/initialize", params: {} });

  assertEquals(stranger.posts.length, 0);
});

Deno.test("generated event bus rejects a navigated WindowProxy with the wrong origin", async () => {
  const descriptor = buildCompositeUi(
    [{ source: "console_snapshot", resourceUri: "ui://console/snapshot", slot: 0 }],
    { layout: "stack" },
  );
  const expectedOrigin = "http://127.0.0.1:49152";
  const initialResult = { structuredContent: { runId: "run-1" } };
  const slots = resolveRendererSlots(descriptor, {
    slots: {
      0: {
        iframeSrc: `${expectedOrigin}/ui`,
        expectedOrigin,
        capabilities: { serverTools: true },
        initialToolResult: initialResult,
      },
    },
  });
  const child = new FakeChildWindow();
  const fetchCalls: Array<{ input: string; init: RequestInit }> = [];
  const harness = createHarness(
    generateEventBusScript(descriptor, slots),
    [{ dataset: { slot: "0" }, contentWindow: child }],
    (input, init) => {
      fetchCalls.push({ input, init });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: { ok: true } }),
      });
    },
  );

  // The real App document completes its initial handshake. The reply is
  // constrained to the exact child origin, not a wildcard.
  harness.emit(
    child,
    { jsonrpc: "2.0", id: "initialize", method: "ui/initialize", params: {} },
    expectedOrigin,
  );
  const handshakePost = child.posts.find((post) =>
    (post.message as Record<string, unknown>).id === "initialize"
  );
  assertEquals(handshakePost?.targetOrigin, expectedOrigin);

  // The same WindowProxy is retained when an iframe navigates. A document at
  // another origin must not receive hydration data or drive the local proxy.
  harness.emit(
    child,
    { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
    "https://evil.example",
  );
  harness.emit(
    child,
    {
      jsonrpc: "2.0",
      id: "evil-tool-call",
      method: "tools/call",
      params: { name: "console_refresh", arguments: {} },
    },
    "https://evil.example",
  );
  await flushPromises();
  assertEquals(fetchCalls.length, 0);
  assertEquals(
    findPost(child, (message) => message.method === "ui/notifications/tool-result"),
    undefined,
  );
  assertEquals(findPost(child, (message) => message.id === "evil-tool-call"), undefined);

  // The original document still works and receives every host response at the
  // pinned origin.
  harness.emit(
    child,
    { jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} },
    expectedOrigin,
  );
  const initialPost = child.posts.find((post) =>
    (post.message as Record<string, unknown>).method === "ui/notifications/tool-result"
  );
  assertEquals(initialPost?.targetOrigin, expectedOrigin);
  assertEquals((initialPost?.message as Record<string, unknown>).params, initialResult);

  harness.emit(
    child,
    {
      jsonrpc: "2.0",
      id: "trusted-tool-call",
      method: "tools/call",
      params: { name: "console_refresh", arguments: {} },
    },
    expectedOrigin,
  );
  await flushPromises();
  assertEquals(fetchCalls.length, 1);
  const toolResponse = child.posts.find((post) =>
    (post.message as Record<string, unknown>).id === "trusted-tool-call"
  );
  assertEquals(toolResponse?.targetOrigin, expectedOrigin);
});

Deno.test("generated event bus negotiates component surfaces, updates dimensions, and keeps compose events", () => {
  const requestedSurface = {
    layout: { type: "grid" as const, columns: 2, gap: "sm" as const },
    components: [
      { id: "status", component: "modelica.status" },
      { id: "metrics", component: "modelica.metrics" },
    ],
  };
  const descriptor = buildCompositeUi(
    [
      {
        componentId: "thermal",
        source: "modelica:simulate",
        resourceUri: "ui://modelica/result",
        slot: 0,
        surface: requestedSurface,
      },
      {
        componentId: "architecture",
        source: "syson:snapshot",
        resourceUri: "ui://syson/diagram",
        slot: 1,
      },
    ],
    {
      layout: "split",
      portSync: [{
        event: "requirement.select",
        action: "requirement.highlight",
      }],
    },
  );
  let dimensions = { width: 560, height: 340 };
  const thermal = new FakeChildWindow();
  const architecture = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [
      {
        dataset: { slot: "0" },
        contentWindow: thermal,
        getBoundingClientRect: () => dimensions,
      },
      {
        dataset: { slot: "1" },
        contentWindow: architecture,
        getBoundingClientRect: () => ({ width: 560, height: 340 }),
      },
    ],
    () => Promise.reject(new Error("not used")),
  );

  harness.emit(thermal, {
    jsonrpc: "2.0",
    id: "thermal-init",
    method: "ui/initialize",
    params: {
      appInfo: { name: "thermal", version: "1.0.0" },
      protocolVersion: "2026-01-26",
      appCapabilities: {
        experimental: {
          "io.casys.mcp.view-components/v1": {
            components: {
              "modelica.status": {
                title: "Status",
                events: { emits: ["requirement.select"] },
              },
              "modelica.metrics": { title: "Metrics" },
              "modelica.provenance": { title: "Provenance" },
            },
            defaultSurface: {
              layout: { type: "stack" },
              components: [
                { id: "status", component: "modelica.status" },
                { id: "metrics", component: "modelica.metrics" },
                { id: "provenance", component: "modelica.provenance" },
              ],
            },
          },
        },
      },
    },
  });
  harness.emit(architecture, {
    jsonrpc: "2.0",
    id: "architecture-init",
    method: "ui/initialize",
    params: {
      appCapabilities: {
        experimental: {
          "io.casys.mcp.view-components/v1": {
            components: {
              "syson.diagram": {
                title: "Diagram",
                events: { accepts: ["requirement.highlight"] },
              },
            },
            defaultSurface: {
              layout: { type: "stack" },
              components: [{ id: "diagram", component: "syson.diagram" }],
            },
          },
        },
      },
    },
  });

  const handshake = findPost(thermal, (message) => message.id === "thermal-init");
  const result = handshake?.result as Record<string, unknown>;
  const capabilities = result.hostCapabilities as Record<string, unknown>;
  const context = result.hostContext as Record<string, unknown>;
  assertEquals(
    (capabilities.experimental as Record<string, unknown>)[
      "io.casys.mcp.view-components/v1"
    ],
    { version: "1", eventChannel: "ui/compose/event" },
  );
  assertEquals(context.containerDimensions, { width: 560, height: 340 });
  assertEquals(context.theme, "light");
  assertEquals(context["io.casys.mcp.surface/v1"], {
    instanceId: "thermal",
    status: "ready",
    source: "requested",
    surface: requestedSurface,
    eventChannel: "ui/compose/event",
  });

  dimensions = { width: 820, height: 560 };
  harness.resize();
  const contextChanges = thermal.posts.filter((post) =>
    (post.message as Record<string, unknown>).method ===
      "ui/notifications/host-context-changed"
  );
  const latest = contextChanges.at(-1)?.message as Record<string, unknown>;
  const latestParams = latest.params as Record<string, unknown>;
  assertEquals(latestParams.containerDimensions, { width: 820, height: 560 });
  assertEquals(latestParams["io.casys.mcp.surface/v1"], {
    instanceId: "thermal",
    status: "ready",
    source: "requested",
    surface: requestedSurface,
    eventChannel: "ui/compose/event",
  });

  harness.emit(thermal, {
    jsonrpc: "2.0",
    method: "ui/compose/event",
    params: { event: "requirement.select", data: { id: "REQ-THERMAL-1" } },
  });
  assertEquals(
    findPost(architecture, (message) => message.method === "ui/compose/event")?.params,
    {
      action: "requirement.highlight",
      data: { id: "REQ-THERMAL-1" },
      sourceSlot: 0,
      sharedContext: {},
    },
  );
});

Deno.test("generated event bus does not dynamically route to undeclared component ports", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "cad", resourceUri: "ui://cad/result", slot: 0 },
      { source: "fea", resourceUri: "ui://fea/result", slot: 1 },
    ],
    {
      layout: "split",
      portSync: [{
        event: "semantic.selection.changed",
        action: "semantic.selection.apply",
      }],
    },
  );
  const cad = new FakeChildWindow();
  const fea = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [
      { dataset: { slot: "0" }, contentWindow: cad },
      { dataset: { slot: "1" }, contentWindow: fea },
    ],
    () => Promise.reject(new Error("not used")),
  );
  for (
    const [viewer, name, events] of [
      [cad, "cad.scene", { emits: ["semantic.selection.changed"] }],
      [fea, "calculix.results", { accepts: ["another.action"] }],
    ] as const
  ) {
    harness.emit(viewer, {
      jsonrpc: "2.0",
      id: `${name}-init`,
      method: "ui/initialize",
      params: {
        appCapabilities: {
          experimental: {
            "io.casys.mcp.view-components/v1": {
              components: { [name]: { title: name, events } },
              defaultSurface: {
                layout: { type: "stack" },
                components: [{ id: name, component: name }],
              },
            },
          },
        },
      },
    });
  }

  harness.emit(cad, {
    jsonrpc: "2.0",
    method: "ui/compose/event",
    params: { event: "semantic.selection.changed", data: { id: "face-12" } },
  });

  assertEquals(
    findPost(fea, (message) => message.method === "ui/compose/event"),
    undefined,
  );
});

Deno.test("generated event bus keeps unknown requested components unresolved", () => {
  const descriptor = buildCompositeUi(
    [{
      componentId: "thermal",
      source: "modelica:simulate",
      resourceUri: "ui://modelica/result",
      slot: 0,
      surface: {
        layout: { type: "stack" },
        components: [{ id: "chart", component: "modelica.chart" }],
      },
    }],
    { layout: "stack" },
  );
  const viewer = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [{ dataset: { slot: "0" }, contentWindow: viewer }],
    () => Promise.reject(new Error("not used")),
  );
  harness.emit(viewer, {
    jsonrpc: "2.0",
    id: "viewer-init",
    method: "ui/initialize",
    params: {
      appCapabilities: {
        experimental: {
          "io.casys.mcp.view-components/v1": {
            components: { "modelica.status": { title: "Status" } },
            defaultSurface: {
              layout: { type: "stack" },
              components: [{ id: "status", component: "modelica.status" }],
            },
          },
        },
      },
    },
  });
  const handshake = findPost(viewer, (message) => message.id === "viewer-init");
  const context = (handshake?.result as Record<string, unknown>).hostContext as Record<
    string,
    unknown
  >;
  assertEquals(context["io.casys.mcp.surface/v1"], {
    instanceId: "thermal",
    status: "unresolved",
    reason: "unknown-components",
    missingComponents: ["modelica.chart"],
    eventChannel: "ui/compose/event",
  });
});

Deno.test("generated event bus composes catalogs with no standalone default", () => {
  const requestedSurface = {
    layout: { type: "stack" as const, gap: "sm" as const },
    components: [{ id: "metrics", component: "erpnext.bom.metrics" }],
  };
  const descriptor = buildCompositeUi(
    [{
      componentId: "bom",
      source: "erpnext:bom",
      resourceUri: "ui://erpnext-components/bom",
      slot: 0,
      surface: requestedSurface,
    }],
    { layout: "stack" },
  );
  const viewer = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [{ dataset: { slot: "0" }, contentWindow: viewer }],
    () => Promise.reject(new Error("not used")),
  );
  harness.emit(viewer, {
    jsonrpc: "2.0",
    id: "viewer-init",
    method: "ui/initialize",
    params: {
      appCapabilities: {
        experimental: {
          "io.casys.mcp.view-components/v1": {
            components: {
              "erpnext.bom.metrics": { title: "BOM metrics" },
            },
          },
        },
      },
    },
  });
  const handshake = findPost(viewer, (message) => message.id === "viewer-init");
  const context = (handshake?.result as Record<string, unknown>).hostContext as Record<
    string,
    unknown
  >;
  assertEquals(context["io.casys.mcp.surface/v1"], {
    instanceId: "bom",
    status: "ready",
    source: "requested",
    surface: requestedSurface,
    eventChannel: "ui/compose/event",
  });
});

Deno.test("generated event bus reports when a component-only App is not composed", () => {
  const descriptor = buildCompositeUi(
    [{ source: "erpnext:bom", resourceUri: "ui://erpnext-components/bom", slot: 0 }],
    { layout: "stack" },
  );
  const viewer = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [{ dataset: { slot: "0" }, contentWindow: viewer }],
    () => Promise.reject(new Error("not used")),
  );
  harness.emit(viewer, {
    jsonrpc: "2.0",
    id: "viewer-init",
    method: "ui/initialize",
    params: {
      appCapabilities: {
        experimental: {
          "io.casys.mcp.view-components/v1": {
            components: {
              "erpnext.bom.metrics": { title: "BOM metrics" },
            },
          },
        },
      },
    },
  });
  const handshake = findPost(viewer, (message) => message.id === "viewer-init");
  const context = (handshake?.result as Record<string, unknown>).hostContext as Record<
    string,
    unknown
  >;
  assertEquals(context["io.casys.mcp.surface/v1"], {
    instanceId: "erpnext:bom",
    status: "unresolved",
    reason: "surface-required",
    eventChannel: "ui/compose/event",
  });
});

Deno.test("generated event bus advertises the system dark theme used by its CSS", () => {
  const descriptor = buildCompositeUi(
    [{ source: "viewer", resourceUri: "ui://viewer/main", slot: 0 }],
    { layout: "stack" },
  );
  const viewer = new FakeChildWindow();
  const harness = createHarness(
    generateEventBusScript(descriptor, resolveRendererSlots(descriptor)),
    [{ dataset: { slot: "0" }, contentWindow: viewer }],
    () => Promise.reject(new Error("not used")),
    true,
  );

  harness.emit(viewer, {
    jsonrpc: "2.0",
    id: "viewer-init",
    method: "ui/initialize",
    params: { appCapabilities: {} },
  });

  const handshake = findPost(viewer, (message) => message.id === "viewer-init");
  const context = (handshake?.result as Record<string, unknown>).hostContext as Record<
    string,
    unknown
  >;
  assertEquals(context.theme, "dark");
});
