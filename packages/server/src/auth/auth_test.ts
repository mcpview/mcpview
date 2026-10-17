// deno-lint-ignore-file require-await
/**
 * Tests for auth middleware, bearer extraction, and HTTP integration.
 *
 * @module lib/server/auth/auth_test
 */

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { AuthProvider } from "./provider.ts";
import { JwtAuthProvider } from "./jwt-provider.ts";
import {
  type AuthInfo,
  httpsUrl,
  type ProtectedResourceMetadata,
  tryHttpsUrl,
} from "./types.ts";
import { createGoogleAuthProvider } from "./presets.ts";
import {
  AuthError,
  createAuthMiddleware,
  createForbiddenResponse,
  createUnauthorizedResponse,
  extractBearerToken,
} from "./middleware.ts";
import { createScopeMiddleware } from "./scope-middleware.ts";
import type { MiddlewareContext } from "../middleware/types.ts";
import { McpApp } from "../mcp-app.ts";

// ============================================
// Mock AuthProvider
// ============================================

class MockAuthProvider extends AuthProvider {
  public verifyCallCount = 0;
  private authInfo: AuthInfo | null;

  constructor(authInfo?: Partial<AuthInfo> | null) {
    super();
    if (authInfo === null) {
      this.authInfo = null;
    } else if (authInfo) {
      this.authInfo = {
        subject: authInfo.subject ?? "mock-user",
        scopes: authInfo.scopes ?? [],
        claims: authInfo.claims ?? {},
        clientId: authInfo.clientId,
        expiresAt: authInfo.expiresAt,
      };
    } else {
      this.authInfo = null;
    }
  }

  async verifyToken(_token: string): Promise<AuthInfo | null> {
    this.verifyCallCount++;
    return this.authInfo;
  }

  getResourceMetadata(): ProtectedResourceMetadata {
    // 0.16.0: both URL fields are HttpsUrl branded — construct via
    // `httpsUrl()` so the brand is enforced at the type layer.
    return {
      resource: "https://mock.example.com",
      resource_metadata_url: httpsUrl(
        "https://mock.example.com/.well-known/oauth-protected-resource",
      ),
      authorization_servers: [httpsUrl("https://auth.example.com")],
      bearer_methods_supported: ["header"],
    };
  }
}

// ============================================
// Bearer Token Extraction
// ============================================

Deno.test("extractBearerToken - valid bearer", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer abc123" },
  });
  assertEquals(extractBearerToken(req), "abc123");
});

Deno.test("extractBearerToken - bearer with spaces trimmed", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer   token123  " },
  });
  assertEquals(extractBearerToken(req), "token123");
});

Deno.test("extractBearerToken - missing header", () => {
  const req = new Request("http://localhost");
  assertEquals(extractBearerToken(req), null);
});

Deno.test("extractBearerToken - basic auth (not bearer)", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Basic abc123" },
  });
  assertEquals(extractBearerToken(req), null);
});

Deno.test("extractBearerToken - empty bearer", () => {
  const req = new Request("http://localhost", {
    headers: { Authorization: "Bearer " },
  });
  assertEquals(extractBearerToken(req), null);
});

// ============================================
// Unauthorized / Forbidden Responses
// ============================================

Deno.test("createUnauthorizedResponse - status 401 with WWW-Authenticate", async () => {
  const res = createUnauthorizedResponse(
    "https://example.com/.well-known/oauth-protected-resource",
  );
  assertEquals(res.status, 401);
  const wwwAuth = res.headers.get("WWW-Authenticate");
  assert(
    wwwAuth?.includes(
      'resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
    ),
  );
  const body = await res.json();
  assertEquals(body.error.code, -31401);
});

Deno.test("createUnauthorizedResponse - includes error and description", async () => {
  const res = createUnauthorizedResponse(
    "https://example.com/.well-known/oauth-protected-resource",
    "invalid_token",
    "Token has expired",
  );
  const wwwAuth = res.headers.get("WWW-Authenticate")!;
  assert(wwwAuth.includes('error="invalid_token"'));
  assert(wwwAuth.includes('error_description="Token has expired"'));
  const body = await res.json();
  assertEquals(body.error.message, "Token has expired");
});

