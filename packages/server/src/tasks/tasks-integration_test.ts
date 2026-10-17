/**
 * Track I — Tasks extension over the wire.
 *
 * `task-store_test.ts` covers the store in isolation. This file covers the part
 * that only exists once the store is wired into the transport: the `resultType`
 * asymmetry, the capability guard on all four entry points, and the routing
 * header. A correct store reached through a wrong dispatch passes those unit
 * tests and fails here.
 *
 * @module lib/server/tasks/tasks-integration_test
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { McpApp } from "../mcp-app.ts";
import type { ToolHandler } from "../types.ts";
import { createTask } from "./mod.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";
const TASKS_ID = "io.modelcontextprotocol/tasks";
const V = "2026-07-28";

/** Client capabilities declaring the Tasks extension. */
const WITH_TASKS = { extensions: { [TASKS_ID]: {} } };

function buildServer(opts: { declareExtension: boolean }) {
  const server = new McpApp({
    name: "tasks-integration",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    ...(opts.declareExtension ? { extensions: { [TASKS_ID]: {} } } : {}),
  });

  server.registerTools(
    [
      {
        name: "slow_scan",
        description: "Long scan",
        inputSchema: { type: "object" },
      },
      {
        name: "quick",
        description: "Immediate",
        inputSchema: { type: "object" },
      },
    ],
    new Map<string, ToolHandler>([
      // Resolves on the next microtask, so the task is created and observable
      // without the test having to sleep.
      ["slow_scan", () =>
        createTask({ pollIntervalMs: 10 }, async () => {
          await Promise.resolve();
          return { rows: 42 };
        })],
      ["quick", () => "done"],
    ]),
  );
  return server;
}

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

/** POST as a conforming client; `caps` controls what the client declares. */
function post(
  url: string,
  method: string,
  params: Record<string, unknown>,
  caps: Record<string, unknown> = WITH_TASKS,
) {
  const mcpName = method === "tools/call"
    ? params.name
    : method.startsWith("tasks/")
    ? params.taskId
    : undefined;

  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": V,
      "Mcp-Method": method,
      ...(typeof mcpName === "string" ? { "Mcp-Name": mcpName } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: caps } },
    }),
  });
}

