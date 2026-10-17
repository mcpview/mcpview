/**
 * Public API surface, from a consumer's point of view.
 *
 * Every import below goes through `mod.ts`, the path a consumer actually uses —
 * not through `src/`. Internal tests reach into sub-modules directly and so prove
 * nothing about whether a feature is *reachable* once published.
 *
 * This exists because the Tasks extension shipped fully wired and fully tested
 * while `createTask` was absent from the barrel: no consumer could have opted a
 * tool into async mode. Nothing else in the suite noticed.
 *
 * @module lib/server/api-surface_test
 */

import { assertEquals } from "@std/assert";
import {
  createTask,
  exportStateKey,
  generateStateKey,
  McpApp,
  MemoryMrtrReplayStore,
  type MrtrOptions,
  type MrtrReplayStore,
  sealRequestState,
  type SubscriptionFilter,
  SubscriptionRegistry,
  verifyRequestState,
} from "./mod.ts";

Deno.test("api surface - a consumer can configure all three 2026-07-28 features", () => {
  // Type-level as much as runtime: if an option or type were missing from the
  // barrel this would not compile.
  const app = new McpApp({
    name: "api-surface",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { "io.modelcontextprotocol/tasks": {} },
    mrtr: {
      signingKey: "b".repeat(64),
      replayStore: new MemoryMrtrReplayStore(),
    } satisfies MrtrOptions,
    cache: { ttlMs: 60_000, scope: "public" },
  });

  assertEquals(typeof app.registerTool, "function");
  assertEquals(typeof app.sendNotification, "function");
});

Deno.test("api surface - a consumer can provide a shared MRTR replay store", () => {
  const replayStore: MrtrReplayStore = {
    consume: (_nonce, _expiresAt) => true,
  };
  const app = new McpApp({
    name: "api-surface-shared-replay",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    mrtr: { signingKey: "b".repeat(64), replayStore },
  });

  assertEquals(typeof app.registerTool, "function");
});

Deno.test("api surface - createTask is reachable and a tool can return it", () => {
  // The gap that motivated this file: Tasks was wired end-to-end while the one
  // function a handler needs was unexported.
  const app = new McpApp({
    name: "api-surface-tasks",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { "io.modelcontextprotocol/tasks": {} },
  });

  app.registerTool(
    { name: "scan", description: "Long scan", inputSchema: { type: "object" } },
    () =>
      createTask({ pollIntervalMs: 10 }, async () => {
        await Promise.resolve();
        return { rows: 1 };
      }),
  );

  const descriptor = createTask({}, () => Promise.resolve("x"));
  assertEquals(typeof descriptor.run, "function");
});

Deno.test("api surface - the MRTR primitives round-trip through the public path", async () => {
  const key = await generateStateKey();
  const hex = await exportStateKey(key);
  assertEquals(hex.length, 64);

  const token = await sealRequestState({
    sub: "user-1",
    method: "tools/call",
    paramsDigest: "d".repeat(64),
    exp: Math.floor(Date.now() / 1000) + 60,
    nonce: "e".repeat(32),
  }, key);

  const verdict = await verifyRequestState(token, key, {
    principal: "user-1",
    method: "tools/call",
    paramsDigest: "d".repeat(64),
  });
  assertEquals(verdict.ok, true);
});

Deno.test("api surface - the subscription registry and its filter type are exported", () => {
  const filter: SubscriptionFilter = { toolsListChanged: true };
  const registry = new SubscriptionRegistry({
    serverInfo: { name: "api-surface", version: "1.0.0" },
    serverSupports: filter,
  });
  assertEquals(registry.computeAgreedFilter({ toolsListChanged: true }), {
    toolsListChanged: true,
  });
  // An allowlist: a type the mask omits is not granted.
  assertEquals(
    registry.computeAgreedFilter({ promptsListChanged: true }),
    {},
  );
  registry.shutdown();
});

Deno.test("api surface - stop() releases every subsystem's resources", async () => {
  // Three subsystems hold timers or streams: the task sweep, the subscription
  // keep-alive, and session cleanup. A leak here means the process stops exiting,
  // which is the kind of regression nobody notices until a CI job hangs.
  //
  // Deno's resource sanitizer is what actually enforces this: were a timer left
  // armed or a stream left open, this test would fail on leak detection rather
  // than on an assertion.
  const app = new McpApp({
    name: "lifecycle",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { "io.modelcontextprotocol/tasks": {} },
    mrtr: { signingKey: "c".repeat(64) },
  });

  app.registerTool(
    {
      name: "spawn",
      description: "Spawns a task",
      inputSchema: { type: "object" },
    },
    () => createTask({}, () => new Promise(() => {/* never settles */})),
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({ port, onListen: () => {} });

  // Leave a task in flight and a subscription stream open, so shutdown has
  // something to actually tear down.
  const call = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "spawn",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "spawn",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/tasks": {} },
          },
        },
      },
    }),
  });
  const created = await call.json();
  assertEquals(created.result.resultType, "task");

  const stream = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "subscriptions/listen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "subscriptions/listen",
      params: {
        notifications: { toolsListChanged: true },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  assertEquals(stream.status, 200);
  await stream.body?.cancel();

  await http.shutdown();
});