Deno.test("createForbiddenResponse - status 403", async () => {
  const res = createForbiddenResponse(
    ["admin", "write"],
    "https://example.com/.well-known/oauth-protected-resource",
  );
  assertEquals(res.status, 403);
  const wwwAuth = res.headers.get("WWW-Authenticate");
  assert(
    wwwAuth?.includes(
      'resource_metadata="https://example.com/.well-known/oauth-protected-resource"',
    ),
  );
  assert(wwwAuth?.includes('error="insufficient_scope"'));
  const body = await res.json();
  assertEquals(body.error.code, -31403);
  assert(body.error.message.includes("admin"));
  assert(body.error.message.includes("write"));
});

// ============================================
// Auth Middleware
// ============================================

Deno.test("createAuthMiddleware - skips auth on STDIO (no request)", async () => {
  const provider = new MockAuthProvider({
    subject: "user-1",
    scopes: ["read"],
  });
  const middleware = createAuthMiddleware(provider);
  let nextCalled = false;

  await middleware(
    { toolName: "test", args: {} },
    async () => {
      nextCalled = true;
      return "ok";
    },
  );

  assertEquals(nextCalled, true);
  assertEquals(provider.verifyCallCount, 0);
});

Deno.test("createAuthMiddleware - throws AuthError on missing token", async () => {
  const provider = new MockAuthProvider({ subject: "user-1", scopes: [] });
  const middleware = createAuthMiddleware(provider);

  await assertRejects(
    () =>
      middleware(
        {
          toolName: "test",
          args: {},
          request: new Request("http://localhost"),
        },
        async () => "ok",
      ),
    AuthError,
    "Authorization header with Bearer token required",
  );
});

Deno.test("createAuthMiddleware - throws AuthError on invalid token", async () => {
  const provider = new MockAuthProvider(null); // verifyToken returns null
  const middleware = createAuthMiddleware(provider);

  await assertRejects(
    () =>
      middleware(
        {
          toolName: "test",
          args: {},
          request: new Request("http://localhost", {
            headers: { Authorization: "Bearer invalid-token" },
          }),
        },
        async () => "ok",
      ),
    AuthError,
    "Invalid or expired token",
  );
});

Deno.test("createAuthMiddleware - injects frozen authInfo on valid token", async () => {
  const claims = { nested: { flag: true } };
  const provider = new MockAuthProvider({
    subject: "user-1",
    scopes: ["read", "write"],
    claims,
  });
  const middleware = createAuthMiddleware(provider);
  const ctx: MiddlewareContext = {
    toolName: "test",
    args: {},
    request: new Request("http://localhost", {
      headers: { Authorization: "Bearer valid-token" },
    }),
  };

  await middleware(ctx, async () => "ok");

  const authInfo = ctx.authInfo as AuthInfo;
  assertEquals(authInfo.subject, "user-1");
  assertEquals(authInfo.scopes, ["read", "write"]);
  assert(Object.isFrozen(ctx.authInfo));
  assert(Object.isFrozen(authInfo.scopes));
  assert(Object.isFrozen(authInfo.claims));
  assert(Object.isFrozen(authInfo.claims?.nested));
  assertEquals(Object.isFrozen(claims), false);
});

// ============================================
// Scope Middleware
// ============================================

Deno.test("createScopeMiddleware - passes when no scopes required", async () => {
  const middleware = createScopeMiddleware(new Map());
  let nextCalled = false;

  await middleware(
    { toolName: "test", args: {}, authInfo: { subject: "u", scopes: [] } },
    async () => {
      nextCalled = true;
      return "ok";
    },
  );

  assertEquals(nextCalled, true);
});

Deno.test("createScopeMiddleware - passes when user has required scopes", async () => {
  const scopes = new Map([["admin_tool", ["admin"]]]);
  const middleware = createScopeMiddleware(scopes);
  let nextCalled = false;

  await middleware(
    {
      toolName: "admin_tool",
      args: {},
      authInfo: { subject: "u", scopes: ["admin", "read"] },
    },
    async () => {
      nextCalled = true;
      return "ok";
    },
  );

  assertEquals(nextCalled, true);
});

