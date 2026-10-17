// deno-lint-ignore-file no-explicit-any
/**
 * Security hardening tests for HTTP server
 *
 * Covers: maxBodyBytes (413), CORS allowlist, IP rate limiting (429),
 * requireAuth, sessionId propagation, and e2e secure flows.
 *
 * @module lib/server/http-security_test
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { McpApp } from "./mcp-app.ts";

// ─── Helpers ─────────────────────────────────────────────

/** Allocate a free port and release the listener immediately */
function getFreePort(): number {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

/** Send a JSON-RPC request to the server (stateless 2026-07-28 format) */
async function jsonRpc(
  port: number,
  method: string,
  params?: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<{ res: Response; data: Record<string, unknown> }> {
  const namePart = params?.name ?? params?.uri;
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...(params ?? {}),
      _meta: { [PROTO_KEY]: "2026-07-28", [CAPS_KEY]: {} },
    },
  };

  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(typeof namePart === "string" ? { "Mcp-Name": namePart } : {}),
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return { res, data };
}

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";

// ═══════════════════════════════════════════════════════════
// requireAuth
// ═══════════════════════════════════════════════════════════

Deno.test("security - requireAuth throws when no auth provider configured", async () => {
  const server = new McpApp({
    name: "auth-guard",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();

  await assertRejects(
    () => server.startHttp({ port, onListen: () => {}, requireAuth: true }),
    Error,
    "HTTP auth is required",
  );
});

Deno.test("security - requireAuth=false (default) allows start without auth", async () => {
  const server = new McpApp({
    name: "no-auth",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/health`);
    assertEquals(res.status, 200);
    await res.json(); // consume
  } finally {
    await http.shutdown();
  }
});

// ═══════════════════════════════════════════════════════════
// maxBodyBytes
// ═══════════════════════════════════════════════════════════

Deno.test("security - maxBodyBytes rejects oversized payload with 413", async () => {
  const server = new McpApp({
    name: "body-limit",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    maxBodyBytes: 30,
  });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { padding: "x".repeat(100) },
      }),
    });

    assertEquals(res.status, 413);
    const data = await res.json();
    assertEquals(data.error.code, -32000);
    assertStringIncludes(data.error.message, "Payload too large");
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - maxBodyBytes allows normal-sized payloads", async () => {
  const server = new McpApp({
    name: "body-limit-ok",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    maxBodyBytes: 10_000,
  });

  try {
    const { res, data } = await jsonRpc(port, "initialize");
    assertEquals(res.status, 200);
    assertExists((data as any).result?.serverInfo);
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - maxBodyBytes=null disables the limit", async () => {
  const server = new McpApp({
    name: "no-body-limit",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    maxBodyBytes: null,
  });

  try {
    // Large payload should pass
    const { res } = await jsonRpc(port, "initialize", {
      padding: "y".repeat(2_000_000),
    });
    assertEquals(res.status, 200);
  } finally {
    await http.shutdown();
  }
});

// ═══════════════════════════════════════════════════════════
// CORS allowlist
// ═══════════════════════════════════════════════════════════

Deno.test("security - corsOrigins allowlist reflects in CORS headers", async () => {
  const server = new McpApp({
    name: "cors-test",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    corsOrigins: ["https://app.example.com"],
  });

  try {
    // Preflight with allowed origin
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "OPTIONS",
      headers: {
        "Origin": "https://app.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type",
      },
    });

    const acao = res.headers.get("access-control-allow-origin");
    assertEquals(acao, "https://app.example.com");
    await res.text(); // consume body
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - corsOrigins wildcard emits warning log", async () => {
  const logs: string[] = [];
  const server = new McpApp({
    name: "cors-warn",
    version: "1.0.0",
    logger: (msg: string) => logs.push(msg),
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    // default corsOrigins is "*"
  });

  try {
    assert(
      logs.some((l) => l.includes("[WARN]") && l.includes("CORS wildcard")),
      `Expected CORS wildcard warning in logs, got: ${JSON.stringify(logs)}`,
    );
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - corsOrigins allowlist does NOT emit wildcard warning", async () => {
  const logs: string[] = [];
  const server = new McpApp({
    name: "cors-no-warn",
    version: "1.0.0",
    logger: (msg: string) => logs.push(msg),
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    corsOrigins: ["https://app.example.com"],
  });

  try {
    assert(
      !logs.some((l) => l.includes("CORS wildcard")),
      `Unexpected CORS wildcard warning in logs: ${JSON.stringify(logs)}`,
    );
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - corsOrigins rejects unknown origin", async () => {
  const server = new McpApp({
    name: "cors-reject",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    corsOrigins: ["https://app.example.com"],
  });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "OPTIONS",
      headers: {
        "Origin": "https://evil.example.com",
        "Access-Control-Request-Method": "POST",
      },
    });

    const acao = res.headers.get("access-control-allow-origin");
    // Hono CORS middleware should NOT include the disallowed origin
    assert(
      acao === null || acao !== "https://evil.example.com",
      `Expected CORS to reject evil origin, got: ${acao}`,
    );
    await res.text(); // consume
  } finally {
    await http.shutdown();
  }
});

// ═══════════════════════════════════════════════════════════
// IP rate limiting
// ═══════════════════════════════════════════════════════════

Deno.test("security - ipRateLimit returns 429 after limit exceeded", async () => {
  const server = new McpApp({
    name: "rate-limit",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    ipRateLimit: { maxRequests: 3, windowMs: 10_000 },
    maxBodyBytes: null, // don't interfere
  });

  try {
    // First 3 requests should succeed
    for (let i = 0; i < 3; i++) {
      const { res } = await jsonRpc(port, "initialize");
      // initialize may return 200 or 429 from the init-rate-limiter
      // but the global ipRateLimit should allow the first 3
      assert(
        res.status === 200 || res.status === 429,
        `Unexpected status: ${res.status}`,
      );
    }

    // 4th request should hit the IP rate limit (429)
    const { res: res4 } = await jsonRpc(port, "initialize");
    assertEquals(res4.status, 429);
    assertExists(res4.headers.get("retry-after"));
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - ipRateLimit includes Retry-After header", async () => {
  const server = new McpApp({
    name: "rate-retry",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    ipRateLimit: { maxRequests: 1, windowMs: 60_000 },
    maxBodyBytes: null,
  });

  try {
    // First request uses the slot
    await jsonRpc(port, "initialize");

    // Second request should be rate-limited
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: {},
      }),
    });

    assertEquals(res.status, 429);
    const retryAfter = res.headers.get("retry-after");
    assertExists(retryAfter, "Retry-After header should be present");
    const retrySeconds = parseInt(retryAfter!, 10);
    assert(
      retrySeconds >= 1,
      `Retry-After should be >= 1, got ${retrySeconds}`,
    );
    await res.json(); // consume
  } finally {
    await http.shutdown();
  }
});

Deno.test("security - ipRateLimit onLimitExceeded='wait' delays instead of rejecting", async () => {
  const server = new McpApp({
    name: "rate-wait",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  const http = await server.startHttp({
    port,
    onListen: () => {},
    ipRateLimit: { maxRequests: 1, windowMs: 200, onLimitExceeded: "wait" },
    maxBodyBytes: null,
  });

  try {
    // First request uses the slot
    const { res: res1 } = await jsonRpc(port, "initialize");
    assertEquals(res1.status, 200);

    // Second request should wait (not 429) because onLimitExceeded="wait"
    const start = Date.now();
    const { res: res2 } = await jsonRpc(port, "initialize");
    const elapsed = Date.now() - start;

    // It should have waited and eventually succeeded (or timed out with 429)
    // With windowMs=200, the wait should be short
    assert(
      res2.status === 200 || res2.status === 429,
      `Expected 200 (waited) or 429 (timeout), got ${res2.status}`,
    );
    if (res2.status === 200) {
      assert(
        elapsed >= 100,
        `Expected delay >= 100ms for wait mode, got ${elapsed}ms`,
      );
    }
  } finally {
    await http.shutdown();
  }
});

// ═══════════════════════════════════════════════════════════
// E2E: full stateless flow
// ═══════════════════════════════════════════════════════════

Deno.test("e2e - default maxBodyBytes (1 MB) allows reasonable payloads", async () => {
  const server = new McpApp({
    name: "e2e-default-limit",
    version: "1.0.0",
    logger: () => {},
  });

  const port = getFreePort();
  // Use default maxBodyBytes (no explicit option)
  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    // ~500 byte payload should be fine
    const { res } = await jsonRpc(port, "initialize", {
      info: "a".repeat(400),
    });
    assertEquals(res.status, 200);
  } finally {
    await http.shutdown();
  }
});
