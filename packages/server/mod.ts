/**
 * @casys/mcp-server — Hono-style framework for MCP servers
 *
 * Production-ready MCP server framework with built-in middleware pipeline,
 * auth, concurrency control, backpressure, and observability.
 *
 * Built on top of the official @modelcontextprotocol/sdk.
 *
 * @example
 * ```typescript
 * import { McpApp } from "@casys/mcp-server";
 *
 * const app = new McpApp({
 *   name: "my-server",
 *   version: "1.0.0",
 *   maxConcurrent: 10,
 *   backpressureStrategy: 'queue'
 * });
 *
 * app.registerTool(
 *   { name: "greet", description: "Greet someone", inputSchema: { type: "object" } },
 *   (args) => `Hello, ${args.name}!`,
 * );
 *
 * // STDIO transport
 * await app.start();
 *
 * // — or — HTTP transport with security-first defaults
 * const http = await app.startHttp({
 *   port: 3000,
 *   maxBodyBytes: 1_048_576,                    // 1 MB (default)
 *   corsOrigins: ["https://app.example.com"],   // allowlist
 *   requireAuth: true,                          // fail-fast without auth
 *   ipRateLimit: { maxRequests: 60, windowMs: 60_000 },
 * });
 * ```
 *
 * @module @casys/mcp-server
 */

// Main server class — canonical name
export { McpApp } from "./src/mcp-app.ts";

/**
 * @deprecated Use {@link McpApp} instead. `ConcurrentMCPServer` is kept as
 * a re-export for backwards compatibility and will be removed in v1.0.
 *
 * Both names point to the exact same class — `McpApp === ConcurrentMCPServer`
 * is true at runtime, and `instanceof` checks pass in both directions.
 * Migration is a one-line import swap.
 */
export { McpApp as ConcurrentMCPServer } from "./src/mcp-app.ts";

// Concurrency primitives
export { RequestQueue } from "./src/concurrency/request-queue.ts";

// Rate limiting
export { RateLimiter } from "./src/concurrency/rate-limiter.ts";

// Schema validation
export { SchemaValidator } from "./src/validation/schema-validator.ts";
export type {
  CompiledSchemaValidator,
  ValidationError,
  ValidationResult,
} from "./src/validation/schema-validator.ts";

// Type exports
export type {
  BlobResourceContent,
  HttpRateLimitContext,
  HttpRateLimitOptions,
  HttpServerInstance,
  // HTTP Server types
  HttpServerOptions,
  McpAppOptions,
  // MCP Apps types (SEP-1865)
  MCPResource,
  MCPTool,
  MCPToolMeta,
  McpUiToolMeta,
  QueueMetrics,
  RateLimitContext,
  RateLimitOptions,
  ResourceContent,
  ResourceHandler,
  SamplingClient,
  SamplingParams,
  SamplingResult,
  StructuredToolResult,
  TextResourceContent,
  ToolAnnotations,
  ToolErrorMapper,
  ToolHandler,
  ToolHandlerContext,
} from "./src/types.ts";

/**
 * @deprecated Use {@link McpAppOptions} instead. `ConcurrentServerOptions`
 * is kept as a re-export for backwards compatibility and will be removed
 * in v1.0.
 */
export type { McpAppOptions as ConcurrentServerOptions } from "./src/types.ts";

// MCP Apps constants & viewer utilities
export {
  MCP_APP_MIME_TYPE,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_PROTOCOL_VERSION,
} from "./src/types.ts";

// MCP Apps capability negotiation (per ext-apps spec 2026-01-26 + SDK 1.29 extensions)
export { getMcpAppsCapability } from "./src/types.ts";
export type { McpAppsClientCapability } from "./src/types.ts";

export type {
  RegisterViewersConfig,
  RegisterViewersSummary,
} from "./src/mcp-app.ts";
export {
  discoverViewers,
  resolveViewerDistPath,
} from "./src/ui/viewer-utils.ts";

// NOTE: UI composition helpers (`composeEvents`, `uiMeta`, `COMPOSE_EVENT_METHOD`
// and their types) are NOT re-exported here. They live in `@casys/mcp-compose`
// and must be imported from there directly:
//   import { composeEvents, uiMeta } from "@casys/mcp-compose/sdk";
// Dropping the convenience re-export removes @casys/mcp-server's dependency on
// @casys/mcp-compose entirely — server stays a lean MCP framework that only
// touches the official protocol packages.

// Middleware pipeline
export type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
  NextFunction,
} from "./src/middleware/mod.ts";
export { createMiddlewareRunner } from "./src/middleware/mod.ts";

// Auth - Core
export { AuthProvider } from "./src/auth/mod.ts";
export {
  AuthError,
  createAuthMiddleware,
  createForbiddenResponse,
  createUnauthorizedResponse,
  extractBearerToken,
} from "./src/auth/mod.ts";
export { createScopeMiddleware } from "./src/auth/mod.ts";
export type {
  AuthInfo,
  AuthOptions,
  ProtectedResourceMetadata,
} from "./src/auth/mod.ts";

