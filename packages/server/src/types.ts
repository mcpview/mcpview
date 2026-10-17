/**
 * Type definitions for the MCP Concurrent Server Framework
 *
 * This module provides TypeScript types for building high-performance
 * MCP servers with built-in concurrency control and backpressure.
 *
 * @module lib/server/types
 */

import type {
  ClientCapabilities,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * Rate limit configuration
 */
export interface RateLimitOptions {
  /** Maximum requests per window */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /**
   * Function to extract client identifier from request context
   * Default: uses "default" for all requests (global rate limit)
   */
  keyExtractor?: (context: RateLimitContext) => string;

  /**
   * Behavior when rate limit is exceeded
   * - 'reject': Return error immediately
   * - 'wait': Wait for slot with backoff (default)
   */
  onLimitExceeded?: "reject" | "wait";
}

/**
 * Context passed to rate limit key extractor
 */
export interface RateLimitContext {
  /** Tool being called */
  toolName: string;

  /** Tool arguments */
  args: Record<string, unknown>;
}

/**
 * Configuration options for McpApp
 */
export interface McpAppOptions {
  /** Server name (shown in MCP protocol) */
  name: string;

  /** Server version */
  version: string;

  /** Maximum concurrent requests (default: 10) */
  maxConcurrent?: number;

  /** Backpressure strategy when at capacity (default: 'sleep') */
  backpressureStrategy?: "sleep" | "queue" | "reject";

  /** Sleep duration in ms for 'sleep' strategy (default: 10) */
  backpressureSleepMs?: number;

  /**
   * Rate limiting configuration
   * If provided, requests will be rate limited per client
   */
  rateLimit?: RateLimitOptions;

  /**
   * Enable JSON Schema validation for tool arguments (default: false)
   * When enabled, validates arguments against tool's inputSchema before execution
   */
  validateSchema?: boolean;

  /**
   * @deprecated No-op as of 0.24.0. The SamplingBridge was removed in the
   * MCP 2026-07-28 spec drop. Passing this option has zero effect and emits
   * a console warning at startup. Will be removed in 0.25.0.
   */
  enableSampling?: boolean;

  /**
   * Instructions for the LLM on how to use this server's tools.
   * Sent in the MCP initialize response. The LLM sees this before any tool call.
   */
  instructions?: string;

  /**
   * @deprecated No-op as of 0.24.0. The SamplingBridge was removed in the
   * MCP 2026-07-28 spec drop. Passing this option has zero effect and emits
   * a console warning at startup. Will be removed in 0.25.0.
   */
  samplingClient?: SamplingClient;

  /** Custom logger function (default: console.error) */
  logger?: (msg: string) => void;

  /**
   * Custom error handler for tool execution errors.
   *
   * When set, errors thrown by tool handlers are passed to this function.
   * Return a message string to produce `{ content: [{type:"text", text: msg}], isError: true }`
   * instead of re-throwing. Return null to rethrow as a JSON-RPC error.
   *
   * Default: undefined (all errors are re-thrown, existing behaviour).
   */
  toolErrorMapper?: ToolErrorMapper;

  /**
   * OAuth2/Bearer authentication configuration.
   * When provided, HTTP requests require a valid Bearer token.
   * STDIO transport is unaffected (local, no auth needed).
   */
  auth?: import("./auth/types.ts").AuthOptions;

  /**
   * Content Security Policy for HTML resources (MCP Apps).
   * When provided, injects a CSP `<meta>` tag into HTML content before serving.
   * This protects against XSS even in STDIO mode where HTTP headers are unavailable.
   *
   * @example
   * ```typescript
   * resourceCsp: { allowInline: true }
   * ```
   */
  resourceCsp?: import("./security/csp.ts").CspOptions;

  /**
   * Pre-declare the `resources` capability before transport connection.
   *
   * When true, installs `resources/list` and `resources/read` handlers at
   * construction time (before start/startHttp). Resources can then be added
   * dynamically after startup via registerResource() without hitting the
   * SDK's "Cannot register capabilities after connecting to transport" error.
   *
   * Use this when resources are discovered asynchronously (e.g., MCP relay/proxy
   * that discovers child servers after the stdio handshake).
   */
  expectResources?: boolean;

  /**
   * HTTP transport mode. Only `"stateless"` is supported as of spec 2026-07-28.
   *
   * Per-request transport: no handshake, no `Mcp-Session-Id`.
   * `protocolVersion` is read from
   * `params._meta["io.modelcontextprotocol/protocolVersion"]` on every
   * request. `GET /mcp` returns 405; use `subscriptions/listen` instead.
   */
  transport?: "stateless";

  /**
   * Cache hints emitted on list and read results (spec 2026-07-28,
   * `CacheableResult`, SEP-2549).
   *
   * `ttlMs` and `cacheScope` are **required** fields of those results, so the
   * framework always emits them. The defaults are deliberately inert:
   *
   * - `ttlMs: 0` — "revalidate every time", the HTTP `max-age=0` equivalent.
   *   Caching is a per-deployment decision: a server whose tool list is built
   *   from a live database must not have a stale window chosen for it. Opt in
   *   with a real value.
   * - `cacheScope: "private"` — shared intermediaries must not cache the
   *   response. Anything else would be unsafe by default here, since results can
   *   be scoped to the authenticated principal or tenant. Use `"public"` only for
   *   a server whose lists are genuinely identical for every caller.
   */
  cache?: {
    /** Freshness window in milliseconds. Default `0`. */
    ttlMs?: number;
    /** Whether shared caches may store the response. Default `"private"`. */
    scope?: "public" | "private";
  };

  /**
   * Authorization key a task is bound to, derived from the request that created it.
   *
   * A task can only be read, answered or cancelled by a caller whose key matches.
   * The default is the authenticated subject, which is right for a
   * single-authority deployment and **not enough** for anything that authorizes on
   * more than identity: a tenant-scoped server where the same subject may act for
   * several tenants needs the tenant in the key, or a task created under one
   * tenant stays reachable from another.
   *
   * The framework cannot derive that itself — tenancy lives in a consumer's own
   * middleware — so it is a hook rather than a guess. Return a stable string; it is
   * compared verbatim.
   *
   * **It must derive everything from its two arguments.** `tasks/*` requests do
   * not run the middleware pipeline, so anything a middleware injects into the
   * pipeline context — the built-in tenant middleware's `tenantId`, for instance —
   * is NOT visible here. Read the header, or resolve it yourself; the hook may be
   * async precisely so a lookup is possible. A hook that expects pipeline state
   * silently sees `undefined` on every call, which collapses every caller onto one
   * key.
   *
   * Returning an empty or non-string value is refused rather than accepted, since
   * that is what the obvious implementation yields when the value it reads is
   * absent, and accepting it would share tasks between callers.
   *
   * Called on task creation and on every `tasks/get` / `tasks/update` /
   * `tasks/cancel`. It must return the same key for the same caller across those
   * calls, or the creator stops being able to reach its own task (fail-closed).
   *
   * @example
   * ```typescript
   * taskOwnerKey: (authInfo, request) =>
   *   `${authInfo?.subject}@${request.headers.get("x-tenant-id")}`
   * ```
   */
  taskOwnerKey?: (
    authInfo: import("./auth/types.ts").AuthInfo | undefined,
    request: Request,
  ) => string | Promise<string>;

  /**
   * Multi Round-Trip Requests (spec 2026-07-28, SEP-2322).
   *
   * Configures how `requestState` is protected when a tool handler asks the
   * client for input mid-call. Consulted by stateless HTTP and by the v2 stdio
   * serving entry. On a legacy stdio connection the SDK fulfils the embedded
   * requests through its compatibility shim, then re-enters the same verified
   * handler; application code keeps one MRTR contract across both eras.
   *
   * Without `signingKey`, `requestState` travels unprotected and the server logs
   * a warning at startup. That is only acceptable when tampering with it can
   * cause nothing worse than the request failing.
   */
  mrtr?: import("./mrtr/mod.ts").MrtrOptions;

  /**
   * Protocol extensions this server declares (spec 2026-07-28).
   *
   * Keyed by reverse-DNS extension identifier — e.g.
   * `{ "io.modelcontextprotocol/tasks": {} }`. Surfaced under
   * `capabilities.extensions` on `server/discover` and `initialize`, and only
   * when non-empty: an empty object would assert "no extensions supported",
   * which is a claim the framework cannot make on a consumer's behalf.
   *
   * Declaring an extension here does not implement it — it advertises what the
   * consumer has wired up.
   */
  extensions?: Readonly<Record<string, unknown>>;
}

// ============================================
// MCP Apps Types (SEP-1865)
// ============================================

/**
 * MCP Apps UI metadata for tools (SEP-1865 + PML extensions)
 *
 * Mirrors the structural fields of the official MCP Apps `McpUiToolMeta`
 * contract and adds PML-specific `emits`/`accepts` fields for cross-UI sync
 * rules. Keeping this public declaration structural avoids leaking the
 * upstream package's internal declaration-module layout into Node consumers.
 *
 * @example
 * ```typescript
 * const tool: MCPTool = {
 *   name: "query_table",
 *   description: "Query database table",
 *   inputSchema: { ... },
 *   _meta: {
 *     ui: {
 *       resourceUri: "ui://mcp-std/table-viewer",
 *       emits: ["filter", "select"],
 *       accepts: ["setData", "highlight"]
 *     }
 *   }
 * };
 * ```
 */
export interface McpUiToolMeta {
  /**
   * Resource URI for the UI. MUST use ui:// scheme.
   * Narrows the optional base field to required for server tools.
   * @example "ui://mcp-std/table-viewer"
   */
  resourceUri: string;

  /**
   * Who can access this tool. Defaults to both the model and the app.
   */
  visibility?: Array<"model" | "app">;

  /** CSP belongs on the UI resource, not on tool metadata. */
  csp?: never;

  /** Permissions belong on the UI resource, not on tool metadata. */
  permissions?: never;

  /**
   * Events this UI can emit (PML extension for sync rules)
   * Used by PML orchestrator to build cross-UI event routing
   * @example ["filter", "select", "sort", "paginate"]
   */
  emits?: string[];

  /**
   * Events this UI can accept (PML extension for sync rules)
   * Used by PML orchestrator to build cross-UI event routing
   * @example ["setData", "highlight", "scrollTo"]
   */
  accepts?: string[];
}

/**
 * MCP Tool metadata container.
 *
 * Carries optional UI hints and routing metadata for MCP Apps (SEP-1865).
 */
export interface MCPToolMeta {
  /** UI configuration for rendering this tool's output in an MCP App */
  ui?: McpUiToolMeta;
}

/**
 * MCP Resource definition for registration
 */
export interface MCPResource {
  /**
   * Resource URI. SHOULD use ui:// scheme for MCP Apps.
   * @example "ui://mcp-std/table-viewer"
   */
  uri: string;

  /** Human-readable name */
  name: string;

  /** Description of the resource */
  description?: string;

  /** Optional display title, distinct from the protocol-required `name`. */
  title?: string;

  /** Optional visual hints advertised in `resources/list`. */
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;

  /** Optional client-facing resource annotations. */
  annotations?: {
    audience?: Array<"user" | "assistant">;
    priority?: number;
    lastModified?: string;
  };

  /** Optional protocol/extension metadata advertised in `resources/list`. */
  _meta?: Record<string, unknown>;

  /** MIME type, when known before the resource is read. */
  mimeType?: string;

  /**
   * Byte size of the resource when it is known.
   *
   * This is an exact byte-size attestation: when supplied, every read must
   * return exactly this many UTF-8 bytes for `text`, or decoded bytes for
   * `blob`. It is surfaced in `resources/list` so clients can make loading
   * decisions before reading. Must be a non-negative safe integer.
   */
  size?: number;
}

/**
 * Common fields of every resource response.
 */
interface ResourceContentBase {
  /** URI of the resource. It must exactly match the URI that was requested. */
  uri: string;
  /** Non-empty MIME type of the content. */
  mimeType: string;
  /** Optional MCP metadata passed through to the protocol response. */
  _meta?: Record<string, unknown>;
}

/** A UTF-8/text resource response. */
export interface TextResourceContent extends ResourceContentBase {
  /** Text payload, including HTML for MCP Apps. */
  text: string;
  /** Text and blob payloads are mutually exclusive. */
  blob?: never;
}

/** A binary resource response encoded as canonical standard base64. */
export interface BlobResourceContent extends ResourceContentBase {
  /** Standard, padded base64 payload. */
  blob: string;
  /** Text and blob payloads are mutually exclusive. */
  text?: never;
}

/**
 * Content returned by a resource handler.
 *
 * Exactly one payload form is allowed: `text` for text/HTML, or `blob` for
 * binary content encoded as canonical standard base64. The framework validates
 * the same XOR contract at runtime before writing the response, which keeps
 * JavaScript consumers and unchecked handler results on the protocol-safe path.
 */
export type ResourceContent = TextResourceContent | BlobResourceContent;

/**
 * Resource handler callback
 *
 * @param uri - The requested resource URI as URL object
 * @returns A text or base64-blob ResourceContent whose URI matches `uri`
 *
 * @example
 * ```typescript
 * const handler: ResourceHandler = async (uri) => ({
 *   uri: uri.toString(),
 *   mimeType: MCP_APP_MIME_TYPE,
 *   text: "<html>...</html>"
 * });
 *
 * // For binary content, return `blob` instead of `text`:
 * // { uri: uri.toString(), mimeType: "image/png", blob: "iVBORw0KGgo..." }
 * ```
 */
export type ResourceHandler = (
  uri: URL,
) => Promise<ResourceContent> | ResourceContent;

/** MCP Apps MIME type constant */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app" as const;

/** URI scheme for MCP Apps resources */
export const MCP_APP_URI_SCHEME = "ui:" as const;

/**
 * Well-known extension identifier for the MCP Apps protocol.
 *
 * Clients advertise MCP Apps support by including this key in
 * `clientCapabilities.extensions` (per the MCP SDK 1.29 extensions
 * feature). Servers read it via {@link getMcpAppsCapability} to decide
 * whether to register UI-rendering tools or fall back to text-only.
 *
 * @see {@link https://github.com/modelcontextprotocol/ext-apps | MCP Apps spec}
 */
export const MCP_APPS_EXTENSION_ID = "io.modelcontextprotocol/ui" as const;

/**
 * MCP Apps protocol spec version this package targets.
 *
 * Matches the dated spec at
 * https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
 *
 * Bump this constant in the same commit that adopts a newer dated spec.
 */
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26" as const;

/**
 * MCP Apps capability advertised by a client.
 *
 * Returned by {@link getMcpAppsCapability} after reading
 * `clientCapabilities.extensions[MCP_APPS_EXTENSION_ID]`.
 *
 * The capability object is intentionally minimal — the spec keeps it
 * extensible by adding fields rather than removing them, so consumers
 * MUST tolerate unknown fields.
 */
export interface McpAppsClientCapability {
  /**
   * MIME types the client can render as MCP Apps.
   *
   * Typically includes `"text/html;profile=mcp-app"`. An empty or
   * absent array means the client advertised support but listed no
   * concrete mime types — defensively assume nothing.
   */
  mimeTypes?: string[];
}

/**
 * Read the MCP Apps capability from a client's advertised capabilities.
 *
 * Best-effort, defensive reader. Returns `undefined` for any of:
 * - `null` / `undefined` input
 * - `clientCapabilities` without an `extensions` field
 * - `extensions` without the {@link MCP_APPS_EXTENSION_ID} key
 * - extension value that is not a plain object (string, number, null, ...)
 *
 * Malformed `mimeTypes` (wrong type, non-string entries) are silently
 * filtered rather than thrown — agents reading this function need a
 * predictable contract that never crashes downstream consumers on
 * untrusted client data.
 *
 * **Validation scope:** this function only validates the *type* of
 * `mimeTypes` entries (must be string). It does NOT validate that the
 * strings look like valid mime types (e.g. empty strings or garbage
 * content pass through). Consumers should compare against known
 * constants like {@link MCP_APP_MIME_TYPE} via `.includes()` rather
 * than treating the array as a generic allowlist.
 *
 * @param clientCapabilities - The `ClientCapabilities` object from the
 *   MCP SDK initialize handshake. May be `null` or `undefined` if the
 *   client never sent capabilities.
 * @returns The MCP Apps capability if the client advertised support,
 *   otherwise `undefined`.
 *
 * @example
 * ```typescript
 * const cap = getMcpAppsCapability(client.getClientCapabilities());
 * if (cap?.mimeTypes?.includes(MCP_APP_MIME_TYPE)) {
 *   // register UI-rendering tools
 * } else {
 *   // register text-only fallback tools
 * }
 * ```
 */
export function getMcpAppsCapability(
  clientCapabilities:
    | (Record<string, unknown> & { extensions?: Record<string, unknown> })
    | null
    | undefined,
): McpAppsClientCapability | undefined {
  if (clientCapabilities === null || clientCapabilities === undefined) {
    return undefined;
  }
  const extensions = clientCapabilities.extensions;
  if (extensions === null || typeof extensions !== "object") {
    return undefined;
  }
  const raw = extensions[MCP_APPS_EXTENSION_ID];
  if (raw === null || typeof raw !== "object") {
    return undefined;
  }
  // We have a capability object — extract known fields defensively.
  const result: McpAppsClientCapability = {};
  const rawMimeTypes = (raw as Record<string, unknown>).mimeTypes;
  if (Array.isArray(rawMimeTypes)) {
    const validMimeTypes = rawMimeTypes.filter(
      (m): m is string => typeof m === "string",
    );
    if (validMimeTypes.length > 0) {
      result.mimeTypes = validMimeTypes;
    }
  }
  return result;
}

// ============================================
// MCP Tool Types
// ============================================

/**
 * Behavioural hints for model clients (MCP SDK 1.27 ToolAnnotations).
 * Passed through in tools/list so hosts can adapt their UI accordingly.
 */
export interface ToolAnnotations {
  /** Short human-readable title, may differ from tool name */
  title?: string;
  /** If true, tool has no side-effects and is safe to call speculatively */
  readOnlyHint?: boolean;
  /** If true, executing may produce irreversible effects */
  destructiveHint?: boolean;
  /** If true, repeated calls with same args produce same result */
  idempotentHint?: boolean;
  /** If true, tool may interact with entities outside the MCP system */
  openWorldHint?: boolean;
}

/**
 * MCP Tool definition (compatible with MCP protocol)
 */
export interface MCPTool {
  /** Tool name */
  name: string;

  /** Human-readable description */
  description: string;

  /** JSON Schema for tool input */
  inputSchema: Record<string, unknown>;

  /**
   * JSON Schema for the tool's structured output (MCP SDK 1.27).
   * Passed through in tools/list so hosts can validate tool results.
   */
  outputSchema?: Record<string, unknown>;

  /** Behavioural hints passed to model clients */
  annotations?: ToolAnnotations;

  /**
   * Tool metadata including UI configuration for MCP Apps
   * @see McpUiToolMeta
   */
  _meta?: MCPToolMeta;

  /**
   * Required OAuth scopes to call this tool.
   * Enforced for HTTP calls. A scoped HTTP tool fails closed when the server has
   * no auth provider or the authenticated caller lacks one of these scopes.
   * STDIO is a trusted local transport and does not apply OAuth scope checks.
   * If empty or undefined, no scope check is performed.
   */
  requiredScopes?: string[];
}

/**
 * Tool handler function.
 *
 * Receives validated arguments and returns a result (or throws).
 * The return value is serialised as JSON inside a `text` content block.
 *
 * **Security**: Never pass `args` values directly to shell commands or SQL.
 * Always validate / sanitise inside the handler or via `inputSchema`.
 *
 * @param args - Validated tool arguments from the MCP client
 * @returns Tool result (string, object, or Promise thereof)
 *
 * @example
 * ```typescript
 * const handler: ToolHandler = async (args) => {
 *   const rows = await db.query(args.sql as string);
 *   return { rows, count: rows.length };
 * };
 * ```
 */
export interface ToolHandlerContext {
  readonly toolName: string;
  readonly request?: Request;
  readonly sessionId?: string;
  readonly authInfo?: import("./auth/types.ts").AuthInfo;
  readonly clientInfo?: Implementation;
  readonly clientCapabilities?: ClientCapabilities;

  /**
   * Answers to a previous `InputRequiredResult`, keyed by the ids the server
   * assigned (spec 2026-07-28 MRTR).
   *
   * Present only on a retry. Read from `params.inputResponses` — a sibling of
   * `_meta`, not a member of it, unlike every other per-request field. Getting
   * that wrong yields a silent `undefined` even when the client sent them.
   */
  readonly inputResponses?: Record<string, unknown>;

  /**
   * True when the client echoed a `requestState` that passed integrity
   * verification, so the handler may trust this is a legitimate retry of its own
   * earlier request.
   *
   * The token carries no application state — it binds the principal, method,
   * argument digest and expiry. Since the digest guarantees the arguments are
   * byte-identical to the original call, a handler reconstructs its context from
   * those arguments rather than from the token.
   */
  readonly retryVerified?: boolean;

  /**
   * Log level requested for this call (spec 2026-07-28), read from
   * `params._meta["io.modelcontextprotocol/logLevel"]`.
   *
   * `undefined` means the client requested no logging. A handler **MUST NOT**
   * emit `notifications/message` in that case — the level is not a filter you
   * may default, it is the client's opt-in.
   */
  readonly logLevel?: import("./middleware/types.ts").McpLogLevel;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx?: ToolHandlerContext,
) => Promise<unknown> | unknown;

/**
 * Structured tool result: separates the LLM text summary (content)
 * from the machine-readable payload (structuredContent).
 *
 * When a ToolHandler returns this shape, the framework produces a
 * CallToolResult with both `content` and `structuredContent` set,
 * keeping heavy data out of the LLM context.
 */
export interface StructuredToolResult {
  /** Human-readable summary shown in content[0].text */
  content: string;
  /** Structured data conforming to the tool's outputSchema */
  structuredContent: Record<string, unknown>;
}

/**
 * Maps a thrown error to either a business error result (isError: true)
 * or signals that the error should be re-thrown as a JSON-RPC error.
 *
 * @returns A message string to produce `{ isError: true }`, or null to rethrow.
 */
export type ToolErrorMapper = (
  error: unknown,
  toolName: string,
) => string | null;

/**
 * Sampling client interface — no-op as of 0.24.0. The SamplingBridge was
 * removed with MCP 2026-07-28. This type is kept for source compatibility
 * only and will be removed in 0.25.0.
 *
 * @deprecated No-op as of 0.24.0. Will be removed in 0.25.0.
 */
export interface SamplingClient {
  /**
   * Request LLM completion from the client
   * @param params - Sampling parameters (messages, tools, etc.)
   * @returns Completion result with content and stop reason
   */
  createMessage(params: SamplingParams): Promise<SamplingResult>;
}

/**
 * Parameters for sampling request — no-op as of 0.24.0.
 *
 * @deprecated No-op as of 0.24.0. Will be removed in 0.25.0.
 */
export interface SamplingParams {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Tools available for the agent to use. Client handles execution. */
  tools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  /** "auto" = LLM decides, "required" = must use tool, "none" = no tools */
  toolChoice?: "auto" | "required" | "none";
  maxTokens?: number;
  /** Hint for client: max agentic loop iterations */
  maxIterations?: number;
  /** Tool name patterns to filter (e.g., ['git_*', 'vfs_*']) */
  allowedToolPatterns?: string[];
}

/**
 * Result from sampling request — no-op as of 0.24.0.
 *
 * @deprecated No-op as of 0.24.0. Will be removed in 0.25.0.
 */
export interface SamplingResult {
  content: Array<{
    type: string;
    text?: string;
    name?: string;
    input?: Record<string, unknown>;
  }>;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

/**
 * Queue metrics for monitoring
 */
export interface QueueMetrics {
  /** Number of requests currently executing */
  inFlight: number;

  /** Number of requests waiting in queue */
  queued: number;
}

/**
 * Promise resolver for pending requests
 */
export interface PromiseResolver<T = unknown> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Request queue options
 */
export interface QueueOptions {
  maxConcurrent: number;
  strategy: "sleep" | "queue" | "reject";
  sleepMs: number;
}

// ============================================
// HTTP Server Types
// ============================================

/**
 * Context passed to HTTP rate limit key extractor
 */
export interface HttpRateLimitContext {
  /** Client IP address (from x-forwarded-for/x-real-ip) */
  ip: string;

  /** HTTP method */
  method: string;

  /** HTTP path (e.g. /mcp) */
  path: string;

  /** HTTP headers */
  headers: Headers;

  /** MCP session ID, if present */
  sessionId?: string;
}

/**
 * HTTP rate limit configuration
 */
export interface HttpRateLimitOptions {
  /** Maximum requests per window */
  maxRequests: number;

  /** Time window in milliseconds */
  windowMs: number;

  /**
   * Function to extract client identifier from HTTP context
   * Default: uses IP address
   */
  keyExtractor?: (context: HttpRateLimitContext) => string;

  /**
   * Behavior when rate limit is exceeded
   * - 'reject': Return error immediately
   * - 'wait': Wait for slot with backoff
   */
  onLimitExceeded?: "reject" | "wait";
}

/**
 * Options for starting an HTTP server
 */
// Re-exported from the runtime port so consumers can import the canonical
// fetch handler type from the same module as HttpServerOptions.
export type { FetchHandler } from "./runtime/types.ts";
import type { FetchHandler } from "./runtime/types.ts";

export interface HttpServerOptions {
  /**
   * Port to listen on. Ignored when {@link embedded} is `true`.
   */
  port: number;

  /** Hostname to bind to (default: "0.0.0.0") */
  hostname?: string;

  /** Enable CORS (default: true) */
  cors?: boolean;

  /**
   * Allowed CORS origins (default: "*")
   * Use an allowlist in production.
   */
  corsOrigins?: "*" | string[];

  /**
   * Maximum request body size in bytes (default: 1_000_000).
   * Set to null to disable the limit.
   */
  maxBodyBytes?: number | null;

  /**
   * Require auth for HTTP mode. If true and auth is not configured, startHttp throws.
   */
  requireAuth?: boolean;

  /**
   * IP-based rate limiting for HTTP endpoints.
   */
  ipRateLimit?: HttpRateLimitOptions;

  /**
   * Custom HTTP routes registered alongside MCP protocol routes.
   * Uses Web standard Request/Response (no framework dependency).
   */
  customRoutes?: Array<{
    method: "get" | "post";
    path: string;
    handler: (req: Request) => Response | Promise<Response>;
  }>;

  /**
   * Callback when server is ready
   * @param info - Server address info
   */
  onListen?: (info: { hostname: string; port: number }) => void;

  /**
   * Embedded mode: skip binding a port and instead surface the Hono fetch
   * handler via the {@link embeddedHandlerCallback} option. Used by
   * {@link McpApp.getFetchHandler} so consumers (Fresh, Hono,
   * Express, etc.) can mount the MCP HTTP stack inside their own server
   * without giving up port ownership.
   *
   * When `true`, `port`, `hostname`, and `onListen` are ignored.
   */
  embedded?: boolean;

  /**
   * Receives the Hono fetch handler when running in embedded mode.
   * Required when {@link embedded} is `true`. Called exactly once,
   * synchronously, before `startHttp` returns.
   *
   * Most consumers should use {@link McpApp.getFetchHandler}
   * instead of setting this directly.
   */
  embeddedHandlerCallback?: (handler: FetchHandler) => void;
}

/**
 * HTTP server instance returned by startHttp
 */
export interface HttpServerInstance {
  /** Shutdown the HTTP server */
  shutdown(): Promise<void>;

  /** Server address info */
  addr: { hostname: string; port: number };
}
