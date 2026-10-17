import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const distEntry = pathToFileURL(
  resolve(process.argv[2] ?? "dist-node/esm/mod.js"),
).href;
const {
  buildClientIdMetadataDocument,
  CallbackServer,
  createStaticTokenAuthProvider,
  FileTokenStore,
  loadAuthConfig,
  McpApp,
  MemoryMrtrReplayStore,
  MemoryTokenStore,
} = await import(distEntry);

const staticCredentials = createStaticTokenAuthProvider(
  [
    { token: "node-token-a", subject: "alice", scopes: ["read"] },
    {
      token: "node-token-b",
      subject: "automation",
      scopes: ["read", "write"],
    },
  ],
  { resource: "https://mcp.example.com" },
);
const [nodeAlice, nodeAutomation, nodeUnknown] = await Promise.all([
  staticCredentials.verifyToken("node-token-a"),
  staticCredentials.verifyToken("node-token-b"),
  staticCredentials.verifyToken("unknown-token"),
]);
if (
  nodeAlice?.subject !== "alice" ||
  nodeAutomation?.subject !== "automation" ||
  nodeAlice === nodeAutomation ||
  nodeAutomation?.scopes.join(" ") !== "read write" ||
  !Object.isFrozen(nodeAlice) ||
  !Object.isFrozen(nodeAlice.scopes) ||
  nodeUnknown !== null
) {
  throw new Error("identity-aware static credentials failed in Node build");
}

const replayStore = new MemoryMrtrReplayStore();
const smokeNonce = "a".repeat(32);
const smokeExpiry = Math.floor(Date.now() / 1000) + 60;
if (
  replayStore.consume(smokeNonce, smokeExpiry) !== true ||
  replayStore.consume(smokeNonce, smokeExpiry) !== false
) {
  throw new Error("MemoryMrtrReplayStore did not reject a replay");
}

const document = buildClientIdMetadataDocument({
  clientName: "Node Smoke Client",
  tokenStore: new MemoryTokenStore(),
  openBrowser: async () => {},
  callbackPort: 38987,
  clientRegistration: {
    method: "client_id_metadata",
    clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
    redirectUri: "http://127.0.0.1:38987/callback",
  },
});

if (document.client_id !== "https://client.example.com/oauth/client.json") {
  throw new Error("CIMD document client_id mismatch");
}

