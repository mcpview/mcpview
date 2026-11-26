import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { connectSnippetProviders } from "./connections.ts";
import { createSnippetExecuteTool } from "./tool.ts";

Deno.test("connects explicitly supplied clients, preserves native results, and leaves ownership with the host", async () => {
  const calls: string[] = [];
  const result = { content: [], _meta: { "example.test/view": { zoom: 2 } } };
  const controller = new AbortController();
  const client = {
    callTool: (request: { name: string }, options?: { signal?: AbortSignal }) => {
      assertEquals(options?.signal, controller.signal);
      calls.push(request.name);
      return Promise.resolve(result);
    },
    close() {
      throw new Error("The borrowed client must remain open");
    },
  };
  const selection = ["plaque du lundi"];
  const bound = await connectSnippetProviders([{ alias: "cad", snippets: selection, client }]);
  try {
    selection.push("other");
    const provider = bound.providers.get("cad")!;
    assertEquals(provider.names, ["plaque du lundi"]);
    assertEquals(
      await provider.call(
        "run_snippet",
        { name: "plaque du lundi", input: {} },
        controller.signal,
        {},
      ),
      result,
    );
    await assertRejects(() =>
      provider.call("run_snippet", { name: "other", input: {} }, controller.signal, {})
    );
    assertEquals(calls, ["run_snippet"]);
  } finally {
    await bound.close();
  }
  await bound.close();
  await assertRejects(() =>
    bound.providers.get("cad")!.call("list_snippets", {}, controller.signal, {})
  );
});

Deno.test("rejects ambiguous bindings before using their connections", async () => {
  const client = { callTool: () => Promise.resolve({ content: [] }) };
  const binding = { alias: "cad", snippets: ["plate"], client };
  await assertRejects(() => connectSnippetProviders([binding, binding]), Error, "alias");
  await assertRejects(
    () => connectSnippetProviders([{ ...binding, snippets: ["plate", "plate"] }]),
    Error,
    "snippet",
  );
  await assertRejects(
    () =>
      connectSnippetProviders([{
        alias: "cad",
        snippets: ["plate"],
        url: new URL("file:///demo"),
      }]),
    Error,
    "HTTP",
  );
});

Deno.test("execute declares the board, enabled providers, and scoped saved-chain operations only when configured", () => {
  const options = {
    resourceUri: "ui://demo/board",
    providers: new Map([["cad", { names: ["plate"] }]]),
  };
  const tool = createSnippetExecuteTool(options);
  assertEquals(tool.name, "execute");
  assertEquals(tool.description.includes('"cad"'), true);
  assertEquals(tool.description.includes('"plate"'), false);
  assertEquals(tool._meta?.ui?.resourceUri, options.resourceUri);
  assertEquals(Object.keys(tool.inputSchema.properties as object).sort(), ["code", "params"]);
  const saved = createSnippetExecuteTool({
    ...options,
    savedChains: true,
    annotations: { readOnlyHint: true },
  });
  assertEquals(Object.keys(saved.inputSchema.properties as object).sort(), [
    "code",
    "listSaved",
    "params",
    "replay",
    "saveAs",
  ]);
  assertEquals(saved.annotations?.readOnlyHint, false);
  assertThrows(
    () => createSnippetExecuteTool({ ...options, resourceUri: "https://example.org/board" }),
    Error,
    "ui://",
  );
});

Deno.test("resolves the client's upstream authority per call, from the trusted context", async () => {
  const pool = await connectSnippetProviders([{
    alias: "erp",
    snippets: ["invoice"],
    client: ({ scope }) => ({
      callTool: () => Promise.resolve({ content: [], structuredContent: { scope } }),
    }),
  }]);
  try {
    const provider = pool.providers.get("erp")!;
    const signal = new AbortController().signal;
    for (const scope of ["one", "two"]) {
      const response = await provider.call(
        "run_snippet",
        { name: "invoice", input: { scope: "guest" } },
        signal,
        { scope },
      );
      assertEquals(response.structuredContent, { scope });
    }
  } finally {
    await pool.close();
  }
});

Deno.test("owns HTTP sessions through partial failure and idempotent shutdown", async () => {
  const deletions: string[] = [];
  let next = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
    if (new URL(req.url).pathname === "/down") return new Response(null, { status: 503 });
    assertEquals(req.headers.get("authorization"), "Bearer demo");
    if (req.method === "DELETE") {
      deletions.push(req.headers.get("mcp-session-id")!);
      return new Response(null, { status: 204 });
    }
    if (req.method === "GET") return new Response(null, { status: 405 });
    const { method, id } = await req.json();
    if (method === "server/discover") {
      return Response.json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unavailable" } });
    }
    if (method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "legacy", version: "1" },
        },
      }, { headers: { "mcp-session-id": `s-${++next}` } });
    }
    if (id === undefined) return new Response(null, { status: 202 });
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: { content: [], structuredContent: { value: "receipt" } },
    });
  });
  const base = `http://127.0.0.1:${server.addr.port}`;
  const first = {
    alias: "a",
    snippets: ["example"],
    url: base + "/up",
    requestInit: { headers: { authorization: "Bearer demo" } },
  };
  try {
    await assertRejects(() =>
      connectSnippetProviders([first, { alias: "b", snippets: ["example"], url: base + "/down" }])
    );
    assertEquals(deletions, ["s-1"]);
    const pool = await connectSnippetProviders([first]);
    try {
      const result = await pool.providers.get("a")!.call(
        "run_snippet",
        { name: "example", input: {} },
        new AbortController().signal,
        {},
      );
      assertEquals(result.structuredContent, { value: "receipt" });
    } finally {
      await Promise.all([pool.close(), pool.close()]);
    }
    assertEquals(deletions, ["s-1", "s-2"]);
  } finally {
    await server.shutdown();
  }
});