Deno.test("createScopeMiddleware - throws AuthError when scopes missing", async () => {
  const scopes = new Map([["admin_tool", ["admin", "write"]]]);
  const middleware = createScopeMiddleware(scopes);

  await assertRejects(
    () =>
      middleware(
        {
          toolName: "admin_tool",
          args: {},
          authInfo: { subject: "u", scopes: ["read"] },
        },
        async () => "ok",
      ),
    AuthError,
    "Insufficient scope",
  );
});

Deno.test("createScopeMiddleware - passes when no authInfo (STDIO)", async () => {
  const scopes = new Map([["admin_tool", ["admin"]]]);
  const middleware = createScopeMiddleware(scopes);
  let nextCalled = false;

  await middleware(
    { toolName: "admin_tool", args: {} }, // no authInfo, no request = STDIO
    async () => {
      nextCalled = true;
      return "ok";
    },
  );

  assertEquals(nextCalled, true);
});

Deno.test("createScopeMiddleware - throws when no authInfo on HTTP request (no-silent-fallback)", async () => {
  const scopes = new Map([["admin_tool", ["admin"]]]);
  const middleware = createScopeMiddleware(scopes);

  await assertRejects(
    () =>
      middleware(
        {
          toolName: "admin_tool",
          args: {},
          request: new Request("http://localhost"),
        }, // HTTP but no authInfo
        async () => "ok",
      ),
    Error,
    "no authInfo found on HTTP request",
  );
});

// ============================================
// HTTP Integration with Auth
// ============================================

Deno.test("HTTP + Auth - 401 without token", async () => {
  const server = new McpApp({
    name: "test-auth",
    version: "1.0.0",
    logger: () => {},
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: ["read"] }),
    },
  });

  server.registerTool(
    { name: "echo", description: "Echo", inputSchema: { type: "object" } },
    (args) => args,
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: { hello: "world" } },
      }),
    });

    assertEquals(res.status, 401);
    const wwwAuth = res.headers.get("WWW-Authenticate");
    assert(wwwAuth?.includes("Bearer"));
    assert(wwwAuth?.includes("resource_metadata="));
    await res.json(); // consume body to avoid leak
  } finally {
    await http.shutdown();
  }
});

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";

