/**
 * Tests for SDK 1.27 tool result features:
 * - structuredContent (Feature 1)
 * - isError mapping via toolErrorMapper (Feature 5)
 *
 * @module lib/server/src/tool-results_test
 */

import { assertEquals } from "@std/assert";
import { McpApp } from "./mcp-app.ts";

/** Helper to start HTTP server on a free port */
async function startTestHttp(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, port };
}

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";

/** Helper to call tools/call via HTTP (stateless 2026-07-28 format) */
async function callTool(
  port: number,
  toolName: string,
  args: Record<string, unknown> = {},
) {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": toolName,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
        name: toolName,
        arguments: args,
      },
    }),
  });
  return await res.json();
}

// ============================================
// Feature 1: structuredContent
// ============================================

Deno.test("tools/call - StructuredToolResult produces content + structuredContent", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    { name: "add", description: "Add", inputSchema: { type: "object" } },
    () => ({
      content: "The sum is 5",
      structuredContent: { sum: 5, operands: [2, 3] },
    }),
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "add", { a: 2, b: 3 });
    assertEquals(data.result.content[0].type, "text");
    assertEquals(data.result.content[0].text, "The sum is 5");
    assertEquals(data.result.structuredContent, { sum: 5, operands: [2, 3] });
    assertEquals(data.result.isError, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - plain string return still works (backward compat)", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    { name: "greet", description: "Greet", inputSchema: { type: "object" } },
    () => "hello world",
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "greet");
    assertEquals(data.result.content[0].text, "hello world");
    assertEquals(data.result.structuredContent, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - plain object return still works (backward compat)", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    { name: "data", description: "Data", inputSchema: { type: "object" } },
    () => ({ x: 1, y: 2 }),
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "data");
    const parsed = JSON.parse(data.result.content[0].text);
    assertEquals(parsed, { x: 1, y: 2 });
    assertEquals(data.result.structuredContent, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - preformatted result passes through (backward compat)", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    { name: "proxy", description: "Proxy", inputSchema: { type: "object" } },
    () => ({ content: [{ type: "text", text: "raw proxy result" }] }),
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "proxy");
    assertEquals(data.result.content[0].text, "raw proxy result");
    assertEquals(data.result.structuredContent, undefined);
  } finally {
    await http.shutdown();
  }
});

// ============================================
// Feature 5: toolErrorMapper → isError
// ============================================

Deno.test("tools/call - no toolErrorMapper: thrown error becomes JSON-RPC error", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    { name: "fail", description: "Fail", inputSchema: { type: "object" } },
    () => {
      throw new Error("boom");
    },
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "fail");
    assertEquals(data.result, undefined);
    assertEquals(typeof data.error, "object");
    assertEquals(data.error.code, -32603);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - toolErrorMapper returns string: produces isError result", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    toolErrorMapper: (err) =>
      err instanceof Error ? `Business error: ${err.message}` : null,
  });

  server.registerTool(
    {
      name: "biz_fail",
      description: "BizFail",
      inputSchema: { type: "object" },
    },
    () => {
      throw new Error("not allowed");
    },
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "biz_fail");
    assertEquals(data.result.isError, true);
    assertEquals(data.result.content[0].text, "Business error: not allowed");
    assertEquals(data.error, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - toolErrorMapper returns null: error rethrown as JSON-RPC error", async () => {
  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    toolErrorMapper: () => null,
  });

  server.registerTool(
    {
      name: "sys_fail",
      description: "SysFail",
      inputSchema: { type: "object" },
    },
    () => {
      throw new Error("system failure");
    },
  );

  const { http, port } = await startTestHttp(server);
  try {
    const data = await callTool(port, "sys_fail");
    assertEquals(data.result, undefined);
    assertEquals(typeof data.error, "object");
  } finally {
    await http.shutdown();
  }
});

Deno.test("tools/call - toolErrorMapper receives toolName and error", async () => {
  let capturedToolName: string | undefined;
  let capturedError: unknown;

  const server = new McpApp({
    name: "test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    toolErrorMapper: (err, toolName) => {
      capturedToolName = toolName;
      capturedError = err;
      return "mapped";
    },
  });

  server.registerTool(
    { name: "my_tool", description: "MyTool", inputSchema: { type: "object" } },
    () => {
      throw new Error("specific error");
    },
  );

  const { http, port } = await startTestHttp(server);
  try {
    await callTool(port, "my_tool");
    assertEquals(capturedToolName, "my_tool");
    assertEquals(capturedError instanceof Error, true);
    assertEquals((capturedError as Error).message, "specific error");
  } finally {
    await http.shutdown();
  }
});
