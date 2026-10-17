/**
 * `server/discover` through the v2 stdio era negotiator.
 *
 * A direct `Server.connect()` is intentionally a 2025-era path. These tests
 * therefore put an in-memory transport behind `serveStdio()` and send the same
 * reserved request envelope a real 2026 client writes on stdio.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  InMemoryTransport,
  type JSONRPCMessage,
  type Server,
} from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { McpApp } from "./mcp-app.ts";

const PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

function modernParams(
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...params,
    _meta: {
      [PROTOCOL_VERSION_KEY]: PROTOCOL_VERSION,
      [CLIENT_INFO_KEY]: { name: "probe", version: "1.0.0" },
      [CLIENT_CAPABILITIES_KEY]: {},
    },
  };
}

/** Speak raw JSON-RPC: this is a serving-entry test, not a client-SDK test. */
class Peer {
  #transport: InMemoryTransport;
  #pending = new Map<number, (msg: Record<string, unknown>) => void>();

  constructor(transport: InMemoryTransport) {
    this.#transport = transport;
    this.#transport.onmessage = (message: JSONRPCMessage) => {
      const msg = message as unknown as Record<string, unknown>;
      const id = msg.id;
      if (typeof id === "number") this.#pending.get(id)?.(msg);
    };
  }

  request(id: number, method: string, params: Record<string, unknown> = {}) {
    const settled = new Promise<Record<string, unknown>>((resolve) => {
      this.#pending.set(id, resolve);
    });
    void this.#transport.send({ jsonrpc: "2.0", id, method, params });
    return settled;
  }
}

async function connectedPeer(app: McpApp): Promise<{
  peer: Peer;
  close: () => Promise<void>;
}> {
  const [clientTransport, serverTransport] = InMemoryTransport
    .createLinkedPair();
  const createProtocolServer = (
    app as unknown as { createProtocolServer(): Server }
  ).createProtocolServer.bind(app);
  const handle: StdioServerHandle = serveStdio(
    () => createProtocolServer(),
    { transport: serverTransport },
  );

  const peer = new Peer(clientTransport);
  await clientTransport.start();

  return {
    peer,
    close: async () => {
      await handle.close();
      await clientTransport.close();
    },
  };
}

function buildApp(instructions?: string): McpApp {
  const app = new McpApp({
    name: "discover-probe",
    version: "1.2.3",
    logger: () => {},
    ...(instructions ? { instructions } : {}),
  });
  app.registerTool(
    { name: "noop", description: "noop", inputSchema: { type: "object" } },
    () => "ok",
  );
  return app;
}

Deno.test("stdio - server/discover answers with the final 2026 envelope", async () => {
  const { peer, close } = await connectedPeer(buildApp());
  try {
    const response = await peer.request(
      1,
      "server/discover",
      modernParams(),
    );
    const result = response.result as Record<string, unknown>;

    assertExists(result);
    assertEquals(result.supportedVersions, [PROTOCOL_VERSION]);
    assertEquals(result.serverInfo, undefined);
    assertEquals(result.resultType, "complete");
    assertEquals(result.cacheScope, "private");
    assertEquals(result.ttlMs, 0);
    assertEquals(
      (result.capabilities as Record<string, unknown>).tools,
      {},
    );
    assertEquals(
      (result._meta as Record<string, unknown>)[SERVER_INFO_KEY],
      { name: "discover-probe", version: "1.2.3" },
    );
  } finally {
    await close();
  }
});

Deno.test("stdio - server/discover carries configured instructions", async () => {
  const { peer, close } = await connectedPeer(buildApp("Use noop sparingly."));
  try {
    const response = await peer.request(
      1,
      "server/discover",
      modernParams(),
    );
    assertEquals(
      (response.result as Record<string, unknown>).instructions,
      "Use noop sparingly.",
    );
  } finally {
    await close();
  }
});

Deno.test("stdio - an unknown modern method is still MethodNotFound", async () => {
  const { peer, close } = await connectedPeer(buildApp());
  try {
    const response = await peer.request(
      1,
      "server/undiscover",
      modernParams(),
    );
    const error = response.error as Record<string, unknown>;

    assertExists(error);
    assertEquals(error.code, -32601);
    assertEquals(error.message, "Method not found");
  } finally {
    await close();
  }
});

Deno.test("stdio - HTTP-only Tasks is not advertised", async () => {
  const app = new McpApp({
    name: "tasks-http-only",
    version: "1.0.0",
    logger: () => {},
    extensions: { "io.modelcontextprotocol/tasks": {} },
  });
  const { peer, close } = await connectedPeer(app);
  try {
    const response = await peer.request(
      1,
      "server/discover",
      modernParams(),
    );
    const capabilities = (response.result as Record<string, unknown>)
      .capabilities as Record<string, unknown>;
    assertEquals(capabilities.extensions, undefined);
  } finally {
    await close();
    await app.stop();
  }
});

Deno.test("stdio and HTTP advertise the same modern server semantics", async () => {
  const httpApp = buildApp("shared");
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await httpApp.startHttp({ port, onListen: () => {} });

  const { peer, close } = await connectedPeer(buildApp("shared"));
  try {
    const overHttp = await (await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "server/discover",
        params: modernParams(),
      }),
    })).json() as { result: Record<string, unknown> };
    const overStdio = await peer.request(
      1,
      "server/discover",
      modernParams(),
    );
    const stdioResult = overStdio.result as Record<string, unknown>;

    for (
      const field of [
        "supportedVersions",
        "instructions",
        "resultType",
        "ttlMs",
        "cacheScope",
      ]
    ) {
      assertEquals(stdioResult[field], overHttp.result[field]);
    }
    assertExists(
      (stdioResult.capabilities as Record<string, unknown>).tools,
    );
    assertExists(
      (overHttp.result.capabilities as Record<string, unknown>).tools,
    );
    assertEquals(
      (stdioResult._meta as Record<string, unknown>)[SERVER_INFO_KEY],
      (overHttp.result._meta as Record<string, unknown>)[SERVER_INFO_KEY],
    );
  } finally {
    await close();
    await http.shutdown();
  }
});
