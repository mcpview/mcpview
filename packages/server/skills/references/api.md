# @mcpview/server — Full API Reference

Canonical package: `@mcpview/server` (JSR and npm)

Compatibility packages: `@casys/mcp-server` and `@casys/mcp-platform`
(deprecated re-exports)

This reference intentionally does not pin a package version. Use the installed
package, lockfile, or package manifest as the version authority.

---

## McpApp class

```typescript
import { McpApp } from "@mcpview/server";
```

### Constructor

```typescript
new McpApp(options: McpAppOptions)
```

#### McpAppOptions

```typescript
interface McpAppOptions {
  name: string; // Server name (MCP protocol)
  version: string; // Server version
  maxConcurrent?: number; // Default: 10
  backpressureStrategy?: "sleep" | "queue" | "reject"; // Default: "sleep"
  backpressureSleepMs?: number; // Default: 10 (ms, for "sleep" strategy)
  rateLimit?: RateLimitOptions; // Per-client tool-call rate limiting
  validateSchema?: boolean; // Default: false — validate args against inputSchema
  enableSampling?: boolean; // Default: false
  samplingClient?: SamplingClient; // Required if enableSampling: true
  instructions?: string; // LLM system instructions (sent in initialize)
  toolErrorMapper?: ToolErrorMapper; // Map errors to isError:true vs rethrow
  auth?: AuthOptions; // OAuth2/Bearer auth config
  resourceCsp?: CspOptions; // CSP for HTML resources
  expectResources?: boolean; // Pre-declare resources capability before connect
  logger?: (msg: string) => void; // Default: console.error
}
```

---

### Tool methods

#### registerTool

```typescript
registerTool(tool: MCPTool, handler: ToolHandler): void
```

Register a single tool before `start()` or `startHttp()`. Throws if called after
start.

#### registerTools

```typescript
registerTools(tools: MCPTool[], handlers: Map<string, ToolHandler>): void
```

Register multiple tools at once. Every tool in the array must have a matching
entry in `handlers` or the call throws (fail-fast).

#### registerToolLive

```typescript
registerToolLive(tool: MCPTool, handler: ToolHandler): void
```

Register a tool while the server is running. Intended for relay/proxy patterns
where tools are discovered dynamically. The tool immediately appears in
`tools/list`.

#### registerAppOnlyTool

```typescript
registerAppOnlyTool(tool: MCPTool, handler: ToolHandler): void
```

Register a tool with `_meta.ui.visibility: ["app"]`. The tool is hidden from
`tools/list` (invisible to the model) but callable via `tools/call` if the
caller knows its name. Used for internal app-to-server calls in MCP Apps.

#### unregisterTool

```typescript
unregisterTool(toolName: string): boolean
```

Remove a tool. Returns `true` if found and deleted. In-flight calls to this tool
complete normally.

---

### Middleware

#### use

```typescript
use(middleware: Middleware): this
```

Add a middleware to the pipeline. Must be called before `start()`/`startHttp()`.
Returns `this` for chaining.

Pipeline order:

```
rate-limit → auth → [custom middlewares] → scope-check → validation → backpressure → handler
```

---

### Resource methods (MCP Apps, SEP-1865)

#### registerResource

```typescript
registerResource(resource: MCPResource, handler: ResourceHandler): void
```

Register a single resource. URI must use `ui://` scheme (warning logged
otherwise). Throws on duplicate URI. When `expectResources: true`, can be called
after `start()`.

#### registerResources

```typescript
registerResources(resources: MCPResource[], handlers: Map<string, ResourceHandler>): void
```

Atomic batch registration. Validates all handlers and checks for duplicates
before registering any — either all succeed or none are registered.

#### registerViewers

```typescript
registerViewers(config: RegisterViewersConfig): RegisterViewersSummary
```

Batch-register MCP App viewers with automatic dist path resolution. Each viewer
gets URI `ui://{prefix}/{viewerName}`.

```typescript
interface RegisterViewersConfig {
  prefix: string; // URI prefix
  moduleUrl: string; // import.meta.url of caller (for path resolution)
  viewers?: string[]; // explicit list of viewer names
  discover?: { // auto-discover from a directory
    uiDir: string;
    // ... DiscoverViewersFS options
  };
  humanName?: (name: string) => string;
  readFile: (path: string) => string | Promise<string>;
  exists?: (path: string) => boolean;
  csp?: CspOptions;
}

interface RegisterViewersSummary {
  registered: string[];
  skipped: string[];
}
```

Viewers whose built dist is not found are skipped with a warning (not an error),
so the server can start in dev without running the UI build.

---

### Transport methods

#### start

```typescript
start(): Promise<void>
```

Start with STDIO transport. Uses `serveStdio` from
`@modelcontextprotocol/server/stdio` (SDK v2), including the legacy
initialization fallback. Builds the middleware pipeline before connecting.

#### startHttp

```typescript
startHttp(options: HttpServerOptions): Promise<HttpServerInstance>
```

