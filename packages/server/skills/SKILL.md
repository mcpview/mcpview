---
name: casys-mcp-server
description: >
  Reference skill for Casys MCP Platform (@casys/mcp-server) and its deprecated
  @casys/mcp-platform compatibility package. Trigger when the user imports either
  package, builds or extends an MCP server, registers tools or resources, configures
  auth (Google, Auth0, GitHub, OIDC), adds middleware, sets up HTTP or STDIO transport,
  embeds an MCP server in Hono/Fresh/Express, or works with MCP Apps (ui:// resources,
  SEP-1865). Also trigger for package migration, concurrency/backpressure tuning,
  rate limiting, schema validation, or observability on MCP servers.
---

# Casys MCP Platform (`@casys/mcp-server`)

Hono-style framework for MCP servers. Wraps `@modelcontextprotocol/sdk` with a
middleware pipeline, auth, concurrency control, and HTTP transport.

- **Runtime**: Deno 2+ or Node 20+
- **Registries**: JSR and npm
- **License**: MIT
- **Depends on**: `@modelcontextprotocol/sdk@^1.29.0`, `hono@^4`, `jose@^6`

## Identity and compatibility

- `@casys/mcp-server` is the canonical framework package. Use it for new code
  and current product naming.
- `@casys/mcp-platform` is the deprecated compatibility package. It re-exports
  the server API unchanged so existing 0.28.x imports can keep working.
- `ConcurrentMCPServer` is a deprecated class alias of `McpApp`; this is
  separate from the package-level compatibility alias.
- The frontmatter name is `casys-mcp-server`, matching the canonical package
  name since the framework was renamed back in 0.29.0.

Do not rewrite a project's legacy imports unless the user asks for the package
migration. When migrating, change the package/import name without implying an
API rewrite.

## Installation

```sh
# Deno
deno add jsr:@casys/mcp-server

# Node / npm
npm install @casys/mcp-server
```

```typescript
import { McpApp } from "@casys/mcp-server";
```

---

## Core: McpApp

```typescript
const app = new McpApp(options: McpAppOptions);
```

### Key constructor options (`McpAppOptions`)

| Option                 | Type                             | Default   | Description                                                            |
| ---------------------- | -------------------------------- | --------- | ---------------------------------------------------------------------- |
| `name`                 | `string`                         | required  | Server name (shown in MCP protocol)                                    |
| `version`              | `string`                         | required  | Server version                                                         |
| `maxConcurrent`        | `number`                         | `10`      | Max parallel tool calls                                                |
| `backpressureStrategy` | `"sleep" \| "queue" \| "reject"` | `"sleep"` | What to do when at capacity                                            |
| `backpressureSleepMs`  | `number`                         | `10`      | Sleep duration for `"sleep"` strategy                                  |
| `rateLimit`            | `RateLimitOptions`               | —         | Per-client tool-call rate limiting                                     |
| `validateSchema`       | `boolean`                        | `false`   | Validate args against `inputSchema` before execution                   |
| `instructions`         | `string`                         | —         | LLM instructions sent in initialize response                           |
| `toolErrorMapper`      | `ToolErrorMapper`                | —         | Map thrown errors to `isError: true` results                           |
| `auth`                 | `AuthOptions`                    | —         | OAuth2/Bearer auth (HTTP transport only)                               |
| `resourceCsp`          | `CspOptions`                     | —         | CSP injected into HTML resources                                       |
| `expectResources`      | `boolean`                        | `false`   | Pre-declare `resources` capability for dynamic post-start registration |

---

## Tool Registration

Tools must be registered **before** `start()` or `startHttp()`.

```typescript
// Single tool
app.registerTool(tool: MCPTool, handler: ToolHandler): void

// Multiple tools
app.registerTools(tools: MCPTool[], handlers: Map<string, ToolHandler>): void

// After server started (relay/proxy pattern)
app.registerToolLive(tool: MCPTool, handler: ToolHandler): void

// Only visible to MCP Apps UI, not to the model
app.registerAppOnlyTool(tool: MCPTool, handler: ToolHandler): void

// Remove a tool (can be called any time)
app.unregisterTool(toolName: string): boolean
```

### MCPTool shape

```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema?: Record<string, unknown>; // for structured results
  annotations?: ToolAnnotations; // readOnlyHint, destructiveHint, etc.
  _meta?: MCPToolMeta; // UI config for MCP Apps
  requiredScopes?: string[]; // OAuth scopes enforced by scope middleware
}
```

### ToolHandler

```typescript
type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;
```

Return a plain value, or a `StructuredToolResult` to separate LLM text from
structured data:

```typescript
interface StructuredToolResult {
  content: string; // human-readable summary → content[0].text
  structuredContent: Record<string, unknown>; // machine-readable → structuredContent
}
```

### Error handling

By default, thrown errors become JSON-RPC errors. Use `toolErrorMapper` to
convert them to `isError: true` results instead:

```typescript
const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  toolErrorMapper: (error, toolName) => {
    if (error instanceof MyAppError) return error.message;
    return null; // rethrow as JSON-RPC error
  },
});
```

---

## Transport

### STDIO (local tools, Claude Desktop, etc.)

```typescript
await app.start();
```

### HTTP (remote / multi-client)

```typescript
const http = await app.startHttp({
  port: 3000,
  corsOrigins: ["https://app.example.com"], // use allowlist in production
  requireAuth: true,
  ipRateLimit: { maxRequests: 60, windowMs: 60_000 },
});

// Shut down later
await http.shutdown();
```

Built-in endpoints:

- `POST /mcp` — MCP JSON-RPC
- `GET /mcp`, `DELETE /mcp` — `405 Method Not Allowed`; both were legacy verbs
  (SSE stream / session termination) removed in 0.24.0. Use
  `subscriptions/listen` for server-initiated notifications.
- `GET /health` — `{ status: "ok", server, version }`
- `GET /metrics` — Prometheus text format
- `GET /.well-known/oauth-protected-resource` — RFC 9728 metadata (when auth
  configured)

### Embed in Hono / Fresh / Express

```typescript
const handler = await app.getFetchHandler({
  requireAuth: true,
  corsOrigins: ["https://app.example.com"],
});
// handler is a Web Standard (req: Request) => Promise<Response>
```

---

## Middleware Pipeline

Add custom middlewares with `app.use()` before `start()`/`startHttp()`.

Pipeline order (built-in first, then yours):

```
rate-limit → auth → [custom middlewares] → scope-check → validation → backpressure → handler
```

```typescript
app.use(async (ctx: MiddlewareContext, next) => {
  console.log(`→ ${ctx.toolName}`, ctx.args);
  const result = await next();
  console.log(`← ${ctx.toolName}`);
  return result;
});
```

`MiddlewareContext` fields:

- `toolName: string`
- `args: Record<string, unknown>`
- `request?: Request` — only set for HTTP transport
- `sessionId?: string` — **always `undefined` since 0.24.0**; protocol-level
  sessions were removed with the stateful transport. Retained for source
  compatibility only.
- `[key: string]: unknown` — extensible (e.g., auth middleware adds `authInfo`)

---

## Auth

Configure auth via `McpAppOptions.auth` or auto-loaded from YAML + env vars.

### Auth presets

```typescript
import {
  createAuth0AuthProvider,
  createGitHubAuthProvider,
  createGoogleAuthProvider,
  createOIDCAuthProvider,
} from "@casys/mcp-server";

// Google
const provider = createGoogleAuthProvider({
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
});

// Auth0
const provider = createAuth0AuthProvider({
  domain: "my-tenant.auth0.com",
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
});

// GitHub Actions OIDC
const provider = createGitHubAuthProvider({
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
});

// Generic OIDC
const provider = createOIDCAuthProvider({
  issuer: "https://my-idp.example.com",
  audience: "https://my-mcp.example.com",
  resource: "https://my-mcp.example.com",
  authorizationServers: ["https://my-idp.example.com"],
});
```

Wire the provider into McpApp:

```typescript
const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: { provider },
});
```

Auth is only enforced on HTTP transport. STDIO is always unprotected (local
process).

### Per-tool scope enforcement

```typescript
app.registerTool(
  {
    name: "admin_action",
    description: "...",
    inputSchema: {},
    requiredScopes: ["admin"],
  },
  handler,
);
```

---

## Resource Registration (MCP Apps)

```typescript
app.registerResource(resource: MCPResource, handler: ResourceHandler): void
app.registerResources(resources: MCPResource[], handlers: Map<string, ResourceHandler>): void
```

```typescript
import { MCP_APP_MIME_TYPE } from "@casys/mcp-server";

app.registerResource(
  { uri: "ui://my-server/viewer", name: "Viewer", mimeType: MCP_APP_MIME_TYPE },
  async (uri: URL) => ({
    uri: uri.toString(),
    mimeType: MCP_APP_MIME_TYPE,
    text: "<html>...</html>",
  }),
);
```

Resource URIs must use the `ui://` scheme. The framework logs a warning for
other schemes.

### registerViewers (batch viewer registration)

```typescript
const summary = app.registerViewers({
  prefix: "my-server",
  moduleUrl: import.meta.url,
  viewers: ["table-viewer", "chart-viewer"],
  // or use discover: { uiDir: "./ui" } for auto-discovery
  readFile: (path) => Deno.readTextFile(path),
});
// summary: { registered: string[], skipped: string[] }
```

### MCP Apps capability detection

```typescript
const cap = app.getClientMcpAppsCapability();
if (cap?.mimeTypes?.includes(MCP_APP_MIME_TYPE)) {
  // return UI result with _meta.ui.resourceUri
}
```

---

## Observability

```typescript
app.getMetrics(): QueueMetrics           // { inFlight, queued }
app.getServerMetrics(): ServerMetricsSnapshot
app.getPrometheusMetrics(): string
app.getRateLimitMetrics(): { keys, totalRequests } | null
```

OTel tracing is auto-enabled if `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

---

## Quick patterns

### Minimal STDIO server

```typescript
import { McpApp } from "@casys/mcp-server";

const app = new McpApp({ name: "my-server", version: "1.0.0" });

app.registerTool(
  {
    name: "greet",
    description: "Greet someone",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
  (args) => `Hello, ${args.name}!`,
);

await app.start();
```

### HTTP server with Google auth

```typescript
import { createGoogleAuthProvider, McpApp } from "@casys/mcp-server";

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: {
    provider: createGoogleAuthProvider({
      audience: "https://my-mcp.example.com",
      resource: "https://my-mcp.example.com",
    }),
  },
});

app.registerTool(
  { name: "hello", description: "Hello", inputSchema: {} },
  () => "hi",
);

await app.startHttp({
  port: 3000,
  requireAuth: true,
  corsOrigins: ["https://app.example.com"],
  ipRateLimit: { maxRequests: 100, windowMs: 60_000 },
});
```

---

For the full API reference, see [references/api.md](./references/api.md). For
common patterns and recipes, see
[references/patterns.md](./references/patterns.md).