Deno.test("HTTP + Auth - 200 with valid token", async () => {
  const server = new McpApp({
    name: "test-auth",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: ["read"] }),
    },
  });

  server.registerTool(
    { name: "echo", description: "Echo", inputSchema: { type: "object" } },
    (args) => args,
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
          name: "echo",
          arguments: { hello: "world" },
        },
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.jsonrpc, "2.0");
    const result = JSON.parse(data.result.content[0].text);
    assertEquals(result.hello, "world");
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - passes frozen authInfo to tool handler context", async () => {
  const seen: Array<{
    subject?: string;
    scopes?: string[];
    frozen: boolean;
    scopesFrozen: boolean;
  }> = [];
  const server = new McpApp({
    name: "test-auth-context",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: new MockAuthProvider({
        subject: "user-42",
        scopes: ["read"],
      }),
    },
  });

  server.registerTool(
    {
      name: "context_echo",
      description: "Echo handler auth context",
      inputSchema: { type: "object" },
    },
    (_args, ctx) => {
      seen.push({
        subject: ctx?.authInfo?.subject,
        scopes: ctx?.authInfo?.scopes,
        frozen: Object.isFrozen(ctx?.authInfo),
        scopesFrozen: Object.isFrozen(ctx?.authInfo?.scopes),
      });
      return { ok: true };
    },
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "context_echo",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
          name: "context_echo",
          arguments: {},
        },
      }),
    });

    assertEquals(res.status, 200);
    await res.json();
    assertEquals(seen, [{
      subject: "user-42",
      scopes: ["read"],
      frozen: true,
      scopesFrozen: true,
    }]);
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - 401 with invalid token", async () => {
  const server = new McpApp({
    name: "test-auth",
    version: "1.0.0",
    logger: () => {},
    auth: {
      provider: new MockAuthProvider(null), // verifyToken returns null
    },
  });

  server.registerTool(
    { name: "echo", description: "Echo", inputSchema: { type: "object" } },
    (args) => args,
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer bad-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "echo", arguments: {} },
      }),
    });

    assertEquals(res.status, 401);
    const wwwAuth = res.headers.get("WWW-Authenticate");
    assert(wwwAuth?.includes("invalid_token"));
    await res.json(); // consume body to avoid leak
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - RFC 9728 endpoint returns metadata", async () => {
  const server = new McpApp({
    name: "test-auth",
    version: "1.0.0",
    logger: () => {},
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: [] }),
    },
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(
      `http://localhost:${port}/.well-known/oauth-protected-resource`,
    );
    assertEquals(res.status, 200);
    const metadata = await res.json();
    assertEquals(metadata.resource, "https://mock.example.com");
    // 0.16.0: MockAuthProvider now wraps auth servers via httpsUrl(),
    // which normalizes to include a trailing slash for host-only URLs.
    assertEquals(metadata.authorization_servers, [
      "https://auth.example.com/",
    ]);
    assertEquals(metadata.bearer_methods_supported, ["header"]);
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - RFC 9728 endpoint 404 when no auth", async () => {
  const server = new McpApp({
    name: "test-no-auth",
    version: "1.0.0",
    logger: () => {},
    // No auth configured
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(
      `http://localhost:${port}/.well-known/oauth-protected-resource`,
    );
    assertEquals(res.status, 404);
    await res.text(); // consume body
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - no auth config means tools work without token", async () => {
  const server = new McpApp({
    name: "test-no-auth",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    // No auth configured
  });

  server.registerTool(
    { name: "echo", description: "Echo", inputSchema: { type: "object" } },
    (args) => args,
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
          name: "echo",
          arguments: { ok: true },
        },
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();
    const result = JSON.parse(data.result.content[0].text);
    assertEquals(result.ok, true);
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - scope enforcement 403", async () => {
  const expectedResourceMetadataUrl =
    "https://mock.example.com/.well-known/oauth-protected-resource";
  let handlerCalls = 0;
  const server = new McpApp({
    name: "test-scopes",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: ["read"] }), // only "read"
    },
  });

  server.registerTool(
    {
      name: "admin_action",
      description: "Admin only",
      inputSchema: { type: "object" },
      requiredScopes: ["admin"],
    },
    () => {
      handlerCalls++;
      return "admin result";
    },
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "admin_action",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
          name: "admin_action",
          arguments: {},
        },
      }),
    });

    assertEquals(res.status, 403);
    const wwwAuth = res.headers.get("WWW-Authenticate");
    assert(wwwAuth?.includes('error="insufficient_scope"'));
    assert(
      wwwAuth?.includes(
        `resource_metadata="${expectedResourceMetadataUrl}"`,
      ),
    );
    const body = await res.json();
    assertEquals(body.error.code, -31403);
    assert(body.error.message.includes("admin"));
    assertEquals(handlerCalls, 0);
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - tools/list requires token (no auth bypass)", async () => {
  const server = new McpApp({
    name: "test-auth-bypass",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: ["read"] }),
    },
  });

  server.registerTool(
    { name: "echo", description: "Echo", inputSchema: { type: "object" } },
    (args) => args,
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    // tools/list WITHOUT token should be 401 (auth check is before version check)
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    assertEquals(res.status, 401);
    await res.json(); // consume body

    // tools/list WITH valid token should work
    const res2 = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/list",
        Authorization: "Bearer valid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} } },
      }),
    });

    assertEquals(res2.status, 200);
    const data = await res2.json();
    assertEquals(data.result.tools.length, 1);
    assertEquals(data.result.tools[0].name, "echo");
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP + Auth - initialize requires token", async () => {
  // MCP 2026-07-28: when requireAuth is configured, the server MUST
  // return 401 on ALL unauthenticated requests — including initialize.
  // The 401 + WWW-Authenticate header is what triggers OAuth/DCR discovery
  // in clients (Claude.ai, Cursor). Returning 200 on initialize breaks the flow.
  const server = new McpApp({
    name: "test-init-requires-auth",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    auth: {
      provider: new MockAuthProvider({ subject: "user-1", scopes: [] }),
    },
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    // initialize WITHOUT token must return 401 (triggers OAuth discovery)
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      }),
    });

    assertEquals(res.status, 401);
    assert(
      res.headers.get("WWW-Authenticate")?.includes("Bearer"),
      "WWW-Authenticate must be present with Bearer scheme",
    );
    await res.body?.cancel();

    // initialize WITH valid token must succeed (200)
    const resWithToken = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "initialize",
        "Authorization": "Bearer valid-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} } },
      }),
    });

    assertEquals(resWithToken.status, 200);
    const data = await resWithToken.json();
    assertEquals(data.result.serverInfo.name, "test-init-requires-auth");
    assertEquals(
      data.result.protocolVersion,
      "2026-07-28",
      "Protocol version must be 2026-07-28",
    );
  } finally {
    await http.shutdown();
  }
});

