/**
 * Systematic wire-shape coverage for extension paths outside MRTR.
 *
 * MRTR's shape fuzzing found a recurring class of boundary bug: values that
 * JSON can carry survive until a later operation assumes the TypeScript type is
 * true. Tasks and subscriptions have the same risk, but their failures look
 * different on the wire: malformed task output must fail the task, while a
 * malformed client subscription filter must be rejected as invalid params.
 *
 * @module lib/server/shape-fuzz_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { McpApp } from "./mcp-app.ts";
import { createTask } from "./tasks/mod.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";
const TASKS_ID = "io.modelcontextprotocol/tasks";
const V = "2026-07-28";
const WITH_TASKS = { extensions: { [TASKS_ID]: {} } };

/** Every shape that round-trips through JSON without being dropped. */
const JSON_SURVIVABLE: readonly unknown[] = [
  null,
  0,
  1,
  -1,
  1.5,
  "",
  "x",
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  true,
  false,
  [],
  ["x"],
  {},
  { nested: { deep: true } },
  { toString: null },
  { valueOf: null },
];

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

function post(
  url: string,
  method: string,
  params: Record<string, unknown>,
  capabilities: Record<string, unknown> = WITH_TASKS,
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
      params: {
        ...params,
        _meta: { [PROTO_KEY]: V, [CAPS_KEY]: capabilities },
      },
    }),
  });
}

function buildTaskServer() {
  const server = new McpApp({
    name: "task-shape-fuzz",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { [TASKS_ID]: {} },
  });
  server.registerTool(
    {
      name: "ask",
      description: "Exercises TaskController.requireInput runtime boundaries",
      inputSchema: { type: "object" },
    },
    (args) => {
      const shape = JSON_SURVIVABLE[args.index as number];
      if (args.position === "key") {
        return createTask({}, async (ctrl) => {
          // The fuzz deliberately crosses the public TypeScript boundary.
          // deno-lint-ignore no-explicit-any
          await ctrl.requireInput(shape as any, {
            method: "elicitation/create",
            params: { question: "Continue?" },
          });
        });
      }
      if (args.position === "canonical") {
        let serialisations = 0;
        return createTask({}, async (ctrl) => {
          // The same live object must not be serialised once for the task
          // creation response and again for tasks/get. A boundary clone makes
          // both snapshots carry the one shape that was validated.
          const unstable = {
            toJSON: () => {
              serialisations++;
              return serialisations === 1
                ? { method: "elicitation/create", params: { stable: true } }
                : null;
            },
          };
          // deno-lint-ignore no-explicit-any
          await ctrl.requireInput("canonical", unstable as any);
        });
      }
      return createTask({}, async (ctrl) => {
        // The fuzz deliberately crosses the public TypeScript boundary.
        // deno-lint-ignore no-explicit-any
        await ctrl.requireInput("request", shape as any);
      });
    },
  );
  return server;
}

async function taskFor(
  url: string,
  position: "key" | "request" | "canonical",
  index: number,
): Promise<Record<string, unknown>> {
  const createdResponse = await post(url, "tools/call", {
    name: "ask",
    arguments: { position, index },
  });
  assertEquals(createdResponse.status, 200, `${position} ${index} creation`);
  const created = await createdResponse.json();
  assertEquals(
    created.result?.resultType,
    "task",
    `${position} ${index} must create a task, not turn malformed task output into a tool error`,
  );
  const taskId = created.result?.taskId;
  assertEquals(typeof taskId, "string", `${position} ${index} task id`);

  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await post(url, "tasks/get", { taskId });
    assertEquals(response.status, 200, `${position} ${index} polling`);
    const data = await response.json();
    const result = data.result as Record<string, unknown>;
    if (result.status !== "working") return result;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`${position} ${index} never left working`);
}

