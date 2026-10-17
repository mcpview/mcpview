/**
 * E2E test: all 5 SDK 1.27 features working together
 * on a single server instance.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpApp } from "./mcp-app.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";

Deno.test("e2e - all SDK 1.27 features on one server", async () => {
  // Server with toolErrorMapper (Feature 5)
  const server = new McpApp({
    name: "e2e-sdk-features",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    toolErrorMapper: (err, toolName) => {
      if (err instanceof Error && err.message.startsWith("BIZ:")) {
        return `[${toolName}] ${err.message.slice(4)}`;
      }
      return null; // system errors → rethrow
    },
  });

  // Feature 2 (outputSchema) + Feature 4 (annotations) + Feature 1 (structuredContent)
  server.registerTool(
    {
      name: "search_invoices",
      description: "Search invoices by criteria",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
      outputSchema: {
        type: "object",
        properties: {
          total: { type: "number" },
          invoices: { type: "array" },
        },
      },
      annotations: {
        readOnlyHint: true,
        title: "Search Invoices",
      },
    },
    (args) => ({
      // StructuredToolResult: content for LLM, structuredContent for viewer
      content: `Found 2 invoices matching "${args.query}"`,
      structuredContent: {
        total: 2,
        invoices: [
          { id: "INV-001", amount: 100 },
          { id: "INV-002", amount: 200 },
        ],
      },
    }),
  );

  // Feature 3 (visibility: app-only tool)
  server.registerAppOnlyTool(
    {
      name: "refresh_table",
      description: "Refresh the invoice table viewer",
      inputSchema: { type: "object" },
    },
    () => ({ refreshed: true }),
  );

  // Feature 5 (business error)
  server.registerTool(
    {
      name: "delete_invoice",
      description: "Delete an invoice",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
      },
      annotations: {
        destructiveHint: true,
        title: "Delete Invoice",
      },
    },
    (args) => {
      if (args.id === "INV-LOCKED") {
        throw new Error("BIZ:Invoice is locked and cannot be deleted");
      }
      return { deleted: true, id: args.id };
    },
  );

  // Feature 5 (system error — mapper returns null → JSON-RPC error)
  server.registerTool(
    {
      name: "crash_tool",
      description: "Tool that throws a system error",
      inputSchema: { type: "object" },
    },
    () => {
      throw new Error("SYSTEM: database connection lost");
    },
  );

  // Plain tool (backward compat)
  server.registerTool(
    {
      name: "ping",
      description: "Health check",
      inputSchema: { type: "object" },
    },
    () => "pong",
  );

  // Start HTTP server
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });

  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const toolName = typeof params.name === "string" ? params.name : undefined;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
    };
    if (toolName !== undefined) {
      headers["Mcp-Name"] = toolName;
    }
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
        ...params,
      },
    };
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return await res.json();
  }

  try {
    // ── tools/list: visibility filtering + outputSchema + annotations ──
    const list = await rpc("tools/list");
    const toolNames = list.result.tools
      .map((t: { name: string }) => t.name)
      .sort();

    // refresh_table (app-only) should be ABSENT
    assertEquals(toolNames, [
      "crash_tool",
      "delete_invoice",
      "ping",
      "search_invoices",
    ]);

    // outputSchema passthrough (Feature 2)
    const searchTool = list.result.tools.find(
      (t: { name: string }) => t.name === "search_invoices",
    );
    assertExists(searchTool.outputSchema);
    assertEquals(searchTool.outputSchema.properties.total.type, "number");

    // annotations passthrough (Feature 4)
    assertEquals(searchTool.annotations.readOnlyHint, true);
    assertEquals(searchTool.annotations.title, "Search Invoices");

    const deleteTool = list.result.tools.find(
      (t: { name: string }) => t.name === "delete_invoice",
    );
    assertEquals(deleteTool.annotations.destructiveHint, true);

    // ── tools/call: structuredContent (Feature 1) ──
    const searchResult = await rpc("tools/call", {
      name: "search_invoices",
      arguments: { query: "acme" },
    });
    assertEquals(
      searchResult.result.content[0].text,
      'Found 2 invoices matching "acme"',
    );
    assertEquals(searchResult.result.structuredContent.total, 2);
    assertEquals(searchResult.result.structuredContent.invoices.length, 2);
    assertEquals(searchResult.result.isError, undefined);

    // ── tools/call: app-only tool is still callable (Feature 3) ──
    const refreshResult = await rpc("tools/call", {
      name: "refresh_table",
      arguments: {},
    });
    const refreshData = JSON.parse(refreshResult.result.content[0].text);
    assertEquals(refreshData.refreshed, true);

    // ── tools/call: business error → isError (Feature 5) ──
    const bizError = await rpc("tools/call", {
      name: "delete_invoice",
      arguments: { id: "INV-LOCKED" },
    });
    assertEquals(bizError.result.isError, true);
    assertEquals(
      bizError.result.content[0].text,
      "[delete_invoice] Invoice is locked and cannot be deleted",
    );
    assertEquals(bizError.error, undefined);

    // ── tools/call: system error → JSON-RPC error (Feature 5) ──
    const sysError = await rpc("tools/call", { name: "crash_tool" });
    assertEquals(sysError.result, undefined);
    assertExists(sysError.error);
    assertEquals(sysError.error.code, -32603);

    // ── tools/call: successful delete (no error) ──
    const deleteOk = await rpc("tools/call", {
      name: "delete_invoice",
      arguments: { id: "INV-999" },
    });
    const deleteData = JSON.parse(deleteOk.result.content[0].text);
    assertEquals(deleteData.deleted, true);
    assertEquals(deleteData.id, "INV-999");
    assertEquals(deleteOk.result.isError, undefined);

    // ── tools/call: plain backward compat ──
    const pong = await rpc("tools/call", { name: "ping" });
    assertEquals(pong.result.content[0].text, "pong");
    assertEquals(pong.result.structuredContent, undefined);
    assertEquals(pong.result.isError, undefined);
  } finally {
    await http.shutdown();
  }
});