// ============================================
// httpsUrl() factory — 0.16.0 branded URL validation
// ============================================

Deno.test("httpsUrl — accepts valid HTTPS URL and returns branded type", () => {
  const url = httpsUrl("https://api.example.com");
  // Runtime: normalized by `new URL().toString()` → appends trailing slash
  assertEquals(url as string, "https://api.example.com/");
});

Deno.test("httpsUrl — accepts valid http:// URL (local dev)", () => {
  const url = httpsUrl("http://localhost:8003/mcp");
  assertEquals(url as string, "http://localhost:8003/mcp");
});

Deno.test("httpsUrl — normalizes uppercase HTTPS scheme to lowercase (RFC 3986)", () => {
  // RFC 3986 § 3.1 says scheme comparison is case-insensitive.
  // `new URL()` normalizes to lowercase on `.toString()`.
  const url = httpsUrl("HTTPS://api.example.com");
  assertEquals(url as string, "https://api.example.com/");
});

Deno.test("httpsUrl — trims leading/trailing whitespace before parsing", () => {
  // YAML keys with trailing whitespace or env vars with stray padding
  // must not produce unparseable URLs.
  const url = httpsUrl("  https://api.example.com  ");
  assertEquals(url as string, "https://api.example.com/");
});

Deno.test("httpsUrl — throws on empty string", () => {
  assertThrows(
    () => httpsUrl(""),
    Error,
    "empty or whitespace-only",
  );
});

Deno.test("httpsUrl — throws on whitespace-only string", () => {
  assertThrows(
    () => httpsUrl("   "),
    Error,
    "empty or whitespace-only",
  );
});

Deno.test("httpsUrl — throws on non-URL string", () => {
  assertThrows(
    () => httpsUrl("not a url"),
    Error,
    "not a parseable URL",
  );
});

Deno.test("httpsUrl — throws on relative path", () => {
  assertThrows(
    () => httpsUrl("/.well-known/oauth-protected-resource"),
    Error,
    "not a parseable URL",
  );
});

Deno.test("httpsUrl — throws on non-HTTP(S) scheme (javascript:)", () => {
  assertThrows(
    () => httpsUrl("javascript:alert(1)"),
    Error,
    "must use http:// or https://",
  );
});

Deno.test("httpsUrl — throws on non-HTTP(S) scheme (ftp:)", () => {
  assertThrows(
    () => httpsUrl("ftp://files.example.com/"),
    Error,
    "must use http:// or https://",
  );
});

Deno.test("httpsUrl — error message includes offending value for debugging", () => {
  try {
    httpsUrl("definitely-not-a-url");
    throw new Error("should have thrown");
  } catch (err) {
    // `JSON.stringify`-ed so quotes/newlines/specials don't break log parsing
    assert((err as Error).message.includes('"definitely-not-a-url"'));
  }
});

Deno.test("tryHttpsUrl — returns HttpsUrl on valid input", () => {
  const url = tryHttpsUrl("https://api.example.com");
  assert(url !== null);
  assertEquals(url as string, "https://api.example.com/");
});