// Auth - Multi-tenant resolution
export { createMultiTenantMiddleware } from "./src/auth/mod.ts";
export type {
  MultiTenantMiddlewareOptions,
  TenantResolution,
  TenantResolver,
} from "./src/auth/mod.ts";

// Auth - JWT Provider + Presets
export { JwtAuthProvider } from "./src/auth/mod.ts";
export type { JwtAuthProviderOptions } from "./src/auth/mod.ts";
export {
  createAuth0AuthProvider,
  createGitHubAuthProvider,
  createGoogleAuthProvider,
  createOIDCAuthProvider,
} from "./src/auth/mod.ts";
export type { PresetOptions } from "./src/auth/mod.ts";

// Auth - AS Metadata Proxy (DCR discovery for IdPs without native RFC 7591)
export { createAsMetadataHandler } from "./src/auth/mod.ts";
export type { AsMetadataProxyOptions } from "./src/auth/mod.ts";

// Auth - Config (YAML + env)
export {
  createAuthProviderFromConfig,
  loadAuthConfig,
} from "./src/auth/mod.ts";

export type { AuthConfig, AuthProviderName } from "./src/auth/mod.ts";

// Auth - Static Token Provider (opaque pre-shared bearer tokens)
export {
  createStaticTokenAuthProvider,
  StaticTokenAuthProvider,
} from "./src/auth/mod.ts";
export type {
  StaticTokenAuthProviderOptions,
  StaticTokenCredential,
} from "./src/auth/mod.ts";

// Client Auth — OAuth client flow + CIMD
export {
  buildClientIdMetadataDocument,
  CallbackServer,
  CimdConfigError,
  FileTokenStore,
  isCimdConfig,
  MemoryTokenStore,
  OAuthClientProviderImpl,
  prepareOAuthProvider,
} from "./src/client-auth/mod.ts";
export type {
  CallbackServerOptions,
  CimdClientConfig,
  CimdConfigErrorCode,
  ClientIdMetadataDocument,
  OAuthClientConfig,
  OAuthClientConfigBase,
  PrepareOAuthResult,
  StaticClientConfig,
  StoredCredentials,
  TokenStore,
} from "./src/client-auth/mod.ts";

// Observability
export {
  endToolCallSpan,
  getServerTracer,
  isOtelEnabled,
  recordAuthEvent,
  ServerMetrics,
  type ServerMetricsSnapshot,
  startToolCallSpan,
  type ToolCallSpanAttributes,
} from "./src/observability/mod.ts";

// Security - CSP utilities
export { buildCspHeader, injectCspMetaTag } from "./src/security/csp.ts";
export type { CspOptions } from "./src/security/csp.ts";

// Security - HMAC channel authentication for PostMessage (MCP Apps)
export { injectChannelAuth } from "./src/security/channel-hmac.ts";
export { MessageSigner } from "./src/security/message-signer.ts";
export type {
  SignedMessage,
  VerifyResult,
} from "./src/security/message-signer.ts";

// Runtime port (for advanced consumers who need to inspect the adapter contract)
export type {
  FetchHandler,
  RuntimePort,
  ServeHandle,
  ServeOptions,
} from "./src/runtime/types.ts";

// Inspector — launch the MCP Inspector for interactive debugging
export { launchInspector } from "./src/inspector/launcher.ts";
export type { InspectorOptions } from "./src/inspector/launcher.ts";

// ── Spec 2026-07-28 features ─────────────────────────────────────────────────

// Tasks extension (io.modelcontextprotocol/tasks, SEP-2663).
//
// `createTask` is what a tool handler returns to opt into async-task mode, so it
// has to be reachable from the package root — without it the extension is wired
// but unusable by any consumer.
export { createTask } from "./src/tasks/mod.ts";
export type {
  AsyncTaskDescriptor,
  DetailedTask,
  Task,
  TaskController,
  TaskStoreOptions,
} from "./src/tasks/mod.ts";

// MRTR — Multi Round-Trip Requests (SEP-2322).
//
// `InputRequiredSignal` is the shape a handler returns to ask the client for
// input. The seal/verify primitives are exported for consumers implementing their
// own transport; the framework seals automatically on `tools/call`.
export type {
  InputRequestEntry,
  InputRequestMethod,
  InputRequiredSignal,
  MemoryMrtrReplayStoreOptions,
  MrtrOptions,
  MrtrReplayStore,
} from "./src/mrtr/mod.ts";
export {
  exportStateKey,
  generateStateKey,
  MemoryMrtrReplayStore,
  sealRequestState,
  verifyRequestState,
} from "./src/mrtr/mod.ts";

// subscriptions/listen (SEP-2575).
//
// The registry is owned by McpApp; these are exported for consumers driving their
// own streams, and for the filter type used when narrowing what a deployment
// delivers.
export { SubscriptionRegistry } from "./src/subscriptions/subscription-registry.ts";
export type {
  SubscriptionFilter,
  SubscriptionRegistryOptions,
  SubscriptionSink,
} from "./src/subscriptions/subscription-registry.ts";
