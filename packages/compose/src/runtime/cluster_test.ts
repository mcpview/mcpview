/** HTTP interoperability checks for Compose's SDK-backed legacy transport. */
import {
  assert,
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import {
  ProtocolError,
  ResourceNotFoundError,
  SdkError,
  SdkErrorCode,
} from "@modelcontextprotocol/client";
import { connectHttp } from "./cluster.ts";
import { RuntimeErrorCode } from "./types.ts";
import type { McpHttpProtocol, RuntimeError } from "./types.ts";
import { COMPOSE_VERSION } from "../version.ts";

const RESOURCE_URI = "ui://legacy/panel";
const LEGACY_VERSION = "2025-11-25";

type RpcRequest = {
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
};

/** A sessionful 2025 wire peer, independent of the migrating Platform implementation. */
function legacyPeer() {
  const requests: Array<{ body: RpcRequest; session: string | null; version: string | null }> = [];
  const terminated: string[] = [];
  const sessions = new Set<string>();
  let reads = 0;
  let sessionSequence = 0;
  let outputType = "number";
  let notifyDuringNextList = false;
  const shutdown = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    signal: shutdown.signal,
    onListen() {},
  }, async (request) => {
    const session = request.headers.get("mcp-session-id");
    if (request.method === "GET") return new Response(null, { status: 405 });
    if (request.method === "DELETE") {
      if (session !== null) terminated.push(session);
      return new Response(null, { status: 200 });
    }
    const body = await request.json() as RpcRequest;
    requests.push({ body, session, version: request.headers.get("mcp-protocol-version") });
    const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: body.id, result });
    const error = (code: number, message: string, data?: unknown) =>
      Response.json({ jsonrpc: "2.0", id: body.id, error: { code, message, data } });
    const changedReply = (result: unknown) =>
      new Response(
        `data: ${
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })
        }\n\n` +
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    if (body.method === "server/discover") return error(-32601, "Method not found");
    if (body.method === "initialize") {
      const assigned = `session-${++sessionSequence}`;
      sessions.add(assigned);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: LEGACY_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: "legacy-peer", version: "1.0.0" },
        },
      }, { headers: { "Mcp-Session-Id": assigned } });
    }
    if (session === null || !sessions.has(session)) return error(-32600, "Session required");
    if (body.id === undefined) return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      const next = body.params?.cursor;
      const result = {
        tools: [{
          name: next === undefined ? "render" : "refresh",
          inputSchema: { type: "object" },
          outputSchema: {
            type: "object",
            properties: { count: { type: outputType } },
            required: ["count"],
          },
        }],
        ...(next === undefined ? { nextCursor: "tools-page-2" } : {}),
        _meta: { provenance: "legacy-tools" },
      };
      if (notifyDuringNextList) {
        notifyDuringNextList = false;
        return changedReply(result);
      }
      return reply(result);
    }
    if (body.method === "resources/list") {
      const next = body.params?.cursor;
      return reply({
        resources: [{
          uri: next === undefined ? RESOURCE_URI : "ui://legacy/second",
          name: "Panel",
        }],
        ...(next === undefined ? { nextCursor: "resources-page-2" } : {}),
        _meta: { provenance: "legacy-resources" },
      });
    }
    if (body.method === "resources/read") {
      if (body.params?.uri !== RESOURCE_URI) {
        return error(-32602, "Resource not found", { uri: body.params?.uri });
      }
      return reply({
        contents: [{
          uri: RESOURCE_URI,
          mimeType: "text/html;profile=mcp-app",
          text: `<p>Read ${++reads}</p>`,
          _meta: { ui: { csp: { resourceDomains: ["https://assets.example.com"] } } },
        }],
        ttlMs: 60_000,
        cacheScope: "private",
      });
    }
    if (body.method === "tools/call") {
      if (body.params?.name === "wait") {
        // The client must time out locally; a remote JSON-RPC error is a different class.
        return new Response(new ReadableStream({ start() {} }), {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (body.params?.name === "unknown") return error(-32602, "Unknown tool");
      const args = body.params?.arguments as Record<string, unknown>;
      if (args?.mode === "changed") {
        return changedReply({ content: [], structuredContent: { count: 1 } });
      }
      if (args?.mode === "bad" || args?.mode === "valid") {
        return reply({
          content: [],
          structuredContent: { count: args.mode === "bad" ? "invalid" : 1 },
        });
      }
      return reply({
        content: [{ type: "text", text: "Tool reported an error" }],
        isError: true,
        structuredContent: { fixture: "legacy-result" },
        _meta: { ui: { resourceUri: RESOURCE_URI } },
      });
    }
    return error(-32601, "Method not found");
  });
  const url = `http://127.0.0.1:${server.addr.port}`;
  return {
    requests,
    terminated,
    setOutputType: (type: "number" | "string") => {
      outputType = type;
    },
    invalidateNextList: () => {
      notifyDuringNextList = true;
    },
    connect: (protocol: McpHttpProtocol = "auto") =>
      connectHttp({ name: "legacy-peer", transport: { type: "http", url, protocol }, tools: [] }),
    close: async () => {
      shutdown.abort();
      await server.finished;
    },
  };
}