Deno.test("tryHttpsUrl — returns null on opaque identifier (no throw)", () => {
  // OIDC project ID used as JWT audience per RFC 9728 § 2 — not an URL.
  const url = tryHttpsUrl("367545125829670172");
  assertEquals(url, null);
});

Deno.test("tryHttpsUrl — returns null on empty string (no throw)", () => {
  assertEquals(tryHttpsUrl(""), null);
});

// ============================================
// JwtAuthProvider — resource_metadata_url resolution (0.16.0 DU)
// ============================================

Deno.test("JwtAuthProvider — auto-derives resource_metadata_url from HttpsUrl resource", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com",
    resource: httpsUrl("https://api.example.com"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  const metadata = provider.getResourceMetadata();
  assertEquals(
    metadata.resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test("JwtAuthProvider — uses explicit resourceMetadataUrl for opaque resource", () => {
  const provider = new JwtAuthProvider({
    kind: "opaque",
    issuer: "https://idp.example.com",
    audience: "367545125829670172",
    resource: "367545125829670172",
    authorizationServers: [httpsUrl("https://idp.example.com")],
    resourceMetadataUrl: httpsUrl(
      "https://my-tenant.example.com/mcp/.well-known/oauth-protected-resource",
    ),
  });
  const metadata = provider.getResourceMetadata();
  assertEquals(
    metadata.resource_metadata_url as string,
    "https://my-tenant.example.com/mcp/.well-known/oauth-protected-resource",
  );
});

Deno.test("JwtAuthProvider — trailing slash on HttpsUrl resource is stripped before derivation", () => {
  // `httpsUrl("https://api.example.com")` normalizes to `"https://api.example.com/"`
  // (trailing slash added by `new URL().toString()`). The constructor must
  // strip it before appending `/.well-known/...` to avoid a double slash.
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com",
    resource: httpsUrl("https://api.example.com/"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});

// ============================================
// JwtAuthProvider — RFC 9728 § 3.1 metadata URL derivation
// ============================================
//
// These tests exercise the non-root-path code path that was silently broken
// prior to 0.16.0. The bug: `${resource}/.well-known/oauth-protected-resource`
// appended the well-known suffix AFTER the path, but RFC 9728 § 3.1 requires
// the suffix to be inserted BETWEEN the host and the path component:
//
//   "If the resource identifier value contains a path or query component,
//    any terminating slash (/) following the host component MUST be removed
//    before inserting /.well-known/ and the well-known URI path suffix
//    between the host component and the path and/or query components."
//
// The bug survived 0.15.x because all existing tests used root-path resources
// (https://host or https://host/) where both approaches produce identical
// output. It was caught by the 0.16.0 code review.

Deno.test("JwtAuthProvider — RFC 9728 § 3.1: path component inserted after well-known (not before)", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com/v1/mcp",
    resource: httpsUrl("https://api.example.com/v1/mcp"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp",
  );
});

Deno.test("JwtAuthProvider — RFC 9728 § 3.1: path with trailing slash preserved in metadata URL", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com/v1/mcp/",
    resource: httpsUrl("https://api.example.com/v1/mcp/"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp/",
  );
});

Deno.test("JwtAuthProvider — RFC 9728 § 3.1: query string preserved on derivation", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com/v1/mcp?tenant=acme",
    resource: httpsUrl("https://api.example.com/v1/mcp?tenant=acme"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource/v1/mcp?tenant=acme",
  );
});

Deno.test("JwtAuthProvider — RFC 9728 § 3.1: query-only resource (no path) places well-known at root", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com?tenant=acme",
    resource: httpsUrl("https://api.example.com?tenant=acme"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource?tenant=acme",
  );
});

Deno.test("JwtAuthProvider — RFC 9728 § 3.1: deeply nested path preserved", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://idp.example.com",
    audience: "https://api.example.com/api/v2/tenants/acme/mcp",
    resource: httpsUrl("https://api.example.com/api/v2/tenants/acme/mcp"),
    authorizationServers: [httpsUrl("https://idp.example.com")],
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource/api/v2/tenants/acme/mcp",
  );
});