Deno.test("tasks - a descriptor-returning tool yields resultType 'task', not 'complete'", async () => {
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const res = await post(url, "tools/call", {
      name: "slow_scan",
      arguments: {},
    });
    const data = await res.json();

    assertEquals(res.status, 200);
    // The single most likely implementation error: stampResult() would have
    // written "complete" here.
    assertEquals(data.result.resultType, "task");
    assertExists(data.result.taskId, "taskId must be flat on the result");
    assertEquals(typeof data.result.status, "string");
    // `task` is still a 2026 Result, so it needs the same server identity stamp
    // as every other result type. Omitting it makes task creation uniquely
    // anonymous to clients that partition response handling by server identity.
    assertEquals(data.result._meta?.["io.modelcontextprotocol/serverInfo"], {
      name: "tasks-integration",
      version: "1.0.0",
    });
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - tasks/get carries resultType 'complete', unlike task creation", async () => {
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const created = await (await post(url, "tools/call", {
      name: "slow_scan",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;

    const got = await (await post(url, "tasks/get", { taskId })).json();
    // The asymmetry the spec states three times: creation is "task", a
    // subsequent tasks/get is an ordinary RPC response and so is "complete".
    assertEquals(got.result.resultType, "complete");
    assertEquals(got.result.taskId, taskId);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - a task created earlier is immediately resolvable", async () => {
  // Spec: a server MUST NOT return a task handle before the task is durably
  // created — a tasks/get for the returned id must resolve straight away.
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const created = await (await post(url, "tools/call", {
      name: "slow_scan",
      arguments: {},
    })).json();
    const res = await post(url, "tasks/get", {
      taskId: created.result.taskId,
    });
    assertEquals(res.status, 200);
    await res.text();
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - the capability guard covers all four entry points", async () => {
  // Guarding creation alone would still let a non-declaring client poll and
  // cancel tasks it could never have been handed, which the spec forbids
  // explicitly for tasks/get, tasks/update and tasks/cancel.
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    // First obtain a real task id as a declaring client.
    const created = await (await post(url, "tools/call", {
      name: "slow_scan",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;

    const noCaps = {};
    const cases: Array<[string, Record<string, unknown>]> = [
      ["tools/call", { name: "slow_scan", arguments: {} }],
      ["tasks/get", { taskId }],
      ["tasks/update", { taskId, inputResponses: {} }],
      ["tasks/cancel", { taskId }],
    ];

    for (const [method, params] of cases) {
      const res = await post(url, method, params, noCaps);
      const data = await res.json();
      assertEquals(res.status, 400, `${method} must be refused`);
      assertEquals(data.error.code, -32021, `${method} code`);
      // ClientCapabilities-shaped per the schema, so a typed client can read it
      // directly rather than mapping an array of names back onto the type.
      assertEquals(data.error.data.requiredCapabilities, {
        extensions: { [TASKS_ID]: {} },
      });
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - tasks/* is method-not-found when the server did not declare the extension", async () => {
  // Advertising drives behaviour: with no declaration there is no store, and the
  // method genuinely does not exist here.
  const { http, url } = await start(buildServer({ declareExtension: false }));
  try {
    const res = await post(url, "tasks/get", { taskId: "whatever" });
    const data = await res.json();
    assertEquals(res.status, 404);
    assertEquals(data.error.code, -32601);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - server/discover advertises the extension only when declared", async () => {
  const declared = await start(buildServer({ declareExtension: true }));
  try {
    const data = await (await post(declared.url, "server/discover", {})).json();
    assertEquals(data.result.capabilities.extensions, { [TASKS_ID]: {} });
  } finally {
    await declared.http.shutdown();
  }

  const bare = await start(buildServer({ declareExtension: false }));
  try {
    const data = await (await post(bare.url, "server/discover", {})).json();
    assertEquals(data.result.capabilities.extensions, undefined);
  } finally {
    await bare.http.shutdown();
  }
});

Deno.test("tasks - Mcp-Name must mirror params.taskId on tasks/* requests", async () => {
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const created = await (await post(url, "tools/call", {
      name: "slow_scan",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;

    // Header omitted.
    const missing = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { taskId, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS } },
      }),
    });
    assertEquals(missing.status, 400);
    assertEquals((await missing.json()).error.code, -32020);

    // Header present but pointing at a different task.
    const wrong = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "some-other-task",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: { taskId, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS } },
      }),
    });
    assertEquals(wrong.status, 400);
    assertEquals((await wrong.json()).error.code, -32020);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - an ordinary tool result is unaffected by the extension", async () => {
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const data = await (await post(url, "tools/call", {
      name: "quick",
      arguments: {},
    })).json();
    assertEquals(data.result.resultType, "complete");
    assertEquals(data.result.content[0].text, "done");
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - cancel reports through and the task reaches a terminal state", async () => {
  const server = new McpApp({
    name: "tasks-cancel",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "forever",
      description: "Never finishes",
      inputSchema: { type: "object" },
    },
    () =>
      createTask({}, (ctrl) =>
        new Promise((_, reject) => {
          ctrl.signal.addEventListener(
            "abort",
            () => reject(ctrl.signal.reason),
          );
        })),
  );
  const { http, url } = await start(server);
  try {
    const created = await (await post(url, "tools/call", {
      name: "forever",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;

    const cancelled = await (await post(url, "tasks/cancel", { taskId }))
      .json();
    // MUST be an empty acknowledgement beyond the envelope. Returning task state
    // here would be non-conformant, and the spec calls the ack eventually
    // consistent — any state included could already be stale.
    assertEquals(cancelled.result, {
      resultType: "complete",
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: "tasks-cancel",
          version: "1.0.0",
        },
      },
    });

    const after = await (await post(url, "tasks/get", { taskId })).json();
    assertEquals(after.result.status, "cancelled");
  } finally {
    await http.shutdown();
  }
});

// ── Version-gate invariant ────────────────────────────────────────────────────
// The Tasks extension is 2026-only. The version gate at STATELESS_SUPPORTED_VERSIONS
// (mcp-app.ts) is the enforcement point: any request arriving with an unsupported
// protocol version is rejected before reaching the method-dispatch layer.
// This test documents that invariant so a future addition of a pre-2026 version
// to STATELESS_SUPPORTED_VERSIONS would produce a failing test that forces
// a conscious review of the Tasks gate.

Deno.test("tasks - a peer with an unsupported protocol version is rejected at the version gate, not by the tasks layer", async () => {
  // Spec MUST NOT: "A server MUST NOT serve Tasks extension methods to a client
  // that negotiated a pre-2026 protocol version". The gate is upstream
  // (STATELESS_SUPPORTED_VERSIONS check), so the error code is -32022
  // (unsupported protocol version), never -32021 (missing capability).
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "some-task",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {
          taskId: "some-task",
          _meta: {
            [PROTO_KEY]: "2025-11-25",
            [CAPS_KEY]: WITH_TASKS,
          },
        },
      }),
    });
    assertEquals(res.status, 400);
    const data = await res.json();
    // Must be a version error, not a capability error (-32021) or method-not-found (-32601).
    // If someone adds "2025-11-25" back to STATELESS_SUPPORTED_VERSIONS this
    // test will catch the regression.
    assertEquals(
      data.error.code,
      -32022,
      "must be rejected by the version gate",
    );
    assertEquals(
      Array.isArray(data.error.data?.supported),
      true,
      "error.data.supported must list the server's accepted versions",
    );
  } finally {
    await http.shutdown();
  }
});

// ── Findings from the final adversarial review ───────────────────────────────

Deno.test("tasks - a task is bound to its creator; another caller cannot reach it", async () => {
  // Spec: "Servers MUST perform authentication and authorization checks on each
  // task-related request to ensure that the client has permission to access a
  // task." A task id is an unguessable bearer token, but that is one line of
  // defence: anyone who learns an id could otherwise read, answer or cancel it.
  //
  // Two distinct principals via static bearer tokens.
  const { createStaticTokenAuthProvider } = await import(
    "../auth/static-token-provider.ts"
  );
  const server = new McpApp({
    name: "tasks-owner",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
    auth: {
      provider: createStaticTokenAuthProvider(["token-alice"], {
        resource: "https://example.test/mcp",
        subject: "alice",
      }),
    },
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => new Promise(() => {/* never settles */})),
  );

  const { http, url } = await start(server);
  try {
    const create = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-alice",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "scan",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "scan",
          arguments: {},
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS },
        },
      }),
    });
    const created = await create.json();
    const taskId = created.result.taskId as string;
    assertExists(taskId);

    // Alice can read her own task.
    const own = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer token-alice",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": taskId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { taskId, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS } },
      }),
    });
    assertEquals((await own.json()).result.taskId, taskId);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - a completed task carries a CallToolResult, not the raw return value", async () => {
  // Spec: CreateTaskResult stands in for the standard result of the augmented
  // request. So the eventual result must be shaped like what tools/call would
  // have returned — otherwise a client has to special-case task results.
  const server = new McpApp({
    name: "tasks-result-shape",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "rows",
      description: "Returns rows",
      inputSchema: { type: "object" },
    },
    () => createTask({}, () => Promise.resolve({ rows: 42 })),
  );

  const { http, url } = await start(server);
  try {
    const created = await (await post(url, "tools/call", {
      name: "rows",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;

    // Let the microtask settle.
    await new Promise((r) => setTimeout(r, 20));

    const got = await (await post(url, "tasks/get", { taskId })).json();
    assertEquals(got.result.status, "completed");
    // The shape a synchronous tools/call would have produced: content[], not
    // the bare { rows: 42 }.
    assertExists(got.result.result.content);
    assertEquals(got.result.result.content[0].type, "text");
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - an unknown taskId is an error, not a successful no-op", async () => {
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    for (const method of ["tasks/get", "tasks/update", "tasks/cancel"]) {
      const params = method === "tasks/update"
        ? { taskId: "no-such-task", inputResponses: {} }
        : { taskId: "no-such-task" };
      const data = await (await post(url, method, params)).json();
      assertEquals(data.error?.code, -32602, `${method} must report an error`);
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - an auth provider with no usable subject yields a diagnosable error", async () => {
  // Regression guard for a fix that introduced its own bug: the principal helper
  // used to throw. The tasks handlers call it outside any try/catch, so the throw
  // surfaced through the POST-level catch as -32700 "Parse error" — a diagnosis
  // pointing nowhere near a misconfigured auth provider.
  const { createStaticTokenAuthProvider } = await import(
    "../auth/static-token-provider.ts"
  );
  const base = createStaticTokenAuthProvider(["tok"], {
    resource: "https://example.test/mcp",
  });
  // Same provider, but reporting the "unknown" subject a token with no `sub`
  // claim produces.
  const provider = Object.create(
    Object.getPrototypeOf(base),
    Object.getOwnPropertyDescriptors(base),
  );
  provider.verifyToken = () =>
    Promise.resolve({ subject: "unknown", scopes: [] });

  const server = new McpApp({
    name: "tasks-no-subject",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
    auth: { provider },
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => Promise.resolve(1)),
  );

  const { http, url } = await start(server);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer tok",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "whatever",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {
          taskId: "whatever",
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS },
        },
      }),
    });
    const data = await res.json();
    // Names the actual problem, and says what to change.
    assertEquals(data.error.code, -32603);
    assertEquals(data.error.data.problem, "no_caller_principal");
    assertStringIncludes(data.error.data.recovery, "subject claim");
  } finally {
    await http.shutdown();
  }
});

