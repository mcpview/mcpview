/**
 * Track C — request-metadata validation over the wire.
 *
 * `request-headers_test.ts` asserts the rules in isolation; this file asserts
 * that the transport actually applies them, with the status code and JSON-RPC
 * error a client really receives. A correct validator wired to the wrong branch
 * passes the unit tests and fails here.
 *
 * @module lib/server/transport/header-validation-http_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { McpApp } from "../mcp-app.ts";
import { encodeHeaderValue } from "./request-headers.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
// Required on every request in the final spec, unlike clientInfo.
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";
const V = "2026-07-28";

function buildServer() {
  const server = new McpApp({
    name: "header-validation-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerTools(
    [
      { name: "echo", description: "Echo", inputSchema: { type: "object" } },
      {
        name: "execute_sql",
        description: "Runs SQL in a region",
        inputSchema: {
          type: "object",
          properties: {
            region: { type: "string", "x-mcp-header": "Region" },
            query: { type: "string" },
          },
          required: ["region", "query"],
        },
      },
    ],
    new Map([
      ["echo", () => "pong"],
      ["execute_sql", () => "rows"],
    ]),
  );
  return server;
}

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

function post(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const listBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/list",
  params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
};

Deno.test("track C - a missing Mcp-Method is rejected with 400 / -32020", async () => {
  const { http, url } = await start(buildServer());
  try {
    const res = await post(url, { "MCP-Protocol-Version": V }, listBody);
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32020);
    assertStringIncludes(data.error.message, "Mcp-Method");
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - a missing MCP-Protocol-Version header is rejected", async () => {
  // 0.21.0 accepted this: the header was validated "tolerantly", only when
  // present. The final spec makes it required on every POST.
  const { http, url } = await start(buildServer());
  try {
    const res = await post(url, { "Mcp-Method": "tools/list" }, listBody);
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32020);
    assertStringIncludes(data.error.message, "MCP-Protocol-Version");
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - Mcp-Method disagreeing with the body is rejected", async () => {
  // The attack this closes: a gateway routes or meters on the header while the
  // server executes the body. They must never be allowed to disagree.
  const { http, url } = await start(buildServer());
  try {
    const res = await post(
      url,
      { "MCP-Protocol-Version": V, "Mcp-Method": "resources/list" },
      listBody,
    );
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32020);
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - tools/call requires an Mcp-Name matching params.name", async () => {
  const { http, url } = await start(buildServer());
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "echo",
      arguments: {},
      _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} },
    },
  };
  try {
    const missing = await post(
      url,
      { "MCP-Protocol-Version": V, "Mcp-Method": "tools/call" },
      body,
    );
    assertEquals(missing.status, 400);
    assertEquals((await missing.json()).error.code, -32020);

    const wrong = await post(url, {
      "MCP-Protocol-Version": V,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "not_echo",
    }, body);
    assertEquals(wrong.status, 400);
    assertEquals((await wrong.json()).error.code, -32020);

    const right = await post(url, {
      "MCP-Protocol-Version": V,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "echo",
    }, body);
    assertEquals(right.status, 200);
    assertEquals((await right.json()).result.resultType, "complete");
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - an x-mcp-header parameter must be mirrored into Mcp-Param-*", async () => {
  const { http, url } = await start(buildServer());
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "execute_sql",
      arguments: { region: "us-west1", query: "SELECT 1" },
      _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} },
    },
  };
  const base = {
    "MCP-Protocol-Version": V,
    "Mcp-Method": "tools/call",
    "Mcp-Name": "execute_sql",
  };
  try {
    const missing = await post(url, base, body);
    assertEquals(missing.status, 400);
    assertStringIncludes(
      (await missing.json()).error.message,
      "Mcp-Param-Region",
    );

    const mismatched = await post(
      url,
      { ...base, "Mcp-Param-Region": "eu-west1" },
      body,
    );
    assertEquals(mismatched.status, 400);

    const good = await post(
      url,
      { ...base, "Mcp-Param-Region": "us-west1" },
      body,
    );
    assertEquals(good.status, 200);
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - a sentinel-encoded Mcp-Name is decoded before comparison", async () => {
  const server = new McpApp({
    name: "header-sentinel-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  const uri = "ui://rapports/%C3%A9t%C3%A9/synth%C3%A8se";
  server.registerResource(
    { uri, name: "accented", mimeType: "text/plain" },
    () => ({ uri, mimeType: "text/plain", text: "ok" }),
  );
  const { http, url } = await start(server);
  try {
    const res = await post(url, {
      "MCP-Protocol-Version": V,
      "Mcp-Method": "resources/read",
      "Mcp-Name": encodeHeaderValue(uri),
    }, {
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: { uri, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
    });
    assertEquals(res.status, 200);
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - notifications are exempt from the header contract", async () => {
  // The revision explicitly leaves header requirements for notification POSTs
  // undefined, so a missing Mcp-Method there is not a violation to invent.
  const { http, url } = await start(buildServer());
  try {
    const res = await post(url, { "MCP-Protocol-Version": V }, {
      jsonrpc: "2.0",
      method: "notifications/something",
      params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
    });
    assertEquals(res.status, 202);
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - list and read results carry the required cache fields", async () => {
  const server = new McpApp({
    name: "cache-fields-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    cache: { ttlMs: 300_000, scope: "public" },
  });
  server.registerResource(
    { uri: "ui://cache/probe", name: "probe", mimeType: "text/plain" },
    () => ({ uri: "ui://cache/probe", mimeType: "text/plain", text: "x" }),
  );
  const { http, url } = await start(server);
  try {
    for (
      const [method, params] of [
        ["tools/list", {}],
        ["resources/list", {}],
        ["prompts/list", {}],
        ["resources/read", { uri: "ui://cache/probe" }],
      ] as Array<[string, Record<string, unknown>]>
    ) {
      const name = method === "resources/read" ? params.uri : undefined;
      const res = await post(url, {
        "MCP-Protocol-Version": V,
        "Mcp-Method": method,
        ...(typeof name === "string" ? { "Mcp-Name": name } : {}),
      }, {
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { ...params, _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
      });
      const data = await res.json();
      assertEquals(data.result.ttlMs, 300_000, `${method} ttlMs`);
      assertEquals(data.result.cacheScope, "public", `${method} cacheScope`);
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - cache defaults are inert, not invented", async () => {
  // ttlMs 0 means "revalidate every time" and cacheScope "private" keeps shared
  // intermediaries out. A framework must not pick a staleness window, nor allow
  // caching of possibly per-tenant results, on a consumer's behalf.
  const { http, url } = await start(buildServer());
  try {
    const res = await post(
      url,
      { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" },
      listBody,
    );
    const data = await res.json();
    assertEquals(data.result.ttlMs, 0);
    assertEquals(data.result.cacheScope, "private");
  } finally {
    await http.shutdown();
  }
});

Deno.test("track C - tools/list is ordered deterministically", async () => {
  // Registered deliberately out of order: the response must not depend on it.
  const server = new McpApp({
    name: "ordering-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerTools(
    [
      { name: "zeta", description: "z", inputSchema: { type: "object" } },
      { name: "alpha", description: "a", inputSchema: { type: "object" } },
      { name: "mid", description: "m", inputSchema: { type: "object" } },
    ],
    new Map([
      ["zeta", () => "z"],
      ["alpha", () => "a"],
      ["mid", () => "m"],
    ]),
  );
  const { http, url } = await start(server);
  try {
    const res = await post(
      url,
      { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" },
      listBody,
    );
    const data = await res.json();
    assertEquals(
      (data.result.tools as Array<{ name: string }>).map((t) => t.name),
      ["alpha", "mid", "zeta"],
    );
  } finally {
    await http.shutdown();
  }
});

// Synchronous: registration throws before any server is started.
Deno.test("track C - a malformed x-mcp-header annotation fails at registration", () => {
  // A conforming client drops the whole tool from tools/list over this, so a
  // typo would otherwise present as a tool that silently does not exist.
  const server = new McpApp({
    name: "bad-annotation-test",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  let threw = false;
  try {
    server.registerTools(
      [{
        name: "bad",
        description: "Invalid annotation",
        inputSchema: {
          type: "object",
          properties: { ratio: { type: "number", "x-mcp-header": "Ratio" } },
        },
      }],
      new Map([["bad", () => "x"]]),
    );
  } catch (error) {
    threw = true;
    assertStringIncludes(String(error), "x-mcp-header");
  }
  assertEquals(threw, true, "registration should reject a number-typed mirror");
});

// ── Regressions found by adversarial review ─────────────────────────────────
// Each of these shipped as a hole in the first Track C implementation. They are
// kept as named tests so the specific mistake cannot come back.

Deno.test("regression - server/discover carries cache fields too", () => {
  // The changelog summarised five list/read methods; the caching page also lists
  // server/discover. Trusting the summary left it uncovered.
  return (async () => {
    const server = new McpApp({
      name: "discover-cache-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
      cache: { ttlMs: 60_000, scope: "public" },
    });
    const { http, url } = await start(server);
    try {
      const res = await post(
        url,
        { "MCP-Protocol-Version": V, "Mcp-Method": "server/discover" },
        {
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
        },
      );
      const data = await res.json();
      assertEquals(data.result.ttlMs, 60_000);
      assertEquals(data.result.cacheScope, "public");
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("regression - an annotated tool registered via registerTool is enforced", () => {
  // Annotation collection was wired into registerTools (plural) only, so a tool
  // registered through the singular path advertised Mcp-Param-* to clients while
  // the server never required or checked it.
  return (async () => {
    const server = new McpApp({
      name: "single-register-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    server.registerTool(
      {
        name: "single",
        description: "Registered singly",
        inputSchema: {
          type: "object",
          properties: {
            region: { type: "string", "x-mcp-header": "Region" },
          },
        },
      },
      () => "ok",
    );
    const { http, url } = await start(server);
    try {
      const res = await post(url, {
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "single",
      }, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "single",
          arguments: { region: "eu-west1" },
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} },
        },
      });
      assertEquals(
        res.status,
        400,
        "missing Mcp-Param-Region must be rejected",
      );
      assertEquals((await res.json()).error.code, -32020);
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("regression - id 0 is a request, not a notification", () => {
  // `!id` treated the valid id 0 as a notification, so an unknown method with
  // id 0 answered 202 instead of 404 / -32601.
  return (async () => {
    const { http, url } = await start(buildServer());
    try {
      const res = await post(
        url,
        { "MCP-Protocol-Version": V, "Mcp-Method": "nonsense/rpc" },
        {
          jsonrpc: "2.0",
          id: 0,
          method: "nonsense/rpc",
          params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
        },
      );
      assertEquals(res.status, 404);
      const data = await res.json();
      assertEquals(data.error.code, -32601);
      assertEquals(data.id, 0);
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("regression - CORS advertises the headers the server now requires", () => {
  // Omitting them broke browser clients before the request ever reached us: the
  // preflight rejects it, so a conforming client cannot send what we demand.
  return (async () => {
    const server = new McpApp({
      name: "cors-headers-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
    });
    server.registerTool(
      {
        name: "with_header",
        description: "Mirrors a param",
        inputSchema: {
          type: "object",
          properties: { region: { type: "string", "x-mcp-header": "Region" } },
        },
      },
      () => "ok",
    );
    const { http, url } = await start(server);
    try {
      const res = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "mcp-method",
        },
      });
      await res.text();
      const allowed = (res.headers.get("access-control-allow-headers") ?? "")
        .toLowerCase();
      for (const required of ["mcp-method", "mcp-name", "mcp-param-region"]) {
        assertEquals(
          allowed.includes(required),
          true,
          `${required} must be allowed by CORS (got: ${allowed})`,
        );
      }
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("regression - a negative or fractional ttlMs is refused at construction", () => {
  // The spec requires ttlMs >= 0 and tells clients to IGNORE a negative value,
  // so accepting one would silently disable caching instead of failing.
  for (const bad of [-1, 1.5, -0.001]) {
    let threw = false;
    try {
      new McpApp({
        name: "bad-ttl",
        version: "1.0.0",
        logger: () => {},
        transport: "stateless",
        cache: { ttlMs: bad },
      });
    } catch {
      threw = true;
    }
    assertEquals(threw, true, `ttlMs ${bad} must be refused`);
  }
});

Deno.test("regression - an MRTR-retry result is not marked cacheable", () => {
  // The caching spec: results from a request carrying inputResponses or
  // requestState MUST NOT be cached, because they depend on inputs that are not
  // part of the cache key. A cache would serve this result for a later request
  // that supplied different input.
  return (async () => {
    const server = new McpApp({
      name: "mrtr-cache-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
      cache: { ttlMs: 60_000, scope: "public" },
    });
    server.registerResource(
      { uri: "ui://cache/mrtr", name: "probe", mimeType: "text/plain" },
      () => ({ uri: "ui://cache/mrtr", mimeType: "text/plain", text: "x" }),
    );
    const { http, url } = await start(server);
    const headers = {
      "MCP-Protocol-Version": V,
      "Mcp-Method": "resources/read",
      "Mcp-Name": "ui://cache/mrtr",
    };
    const body = (extra: Record<string, unknown>) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: {
        uri: "ui://cache/mrtr",
        ...extra,
        _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} },
      },
    });
    try {
      // Ordinary read: cacheable.
      const plain = await (await post(url, headers, body({}))).json();
      assertEquals(plain.result.ttlMs, 60_000);

      // Same read, but carrying MRTR retry fields: hints must be withheld.
      const retry = await (await post(
        url,
        headers,
        body({ requestState: "opaque", inputResponses: {} }),
      )).json();
      assertEquals(retry.result.ttlMs, undefined);
      assertEquals(retry.result.cacheScope, undefined);
    } finally {
      await http.shutdown();
    }
  })();
});

// ── AX: errors must be actionable as data, not as prose ─────────────────────

Deno.test("AX - every header rejection carries a machine-readable recovery path", () => {
  // Principle: an agent fixes the request from `data`, never by parsing the
  // English message. Each case asserts the enum, the offending header, and that a
  // concrete recovery instruction is present.
  return (async () => {
    const { http, url } = await start(buildServer());
    const V_BODY = { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } };

    const cases: Array<{
      name: string;
      headers: Record<string, string>;
      body: Record<string, unknown>;
      problem: string;
      header: string;
    }> = [
      {
        name: "missing Mcp-Method",
        headers: { "MCP-Protocol-Version": V },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: V_BODY },
        problem: "missing_header",
        header: "Mcp-Method",
      },
      {
        name: "missing MCP-Protocol-Version",
        headers: { "Mcp-Method": "tools/list" },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: V_BODY },
        problem: "missing_header",
        header: "MCP-Protocol-Version",
      },
      {
        name: "Mcp-Method disagrees with the body",
        headers: { "MCP-Protocol-Version": V, "Mcp-Method": "resources/list" },
        body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: V_BODY },
        problem: "header_body_mismatch",
        header: "Mcp-Method",
      },
      {
        name: "missing Mcp-Name on tools/call",
        headers: { "MCP-Protocol-Version": V, "Mcp-Method": "tools/call" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "echo", arguments: {}, ...V_BODY },
        },
        problem: "missing_header",
        header: "Mcp-Name",
      },
      {
        name: "missing Mcp-Param for an annotated argument",
        headers: {
          "MCP-Protocol-Version": V,
          "Mcp-Method": "tools/call",
          "Mcp-Name": "execute_sql",
        },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "execute_sql",
            arguments: { region: "us-west1", query: "SELECT 1" },
            ...V_BODY,
          },
        },
        problem: "missing_header",
        header: "Mcp-Param-Region",
      },
    ];

    try {
      for (const c of cases) {
        const res = await post(url, c.headers, c.body);
        const data = await res.json();

        assertEquals(res.status, 400, c.name);
        assertEquals(data.error.code, -32020, c.name);
        assertEquals(data.error.data.problem, c.problem, c.name);
        assertEquals(data.error.data.header, c.header, c.name);
        // A recovery string that is present but empty would be worse than none:
        // it looks actionable and is not.
        assertEquals(
          typeof data.error.data.recovery === "string" &&
            data.error.data.recovery.length > 10,
          true,
          `${c.name}: recovery must be a concrete instruction`,
        );
      }
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("AX - a mismatch reports both what was expected and what arrived", () => {
  // Without both sides an agent cannot tell which end to change.
  return (async () => {
    const { http, url } = await start(buildServer());
    try {
      const res = await post(url, {
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "wrong_tool",
      }, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {},
          _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} },
        },
      });
      const { error } = await res.json();
      assertEquals(error.data.problem, "header_body_mismatch");
      assertEquals(error.data.expected, "echo");
      assertEquals(error.data.received, "wrong_tool");
      assertEquals(error.data.bodyField, "params.name");
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("AX - a malformed mrtr.signingKey fails at construction, not on first use", () => {
  // Principle: validate at the boundary. A typo in a 64-hex secret must not wait
  // for the first request that needs it, which would make it a production runtime
  // failure instead of a boot failure.
  for (const bad of ["tooshort", "A".repeat(64), "z".repeat(64), ""]) {
    let threw = false;
    try {
      new McpApp({
        name: "bad-key",
        version: "1.0.0",
        logger: () => {},
        transport: "stateless",
        mrtr: { signingKey: bad },
      });
    } catch (error) {
      threw = true;
      assertStringIncludes(String(error), "64 lowercase hex");
    }
    assertEquals(
      threw,
      true,
      `signingKey ${JSON.stringify(bad)} must be refused`,
    );
  }
});

Deno.test("AX - a malformed clientCapabilities is rejected at ingress, not deep in a handler", () => {
  // `!== undefined` accepted null, a scalar or an array, which then reached the
  // handler as a supposed ClientCapabilities and failed later as -32603 — an
  // internal error for what is plainly a malformed request.
  return (async () => {
    const { http, url } = await start(buildServer());
    try {
      for (const bad of [null, "caps", 42, ["elicitation"]]) {
        const res = await post(
          url,
          { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" },
          {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: bad } },
          },
        );
        const data = await res.json();
        assertEquals(res.status, 400, `${JSON.stringify(bad)} must be refused`);
        assertEquals(data.error.code, -32602);
        assertEquals(data.error.data.problem, "missing_field");
      }

      // `{}` is valid: it declares no capabilities.
      const empty = await post(
        url,
        { "MCP-Protocol-Version": V, "Mcp-Method": "tools/list" },
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: { _meta: { [PROTO_KEY]: V, [CAPS_KEY]: {} } },
        },
      );
      assertEquals(empty.status, 200);
      await empty.json();
    } finally {
      await http.shutdown();
    }
  })();
});

Deno.test("round4 - post-negotiation error responses carry MCP-Protocol-Version even with CORS off", () => {
  // A raw Response does not inherit headers set on the Hono context, so each error
  // path had to carry the header itself. The default CORS config masked the
  // omission: a browser never sees it, and a proxy routing on the header does.
  return (async () => {
    const server = new McpApp({
      name: "header-echo-test",
      version: "1.0.0",
      logger: () => {},
      transport: "stateless",
      extensions: { "io.modelcontextprotocol/tasks": {} },
    });
    const listener = Deno.listen({ port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    // CORS explicitly off, which is what exposed this.
    const http = await server.startHttp({
      port,
      cors: false,
      onListen: () => {},
    });
    const url = `http://localhost:${port}/mcp`;
    try {
      // A tasks/get for an unknown id: reached only after negotiation.
      const res = await post(url, {
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "nope",
      }, {
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {
          taskId: "nope",
          _meta: {
            [PROTO_KEY]: V,
            [CAPS_KEY]: {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          },
        },
      });
      await res.json();
      assertEquals(res.headers.get("mcp-protocol-version"), V);
    } finally {
      await http.shutdown();
    }
  })();
});