Start with stateless HTTP transport (MCP protocol `2026-07-28`). Clients use SDK
v2 transports from `@modelcontextprotocol/client`; GET `/mcp` returns 405.
Builds the middleware pipeline and auto-configures auth from YAML + env if
`options.auth` is not provided programmatically.

Returns `{ shutdown(): Promise<void>, addr: { hostname, port } }`.

#### getFetchHandler

```typescript
getFetchHandler(
  options?: Omit<HttpServerOptions, "port" | "hostname" | "onListen">
): Promise<FetchHandler>
```

Returns a Web Standard `(req: Request) => Promise<Response>` handler without
binding a port. Use to embed the MCP HTTP stack inside Hono, Fresh, Express,
etc.

```typescript
type FetchHandler = (req: Request) => Promise<Response>;
```

#### stop

```typescript
stop(): Promise<void>
```

Graceful shutdown: closes SSE clients, cancels pending sampling, shuts down HTTP
server (if running), closes MCP transport.

---

### Observability methods

#### getMetrics

```typescript
getMetrics(): QueueMetrics
// { inFlight: number, queued: number }
```

#### getServerMetrics

```typescript
getServerMetrics(): ServerMetricsSnapshot
```

Full snapshot: tool call counters, duration histograms, active session/SSE
gauges.

#### getPrometheusMetrics

```typescript
getPrometheusMetrics(): string
```

Prometheus text format (same as `GET /metrics` endpoint).

#### getRateLimitMetrics

```typescript
getRateLimitMetrics(): { keys: number; totalRequests: number } | null
```

Returns `null` when rate limiting is not configured.

---

### MCP Apps methods

#### getClientMcpAppsCapability

```typescript
getClientMcpAppsCapability(): McpAppsClientCapability | undefined
```

Read the MCP Apps capability advertised by the connected client. Returns
`undefined` if the client did not advertise MCP Apps support (did not send the
`io.modelcontextprotocol/ui` extension in `clientCapabilities.extensions`).

```typescript
interface McpAppsClientCapability {
  mimeTypes?: string[];
}
```

---

## Type Reference

### MCPTool

```typescript
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  outputSchema?: Record<string, unknown>; // JSON Schema for structured output
  annotations?: ToolAnnotations;
  _meta?: MCPToolMeta; // UI metadata for MCP Apps
  requiredScopes?: string[]; // OAuth scopes (enforced by scope middleware)
}

interface MCPToolMeta {
  ui?: McpUiToolMeta;
}

interface McpUiToolMeta {
  resourceUri: string; // MUST use ui:// scheme
  emits?: string[]; // PML: events this UI emits
  accepts?: string[]; // PML: events this UI accepts
  visibility?: ("model" | "app")[];
}

interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
```

### ToolHandler & StructuredToolResult

```typescript
type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<unknown> | unknown;

type ToolErrorMapper = (error: unknown, toolName: string) => string | null;

interface StructuredToolResult {
  content: string; // → content[0].text (for the LLM)
  structuredContent: Record<string, unknown>; // → structuredContent (machine-readable)
}
```

### MCPResource & ResourceHandler

```typescript
interface MCPResource {
  uri: string; // SHOULD use ui:// scheme
  name: string;
  description?: string;
  mimeType?: string; // Default: MCP_APP_MIME_TYPE
}

type ResourceHandler = (uri: URL) => Promise<ResourceContent> | ResourceContent;

interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui";
const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";
```

### HttpServerOptions

```typescript
interface HttpServerOptions {
  port: number;
  hostname?: string; // Default: "0.0.0.0"
  cors?: boolean; // Default: true
  corsOrigins?: "*" | string[]; // Default: "*" (use allowlist in production)
  maxBodyBytes?: number | null; // Default: 1_000_000; null = no limit
  requireAuth?: boolean; // Default: false; true = throw if no auth configured
  ipRateLimit?: HttpRateLimitOptions;
  customRoutes?: Array<{
    method: "get" | "post";
    path: string;
    handler: (req: Request) => Response | Promise<Response>;
  }>;
  onListen?: (info: { hostname: string; port: number }) => void;
  embedded?: boolean; // Skip port binding, use embeddedHandlerCallback
  embeddedHandlerCallback?: (handler: FetchHandler) => void;
}
```

### RateLimitOptions

```typescript
interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyExtractor?: (ctx: RateLimitContext) => string; // Default: "default" (global)
  onLimitExceeded?: "reject" | "wait"; // Default: "wait"
}

interface RateLimitContext {
  toolName: string;
  args: Record<string, unknown>;
}
```

### HttpRateLimitOptions

```typescript
interface HttpRateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyExtractor?: (ctx: HttpRateLimitContext) => string; // Default: IP address
  onLimitExceeded?: "reject" | "wait";
}

interface HttpRateLimitContext {
  ip: string;
  method: string;
  path: string;
  headers: Headers;
  sessionId?: string;
}
```

### AuthOptions

```typescript
interface AuthOptions {
  provider: AuthProvider;
  authorizationServers: string[];
  resource: string;
  scopesSupported?: string[];
}

interface AuthInfo {
  subject: string;
  clientId?: string;
  scopes: string[];
  claims?: Record<string, unknown>;
  expiresAt?: number;
  tenantId?: string; // set by createMultiTenantMiddleware
}
```