// ── Round-2 findings ─────────────────────────────────────────────────────────

Deno.test("round2 - a formatter failure fails the task instead of completing it empty", async () => {
  // A BigInt cannot be JSON-serialised, so the result formatter throws. Unguarded
  // that produced a task marked `completed` with NO result — the one state a
  // polling client cannot interpret — plus an unhandled rejection.
  const server = new McpApp({
    name: "tasks-format-fail",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "bigint",
      description: "Unserialisable",
      inputSchema: { type: "object" },
    },
    () => createTask({}, () => Promise.resolve({ n: 1n })),
  );

  const { http, url } = await start(server);
  try {
    const created = await (await post(url, "tools/call", {
      name: "bigint",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;
    await new Promise((r) => setTimeout(r, 20));

    const got = await (await post(url, "tasks/get", { taskId })).json();
    // Honest terminal state: the work finished, the result cannot be represented.
    assertEquals(got.result.status, "failed");
    assertStringIncludes(got.result.error.message, "could not be serialised");
  } finally {
    await http.shutdown();
  }
});

Deno.test("tasks - a preformatted unserialisable result fails before tasks/get", async () => {
  // Preformatted proxy results bypass the plain-value JSON.stringify path. A
  // BigInt hidden in structuredContent used to let the task become completed,
  // then made a later tasks/get fail while serialising the stored result.
  const server = new McpApp({
    name: "tasks-preformatted-format-fail",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "preformatted_bigint",
      description: "Unserialisable proxy result",
      inputSchema: { type: "object" },
    },
    () =>
      createTask({}, () =>
        Promise.resolve({
          content: [{ type: "text", text: "done" }],
          structuredContent: { n: 1n },
        })),
  );

  const { http, url } = await start(server);
  try {
    const created = await (await post(url, "tools/call", {
      name: "preformatted_bigint",
      arguments: {},
    })).json();
    const taskId = created.result.taskId as string;
    await new Promise((r) => setTimeout(r, 20));

    const got = await (await post(url, "tasks/get", { taskId })).json();
    assertEquals(got.result.status, "failed");
    assertStringIncludes(got.result.error.message, "could not be serialised");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round2 - tasks/* without a JSON-RPC id is rejected, not executed", async () => {
  // Without an id these slipped past header validation (which exempts
  // notifications), mutated task state, and answered with a malformed id-less
  // response.
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/cancel",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tasks/cancel",
        params: {
          taskId: "whatever",
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS },
        },
      }),
    });
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32602);
    assertStringIncludes(data.error.message, "requires a JSON-RPC id");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round2 - taskIds in a listen filter requires the Tasks capability", async () => {
  // Recognising the field is mandatory even though pushing task updates is not:
  // accepting it from a non-declaring client opens a stream that can never
  // deliver, with nothing to say why.
  const { http, url } = await start(buildServer({ declareExtension: true }));
  try {
    const refused = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "subscriptions/listen",
        params: {
          notifications: { taskIds: ["t-1"] },
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} }, // no tasks extension
        },
      }),
    });
    const data = await refused.json();
    assertEquals(refused.status, 400);
    assertEquals(data.error.code, -32021);

    // Declaring it is accepted, and the acknowledgement echoes the ids.
    const ok = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "subscriptions/listen",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "subscriptions/listen",
        params: {
          notifications: { taskIds: ["t-1"] },
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS },
        },
      }),
    });
    assertEquals(ok.status, 200);
    await ok.body?.cancel();
  } finally {
    await http.shutdown();
  }
});

Deno.test("round2 - taskOwnerKey scopes a task beyond the subject", async () => {
  // Binding to the subject alone leaves a task created under one tenant reachable
  // from another by the same user. The framework cannot derive tenancy — it lives
  // in consumer middleware — so it is a hook.
  const server = new McpApp({
    name: "tasks-tenant",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
    taskOwnerKey: (_authInfo, request) =>
      `anon@${request.headers.get("x-tenant-id") ?? "none"}`,
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => new Promise(() => {})),
  );

  const { http, url } = await start(server);
  const call = (
    method: string,
    params: Record<string, unknown>,
    tenant: string,
    name: string,
  ) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": tenant,
        "MCP-Protocol-Version": V,
        "Mcp-Method": method,
        "Mcp-Name": name,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: WITH_TASKS },
        },
      }),
    });
  try {
    const created = await (await call(
      "tools/call",
      {
        name: "scan",
        arguments: {},
      },
      "acme",
      "scan",
    )).json();
    const taskId = created.result.taskId as string;

    // Same subject, different tenant: must not resolve.
    const foreign = await (await call("tasks/get", { taskId }, "other", taskId))
      .json();
    assertEquals(foreign.error?.code, -32602, "cross-tenant access must fail");

    // Same tenant: resolves.
    const own = await (await call("tasks/get", { taskId }, "acme", taskId))
      .json();
    assertEquals(own.result.taskId, taskId);
  } finally {
    await http.shutdown();
  }
});

Deno.test("probe - an empty taskOwnerKey is refused rather than shared", async () => {
  // `""` is what the obvious implementation returns when a header is missing, and
  // it would put every caller under one owner — undoing the isolation the hook
  // exists to provide. Found by probing my own fix, not by a failing test.
  const server = new McpApp({
    name: "tasks-empty-key",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
    taskOwnerKey: () => "",
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => new Promise(() => {})),
  );

  const { http, url } = await start(server);
  try {
    const res = await post(url, "tools/call", { name: "scan", arguments: {} });
    const data = await res.json();
    assertEquals(res.status, 500);
    assertEquals(data.error.data.problem, "invalid_task_owner_key");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round3 - no task is spawned once shutdown has begun", async () => {
  // The pipeline is async, so a handler can settle after stop() started. Spawning
  // then would start un-abortable work in a drained store, and the task would
  // outlive the server. A synchronous stopping flag is what makes the check
  // reliable — anything awaited leaves the same window open.
  let release: (() => void) | undefined;
  let entered: (() => void) | undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const inHandler = new Promise<void>((r) => {
    entered = r;
  });

  const server = new McpApp({
    name: "tasks-shutdown-race",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    { name: "slow", description: "Waits", inputSchema: { type: "object" } },
    async () => {
      entered?.();
      await held; // still running when shutdown begins
      return createTask({}, () => new Promise(() => {}));
    },
  );

  const { http, url } = await start(server);
  const pending = post(url, "tools/call", { name: "slow", arguments: {} });

  // Wait until the handler is genuinely parked inside the pipeline, so the request
  // is accepted and in flight rather than merely dispatched.
  await inHandler;

  // Mark the server as stopping WITHOUT closing the listener yet: stop() sets the
  // flag synchronously, which is the behaviour under test. Closing the socket first
  // would only prove that a refused connection fails.
  const stopping = server.stop();
  release?.();

  const res = await pending;
  const data = await res.json();
  await stopping;
  await http.shutdown();

  // Refused, and legibly: not a 200 carrying a task nothing will ever drain.
  assertEquals(res.status, 503);
  assertEquals(data.error.data.problem, "server_stopping");
});

Deno.test("round3 - a throwing taskOwnerKey fails closed on task routes too", async () => {
  // It previously became -32700 Parse error on tasks/*, while task creation gave
  // -32603 — the same inconsistency the principal guard had.
  const server = new McpApp({
    name: "tasks-throwing-key",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
    taskOwnerKey: () => {
      throw new Error("consumer bug");
    },
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => new Promise(() => {})),
  );

  const { http, url } = await start(server);
  try {
    const res = await post(url, "tasks/get", { taskId: "whatever" });
    const data = await res.json();
    assertEquals(res.status, 500);
    assertEquals(data.error.data.problem, "invalid_task_owner_key");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round4 - a restarted server accepts tasks again", async () => {
  // stop() leaves the store disposed and sets `stopping`; only a start path clears
  // both. The stdio start() did not, so a stdio server that had been stopped
  // refused every task for the rest of its life, with nothing to say why.
  const server = new McpApp({
    name: "tasks-restart",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    { name: "scan", description: "Scan", inputSchema: { type: "object" } },
    () => createTask({}, () => new Promise(() => {})),
  );

  const first = await start(server);
  const before = await (await post(first.url, "tools/call", {
    name: "scan",
    arguments: {},
  })).json();
  assertEquals(before.result.resultType, "task");
  await first.http.shutdown();

  // Back up on a fresh port: tasks must work again.
  const second = await start(server);
  try {
    const after = await (await post(second.url, "tools/call", {
      name: "scan",
      arguments: {},
    })).json();
    assertEquals(
      after.result.resultType,
      "task",
      "a restarted server must accept tasks again",
    );
  } finally {
    await second.http.shutdown();
  }
});

Deno.test("round5 - a handler failing during task setup reports its own error", async () => {
  // The catch around spawn() was a blanket one, so a legitimate throw from the
  // handler's task setup was reported as "server is shutting down" on a perfectly
  // healthy server — a diagnosis that sends the reader to the wrong place.
  const server = new McpApp({
    name: "tasks-setup-throw",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "boom",
      description: "Throws in setup",
      inputSchema: { type: "object" },
    },
    () =>
      ({
        _type: "async-task",
        get options(): never {
          throw new Error("setup exploded");
        },
        run: () => Promise.resolve(1),
        // deno-lint-ignore no-explicit-any
      }) as any,
  );

  const { http, url } = await start(server);
  try {
    const res = await post(url, "tools/call", { name: "boom", arguments: {} });
    const data = await res.json();
    // The real cause, not a fictional shutdown.
    assertEquals(data.error.code, -32603);
    assertStringIncludes(data.error.message, "setup exploded");
    assertEquals(data.error.data?.problem, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("round5 - one unserialisable inputRequest rejects the whole map", async () => {
  // Wholesale rejection is the right call: a partially serialisable map cannot be
  // emitted, so accepting the good half would return a response missing a request
  // the handler asked for.
  const { checkInputRequestCapabilities } = await import(
    "../mrtr/capability-check.ts"
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const result = checkInputRequestCapabilities({
    good: { method: "elicitation/create", params: { mode: "form" } },
    // deno-lint-ignore no-explicit-any
    bad: { method: "elicitation/create", params: circular as any },
  }, { elicitation: {} });
  assertEquals(result.ok, false);
});
