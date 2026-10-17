/**
 * Unit tests for _meta field in tools registration
 *
 * Tests MCP Apps (SEP-1865) tool metadata support including:
 * - Tools with _meta.ui are stored correctly
 * - emits/accepts fields preserved
 * - Tools without _meta work normally
 *
 * @module lib/server/src/tools-meta_test
 */

import { assertEquals } from "@std/assert";
import { McpApp } from "./mcp-app.ts";
import type { MCPTool } from "./types.ts";

/**
 * Helper to create test server instance
 */
const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";

function createTestServer(): McpApp {
  return new McpApp({
    name: "test-server",
    version: "1.0.0",
    // Suppress logging during tests
    logger: () => {},
    transport: "stateless",
  });
}

Deno.test("registerTool - stores _meta when present", () => {
  const server = createTestServer();
  const tool: MCPTool = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: { type: "object" },
    _meta: {
      ui: {
        resourceUri: "ui://test/tool-ui",
        emits: ["filter", "select"],
        accepts: ["setData"],
      },
    },
  };

  server.registerTool(tool, () => "result");

  assertEquals(server.getToolCount(), 1);
  assertEquals(server.getToolNames(), ["test_tool"]);
});

Deno.test("registerTool - works without _meta", () => {
  const server = createTestServer();
  const tool: MCPTool = {
    name: "basic_tool",
    description: "A basic tool without meta",
    inputSchema: { type: "object" },
  };

  server.registerTool(tool, () => "result");

  assertEquals(server.getToolCount(), 1);
});

Deno.test("registerTools - preserves _meta for multiple tools", () => {
  const server = createTestServer();
  const tools: MCPTool[] = [
    {
      name: "tool_with_ui",
      description: "Tool with UI",
      inputSchema: { type: "object" },
      _meta: {
        ui: {
          resourceUri: "ui://test/viewer",
          visibility: ["model"],
        },
      },
    },
    {
      name: "tool_without_ui",
      description: "Tool without UI",
      inputSchema: { type: "object" },
    },
    {
      name: "tool_with_events",
      description: "Tool with events",
      inputSchema: { type: "object" },
      _meta: {
        ui: {
          resourceUri: "ui://test/events",
          emits: ["click", "hover"],
          accepts: ["highlight", "scrollTo"],
        },
      },
    },
  ];

  const handlers = new Map([
    ["tool_with_ui", () => "result"],
    ["tool_without_ui", () => "result"],
    ["tool_with_events", () => "result"],
  ]);

  server.registerTools(tools, handlers);

  assertEquals(server.getToolCount(), 3);
  assertEquals(server.getToolNames().sort(), [
    "tool_with_events",
    "tool_with_ui",
    "tool_without_ui",
  ]);
});

Deno.test("registerTool - _meta.ui with visibility array", () => {
  const server = createTestServer();
  const tool: MCPTool = {
    name: "hidden_tool",
    description: "Hidden from model",
    inputSchema: { type: "object" },
    _meta: {
      ui: {
        resourceUri: "ui://test/hidden",
        visibility: ["app"], // Only visible to app, not model
      },
    },
  };

  server.registerTool(tool, () => "result");

  assertEquals(server.getToolCount(), 1);
});

// ============================================
// SDK 1.27 Features: visibility filtering, outputSchema, annotations
// ============================================

/** Helper to start HTTP server on a free port */
async function startTestHttp(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, port };
}

/** Helper to call tools/list via HTTP (stateless 2026-07-28 format) */
async function fetchToolsList(port: number) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} } },
    }),
  });
  return await res.json();
}

Deno.test("tools/list - excludes app-only tools from listing", async () => {
  const server = createTestServer();

  server.registerTool(
    {
      name: "app_only",
      description: "App only",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "ui://test/app", visibility: ["app"] } },
    },
    () => "result",
  );
  server.registerTool(
    {
      name: "model_visible",
      description: "Model visible",
      inputSchema: { type: "object" },
      _meta: { ui: { resourceUri: "ui://test/model", visibility: ["model"] } },
    },
    () => "result",
  );
  server.registerTool(
    {
      name: "no_meta",
      description: "No meta",
      inputSchema: { type: "object" },
    },
    () => "result",
  );

  // All 3 stored internally
  assertEquals(server.getToolCount(), 3);

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    const names = data.result.tools.map((t: { name: string }) => t.name).sort();
    assertEquals(names, ["model_visible", "no_meta"]);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/list - includes tools with visibility ['model', 'app']", async () => {
  const server = createTestServer();
  server.registerTool(
    {
      name: "both",
      description: "Both",
      inputSchema: { type: "object" },
      _meta: {
        ui: { resourceUri: "ui://test/both", visibility: ["model", "app"] },
      },
    },
    () => "result",
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    assertEquals(data.result.tools.length, 1);
    assertEquals(data.result.tools[0].name, "both");
  } finally {
    await http.shutdown();
  }
});

Deno.test("registerAppOnlyTool - stores tool but excludes from listing", async () => {
  const server = createTestServer();
  server.registerAppOnlyTool(
    {
      name: "refresh",
      description: "Refresh viewer",
      inputSchema: { type: "object" },
    },
    () => "refreshed",
  );

  assertEquals(server.getToolCount(), 1);

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    assertEquals(data.result.tools.length, 0);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/list - outputSchema passed through", async () => {
  const server = createTestServer();
  const outputSchema = {
    type: "object",
    properties: { sum: { type: "number" } },
  };
  server.registerTool(
    {
      name: "add",
      description: "Add numbers",
      inputSchema: { type: "object" },
      outputSchema,
    },
    () => ({ sum: 5 }),
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    assertEquals(data.result.tools[0].outputSchema, outputSchema);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/list - annotations passed through", async () => {
  const server = createTestServer();
  const annotations = { readOnlyHint: true, title: "Get Data" };
  server.registerTool(
    {
      name: "get_data",
      description: "Get data",
      inputSchema: { type: "object" },
      annotations,
    },
    () => ({}),
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    assertEquals(data.result.tools[0].annotations, annotations);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/list - outputSchema and annotations omitted when not set", async () => {
  const server = createTestServer();
  server.registerTool(
    {
      name: "basic",
      description: "Basic tool",
      inputSchema: { type: "object" },
    },
    () => "result",
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await fetchToolsList(port);
    assertEquals(data.result.tools[0].outputSchema, undefined);
    assertEquals(data.result.tools[0].annotations, undefined);
  } finally {
    await http.shutdown();
  }
});
