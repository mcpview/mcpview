/**
 * Acceptance tests for SEP-2575 stateless HTTP interop.
 *
 * The official MCP SDK client does not yet send the stateless wire format, so
 * these tests use raw fetch requests that include MCP-Protocol-Version plus the
 * required namespaced params._meta keys on every request.
 */

import { assertEquals, assertExists } from "@std/assert";
import { McpApp } from "./mcp-app.ts";

const PROTOCOL_VERSION = "2026-07-28";
const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

type StartedHttp = { shutdown(): Promise<void> };

async function startOnFreePort(
  server: McpApp,
): Promise<{ http: StartedHttp; url: string }> {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

function createStatelessEchoServer(): McpApp {
  const server = new McpApp({
    name: "stateless-round-robin",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    {
      name: "echo",
      description: "Echo arguments",
      inputSchema: { type: "object" },
    },
    (args) => args,
  );

  return server;
}

async function conformantPost(
  url: string,
  id: number,
  method: string,
  extraParams: Record<string, unknown> = {},
) {
  // `Mcp-Method` is required on every 2026-07-28 POST, and `Mcp-Name` on the
  // three methods that define it. Without them a conformant server answers
  // -32020 — so a helper called `conformantPost` has to send them.
  const mirroredName = method === "resources/read"
    ? extraParams.uri
    : method === "tools/call" || method === "prompts/get"
    ? extraParams.name
    : undefined;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(typeof mirroredName === "string" ? { "Mcp-Name": mirroredName } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...extraParams,
        _meta: {
          [PROTO_KEY]: PROTOCOL_VERSION,
          [CLIENT_INFO_KEY]: {
            name: "stateless-round-robin-client",
            version: "1.0.0",
          },
          [CLIENT_CAPABILITIES_KEY]: {},
        },
      },
    }),
  });

  return { response, data: await response.json() };
}

function assertStatelessSuccess(response: Response) {
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("mcp-session-id"), null);
  assertEquals(response.headers.get("mcp-protocol-version"), PROTOCOL_VERSION);
}

Deno.test("stateless acceptance - round-robin across two instances without sticky session", async () => {
  const serverA = createStatelessEchoServer();
  const serverB = createStatelessEchoServer();
  const started: StartedHttp[] = [];

  try {
    const instanceA = await startOnFreePort(serverA);
    started.push(instanceA.http);
    const instanceB = await startOnFreePort(serverB);
    started.push(instanceB.http);

    const discover = await conformantPost(
      instanceA.url,
      1,
      "server/discover",
    );
    assertStatelessSuccess(discover.response);
    assertExists(discover.data.result);
    assertEquals(
      discover.data.result.supportedVersions.includes(PROTOCOL_VERSION),
      true,
    );

    const tools = await conformantPost(instanceB.url, 2, "tools/list");
    assertStatelessSuccess(tools.response);
    assertExists(tools.data.result);
    assertEquals(
      tools.data.result.tools.some((tool: { name?: string }) =>
        tool.name === "echo"
      ),
      true,
    );

    const callA = await conformantPost(instanceA.url, 3, "tools/call", {
      name: "echo",
      arguments: { servedBy: "A", sequence: 3 },
    });
    assertStatelessSuccess(callA.response);
    assertExists(callA.data.result);
    assertEquals(JSON.parse(callA.data.result.content[0].text), {
      servedBy: "A",
      sequence: 3,
    });

    const callB = await conformantPost(instanceB.url, 4, "tools/call", {
      name: "echo",
      arguments: { servedBy: "B", sequence: 4 },
    });
    assertStatelessSuccess(callB.response);
    assertExists(callB.data.result);
    assertEquals(JSON.parse(callB.data.result.content[0].text), {
      servedBy: "B",
      sequence: 4,
    });
  } finally {
    await Promise.all(started.map((http) => http.shutdown()));
  }
});

Deno.test("stateless acceptance - header/_meta version mismatch is rejected (400, -32020)", async () => {
  // Negative case: both versions are individually supported, but they differ.
  // This isolates the header/_meta consistency check (not version support) and
  // keeps this file sensitive to a regression that drops the comparison.
  const server = createStatelessEchoServer();
  const { http, url } = await startOnFreePort(server);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: {
          _meta: {
            [PROTO_KEY]: PROTOCOL_VERSION,
            [CLIENT_INFO_KEY]: { name: "mismatch-client", version: "1.0.0" },
            [CLIENT_CAPABILITIES_KEY]: {},
          },
        },
      }),
    });
    const data = await response.json();

    assertEquals(response.status, 400);
    // HeaderMismatch (spec 2026-07-28), renumbered from the RC's -32001.
    assertEquals(data.error.code, -32020);
  } finally {
    await http.shutdown();
  }
});