Deno.test("shape fuzz - task input keys are either strings or a clearly failed task", async () => {
  const { http, url } = await start(buildTaskServer());
  try {
    for (const [index, shape] of JSON_SURVIVABLE.entries()) {
      const task = await taskFor(url, "key", index);
      if (typeof shape === "string") {
        assertEquals(
          task.status,
          "input_required",
          `key ${JSON.stringify(shape)}`,
        );
        const requests = task.inputRequests as Record<string, unknown>;
        // `__proto__`, `constructor`, and `toString` are strings too: they must
        // remain own JSON keys, not change the snapshot object's prototype.
        assertEquals(
          Object.hasOwn(requests, shape),
          true,
          `key ${JSON.stringify(shape)} must survive the task snapshot`,
        );
        const cancelled = await post(url, "tasks/cancel", {
          taskId: task.taskId,
        });
        assertEquals(
          cancelled.status,
          200,
          `key ${JSON.stringify(shape)} cancel`,
        );
        await cancelled.body?.cancel();
      } else {
        assertEquals(task.status, "failed", `key ${JSON.stringify(shape)}`);
        const error = task.error as Record<string, unknown>;
        assertEquals(error.code, -32603, `key ${JSON.stringify(shape)} code`);
        assertStringIncludes(
          error.message as string,
          "Invalid task input request key",
          `key ${JSON.stringify(shape)} error`,
        );
      }
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("shape fuzz - task input requests are validated before they enter snapshots", async () => {
  const { http, url } = await start(buildTaskServer());
  try {
    for (const [index, shape] of JSON_SURVIVABLE.entries()) {
      const task = await taskFor(url, "request", index);
      assertEquals(task.status, "failed", `request ${JSON.stringify(shape)}`);
      const error = task.error as Record<string, unknown>;
      assertEquals(error.code, -32603, `request ${JSON.stringify(shape)} code`);
      assertStringIncludes(
        error.message as string,
        "Invalid task input request",
        `request ${JSON.stringify(shape)} error`,
      );
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("shape fuzz - task snapshots emit the canonical request that was validated", async () => {
  const { http, url } = await start(buildTaskServer());
  try {
    const task = await taskFor(url, "canonical", 0);
    assertEquals(task.status, "input_required");
    const requests = task.inputRequests as Record<string, unknown>;
    assertEquals(requests.canonical, {
      method: "elicitation/create",
      params: { stable: true },
    });
    const cancelled = await post(url, "tasks/cancel", { taskId: task.taskId });
    assertEquals(cancelled.status, 200);
    await cancelled.body?.cancel();
  } finally {
    await http.shutdown();
  }
});

function listen(url: string, notifications: Record<string, unknown>) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": V,
      "Mcp-Method": "subscriptions/listen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: { notifications, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
    }),
  });
}

async function assertInvalidFilter(
  url: string,
  notifications: Record<string, unknown>,
  bodyField: string,
) {
  const response = await listen(url, notifications);
  assertEquals(response.status, 400, `${bodyField} must be rejected`);
  const data = await response.json();
  assertEquals(data.error.code, -32602, `${bodyField} JSON-RPC code`);
  assertEquals(
    data.error.data.problem,
    "malformed_field",
    `${bodyField} problem`,
  );
  assertEquals(data.error.data.bodyField, bodyField, `${bodyField} location`);
  assertEquals(
    typeof data.error.data.recovery === "string" &&
      data.error.data.recovery.length > 10,
    true,
    `${bodyField} recovery`,
  );
}

Deno.test("shape fuzz - subscription filters reject every malformed JSON-survivable field on the wire", async () => {
  const server = new McpApp({
    name: "subscription-shape-fuzz",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  const { http, url } = await start(server);
  try {
    for (
      const field of [
        "toolsListChanged",
        "promptsListChanged",
        "resourcesListChanged",
      ]
    ) {
      for (const shape of JSON_SURVIVABLE) {
        if (typeof shape === "boolean") continue;
        await assertInvalidFilter(
          url,
          { [field]: shape },
          `params.notifications.${field}`,
        );
      }
    }

    for (const field of ["resourceSubscriptions", "taskIds"]) {
      for (const shape of JSON_SURVIVABLE) {
        if (Array.isArray(shape)) continue;
        await assertInvalidFilter(
          url,
          { [field]: shape },
          `params.notifications.${field}`,
        );
      }
      for (const shape of JSON_SURVIVABLE) {
        if (typeof shape === "string") continue;
        await assertInvalidFilter(
          url,
          { [field]: [shape] },
          `params.notifications.${field}[0]`,
        );
      }
    }

    // Counterweight: legitimate booleans and string arrays must remain legal.
    const accepted = await listen(url, {
      toolsListChanged: false,
      resourceSubscriptions: ["ui://valid"],
    });
    assertEquals(accepted.status, 200);
    await accepted.body?.cancel();
  } finally {
    await http.shutdown();
  }
});