### Middleware types

```typescript
interface MiddlewareContext {
  toolName: string;
  args: Record<string, unknown>;
  request?: Request; // HTTP transport only
  sessionId?: string; // HTTP transport only
  [key: string]: unknown; // extensible
}

type MiddlewareResult = unknown;
type NextFunction = () => Promise<MiddlewareResult>;
type Middleware = (
  ctx: MiddlewareContext,
  next: NextFunction,
) => Promise<MiddlewareResult>;
```

### QueueMetrics

```typescript
interface QueueMetrics {
  inFlight: number;
  queued: number;
}
```

### SamplingBridge / SamplingClient

```typescript
interface SamplingClient {
  createMessage(params: SamplingParams): Promise<SamplingResult>;
}

interface SamplingParams {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: Array<
    { name: string; description: string; inputSchema: Record<string, unknown> }
  >;
  toolChoice?: "auto" | "required" | "none";
  maxTokens?: number;
  maxIterations?: number;
  allowedToolPatterns?: string[];
}

interface SamplingResult {
  content: Array<
    {
      type: string;
      text?: string;
      name?: string;
      input?: Record<string, unknown>;
    }
  >;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}
```

---

## Standalone components

These are also exported for direct use outside of `McpApp`:

### RateLimiter

```typescript
import { RateLimiter } from "@mcpview/server";

const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60_000 });
limiter.checkLimit(key: string): boolean
limiter.waitForSlot(key: string): Promise<void>
limiter.getTimeUntilSlot(key: string): number
limiter.getMetrics(): { keys: number; totalRequests: number }
```

### RequestQueue

```typescript
import { RequestQueue } from "@mcpview/server";

const queue = new RequestQueue({ maxConcurrent: 5, strategy: "queue", sleepMs: 10 });
queue.getMetrics(): QueueMetrics
```

### SchemaValidator

```typescript
import { SchemaValidator } from "@mcpview/server";

const validator = new SchemaValidator();
validator.addSchema(toolName: string, schema: Record<string, unknown>): void
validator.validate(toolName: string, data: unknown): ValidationResult

interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}
```

---

## Auth presets

```typescript
import {
  createAuth0AuthProvider, // issuer: https://{domain}/
  createGitHubAuthProvider, // issuer: https://token.actions.githubusercontent.com
  createGoogleAuthProvider, // issuer: https://accounts.google.com
  createOIDCAuthProvider, // generic, any OIDC-compliant provider
  JwtAuthProvider, // underlying class (use presets when possible)
} from "@mcpview/server";
```

All presets accept `PresetOptions`:

```typescript
interface PresetOptions {
  audience: string;
  resource: string;
  scopesSupported?: string[];
}
```

Auth0 additionally requires `domain: string`. `createOIDCAuthProvider` accepts
`JwtAuthProviderOptions` (includes `issuer`, `jwksUri`, `authorizationServers`).

### Multi-tenant auth

```typescript
import { createMultiTenantMiddleware } from "@mcpview/server";

app.use(createMultiTenantMiddleware({
  resolver: async (ctx) => ({
    tenantId: ctx.authInfo.claims?.tenant_id as string,
  }),
}));
```

---

## MCP Apps constants and utilities

```typescript
import {
  getMcpAppsCapability, // standalone reader for clientCapabilities
  MCP_APP_MIME_TYPE, // "text/html;profile=mcp-app"
  MCP_APPS_EXTENSION_ID, // "io.modelcontextprotocol/ui"
  MCP_APPS_PROTOCOL_VERSION, // "2026-01-26"
} from "@mcpview/server";
```

### getMcpAppsCapability (standalone)

```typescript
getMcpAppsCapability(clientCapabilities: Record<string, unknown> | null | undefined): McpAppsClientCapability | undefined
```

---

## MCP Compose (import from the compose SDK)

```typescript
import {
  COMPOSE_EVENT_METHOD,
  composeEvents,
  uiMeta,
} from "@mcpview/compose/sdk";
```

`uiMeta` and `composeEvents` live in `@mcpview/compose/sdk` — import them from
there directly. See the mcp-compose skill for the full compose API.

---

## Security utilities

```typescript
import { buildCspHeader, injectCspMetaTag } from "@mcpview/server";
import { injectChannelAuth } from "@mcpview/server";
import { MessageSigner } from "@mcpview/server";
```

---

## Inspector

```typescript
import { launchInspector } from "@mcpview/server";

await launchInspector({ port: 5173 });
```

Launches the MCP Inspector UI for interactive debugging.

---

## Observability (OTel)

```typescript
import {
  endToolCallSpan,
  getServerTracer,
  isOtelEnabled,
  recordAuthEvent,
  ServerMetrics,
  startToolCallSpan,
} from "@mcpview/server";
```

OTel tracing is auto-enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the
environment. The tracer name is `mcp.server` (instrumentation version `0.8.0`).
