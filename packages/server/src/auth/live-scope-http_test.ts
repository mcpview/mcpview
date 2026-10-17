/**
 * HTTP regressions for authorization on tools registered or replaced at runtime.
 *
 * These tests intentionally use the real stateless HTTP path. Unit-testing the
 * scope middleware alone cannot catch a stale startup snapshot or a race between
 * scope lookup and the later handler lookup.
 *
 * @module lib/server/auth/live-scope-http_test
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { McpApp } from "../mcp-app.ts";
import { AuthProvider } from "./provider.ts";
import { createStaticTokenAuthProvider } from "./static-token-provider.ts";
import {
  type AuthInfo,
  httpsUrl,
  type ProtectedResourceMetadata,
} from "./types.ts";

const VERSION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const RESOURCE_METADATA_URL =
  "https://auth-test.example/.well-known/oauth-protected-resource";

class TokenScopesProvider extends AuthProvider {
  private readonly tokens = new Map<string, AuthInfo>([
    ["read-token", { subject: "reader", scopes: ["read"] }],
    ["admin-token", { subject: "admin", scopes: ["admin"] }],
    ["write-token", { subject: "writer", scopes: ["write"] }],
  ]);

  verifyToken(token: string): Promise<AuthInfo | null> {
    return Promise.resolve(this.tokens.get(token) ?? null);
  }

  getResourceMetadata(): ProtectedResourceMetadata {
    return {
      resource: "https://auth-test.example/mcp",
      resource_metadata_url: httpsUrl(RESOURCE_METADATA_URL),
      authorization_servers: [httpsUrl("https://issuer.example")],
      bearer_methods_supported: ["header"],
    };
  }
}

function allocatePort(): number {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

function callTool(
  port: number,
  name: string,
  token?: string,
  args: Record<string, unknown> = {},
  id = 1,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "MCP-Protocol-Version": VERSION,
    "Mcp-Method": "tools/call",
    "Mcp-Name": name,
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;

  return fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name,
        arguments: args,
        _meta: {
          [PROTOCOL_VERSION_KEY]: VERSION,
          [CLIENT_CAPABILITIES_KEY]: {},
        },
      },
    }),
  });
}

async function resultText(response: Response): Promise<string> {
  const body = await response.json();
  return body.result.content[0].text as string;
}

async function waitForQueued(app: McpApp): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (app.getMetrics().queued > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("tool call did not enter the backpressure queue");
}

Deno.test("live scoped tool denies insufficient scope and allows sufficient scope", async () => {
  const app = new McpApp({
    name: "live-scope",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: { provider: new TokenScopesProvider() },
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  let handlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "live_admin",
        description: "Admin-only live tool",
        inputSchema: { type: "object" },
        requiredScopes: ["admin"],
      },
      () => {
        handlerCalls++;
        return { reached: true };
      },
    );

    const denied = await callTool(port, "live_admin", "read-token");
    assertEquals(denied.status, 403);
    const authenticate = denied.headers.get("WWW-Authenticate") ?? "";
    assertStringIncludes(authenticate, 'error="insufficient_scope"');
    assertStringIncludes(
      authenticate,
      `resource_metadata="${RESOURCE_METADATA_URL}"`,
    );
    const deniedBody = await denied.json();
    assertEquals(deniedBody.error.code, -31403);
    assertStringIncludes(deniedBody.error.message, "admin");
    assertEquals(handlerCalls, 0);

    const allowed = await callTool(port, "live_admin", "admin-token", {}, 2);
    assertEquals(allowed.status, 200);
    assertStringIncludes(await resultText(allowed), '"reached": true');
    assertEquals(handlerCalls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("identity-aware static credentials enforce their own scopes over HTTP", async () => {
  const app = new McpApp({
    name: "static-credential-scopes",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: createStaticTokenAuthProvider(
        [
          { token: "reader-token", subject: "reader", scopes: ["read"] },
          { token: "admin-token", subject: "admin", scopes: ["admin"] },
        ],
        { resource: "https://auth-test.example" },
      ),
    },
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  let handlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "static_admin",
        description: "Admin-only tool backed by static credentials",
        inputSchema: { type: "object" },
        requiredScopes: ["admin"],
      },
      () => {
        handlerCalls++;
        return "allowed";
      },
    );

    const denied = await callTool(port, "static_admin", "reader-token");
    assertEquals(denied.status, 403);
    assertEquals(handlerCalls, 0);

    const allowed = await callTool(
      port,
      "static_admin",
      "admin-token",
      {},
      2,
    );
    assertEquals(allowed.status, 200);
    assertEquals(await resultText(allowed), "allowed");
    assertEquals(handlerCalls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("live replacement updates scopes without retaining caller-owned arrays", async () => {
  const app = new McpApp({
    name: "live-scope-replace",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: { provider: new TokenScopesProvider() },
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  const originalScopes = ["admin"];
  let adminHandlerCalls = 0;
  let writeHandlerCalls = 0;
  let publicHandlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "mutable_live",
        description: "Initially admin-only",
        inputSchema: { type: "object" },
        requiredScopes: originalScopes,
      },
      () => {
        adminHandlerCalls++;
        return "admin";
      },
    );

    // Mutating the caller's array must not mutate the registered policy.
    originalScopes.splice(0, 1, "read");
    const stillDenied = await callTool(port, "mutable_live", "read-token");
    assertEquals(stillDenied.status, 403);
    assertEquals(adminHandlerCalls, 0);

    const adminAllowed = await callTool(
      port,
      "mutable_live",
      "admin-token",
      {},
      2,
    );
    assertEquals(await resultText(adminAllowed), "admin");
    assertEquals(adminHandlerCalls, 1);

    app.registerToolLive(
      {
        name: "mutable_live",
        description: "Now write-only",
        inputSchema: { type: "object" },
        requiredScopes: ["write"],
      },
      () => {
        writeHandlerCalls++;
        return "write";
      },
    );

    const staleAdmin = await callTool(
      port,
      "mutable_live",
      "admin-token",
      {},
      3,
    );
    assertEquals(staleAdmin.status, 403);
    assertEquals(writeHandlerCalls, 0);

    const writerAllowed = await callTool(
      port,
      "mutable_live",
      "write-token",
      {},
      4,
    );
    assertEquals(await resultText(writerAllowed), "write");
    assertEquals(writeHandlerCalls, 1);

    app.registerToolLive(
      {
        name: "mutable_live",
        description: "Now unscoped",
        inputSchema: { type: "object" },
      },
      () => {
        publicHandlerCalls++;
        return "public";
      },
    );

    const publicCall = await callTool(
      port,
      "mutable_live",
      "read-token",
      {},
      5,
    );
    assertEquals(await resultText(publicCall), "public");
    assertEquals(publicHandlerCalls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("in-flight call keeps the handler and scopes captured before live replacement", async () => {
  let releaseBlocker = () => {};
  let markBlockerEntered = () => {};
  const blockerEntered = new Promise<void>((resolve) => {
    markBlockerEntered = resolve;
  });
  const blockerReleased = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });

  const app = new McpApp({
    name: "live-scope-race",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    maxConcurrent: 1,
    backpressureStrategy: "queue",
    auth: { provider: new TokenScopesProvider() },
  });
  app.registerTool(
    { name: "blocker", description: "Occupy the slot", inputSchema: {} },
    async () => {
      markBlockerEntered();
      await blockerReleased;
      return "released";
    },
  );
  let oldHandlerCalls = 0;
  let newHandlerCalls = 0;
  app.registerTool(
    {
      name: "replace_race",
      description: "Old read tool",
      inputSchema: {},
      requiredScopes: ["read"],
      _meta: { ui: { resourceUri: "ui://live-scope/old" } },
    },
    () => {
      oldHandlerCalls++;
      return "old";
    },
  );

  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  const blockingCall = callTool(port, "blocker", "read-token");
  let queuedCall: Promise<Response> | undefined;

  try {
    await blockerEntered;
    queuedCall = callTool(port, "replace_race", "read-token", {}, 2);
    await waitForQueued(app);

    app.registerToolLive(
      {
        name: "replace_race",
        description: "New admin tool",
        inputSchema: {},
        requiredScopes: ["admin"],
        _meta: { ui: { resourceUri: "ui://live-scope/new" } },
      },
      () => {
        newHandlerCalls++;
        return "new";
      },
    );

    releaseBlocker();
    assertEquals(await resultText(await blockingCall), "released");
    const queuedBody = await (await queuedCall).json();
    assertEquals(queuedBody.result.content[0].text, "old");
    assertEquals(
      queuedBody.result._meta.ui.resourceUri,
      "ui://live-scope/old",
    );
    assertEquals(oldHandlerCalls, 1);
    assertEquals(newHandlerCalls, 0);

    const deniedNext = await callTool(
      port,
      "replace_race",
      "read-token",
      {},
      3,
    );
    assertEquals(deniedNext.status, 403);
    assertEquals(newHandlerCalls, 0);

    const allowedNext = await callTool(
      port,
      "replace_race",
      "admin-token",
      {},
      4,
    );
    assertEquals(await resultText(allowedNext), "new");
    assertEquals(newHandlerCalls, 1);
  } finally {
    releaseBlocker();
    await Promise.allSettled([
      blockingCall,
      ...(queuedCall ? [queuedCall] : []),
    ]);
    await http.shutdown();
  }
});

Deno.test("in-flight call keeps its compiled schema across live replacement", async () => {
  let releaseMiddleware = () => {};
  let markMiddlewareEntered = () => {};
  const middlewareEntered = new Promise<void>((resolve) => {
    markMiddlewareEntered = resolve;
  });
  const middlewareReleased = new Promise<void>((resolve) => {
    releaseMiddleware = resolve;
  });

  const app = new McpApp({
    name: "live-schema-replace-race",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    validateSchema: true,
    auth: { provider: new TokenScopesProvider() },
  });
  app.use(async (_ctx, next) => {
    markMiddlewareEntered();
    await middlewareReleased;
    return next();
  });
  let oldHandlerCalls = 0;
  let newHandlerCalls = 0;
  app.registerTool(
    {
      name: "schema_replace_race",
      description: "Old constrained read tool",
      inputSchema: {
        type: "object",
        properties: { safe: { type: "string" } },
        additionalProperties: false,
      },
      requiredScopes: ["read"],
    },
    () => {
      oldHandlerCalls++;
      return "old";
    },
  );

  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  const inFlight = callTool(
    port,
    "schema_replace_race",
    "read-token",
    { privileged: true },
  );

  try {
    await middlewareEntered;
    app.registerToolLive(
      {
        name: "schema_replace_race",
        description: "New permissive admin tool",
        inputSchema: { type: "object" },
        requiredScopes: ["admin"],
      },
      () => {
        newHandlerCalls++;
        return "new";
      },
    );

    releaseMiddleware();
    const rejected = await inFlight;
    const rejectedBody = await rejected.json();
    assertEquals(rejectedBody.error.code, -32603);
    assertStringIncludes(
      rejectedBody.error.message,
      "Unknown property: privileged",
    );
    assertEquals(oldHandlerCalls, 0);
    assertEquals(newHandlerCalls, 0);

    const currentTool = await callTool(
      port,
      "schema_replace_race",
      "admin-token",
      { privileged: true },
      2,
    );
    assertEquals(await resultText(currentTool), "new");
    assertEquals(newHandlerCalls, 1);
  } finally {
    releaseMiddleware();
    await Promise.allSettled([inFlight]);
    await http.shutdown();
  }
});

Deno.test("in-flight call keeps its compiled schema after unregister", async () => {
  let releaseMiddleware = () => {};
  let markMiddlewareEntered = () => {};
  const middlewareEntered = new Promise<void>((resolve) => {
    markMiddlewareEntered = resolve;
  });
  const middlewareReleased = new Promise<void>((resolve) => {
    releaseMiddleware = resolve;
  });

  const app = new McpApp({
    name: "live-schema-unregister-race",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    validateSchema: true,
    auth: { provider: new TokenScopesProvider() },
  });
  app.use(async (_ctx, next) => {
    markMiddlewareEntered();
    await middlewareReleased;
    return next();
  });
  let handlerCalls = 0;
  app.registerTool(
    {
      name: "schema_unregister_race",
      description: "Constrained tool removed while a call is in flight",
      inputSchema: {
        type: "object",
        properties: { safe: { type: "string" } },
        additionalProperties: false,
      },
      requiredScopes: ["read"],
    },
    () => {
      handlerCalls++;
      return "unsafe";
    },
  );

  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  const inFlight = callTool(
    port,
    "schema_unregister_race",
    "read-token",
    { privileged: true },
  );

  try {
    await middlewareEntered;
    assertEquals(app.unregisterTool("schema_unregister_race"), true);
    releaseMiddleware();

    const rejected = await inFlight;
    const rejectedBody = await rejected.json();
    assertEquals(rejectedBody.error.code, -32603);
    assertStringIncludes(
      rejectedBody.error.message,
      "Unknown property: privileged",
    );
    assertEquals(handlerCalls, 0);

    const missing = await callTool(
      port,
      "schema_unregister_race",
      "read-token",
      {},
      2,
    );
    const missingBody = await missing.json();
    assertEquals(missingBody.error.code, -32602);
  } finally {
    releaseMiddleware();
    await Promise.allSettled([inFlight]);
    await http.shutdown();
  }
});

Deno.test("unregister removes stale schema and re-registration starts unscoped", async () => {
  const app = new McpApp({
    name: "live-scope-unregister",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    validateSchema: true,
    auth: { provider: new TokenScopesProvider() },
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  let newHandlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "reused_name",
        description: "Old scoped schema",
        inputSchema: {
          type: "object",
          properties: { old: { type: "string" } },
          required: ["old"],
        },
        requiredScopes: ["admin"],
      },
      () => "old",
    );
    assertEquals(app.unregisterTool("reused_name"), true);

    const missing = await callTool(
      port,
      "reused_name",
      "read-token",
      {},
      2,
    );
    const missingBody = await missing.json();
    assertEquals(missingBody.error.code, -32602);
    assertStringIncludes(missingBody.error.message, "Unknown tool");

    app.registerToolLive(
      {
        name: "reused_name",
        description: "New unscoped schema",
        inputSchema: {
          type: "object",
          properties: { fresh: { type: "number" } },
          required: ["fresh"],
        },
      },
      () => {
        newHandlerCalls++;
        return "fresh";
      },
    );
    const fresh = await callTool(
      port,
      "reused_name",
      "read-token",
      { fresh: 1 },
      3,
    );
    assertEquals(await resultText(fresh), "fresh");
    assertEquals(newHandlerCalls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("invalid live replacement leaves the previous tool policy and handler intact", async () => {
  const app = new McpApp({
    name: "live-scope-transaction",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    validateSchema: true,
    auth: { provider: new TokenScopesProvider() },
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  let oldHandlerCalls = 0;
  let rejectedHandlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "transactional_live",
        description: "Valid read tool",
        inputSchema: {
          type: "object",
          properties: { old: { type: "string" } },
          required: ["old"],
        },
        requiredScopes: ["read"],
      },
      () => {
        oldHandlerCalls++;
        return "old";
      },
    );

    assertThrows(() =>
      app.registerToolLive(
        {
          name: "transactional_live",
          description: "Invalid admin replacement",
          inputSchema: { type: "not-a-json-schema-type" },
          requiredScopes: ["admin"],
        },
        () => {
          rejectedHandlerCalls++;
          return "rejected";
        },
      )
    );

    const oldStillActive = await callTool(
      port,
      "transactional_live",
      "read-token",
      { old: "still-valid" },
    );
    assertEquals(await resultText(oldStillActive), "old");
    assertEquals(oldHandlerCalls, 1);
    assertEquals(rejectedHandlerCalls, 0);

    const oldSchemaStillActive = await callTool(
      port,
      "transactional_live",
      "read-token",
      {},
      2,
    );
    const oldSchemaBody = await oldSchemaStillActive.json();
    assertEquals(oldSchemaBody.error.code, -32603);
    assertStringIncludes(
      oldSchemaBody.error.message,
      "Missing required property: old",
    );
    assertEquals(oldHandlerCalls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("live scoped HTTP tool fails closed when no auth provider is configured", async () => {
  const app = new McpApp({
    name: "live-scope-no-auth",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  const port = allocatePort();
  const http = await app.startHttp({ port, onListen: () => {} });
  let handlerCalls = 0;

  try {
    app.registerToolLive(
      {
        name: "misconfigured_live",
        description: "Must not run without auth",
        inputSchema: { type: "object" },
        requiredScopes: ["admin"],
      },
      () => {
        handlerCalls++;
        return "unsafe";
      },
    );

    const response = await callTool(port, "misconfigured_live");
    const body = await response.json();
    assertEquals(body.error.code, -32603);
    assertStringIncludes(
      body.error.message,
      "no authInfo found on HTTP request",
    );
    assertEquals(handlerCalls, 0);
  } finally {
    await http.shutdown();
  }
});