const dir = await mkdtemp(join(tmpdir(), "casys-node-smoke-"));
try {
  const authConfigPath = join(dir, "auth.yaml");
  await writeFile(
    authConfigPath,
    [
      "auth:",
      "  provider: github",
      "  audience: https://node-smoke.example/audience",
      "  resource: https://node-smoke.example/resource",
      "  scopesSupported:",
      "    - read",
      "    - write",
      "",
    ].join("\n"),
  );
  const authConfig = await loadAuthConfig(authConfigPath);
  if (
    authConfig?.provider !== "github" ||
    authConfig.scopesSupported?.join(" ") !== "read write"
  ) {
    throw new Error("Node build did not load the vendored YAML config");
  }

  const store = new FileTokenStore(dir);
  await store.set("https://mcp.example.com", {
    serverUrl: "https://mcp.example.com",
    tokens: { access_token: "token", token_type: "bearer" },
    obtainedAt: Date.now(),
  });

  const stored = await store.get("https://mcp.example.com");
  if (stored?.tokens.access_token !== "token") {
    throw new Error("FileTokenStore get returned wrong token");
  }

  await store.delete("https://mcp.example.com");
  if (await store.get("https://mcp.example.com") !== null) {
    throw new Error("FileTokenStore delete did not remove token");
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

const callbackServer = new CallbackServer({ port: 0, timeout: 5_000 });
const { port } = await callbackServer.start();
if (!(port > 0)) {
  throw new Error("CallbackServer did not bind an ephemeral port");
}
await callbackServer.close();

const occupied = createServer();
await new Promise((resolveListen, rejectListen) => {
  occupied.once("error", rejectListen);
  occupied.listen(0, "127.0.0.1", resolveListen);
});

try {
  const occupiedAddress = occupied.address();
  if (
    typeof occupiedAddress !== "object" || occupiedAddress === null ||
    typeof occupiedAddress.port !== "number"
  ) {
    throw new Error("Could not determine occupied port");
  }

  const collidingServer = new CallbackServer({
    hostname: "127.0.0.1",
    port: occupiedAddress.port,
    timeout: 1_000,
  });
  let rejected = false;
  try {
    await collidingServer.start();
  } catch {
    rejected = true;
  } finally {
    await collidingServer.close();
  }
  if (!rejected) {
    throw new Error("CallbackServer did not reject on occupied port");
  }
} finally {
  await new Promise((resolveClose, rejectClose) => {
    occupied.close((err) => err ? rejectClose(err) : resolveClose());
  });
}

console.log("node client-auth smoke ok");

// Runtime selector + HTTP transport: McpApp.startHttp() must work under Node.
// Regression guard for the runtime-selection bug fixed in 0.21.1, where the
// Deno adapter (Deno.readTextFile / Deno.serve) leaked into Node consumers.
{
  const app = new McpApp({
    name: "node-smoke",
    version: "0.0.0",
    maxConcurrent: 2,
    logger: () => {},
    resourceCsp: { allowInline: true },
    transport: "stateless",
    auth: { provider: staticCredentials },
  });
  app.registerTools([], {});
  app.registerResource(
    {
      uri: "ui://node-smoke/blob",
      name: "Node blob resource",
      mimeType: "text/html",
      size: 3,
    },
    () => ({
      uri: "ui://node-smoke/blob",
      mimeType: "text/html",
      blob: "AAEC",
    }),
  );
  const http = await app.startHttp({ port: 38988, hostname: "127.0.0.1" });
  try {
    // A conforming 2026-07-28 request: the protocol version lives in
    // `params._meta` under its namespaced key, and is mirrored in the
    // MCP-Protocol-Version header. The pre-2026 shape (top-level
    // `params.protocolVersion`, no headers) is rejected since 0.24.0.
    const res = await fetch("http://127.0.0.1:38988/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer node-token-b",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "node-smoke",
              version: "0",
            },
          },
        },
      }),
    });
    if (res.status !== 200) {
      throw new Error(`McpApp.startHttp tools/list returned ${res.status}`);
    }
    await res.body?.cancel();

    // The identity-aware provider must also drive the real HTTP scope gate in
    // the compiled package, not just expose distinct verifyToken() results.
    let scopedHandlerCalls = 0;
    app.registerToolLive(
      {
        name: "node_write",
        description: "Node package scope smoke",
        inputSchema: { type: "object" },
        requiredScopes: ["write"],
      },
      () => {
        scopedHandlerCalls++;
        return "allowed";
      },
    );
    const callScopedTool = (token, id) =>
      fetch("http://127.0.0.1:38988/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "node_write",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "node_write",
            arguments: {},
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });

    const deniedScope = await callScopedTool("node-token-a", 5);
    if (deniedScope.status !== 403 || scopedHandlerCalls !== 0) {
      throw new Error("Node HTTP scope gate did not reject the read token");
    }
    await deniedScope.body?.cancel();
    const allowedScope = await callScopedTool("node-token-b", 6);
    if (allowedScope.status !== 200 || scopedHandlerCalls !== 1) {
      throw new Error("Node HTTP scope gate did not accept the write token");
    }
    await allowedScope.body?.cancel();
    const unknownToken = await callScopedTool("unknown-token", 7);
    if (unknownToken.status !== 401 || scopedHandlerCalls !== 1) {
      throw new Error("Node HTTP auth gate did not reject an unknown token");
    }
    await unknownToken.body?.cancel();

    // A binary resource exercises the Node copy of the content validation and
    // confirms CSP does not decode or mutate base64 blobs.
    const resource = await fetch("http://127.0.0.1:38988/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer node-token-b",
        "content-type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://node-smoke/blob",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "resources/read",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
          uri: "ui://node-smoke/blob",
        },
      }),
    });
    const resourceBody = await resource.json();
    const content = resourceBody.result?.contents?.[0];
    if (
      resource.status !== 200 || content?.blob !== "AAEC" || "text" in content
    ) {
      throw new Error("McpApp Node resource blob smoke failed");
    }

    // The pre-start resource installed the one shared resource-handler set, so
    // a later addition must appear immediately without a second SDK registry.
    app.registerResource(
      { uri: "ui://node-smoke/live", name: "Node live resource" },
      () => ({
        uri: "ui://node-smoke/live",
        mimeType: "text/plain",
        text: "live",
      }),
    );
    const list = await fetch("http://127.0.0.1:38988/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer node-token-b",
        "content-type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "resources/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "resources/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
    const listBody = await list.json();
    if (
      list.status !== 200 ||
      !listBody.result?.resources?.some((item) =>
        item.uri === "ui://node-smoke/live"
      )
    ) {
      throw new Error("McpApp Node live resource registration smoke failed");
    }

    // And the legacy shape must be refused — this is the 0.24.0 break, so the
    // smoke test is the right place to catch a silent regression of it.
    const legacy = await fetch("http://127.0.0.1:38988/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer node-token-b",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {} },
      }),
    });
    if (legacy.status !== 400) {
      throw new Error(
        `pre-2026 request should be rejected with 400, got ${legacy.status}`,
      );
    }
    const legacyBody = await legacy.json();
    if (legacyBody.error?.code !== -32020) {
      throw new Error(
        `missing MCP-Protocol-Version should be -32020, got ${legacyBody.error?.code}`,
      );
    }
  } finally {
    await http.shutdown();
  }
}

console.log("node mcp-app http smoke ok");
