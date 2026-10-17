/**
 * Track G — subscriptions/listen over the wire.
 *
 * The registry is unit-tested against an in-memory sink; this exercises the real
 * SSE response: the ordering guarantee on the acknowledgement, the opt-in
 * filtering, and the headers that decide whether events actually reach a client
 * through a proxy.
 *
 * @module lib/server/subscriptions/subscriptions-integration_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { McpApp } from "../mcp-app.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";
const SUB_ID_KEY = "io.modelcontextprotocol/subscriptionId";
const V = "2026-07-28";

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

function buildServer() {
  return new McpApp({
    name: "subs-integration",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
}

function listen(
  url: string,
  notifications: Record<string, unknown>,
  id: number | string = 1,
) {
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
      id,
      method: "subscriptions/listen",
      params: { notifications, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
    }),
  });
}

/** Read one SSE `data:` frame, then abandon the stream. */
async function readFirstFrame(res: Response): Promise<Record<string, unknown>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended before a frame arrived");
      buffer += decoder.decode(value, { stream: true });
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) continue;
      const frame = buffer.slice(0, boundary);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue; // keep-alive comment — keep reading
      return JSON.parse(line.slice("data: ".length));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

Deno.test("subscriptions - the response is an SSE stream with proxy-safe headers", async () => {
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, { toolsListChanged: true });
    assertEquals(res.status, 200);
    assertStringIncludes(
      res.headers.get("content-type") ?? "",
      "text/event-stream",
    );
    // Without this, nginx buffers events until its buffer fills — the stream
    // "works" in tests and stalls in production.
    assertEquals(res.headers.get("x-accel-buffering"), "no");
    await res.body?.cancel();
  } finally {
    await http.shutdown();
  }
});

Deno.test("subscriptions - the acknowledgement is the first message and carries subscriptionId", async () => {
  // Ordering is normative: the server MUST NOT send any notification on the
  // subscription before the acknowledgement.
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, { toolsListChanged: true }, 7);
    const first = await readFirstFrame(res);

    assertEquals(first.method, "notifications/subscriptions/acknowledged");
    const params = first.params as Record<string, unknown>;
    const meta = params._meta as Record<string, unknown>;
    // The id is the JSON-RPC id of the listen request itself.
    assertEquals(meta[SUB_ID_KEY], 7);
  } finally {
    await http.shutdown();
  }
});

Deno.test("subscriptions - the acknowledgement echoes only the agreed subset", async () => {
  // The client is told what it actually got. Requesting nothing must not come
  // back as if everything had been granted.
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, { toolsListChanged: true });
    const params = (await readFirstFrame(res)).params as Record<
      string,
      unknown
    >;
    const agreed = params.notifications as Record<string, unknown>;

    assertEquals(agreed.toolsListChanged, true);
    // Not requested → absent, not `false`.
    assertEquals(agreed.promptsListChanged, undefined);
    assertEquals(agreed.resourcesListChanged, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("subscriptions - resourceSubscriptions survive into the agreed filter", async () => {
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, {
      resourceSubscriptions: ["ui://a", "ui://b"],
    });
    const params = (await readFirstFrame(res)).params as Record<
      string,
      unknown
    >;
    const agreed = params.notifications as Record<string, unknown>;
    assertEquals(agreed.resourceSubscriptions, ["ui://a", "ui://b"]);
  } finally {
    await http.shutdown();
  }
});

Deno.test("subscriptions - an empty filter yields an acknowledgement with nothing granted", async () => {
  // A client may open a stream and subscribe to nothing. That is legal and must
  // still be acknowledged rather than erroring.
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, {});
    const first = await readFirstFrame(res);
    assertEquals(first.method, "notifications/subscriptions/acknowledged");
  } finally {
    await http.shutdown();
  }
});

Deno.test("subscriptions - closing the client stream does not break the server", async () => {
  // The client closing the stream IS the cancellation signal. The cancel()
  // callback races the registry's own writes, so this must not throw.
  const { http, url } = await start(buildServer());
  try {
    const res = await listen(url, { toolsListChanged: true });
    await readFirstFrame(res); // also cancels the reader

    // The server must still answer normal traffic afterwards.
    const after = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
      }),
    });
    assertEquals(after.status, 200);
    await after.json();
  } finally {
    await http.shutdown();
  }
});