// Note: the 0.15.1 runtime validation tests (empty/whitespace/invalid/
// non-HTTP(S)/trailing-whitespace/uppercase) have been lifted to the
// `httpsUrl()` factory tests above. In 0.16.0, the constructor can't
// receive an invalid URL through `JwtAuthProviderOptions` at the type
// level — the compiler rejects raw strings for `HttpsUrl`-typed fields.
// The bridge-layer test (opaque resource + missing metadata) is in
// presets_bridge_test (see below in this file).

// ============================================
// Preset bridge layer — 0.16.0 raw-string → DU translation
// ============================================

Deno.test("preset bridge — createGoogleAuthProvider accepts URL resource without explicit metadata", () => {
  const provider = createGoogleAuthProvider({
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://my-mcp.example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test("preset bridge — opaque resource without resourceMetadataUrl throws with clear error", () => {
  // When YAML/env supplies an opaque `resource` (e.g., OIDC project ID) but
  // forgets `resourceMetadataUrl`, the preset bridge must throw at construction
  // with a message naming the preset and suggesting the fix. Prior to 0.16.0
  // this throw came from JwtAuthProvider's constructor; now it comes from the
  // bridge layer because the DU constructor can't accept that state.
  assertThrows(
    () =>
      createGoogleAuthProvider({
        audience: "367545125829670172",
        resource: "367545125829670172",
      }),
    Error,
    "resourceMetadataUrl is required",
  );
});

Deno.test("preset bridge — empty-string resourceMetadataUrl treated as absent (YAML fall-through)", () => {
  // A YAML key with no value or env var expanded to empty must behave
  // identically to omitting the key — fall through to auto-derivation for
  // URL `resource`. The bridge trims before truthy-check so whitespace-only
  // values are also absent.
  const provider = createGoogleAuthProvider({
    audience: "https://api.example.com",
    resource: "https://api.example.com",
    resourceMetadataUrl: "",
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test("preset bridge — whitespace-only resourceMetadataUrl also treated as absent", () => {
  const provider = createGoogleAuthProvider({
    audience: "https://api.example.com",
    resource: "https://api.example.com",
    resourceMetadataUrl: "   ",
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test("preset bridge — invalid resourceMetadataUrl throws via httpsUrl() propagation", () => {
  // The preset bridge wraps `resourceMetadataUrl` through `httpsUrl()`, so
  // `new URL()` parsing errors surface at construction time with a clear
  // message. This replaces the 0.15.1 constructor-level validation.
  assertThrows(
    () =>
      createGoogleAuthProvider({
        audience: "367545125829670172",
        resource: "367545125829670172",
        resourceMetadataUrl: "not a url",
      }),
    Error,
    "not a parseable URL",
  );
});

Deno.test("preset bridge — javascript: scheme in resourceMetadataUrl rejected via httpsUrl()", () => {
  assertThrows(
    () =>
      createGoogleAuthProvider({
        audience: "367545125829670172",
        resource: "367545125829670172",
        resourceMetadataUrl: "javascript:alert(1)",
      }),
    Error,
    "must use http:// or https://",
  );
});

Deno.test("preset bridge — trailing whitespace in URL resource is trimmed via tryHttpsUrl()", () => {
  // `tryHttpsUrl()` calls `httpsUrl()` internally which trims before parsing,
  // so `"https://api.example.com   "` is accepted as a URL resource (not
  // opaque) and auto-derives cleanly.
  const provider = createGoogleAuthProvider({
    audience: "https://api.example.com",
    resource: "https://api.example.com   ",
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});

Deno.test("preset bridge — uppercase HTTPS in resource normalized to lowercase", () => {
  const provider = createGoogleAuthProvider({
    audience: "HTTPS://api.example.com",
    resource: "HTTPS://api.example.com",
  });
  assertEquals(
    provider.getResourceMetadata().resource_metadata_url as string,
    "https://api.example.com/.well-known/oauth-protected-resource",
  );
});
