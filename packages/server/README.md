# @mcpview/server

[![npm](https://img.shields.io/npm/v/@mcpview/server)](https://www.npmjs.com/package/@mcpview/server)
[![JSR](https://jsr.io/badges/@mcpview/server)](https://jsr.io/@mcpview/server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The "Hono for MCP"** — a production-grade framework for building Model Context
Protocol servers in TypeScript.

Composable middleware, OAuth2 auth, dual transport, observability, and
everything you need to ship reliable MCP servers. Built on the official
[`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
and
[`@modelcontextprotocol/client`](https://www.npmjs.com/package/@modelcontextprotocol/client)
SDK v2 packages.

```
rate-limit → auth → custom middleware → scope-check → validation → backpressure → handler
```

---

## Why @mcpview/server?

The official SDK gives you the protocol. This framework gives you the production
stack.

|                             | Official SDK |        @mcpview/server         |
| --------------------------- | :----------: | :----------------------------: |
| MCP protocol compliance     |     Yes      |              Yes               |
| Concurrency control         |      --      |   3 backpressure strategies    |
| Middleware pipeline         |      --      |     Composable onion model     |
| OAuth2 / JWT auth           |      --      |   Built-in + 4 OIDC presets    |
| Rate limiting               |      --      |   Sliding window, per-client   |
| Schema validation           |      --      |       JSON Schema (ajv)        |
| Streamable HTTP (stateless) |    Manual    |    `startHttp()` / handler     |
| OpenTelemetry tracing       |      --      | Automatic spans per tool call  |
| Prometheus metrics          |      --      |      `/metrics` endpoint       |
| MCP Apps (UI resources)     |    Manual    | `registerResource()` + `ui://` |

---

## Install

```bash
# Deno (primary target — JSR)
deno add jsr:@mcpview/server

# Node (secondary — npm, native ESM build)
npm install @mcpview/server
```

> **Moved to the `@mcpview` scope in 0.29.0:** this framework was published as
> `@casys/mcp-server` (up to 0.27.x) and as `@casys/mcp-platform` (0.28.x). Both
> names continue as deprecated aliases that re-export this package unchanged, so
> existing imports keep working. Coming from either? See the
> [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## SDK v2 compatibility

Requires Node 20+ for npm consumers and Zod 4.2+ when supplying the MCP Apps
peer dependency. The framework uses `@modelcontextprotocol/server`, `client`,
and `core` (`^2.3.1`) and MCP Apps `^2.0.3`. Direct SDK type imports must use
these split packages instead of `@modelcontextprotocol/sdk`. In particular, pair
`OAuthClientProviderImpl` with transports from `@modelcontextprotocol/client`;
SDK v1 and v2 instances are not interchangeable. Stored OAuth tokens now carry
the SDK's issuer binding, and the provider retains discovery for the PKCE code
callback within its active authorization flow.

Tool handlers keep `handler(args, ctx)` and JSON Schema validation. HTTP remains
stateless: `POST /mcp` accepts protocol `2026-07-28`, while `GET /mcp`
returns 405. STDIO retains modern discovery and the legacy initialization
fallback. Tasks, subscriptions, and signed MRTR retries keep their existing
framework contracts.

## Which companion package should I use?

Start with `@mcpview/server` to build and operate an MCP server. Add a companion
only for the boundary it owns:

| Package                                                                                        | Use it when you need to...                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`@mcpview/compose`](https://github.com/mcpview/mcpview/tree/main/packages/compose)            | Compose and synchronize multiple MCP Apps in one dashboard.                       |
| [`@mcpview/bridge`](https://github.com/mcpview/mcpview/tree/main/packages/bridge)              | Bridge MCP Apps to external hosts or route selected calls to a private network.   |
| [`@mcpview/contracts`](https://github.com/mcpview/mcpview/tree/main/packages/view-contracts)   | Share dependency-free App, resource, composition, and recorded-session contracts. |
| [`@mcpview/view`](https://github.com/mcpview/mcpview/tree/main/packages/view)                  | Build the browser-side lifecycle, routing, results, and events of an MCP App.     |
| [`@mcpview/components`](https://github.com/mcpview/mcpview/tree/main/packages/view-components) | Add the optional presentation runtime, theme, and component kit to an MCP App.    |

`@casys/mcp-server` and `@casys/mcp-platform` are deprecated compatibility
aliases, not separate frameworks or additional layers to install for new
projects.

## Runtime targets

`@mcpview/server` is **Deno-first**. The canonical deployment path is Deno 2.x
running on [Deno Deploy](https://deno.com/deploy) or self-hosted Deno, with a
Node 20+ distribution as a secondary target. The npm package contains compiled
ESM JavaScript and TypeScript declarations; its runtime selector loads the Node
HTTP adapter without evaluating the Deno adapter.

| Runtime                                       |      Status      |
| --------------------------------------------- | :--------------: |
| **Deno 2.x** (Deno Deploy, self-hosted)       |    ✅ Primary    |
| **Node.js 20+** (Express, Hono-on-Node, bare) |   ✅ Secondary   |
| **Cloudflare Workers / workerd**              | ❌ Not supported |
| **Browser / WebContainer**                    | ❌ Not supported |

If you need to target Cloudflare Workers or the browser, use
[`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
directly with its workerd / browser shims — that package focuses on the protocol
and runtime portability, while `@mcpview/server` focuses on the production stack
(auth, middleware, observability, multi-tenant, MCP Apps helpers) for Deno
deployments.

---

## Quick Start

### STDIO Server (5 lines)

```typescript
import { McpApp } from "@mcpview/server";

const server = new McpApp({ name: "my-server", version: "1.0.0" });

server.registerTool(
  {
    name: "greet",
    description: "Greet a user",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  ({ name }) => `Hello, ${name}!`,
);

await server.start();
```

Provider repositories that expose a native stdio CLI should test their actual
documented command, transport flags, protocol eras, stdout discipline, and EOF
cleanup. Use the
[native stdio provider testing guide](https://github.com/mcpview/mcpview/blob/main/docs/guides/native-stdio-provider-testing.md)
as a test-only adoption kit.

### HTTP Server with Auth

```typescript
import { createGoogleAuthProvider, McpApp } from "@mcpview/server";

const server = new McpApp({
  name: "my-api",
  version: "1.0.0",
  maxConcurrent: 10,
  backpressureStrategy: "queue",
  validateSchema: true,
  rateLimit: { maxRequests: 100, windowMs: 60_000 },
  auth: {
    provider: createGoogleAuthProvider({
      audience: "https://my-mcp.example.com",
      resource: "https://my-mcp.example.com",
    }),
  },
});

server.registerTool(
  {
    name: "query",
    description: "Query the database",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" } },
    },
    requiredScopes: ["db:read"],
  },
  async ({ sql }) => ({ rows: [] }),
);

await server.startHttp({ port: 3000 });
// GET  /health   → { status: "ok" }
// GET  /metrics  → Prometheus text format
// POST /mcp      → JSON-RPC (tools/call, tools/list, ...)
// GET  /mcp      → 405 Method Not Allowed (stateless transport)
```

`startHttp()` serves stateless Streamable HTTP. Every `POST /mcp` request is
self-contained: the server does not issue `Mcp-Session-Id`, keep an MCP session,
or expose the legacy SSE stream on `GET /mcp`.

See the
[HTTP security guide](https://github.com/mcpview/mcpview/blob/main/docs/guides/securing-your-http-server.md)
to choose between a shared static allowlist, identity-aware static credentials,
and OIDC/JWT.

**Secure-by-default HTTP options:**

```typescript
await server.startHttp({
  port: 3000,
  requireAuth: true, // fail fast if auth isn't configured
  corsOrigins: ["https://app.example.com"],
  maxBodyBytes: 1_000_000, // 1 MB
  ipRateLimit: { maxRequests: 120, windowMs: 60_000 },
});
```

**Notes:**

- `requireAuth: true` throws if no auth provider is configured
- `corsOrigins` defaults to `"*"` — use an allowlist in production
- `maxBodyBytes` defaults to **1 MB** (set `null` to disable)
- `ipRateLimit` keys on client IP by default

---

## Features

### Middleware Pipeline

Composable onion model — same mental model as Hono, Koa, or Express.

```typescript
import type { Middleware } from "@mcpview/server";

const timing: Middleware = async (ctx, next) => {
  const start = performance.now();
  const result = await next();
  console.log(
    `${ctx.toolName} took ${(performance.now() - start).toFixed(0)}ms`,
  );
  return result;
};

server.use(timing);
```

Built-in pipeline:
`rate-limit → auth → custom → scope-check → validation → backpressure → handler`

### OAuth2 / JWT Auth

Four OIDC presets out of the box:

```typescript
import {
  createAuth0AuthProvider, // Auth0
  createGitHubAuthProvider, // GitHub Actions OIDC
  createGoogleAuthProvider, // Google OIDC
  createOIDCAuthProvider, // Generic OIDC (Keycloak, Okta, etc.)
} from "@mcpview/server";

const auth0 = createAuth0AuthProvider({
  domain: "my-tenant.auth0.com",
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
  scopesSupported: ["read", "write"],
});
```

Or use `JwtAuthProvider` directly for custom setups:

```typescript
import { JwtAuthProvider } from "@mcpview/server";

const provider = new JwtAuthProvider({
  issuer: "https://my-idp.example.com",
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
  authorizationServers: ["https://my-idp.example.com"],
});
```

Token verification is cached (SHA-256 hash → AuthInfo, TTL = min(token expiry,
5min)) to avoid redundant JWKS round-trips.

### YAML + Env Config

For binary distribution — users configure auth without code:

```yaml
# mcp-server.yaml
auth:
  provider: auth0
  audience: https://my-mcp.example.com
  resource: https://my-mcp.example.com
  domain: my-tenant.auth0.com
  scopesSupported: [read, write, admin]
```

Env vars override YAML at deploy time:

```bash
MCP_AUTH_AUDIENCE=https://prod.example.com ./my-server --http --port 3000
```

Priority: `programmatic > env vars > YAML > no auth`

### MRTR requestState replay protection

When a tool returns `resultType: "input_required"`, configure a signing key so
the framework can bind the continuation to the principal, method, arguments,
expiry, and a random nonce:

```typescript
const server = new McpApp({
  name: "my-api",
  version: "1.0.0",
  mrtr: {
    signingKey: Deno.env.get("MCP_MRTR_SIGNING_KEY"),
  },
});
```

Each verified nonce is consumed before the handler runs. With no explicit
`replayStore`, the built-in `MemoryMrtrReplayStore` rejects a second use within
one continuously running process.

Multi-instance or restart-safe deployments must inject one durable atomic store
shared by every instance:

```typescript
import type { MrtrReplayStore } from "@mcpview/server";

const replayStore: MrtrReplayStore = {
  async consume(nonce, expiresAt) {
    // Atomically reserve the nonce until its signed expiry.
    // Redis equivalent: SET mrtr:<nonce> 1 NX EXAT <expiresAt>
    return await reserveNonce(nonce, expiresAt);
  },
};

const server = new McpApp({
  name: "my-api",
  version: "1.0.0",
  mrtr: {
    signingKey: Deno.env.get("MCP_MRTR_SIGNING_KEY"),
    replayStore,
  },
});
```

`consume()` must return `true` only for the caller that wins the atomic
reservation, `false` for a nonce already consumed, and throw when the store is
unavailable. Store failures are fail-closed; the handler is not executed.

This is at-most-once admission, not exactly-once completion. If business logic
commits and the response is lost, replaying the same token is rejected.
Returning the prior result safely requires a separate idempotency/result ledger,
ideally paired with idempotency support in the downstream system.

### RFC 9728

When auth is configured, the framework automatically exposes
`GET /.well-known/oauth-protected-resource` per
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728).

### DCR Discovery Proxy (RFC 8414 + RFC 7591)

IdPs without native Dynamic Client Registration (Zitadel, unconfigured Keycloak,
Okta free tier) don't publish `registration_endpoint` in their AS metadata, so
MCP clients like Claude.ai or Cursor can't auto-register.

`createAsMetadataHandler` is a framework-agnostic Web Standard handler that
proxies the upstream RFC 8414 metadata and injects a `registration_endpoint`
pointing to your own DCR proxy:

```typescript
// routes/.well-known/oauth-authorization-server.ts (Fresh example)
import { createAsMetadataHandler } from "@mcpview/server";

const handle = createAsMetadataHandler({
  upstreamIssuer: "https://my-tenant.zitadel.cloud",
  registrationEndpoint: "https://my-app.example.com/oauth/register",
  // cacheTtlMs?: 24h default, stale-while-revalidate
  // extraFields?: override scopes_supported, etc.
});

export const handler = { GET: (ctx) => handle(ctx.req) };
```

Then point the PRM at your own host so clients hit the enriched metadata:

```typescript
authorizationServers: ["https://my-app.example.com"],
```

The DCR endpoint itself (RFC 7591 `/oauth/register`) is out of scope — mount it
in your framework and forward to the IdP's admin API.

**Path caveat**: if the MCP server lives at `/mcp`, clients may build the
discovery URL as `<host>/.well-known/oauth-authorization-server/mcp`. Mount the
handler at the exact path your PRM advertises.

### Observability

Every tool call emits an **OpenTelemetry span** with rich attributes:

```
mcp.tool.call query
  mcp.tool.name       = "query"
  mcp.server.name     = "my-api"
  mcp.transport       = "http"
  mcp.tool.duration_ms = 42
  mcp.tool.success     = true
```

The built-in HTTP transport does not emit `mcp.session.id`, because it does not
create MCP sessions.

Enable with Deno's native OTEL support:

```bash
OTEL_DENO=true deno run --unstable-otel server.ts
```

The HTTP server exposes a **Prometheus-compatible** `/metrics` endpoint:

```
mcp_server_tool_calls_total 1024
mcp_server_tool_calls_success_total 1018
mcp_server_tool_calls_failed_total 6
mcp_server_tool_call_duration_ms_bucket{le="50"} 892
mcp_server_tool_call_duration_ms_bucket{le="100"} 987
mcp_server_tool_calls_by_name{tool="query",status="success"} 512
mcp_server_active_requests 3
mcp_server_uptime_seconds 86400
```

Programmatic access:

```typescript
server.getServerMetrics(); // Full snapshot (counters, histograms, gauges)
server.getPrometheusMetrics(); // Prometheus text format string
```

### Concurrency Control

Three backpressure strategies when the server is at capacity:

| Strategy          | Behavior                                   |
| ----------------- | ------------------------------------------ |
| `sleep` (default) | Busy-wait with configurable sleep interval |
| `queue`           | FIFO queue with ordered release            |
| `reject`          | Fail fast with immediate error             |

```typescript
new McpApp({
  maxConcurrent: 10,
  backpressureStrategy: "queue",
});
```

### Rate Limiting

Sliding window rate limiter with per-client tracking:

```typescript
new McpApp({
  rateLimit: {
    maxRequests: 100,
    windowMs: 60_000,
    keyExtractor: (ctx) => ctx.args.clientId as string,
    onLimitExceeded: "wait", // or "reject"
  },
});
```

For HTTP endpoints, use `startHttp({ ipRateLimit: ... })` to rate limit by
client IP (or custom key).

### Security Best Practices (Tool Handlers)

Tool handlers receive **untrusted JSON input**. Treat args as hostile:

- **Define strict schemas**: `additionalProperties: false`, `minLength`,
  `pattern`, `enum`.
- **Never pass raw args to a shell** (`Deno.Command`, `child_process.exec`). If
  you must, use an allowlist + argv array (no shell).
- **Validate paths & resources**: allowlisted roots, deny `..`, restrict env
  access.
- **Prefer safe APIs**: parameterized DB queries, SDK methods, typed clients.
- **Log sensitive actions**: file writes, network calls, admin ops.

### MCP Apps (UI Resources)

Register interactive UIs as MCP resources:

```typescript
import { MCP_APP_MIME_TYPE, McpApp } from "@mcpview/server";

server.registerResource(
  { uri: "ui://my-server/viewer", name: "Data Viewer" },
  async (uri) => ({
    uri: uri.toString(),
    mimeType: MCP_APP_MIME_TYPE,
    text: "<html><body>...</body></html>",
  }),
);
```

Handlers return one payload form: `text` (including HTML) **or** `blob` for
binary content encoded as standard padded base64. Existing text handlers remain
valid. The framework also checks at runtime that the response URI exactly
matches the requested URI and that the MIME type is non-empty, which protects
JavaScript and unchecked TypeScript handlers as well as typed callers.

```typescript
server.registerResource(
  { uri: "file://reports/latest.pdf", name: "Latest report", size: 184_320 },
  async (uri) => ({
    uri: uri.toString(),
    mimeType: "application/pdf",
    blob: await loadReportAsCanonicalBase64(),
  }),
);
```

`size` is optional resource metadata shown in `resources/list`; when present it
must be a non-negative safe integer and is verified on every read against the
exact UTF-8 byte length of `text` or decoded byte length of `blob`. Supplying
`mimeType` in the resource metadata likewise binds every response to that exact
MIME type. If it is absent, it is absent from `resources/list`; the handler
still declares the MIME type when it serves the bytes. Resource content may
include `_meta`. Put `annotations`, `icons`, `title`, and resource `_meta` on
the `MCPResource` registration, where MCP defines those fields.

With `resourceCsp`, CSP injection applies only to the `text` branch of an HTML
resource. Blobs are never decoded, transformed, or re-encoded.

Register resources before `start()` / `startHttp()` to install the resource
handlers and advertise `resources: { listChanged: true }`. They can then be
added or removed at any time through `unregisterResource(uri)`, which returns
`true` only once. For a registry that starts empty and discovers resources
asynchronously, construct with `expectResources: true`; that mode installs the
same handlers at construction time:

```typescript
const app = new McpApp({
  name: "relay",
  version: "1.0.0",
  expectResources: true,
});

// After start(): list/read/templates handlers are already installed.
app.registerResource(resource, handler);
app.unregisterResource(resource.uri); // true, then false if called again
```

#### Capability negotiation (clients that don't support MCP Apps)

Not every MCP client renders UI resources. Clients that do advertise the
[MCP Apps extension](https://github.com/modelcontextprotocol/ext-apps) in their
capabilities (per the SDK v2 `extensions` field). Read it from a tool handler to
decide between rich UI and a text-only fallback:

```typescript
import { MCP_APP_MIME_TYPE, McpApp } from "@mcpview/server";

const app = new McpApp({ name: "weather-server", version: "1.0.0" });

app.registerTool(
  {
    name: "get-weather",
    description: "Get the weather forecast for a city",
    inputSchema: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
  async ({ city }) => {
    const forecast = await fetchForecast(city);
    const cap = app.getClientMcpAppsCapability();

    if (cap?.mimeTypes?.includes(MCP_APP_MIME_TYPE)) {
      // Rich UI: small text summary + interactive resource
      return {
        content: [{ type: "text", text: `Forecast for ${city} loaded` }],
        _meta: { ui: { resourceUri: `ui://weather/${city}` } },
      };
    }

    // Text-only fallback for clients that can't render the UI
    return {
      content: [{ type: "text", text: formatForecastAsText(forecast) }],
    };
  },
);
```

`getClientMcpAppsCapability()` returns `undefined` before the client has
completed its initialize handshake, when the client doesn't advertise MCP Apps
support, or when the advertised capability is malformed. The standalone
`getMcpAppsCapability(clientCapabilities)` function is also exported for use
against arbitrary capability objects.

The constants `MCP_APPS_EXTENSION_ID` (`"io.modelcontextprotocol/ui"`) and
`MCP_APPS_PROTOCOL_VERSION` (`"2026-01-26"`) are exported for agents that need
to introspect the protocol target directly.

---

## API Reference

### McpApp

> **Note:** `ConcurrentMCPServer` and `ConcurrentServerOptions` remain exported
> as `@deprecated` aliases for backwards compatibility and will be removed in
> v1.0. New code should use `McpApp` / `McpAppOptions`. The aliases point to the
> exact same class — `instanceof` checks pass on both.

```typescript
const server = new McpApp(options: McpAppOptions);

// Registration (before start, unless expectResources: true)
server.registerTool(tool, handler);
server.registerTools(tools, handlers);
server.registerResource(resource, handler);
server.registerResources(resources, handlers);
server.unregisterResource(resourceUri); // safe before or after start
server.use(middleware);

// Transport
await server.start();                  // STDIO
await server.startHttp({ port: 3000 }); // Stateless Streamable HTTP
await server.stop();                    // Graceful shutdown

// Observability
server.getMetrics();              // { inFlight, queued }
server.getServerMetrics();        // Full snapshot
server.getPrometheusMetrics();    // Prometheus text format
server.getRateLimitMetrics();     // { keys, totalRequests }

// Introspection
server.getToolCount();
server.getToolNames();
server.getResourceCount();
server.getResourceUris();
```

### Standalone Components

Each component works independently:

```typescript
import { RateLimiter, RequestQueue, SchemaValidator } from "@mcpview/server";

// Rate limiter
const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000 });
if (limiter.checkLimit("client-123")) {
  /* proceed */
}

// Request queue
const queue = new RequestQueue({
  maxConcurrent: 5,
  strategy: "queue",
  sleepMs: 10,
});
await queue.acquire();
try {
  /* work */
} finally {
  queue.release();
}

// Schema validator
const validator = new SchemaValidator();
validator.addSchema("tool", {
  type: "object",
  properties: { n: { type: "number" } },
});
validator.validate("tool", { n: 5 }); // { valid: true, errors: [] }
```

---

## HTTP Endpoints

When running with `startHttp()`, MCP traffic is stateless and `POST`-only. A
`GET` or `DELETE` to the MCP route returns `405 Method Not Allowed` rather than
opening an SSE stream or managing a session:

| Method | Path                                    | Description                                                 |
| ------ | --------------------------------------- | ----------------------------------------------------------- |
| `POST` | `/mcp` or `/`                           | JSON-RPC endpoint (initialize, tools/call, tools/list, ...) |
| `GET`  | `/health`                               | Health check                                                |
| `GET`  | `/metrics`                              | Prometheus metrics                                          |
| `GET`  | `/.well-known/oauth-protected-resource` | RFC 9728 metadata (when auth enabled)                       |

---

## License

MIT