Deno.test("cluster SDK v2 preserves sessions, page cursors, live resources, and remote errors", async () => {
  const peer = legacyPeer();
  const connection = await peer.connect();
  try {
    assertEquals(peer.requests.slice(0, 3).map(({ body }) => body.method), [
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
    const initialize = peer.requests.find(({ body }) => body.method === "initialize")!;
    assertEquals(initialize.body.params?.clientInfo, {
      name: "@mcpview/compose",
      version: COMPOSE_VERSION,
    });

    const tools = await connection.listTools();
    assertEquals(tools.nextCursor, "tools-page-2");
    assertEquals(tools.tools.map((tool) => tool.name), ["render"]);
    assertEquals(tools._meta, { provenance: "legacy-tools" });
    assertEquals((await connection.listTools(tools.nextCursor)).tools.map((tool) => tool.name), [
      "refresh",
    ]);
    assertEquals(peer.requests.filter(({ body }) => body.method === "tools/list").length, 2);
    const resources = await connection.listResources();
    assertEquals(resources.nextCursor, "resources-page-2");
    assertEquals(resources.resources.map((resource) => resource.uri), [RESOURCE_URI]);
    assertEquals(
      (await connection.listResources(resources.nextCursor)).resources[0].uri,
      "ui://legacy/second",
    );
    assertEquals(peer.requests.filter(({ body }) => body.method === "resources/list").length, 2);

    const first = await connection.readResource(RESOURCE_URI);
    const second = await connection.readResource(RESOURCE_URI);
    assertEquals(first.contents[0].mimeType, "text/html;profile=mcp-app");
    assertEquals(first.contents[0]._meta, {
      ui: { csp: { resourceDomains: ["https://assets.example.com"] } },
    });
    assertEquals("text" in first.contents[0] && first.contents[0].text, "<p>Read 1</p>");
    assertEquals("text" in second.contents[0] && second.contents[0].text, "<p>Read 2</p>");

    assertEquals(await connection.callTool("render"), {
      content: [{ type: "text", text: "Tool reported an error" }],
      isError: true,
      structuredContent: { fixture: "legacy-result" },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    });
    const callFailure = await assertRejects(() => connection.callTool("unknown")) as RuntimeError;
    assertEquals(callFailure.code, RuntimeErrorCode.TOOL_CALL_FAILED);
    assertEquals(callFailure.server, "legacy-peer");
    assertEquals(callFailure.tool, "unknown");
    assertInstanceOf(callFailure.cause, ProtocolError);
    assertEquals(callFailure.cause.code, -32602);
    assertStringIncludes(callFailure.message, "Unknown tool");

    const missing = await assertRejects(() =>
      connection.readResource("ui://legacy/missing")
    ) as RuntimeError;
    assertEquals(missing.code, RuntimeErrorCode.RESOURCE_READ_FAILED);
    assertInstanceOf(missing.cause, ResourceNotFoundError);
    assertEquals(missing.cause.uri, "ui://legacy/missing");
    assert(
      peer.requests.filter(({ body }) =>
        body.method !== "initialize" && body.method !== "server/discover"
      )
        .every(({ session, version }) => session === "session-1" && version === LEGACY_VERSION),
    );
  } finally {
    await connection.close();
    await connection.close();
    try {
      assertEquals(peer.terminated, ["session-1"]);
      // A fresh connection owns a fresh client and cannot inherit the prior session.
      const next = await peer.connect("streamable-http");
      try {
        await next.listTools();
        assertEquals(peer.requests.at(-1)?.session, "session-2");
      } finally {
        await next.close();
      }
    } finally {
      await peer.close();
    }
  }
});

Deno.test("cluster SDK v2 validates output from listed pages and invalidates stale definitions", async () => {
  const peer = legacyPeer();
  const connection = await peer.connect("streamable-http");
  try {
    const firstPage = await connection.listTools();
    const invalid = await assertRejects(() =>
      connection.callTool("render", { mode: "bad" })
    ) as RuntimeError;
    assertEquals(invalid.code, RuntimeErrorCode.TOOL_CALL_FAILED);
    assertInstanceOf(invalid.cause, ProtocolError);
    assertStringIncludes(invalid.message, "Structured content does not match");
    assertEquals(await connection.callTool("render", { mode: "valid" }), {
      content: [],
      structuredContent: { count: 1 },
    });
    // Mutating the returned page must not mutate the definition used for validation.
    firstPage.tools[0].outputSchema = { type: "object" };
    await connection.listTools(firstPage.nextCursor);
    await assertRejects(() => connection.callTool("render", { mode: "bad" }));
    await assertRejects(() => connection.callTool("refresh", { mode: "bad" }));
    // Tool-level failures are exempt from output-schema validation.
    const toolError = await connection.callTool("render") as Record<string, unknown>;
    assertEquals(toolError.isError, true);

    peer.setOutputType("string");
    await connection.listTools();
    // A new first page replaces the prior catalog, including its continuation pages.
    assertEquals(await connection.callTool("refresh", { mode: "bad" }), {
      content: [],
      structuredContent: { count: "invalid" },
    });
    assertEquals(await connection.callTool("render", { mode: "bad" }), {
      content: [],
      structuredContent: { count: "invalid" },
    });
    peer.setOutputType("number");
    await connection.listTools();
    await connection.callTool("render", { mode: "changed" });
    // A list_changed message invalidates definitions without implicitly fetching more pages.
    assertEquals(await connection.callTool("render", { mode: "bad" }), {
      content: [],
      structuredContent: { count: "invalid" },
    });
    await connection.listTools();
    peer.invalidateNextList();
    await connection.listTools();
    // A notification preceding a list reply must not let that stale reply repopulate the cache.
    assertEquals(await connection.callTool("render", { mode: "bad" }), {
      content: [],
      structuredContent: { count: "invalid" },
    });
    await connection.listTools();
    await connection.close();
    const next = await peer.connect("streamable-http");
    try {
      // A new client has no tool definitions from the closed connection.
      assertEquals(await next.callTool("render", { mode: "bad" }), {
        content: [],
        structuredContent: { count: "invalid" },
      });
    } finally {
      await next.close();
    }
  } finally {
    await connection.close();
    await peer.close();
  }
});

Deno.test("cluster SDK v2 maps a real local request timeout to Compose's stable error code", async () => {
  const peer = legacyPeer();
  const connection = await peer.connect("streamable-http");
  try {
    const failure = await assertRejects(() => connection.callTool("wait")) as RuntimeError;
    assertEquals(failure.code, RuntimeErrorCode.TOOL_CALL_TIMEOUT);
    assertEquals(failure.server, "legacy-peer");
    assertEquals(failure.tool, "wait");
    assertInstanceOf(failure.cause, SdkError);
    assertEquals(failure.cause.code, SdkErrorCode.RequestTimeout);
    assertStringIncludes(failure.message, "timed out after 30000ms");
  } finally {
    await connection.close();
    await peer.close();
  }
});
