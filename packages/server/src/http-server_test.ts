/**
 * Tests for HTTP server support (startHttp)
 *
 * @module lib/server/http-server_test
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { McpApp } from "./mcp-app.ts";
import { MCP_APP_MIME_TYPE } from "./types.ts";

// ── Track A — Stateless transport (transport: "stateless") ──────────────────
// Spec 2026-07-28: protocolVersion is carried via the namespaced key
// "io.modelcontextprotocol/protocolVersion" in params._meta (not at the top level
// of JSON-RPC params). The server echoes the negotiated version in the
// MCP-Protocol-Version response header.

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

Deno.test(
  "transport stateless - initialize responds without Mcp-Session-Id and negotiates protocolVersion",
  async () => {
    const server = new McpApp({
      name: "stateless-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

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
          "Mcp-Method": "initialize",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      assertEquals(res.status, 200);
      // Stateless mode: no session header emitted
      assertEquals(res.headers.get("mcp-session-id"), null);
      // Spec: negotiated version echoed in MCP-Protocol-Version header
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
      const data = await res.json();
      // protocolVersion echoes client's requested version (negotiated)
      assertEquals(data.result.protocolVersion, "2026-07-28");
      assertEquals(data.result.serverInfo.name, "stateless-test");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - matching MCP-Protocol-Version header succeeds",
  async () => {
    const server = new McpApp({
      name: "stateless-header-match-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

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
          "Mcp-Method": "initialize",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      assertEquals(res.status, 200);
      assertEquals(res.headers.get("mcp-session-id"), null);
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
      const data = await res.json();
      assertEquals(data.result.protocolVersion, "2026-07-28");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - mismatched MCP-Protocol-Version header returns -32020 (HeaderMismatch)",
  async () => {
    const server = new McpApp({
      name: "stateless-header-mismatch-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 400);
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
      // Spec 2026-07-28 renumbered HeaderMismatch from the RC's -32001 to -32020,
      // and it supersedes InvalidParams here: the body is well-formed, it is the
      // header that disagrees with it.
      assertEquals(data.error.code, -32020);
      assertEquals(
        data.error.message,
        'MCP-Protocol-Version header "2025-11-25" does not match _meta protocolVersion "2026-07-28"',
      );
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - absent MCP-Protocol-Version header is rejected (required by spec)",
  async () => {
    const server = new McpApp({
      name: "stateless-header-absent-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      // Valid 2026-07-28 body with capabilities but NO MCP-Protocol-Version header.
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: {
            _meta: {
              [PROTO_KEY]: "2026-07-28",
              [CLIENT_CAPABILITIES_KEY]: {},
            },
          },
        }),
      });

      // The header is required for every request: its absence is -32020.
      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32020);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - server/discover returns server metadata",
  async () => {
    const server = new McpApp({
      name: "stateless-discover-test",
      version: "1.2.3",
      logger: () => {},
      transport: "stateless",
    });

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
          "Mcp-Method": "server/discover",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "server/discover",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
      assertExists(data.result);
      assertEquals(data.result.supportedVersions.includes("2026-07-28"), true);
      assertEquals(data.result.serverInfo.name, "stateless-discover-test");
      assertEquals(data.result.serverInfo.version, "1.2.3");
      assertExists(data.result.capabilities);
      assertEquals(data.result.capabilities.tools, {});
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - server/discover without version returns -32602",
  async () => {
    const server = new McpApp({
      name: "stateless-discover-noversion-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 5,
          method: "server/discover",
          params: {},
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 400);
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - server/discover includes instructions when configured",
  async () => {
    const server = new McpApp({
      name: "stateless-discover-instructions-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
      instructions: "Prefer concise responses.",
    });

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
          "Mcp-Method": "server/discover",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 6,
          method: "server/discover",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 200);
      assertExists(data.result);
      assertEquals(data.result.instructions, "Prefer concise responses.");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - tools/list works without prior handshake",
  async () => {
    const server = new McpApp({
      name: "stateless-tools-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    server.registerTool(
      { name: "ping", description: "Ping", inputSchema: { type: "object" } },
      () => "pong",
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
          "Mcp-Method": "tools/list",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      assertEquals(res.status, 200);
      assertEquals(res.headers.get("mcp-session-id"), null);
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
      const data = await res.json();
      assertEquals(data.result.tools.length, 1);
      assertEquals(data.result.tools[0].name, "ping");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - tools/call exposes clientInfo and clientCapabilities to handler",
  async () => {
    const server = new McpApp({
      name: "stateless-client-meta-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const clientInfo = { name: "sep-client", version: "2.3.4" };
    const clientCapabilities = {
      roots: { listChanged: true },
      sampling: {},
      experimental: { "casys.test": true },
    };
    let capturedClientInfo: unknown;
    let capturedClientCapabilities: unknown;

    server.registerTool(
      {
        name: "capture-client-meta",
        description: "Capture client metadata",
        inputSchema: { type: "object" },
      },
      (_args, ctx) => {
        capturedClientInfo = ctx?.clientInfo;
        capturedClientCapabilities = ctx?.clientCapabilities;
        return "captured";
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
          "Mcp-Name": "capture-client-meta",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            _meta: {
              [PROTO_KEY]: "2026-07-28",
              [CLIENT_INFO_KEY]: clientInfo,
              [CLIENT_CAPABILITIES_KEY]: clientCapabilities,
            },
            name: "capture-client-meta",
            arguments: {},
          },
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 200);
      assertEquals(data.result.content[0].text, "captured");
      assertEquals(capturedClientInfo, clientInfo);
      assertEquals(capturedClientCapabilities, clientCapabilities);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - tools/call tolerates absent clientInfo (but not absent clientCapabilities)",
  async () => {
    const server = new McpApp({
      name: "stateless-client-meta-absent-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    let capturedClientInfo: unknown = "not-called";
    let capturedClientCapabilities: unknown = "not-called";

    server.registerTool(
      {
        name: "capture-absent-client-meta",
        description: "Capture absent client metadata",
        inputSchema: { type: "object" },
      },
      (_args, ctx) => {
        capturedClientInfo = ctx?.clientInfo;
        capturedClientCapabilities = ctx?.clientCapabilities;
        return "ok";
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
          "Mcp-Name": "capture-absent-client-meta",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
            name: "capture-absent-client-meta",
            arguments: {},
          },
        }),
      });

      const data = await res.json();
      assertEquals(res.status, 200);
      assertEquals(data.result.content[0].text, "ok");
      // clientInfo is only SHOULD, so its absence must not fail the call.
      assertEquals(capturedClientInfo, undefined);
      // clientCapabilities IS required, so it reached the handler.
      assertEquals(capturedClientCapabilities, {});

      // Omitting it entirely is malformed: -32602 + 400 per the _meta rules.
      const missing = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "capture-absent-client-meta",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28" },
            name: "capture-absent-client-meta",
            arguments: {},
          },
        }),
      });
      const missingBody = await missing.json();
      assertEquals(missing.status, 400);
      assertEquals(missingBody.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - GET /mcp returns 405 even with SSE Accept header",
  async () => {
    const server = new McpApp({
      name: "stateless-sse-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        headers: { "Accept": "text/event-stream" },
      });

      assertEquals(res.status, 405);
      await res.text(); // Consume body to avoid leak
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - missing protocolVersion key returns -32602",
  async () => {
    const server = new McpApp({
      name: "stateless-noversion-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      // tools/list without protocolVersion key → must fail, not 200
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });

      // Machine-readable error, not a spurious 200
      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - _meta present but without version key returns -32602",
  async () => {
    const server = new McpApp({
      name: "stateless-meta-nokey-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      // _meta object present but the namespaced key is absent → must fail -32602
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: {} }, // _meta exists but key missing
        }),
      });
      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - unsupported protocolVersion returns -32022 (UnsupportedProtocolVersion)",
  async () => {
    const server = new McpApp({
      name: "stateless-badversion-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            _meta: { [PROTO_KEY]: "1999-01-01" }, // unknown version
            name: "anything",
            arguments: {},
          },
        }),
      });

      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32022);
      assertEquals(data.id, 2);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - Mcp-Session-Id request header is ignored (no session bypass)",
  async () => {
    const server = new McpApp({
      name: "stateless-nossid-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      // Sending a fake Mcp-Session-Id must not cause a 404 or session lookup
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/list",
          "Mcp-Session-Id": "fake-session-id-that-does-not-exist",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });

      // Must succeed — session header is silently ignored in stateless mode
      assertEquals(res.status, 200);
      // And must NOT echo a Mcp-Session-Id in the response
      assertEquals(res.headers.get("mcp-session-id"), null);
      const data = await res.json();
      assertExists(data.result.tools);
    } finally {
      await http.shutdown();
    }
  },
);

// ── Track A corrections (post-Codex review) ─────────────────────────────────

Deno.test(
  "transport stateless - -32022 error carries MCP-Protocol-Version header",
  async () => {
    const server = new McpApp({
      name: "stateless-errheader-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [PROTO_KEY]: "9999-99-99" } }, // unsupported
        }),
      });
      assertEquals(res.status, 400);
      // Error responses must ALSO carry the header (server's fallback version)
      assertExists(res.headers.get("mcp-protocol-version"));
      const data = await res.json();
      assertEquals(data.error.code, -32022);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - -32602 error carries MCP-Protocol-Version header",
  async () => {
    const server = new McpApp({
      name: "stateless-errheader2-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {}, // missing protocolVersion
        }),
      });
      assertEquals(res.status, 400);
      assertExists(res.headers.get("mcp-protocol-version"));
      const data = await res.json();
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - -32022 error body carries data.supported and data.requested (AX)",
  async () => {
    const server = new McpApp({
      name: "stateless-errdata-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/list",
          params: { _meta: { [PROTO_KEY]: "0000-01-01" } },
        }),
      });
      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32022);
      assertEquals(data.id, 3);
      // Machine-readable: client knows what's supported and what it sent
      assertExists(data.error.data);
      assertEquals(data.error.data.requested, "0000-01-01");
      assertExists(data.error.data.supported);
      assertEquals(Array.isArray(data.error.data.supported), true);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - rate-limit keyExtractor cannot see Mcp-Session-Id header",
  async () => {
    // Scenario: a keyExtractor tries to use Mcp-Session-Id as the rate-limit key.
    // If the header reaches the context, rotating session IDs bypasses the limit.
    // In stateless mode the header must be stripped from the rate-limit context.
    const server = new McpApp({
      name: "stateless-rl-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();

    const http = await server.startHttp({
      port,
      onListen: () => {},
      ipRateLimit: {
        maxRequests: 1,
        windowMs: 60_000,
        // Attacker's keyExtractor: keyed on session header, bypasses IP limit if header leaks
        keyExtractor: (ctx) => ctx.headers.get("mcp-session-id") ?? ctx.ip,
      },
    });

    try {
      // First request with session-A
      const r1 = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "session-A",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });
      await r1.json(); // consume

      // Second request with a DIFFERENT session-B
      // Without the fix: different key → 200 (bypass!)
      // With the fix: mcp-session-id stripped → same IP key → 429
      const r2 = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "session-B",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });
      const d2 = await r2.json();
      // Must be rate-limited (header was stripped → both requests keyed on IP)
      assertEquals(r2.status, 429);
      assertEquals(d2.error.code, -32000);
    } finally {
      await http.shutdown();
    }
  },
);

// ── Track A coverage: version validation is not bypassable ────────────────────

Deno.test(
  "transport stateless - resources/read validates version per-request",
  async () => {
    const server = new McpApp({
      name: "stateless-res-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    server.registerResource(
      { uri: "ui://test/page", name: "Page" },
      () => ({
        uri: "ui://test/page",
        mimeType: MCP_APP_MIME_TYPE,
        text: "<h1>ok</h1>",
      }),
    );

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      // Scenario A: with valid version key → 200, MCP-Protocol-Version header present
      const r1 = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "resources/read",
          "Mcp-Name": "ui://test/page",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
            uri: "ui://test/page",
          },
        }),
      });
      const d1 = await r1.json(); // consume body first
      assertEquals(r1.status, 200);
      assertEquals(r1.headers.get("mcp-protocol-version"), "2026-07-28");
      assertExists(d1.result.contents);

      // Scenario B: without version key → -32602 (no bypass)
      const r2 = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "resources/read",
          params: { uri: "ui://test/page" }, // NO protocolVersion
        }),
      });
      const d2 = await r2.json(); // consume body first
      assertEquals(r2.status, 400);
      assertEquals(d2.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - notification (no id) with version accepted as 202",
  async () => {
    const server = new McpApp({
      name: "stateless-notif-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          // no "id" — this is a notification
          method: "notifications/initialized",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });
      assertEquals(res.status, 202);
      await res.text(); // consume body
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - notification without version returns -32602 (no bypass)",
  async () => {
    const server = new McpApp({
      name: "stateless-notif-noversion-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {}, // missing version
        }),
      });
      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - batch (array body) blocked by version validation",
  async () => {
    const server = new McpApp({
      name: "stateless-batch-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      // Batch body = array — params would be undefined → -32602
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify([
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {
              _meta: {
                [PROTO_KEY]: "2026-07-28",
                [CLIENT_CAPABILITIES_KEY]: {},
              },
            },
          },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {
              _meta: {
                [PROTO_KEY]: "2026-07-28",
                [CLIENT_CAPABILITIES_KEY]: {},
              },
            },
          },
        ]),
      });
      // Batch lands in version validation path (params = undefined → -32602) or parse error
      // Key assertion: does NOT return a spurious 200 bypass
      assertStringIncludes(String(res.status), "4"); // 4xx
      await res.text();
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - ping returns 404 / -32601 (removed in spec 2026-07-28)",
  async () => {
    const server = new McpApp({
      name: "stateless-ping-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
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
          "Mcp-Method": "ping",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 99,
          method: "ping",
          params: {
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });
      const data = await res.json(); // consume first
      // 0.21.0 answered `{}` here for backward compatibility. The final spec
      // removed `ping` outright, and requires 404 + -32601 for an unimplemented
      // method — which is also the signal a client uses to tell a modern server
      // from a legacy HTTP+SSE one. Answering `{}` broke that probe.
      assertEquals(res.status, 404);
      assertEquals(data.error.code, -32601);
      // Falls through to the generic method-not-found branch rather than being
      // special-cased, so the message is the plain one. The status is what
      // carries the meaning here.
      assertStringIncludes(data.error.message, "Method not found: ping");
      // Version validation still ran first, so the header is echoed.
      assertEquals(res.headers.get("mcp-protocol-version"), "2026-07-28");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - logging/setLevel returns 404 / -32601 (removed in spec 2026-07-28)",
  async () => {
    const server = new McpApp({
      name: "stateless-setlevel-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
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
          "Mcp-Method": "logging/setLevel",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 100,
          method: "logging/setLevel",
          params: {
            level: "debug",
            _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          },
        }),
      });
      const data = await res.json();
      assertEquals(res.status, 404);
      assertEquals(data.error.code, -32601);
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - ping without version key returns -32602 (no bypass)",
  async () => {
    const server = new McpApp({
      name: "stateless-ping-noversion-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });
    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Present so the request reaches the version gate this test targets;
          // its absence is now a separate -32020 header failure.
          "MCP-Protocol-Version": "2026-07-28",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 100,
          method: "ping",
          params: {}, // NO protocolVersion key — must not bypass validation
        }),
      });
      const data = await res.json(); // consume first
      assertEquals(res.status, 400);
      assertEquals(data.error.code, -32602);
    } finally {
      await http.shutdown();
    }
  },
);

// ── End Track A corrections ──────────────────────────────────────────────────

Deno.test("startHttp - starts server and handles initialize", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {}, // Silence logs
    transport: "stateless",
  });

  // Find a free port
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
        "Mcp-Method": "initialize",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          _meta: {
            [PROTO_KEY]: "2026-07-28",
            [CLIENT_CAPABILITIES_KEY]: {},
          },
        },
      }),
    });

    assertEquals(res.status, 200);
    const data = await res.json();
    assertEquals(data.jsonrpc, "2.0");
    assertEquals(data.id, 1);
    assertEquals(data.result.serverInfo.name, "test-server");
    assertEquals(data.result.serverInfo.version, "1.0.0");
    assertExists(data.result.capabilities);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - requires auth when configured", async () => {
  const server = new McpApp({
    name: "auth-required-test",
    version: "1.0.0",
    logger: () => {},
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  await assertRejects(
    () => server.startHttp({ port, onListen: () => {}, requireAuth: true }),
    Error,
    "HTTP auth is required",
  );
});

Deno.test("startHttp - enforces maxBodyBytes", async () => {
  const server = new McpApp({
    name: "body-limit-test",
    version: "1.0.0",
    logger: () => {},
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({
    port,
    onListen: () => {},
    maxBodyBytes: 20,
  });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Present so the request reaches the version gate this test targets;
        // its absence is now a separate -32020 header failure.
        "MCP-Protocol-Version": "2026-07-28",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { padding: "this-payload-is-too-large" },
      }),
    });

    assertEquals(res.status, 413);
    const data = await res.json();
    assertEquals(data.error.code, -32000);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - handles tools/list", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    {
      name: "greet",
      description: "Greet someone",
      inputSchema: { type: "object" },
    },
    () => "Hello!",
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
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
        },
      }),
    });

    const data = await res.json();
    assertEquals(data.result.tools.length, 1);
    assertEquals(data.result.tools[0].name, "greet");
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - handles tools/call", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    {
      name: "add",
      description: "Add numbers",
      inputSchema: { type: "object" },
    },
    (args) => ({ sum: (args.a as number) + (args.b as number) }),
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
        "Mcp-Name": "add",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          name: "add",
          arguments: { a: 2, b: 3 },
        },
      }),
    });

    const data = await res.json();
    assertEquals(data.result.content[0].type, "text");
    const result = JSON.parse(data.result.content[0].text);
    assertEquals(result.sum, 5);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - passes execution context to tool handlers", async () => {
  const seen: Array<{ toolName?: string; hasRequest: boolean }> = [];
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerTool(
    {
      name: "context_echo",
      description: "Echo handler context",
      inputSchema: { type: "object" },
    },
    (_args, ctx) => {
      seen.push({
        toolName: ctx?.toolName,
        hasRequest: ctx?.request instanceof Request,
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
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          name: "context_echo",
          arguments: {},
        },
      }),
    });

    await res.json();
    assertEquals(seen, [{ toolName: "context_echo", hasRequest: true }]);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - handles resources/list", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  server.registerResource(
    {
      uri: "ui://test/viewer",
      name: "Test Viewer",
      description: "A test viewer",
    },
    () => ({
      uri: "ui://test/viewer",
      mimeType: MCP_APP_MIME_TYPE,
      text: "<html></html>",
    }),
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
        "Mcp-Method": "resources/list",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
        },
      }),
    });

    const data = await res.json();
    assertEquals(data.result.resources.length, 1);
    assertEquals(data.result.resources[0].uri, "ui://test/viewer");
    assertEquals(data.result.resources[0].mimeType, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - handles resources/read", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

  const htmlContent = "<html><body>Hello World</body></html>";
  server.registerResource(
    { uri: "ui://test/page", name: "Test Page" },
    () => ({
      uri: "ui://test/page",
      mimeType: MCP_APP_MIME_TYPE,
      text: htmlContent,
    }),
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
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://test/page",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          uri: "ui://test/page",
        },
      }),
    });

    const data = await res.json();
    assertEquals(data.result.contents.length, 1);
    assertEquals(data.result.contents[0].text, htmlContent);
    assertEquals(data.result.contents[0].mimeType, MCP_APP_MIME_TYPE);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - returns error for unknown resource", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });

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
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://unknown/resource",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          uri: "ui://unknown/resource",
        },
      }),
    });

    const data = await res.json();
    assertEquals(data.error.code, -32602);
    assertEquals(
      data.error.message,
      "Resource not found: ui://unknown/resource",
    );
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - health endpoint works", async () => {
  const server = new McpApp({
    name: "health-test",
    version: "2.0.0",
    logger: () => {},
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();
    assertEquals(data.status, "ok");
    assertEquals(data.server, "health-test");
    assertEquals(data.version, "2.0.0");
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - GET returns 405", async () => {
  const server = new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
  });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const http = await server.startHttp({ port, onListen: () => {} });

  try {
    const res = await fetch(`http://localhost:${port}/mcp`);
    assertEquals(res.status, 405);
    await res.text(); // Consume body to avoid leak
  } finally {
    await http.shutdown();
  }
});

// ── CSP meta tag injection (resourceCsp) ────────────────────────

Deno.test("startHttp - resources/read injects CSP meta tag when resourceCsp is set", async () => {
  const server = new McpApp({
    name: "csp-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    resourceCsp: { allowInline: true },
  });

  const htmlContent =
    "<html><head><title>App</title></head><body>Hello</body></html>";
  server.registerResource(
    { uri: "ui://test/csp-app", name: "CSP App" },
    () => ({
      uri: "ui://test/csp-app",
      mimeType: MCP_APP_MIME_TYPE,
      text: htmlContent,
    }),
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
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://test/csp-app",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          uri: "ui://test/csp-app",
        },
      }),
    });

    const data = await res.json();
    const returnedHtml = data.result.contents[0].text;

    // CSP meta tag should be injected after <head>
    assertStringIncludes(
      returnedHtml,
      '<meta http-equiv="Content-Security-Policy"',
    );
    assertStringIncludes(returnedHtml, "default-src 'none'");
    assertStringIncludes(returnedHtml, "script-src 'self' 'unsafe-inline'");
    // Original content should still be present
    assertStringIncludes(returnedHtml, "<title>App</title>");
    assertStringIncludes(returnedHtml, "<body>Hello</body>");
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - resources/read does NOT inject CSP when resourceCsp is not set", async () => {
  const server = new McpApp({
    name: "no-csp-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    // No resourceCsp option
  });

  const htmlContent =
    "<html><head><title>Plain</title></head><body>No CSP</body></html>";
  server.registerResource(
    { uri: "ui://test/plain", name: "Plain App" },
    () => ({
      uri: "ui://test/plain",
      mimeType: MCP_APP_MIME_TYPE,
      text: htmlContent,
    }),
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
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://test/plain",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          uri: "ui://test/plain",
        },
      }),
    });

    const data = await res.json();
    // HTML should be returned unchanged (no CSP injection)
    assertEquals(data.result.contents[0].text, htmlContent);
  } finally {
    await http.shutdown();
  }
});

Deno.test("startHttp - resources/read skips CSP injection for non-HTML resources", async () => {
  const server = new McpApp({
    name: "json-csp-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    resourceCsp: { allowInline: true }, // CSP enabled
  });

  const jsonContent = '{"data": "test"}';
  server.registerResource(
    {
      uri: "ui://test/json",
      name: "JSON Resource",
      mimeType: "application/json",
    },
    () => ({
      uri: "ui://test/json",
      mimeType: "application/json",
      text: jsonContent,
    }),
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
        "Mcp-Method": "resources/read",
        "Mcp-Name": "ui://test/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: {
          _meta: { [PROTO_KEY]: "2026-07-28", [CLIENT_CAPABILITIES_KEY]: {} },
          uri: "ui://test/json",
        },
      }),
    });

    const data = await res.json();
    // JSON content should NOT have CSP meta tag
    assertEquals(data.result.contents[0].text, jsonContent);
  } finally {
    await http.shutdown();
  }
});

Deno.test(
  "transport stateless - a missing MCP-Protocol-Version header is -32020, not -32602",
  async () => {
    // Spec, Server Validation: "Validation failure conditions include: A
    // required standard header (MCP-Protocol-Version, Mcp-Method, Mcp-Name) is
    // missing", answered with 400 + -32020 (HeaderMismatch).
    //
    // This is the shape a legacy client sends — neither the header nor the
    // `_meta` field. It previously got -32602 for the missing body field,
    // because the version gate ran first, pointing the client at the wrong fix.
    const server = new McpApp({
      name: "stateless-missing-header-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

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
          method: "tools/list",
          params: {},
        }),
      });

      assertEquals(res.status, 400);
      const data = await res.json();
      assertEquals(data.error.code, -32020);
      // The recovery has to name the header, or the client cannot act on it.
      assertEquals(data.error.data?.problem, "missing_header");
      assertEquals(data.error.data?.header, "MCP-Protocol-Version");
    } finally {
      await http.shutdown();
    }
  },
);

Deno.test(
  "transport stateless - DELETE on the MCP endpoint returns 405",
  async () => {
    // Spec, Backward Compatibility: a server supporting only this revision
    // "SHOULD" answer HTTP GET or DELETE to the MCP endpoint with 405. DELETE
    // was the session-termination verb in 2025-03-26..2025-11-25; 404 would
    // read to an older client as "no MCP endpoint here".
    const server = new McpApp({
      name: "stateless-delete-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });

    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    const http = await server.startHttp({ port, onListen: () => {} });

    try {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: "DELETE",
      });
      assertEquals(res.status, 405);
      await res.text();
    } finally {
      await http.shutdown();
    }
  },
);
