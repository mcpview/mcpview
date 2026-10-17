/**
 * McpApp — Hono-style framework for MCP servers
 *
 * High-performance MCP server with built-in concurrency control
 * and backpressure.
 *
 * Wraps the official MCP server packages with middleware, auth, and
 * observability features.
 *
 * @module lib/server/mcp-app
 */

import {
  type CallToolRequest,
  type CallToolResult,
  type ClientCapabilities,
  type Implementation,
  type InputRequiredResult,
  type ListResourcesResult,
  type ListToolsResult,
  ProtocolError,
  ProtocolErrorCode,
  type ReadResourceRequest,
  Server,
  type ServerCapabilities,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  serveStdio,
  type StdioServerHandle,
} from "@modelcontextprotocol/server/stdio";
import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { RequestQueue } from "./concurrency/request-queue.ts";
import { RateLimiter } from "./concurrency/rate-limiter.ts";
import {
  type CompiledSchemaValidator,
  SchemaValidator,
} from "./validation/schema-validator.ts";
import { createMiddlewareRunner } from "./middleware/runner.ts";
import { createRateLimitMiddleware } from "./middleware/rate-limit.ts";
import { createValidationMiddleware } from "./middleware/validation.ts";
import { createBackpressureMiddleware } from "./middleware/backpressure.ts";
import type {
  McpLogLevel,
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
} from "./middleware/types.ts";
import { serve, type ServeHandle, unrefTimer } from "./runtime/runtime.ts";
import {
  AuthError,
  createAuthMiddleware,
  createForbiddenResponse,
  createUnauthorizedResponse,
  extractBearerToken,
  freezeAuthInfo,
} from "./auth/middleware.ts";
import { createScopeMiddleware } from "./auth/scope-middleware.ts";
import { createAuthProviderFromConfig, loadAuthConfig } from "./auth/config.ts";
import type { AuthProvider } from "./auth/provider.ts";
import type { AuthInfo } from "./auth/types.ts";
import type {
  FetchHandler,
  HttpRateLimitContext,
  HttpServerOptions,
  McpAppOptions,
  McpAppsClientCapability,
  MCPResource,
  MCPTool,
  QueueMetrics,
  ResourceContent,
  ResourceHandler,
  StructuredToolResult,
  ToolHandler,
} from "./types.ts";
import { getMcpAppsCapability, MCP_APP_MIME_TYPE } from "./types.ts";
import { discoverViewers, resolveViewerDistPath } from "./ui/viewer-utils.ts";
import type { DiscoverViewersFS } from "./ui/viewer-utils.ts";
import { buildCspHeader, injectCspMetaTag } from "./security/csp.ts";
import {
  collectMirroredParams,
  type MirroredParam,
  validateRequestHeaders,
} from "./transport/request-headers.ts";
import {
  type DetailedTask,
  isAsyncTaskDescriptor,
  TaskStore,
} from "./tasks/mod.ts";
import {
  checkInputRequestCapabilities,
  guardMrtrRetry,
  importStateKey,
  type InputRequestEntry,
  type InputRequiredSignal,
  MemoryMrtrReplayStore,
  type MrtrReplayStore,
  paramsDigest,
  sealRequestState,
} from "./mrtr/mod.ts";
import {
  buildAcknowledgedMessage,
  encodeSSEEvent,
  type SubscriptionFilter,
  SubscriptionRegistry,
  type SubscriptionSink,
} from "./subscriptions/subscription-registry.ts";
import { ServerMetrics } from "./observability/metrics.ts";
import type { SpanContext } from "@opentelemetry/api";
import {
  endToolCallSpan,
  parseTraceParent,
  startToolCallSpan,
} from "./observability/otel.ts";
import {
  BodyTooLargeError,
  DEFAULT_MAX_BODY_BYTES,
  getClientIpFromHeaders,
  readBodyWithLimit,
} from "./http/body.ts";
import {
  bytesToHexLocal,
  callerPrincipal,
  noOwnerKeyError,
  noPrincipalError,
  taskOwnerKeyFor,
} from "./http/request-guards.ts";
import {
  isRecord,
  jsonRpcResponse,
  MRTR_NO_AUTH_PRINCIPAL,
} from "./http/wire.ts";

/**
 * Private per-call binding to one exact tool definition.
 *
 * Live registration can replace a tool while another call is waiting in auth
 * or backpressure. Scope enforcement and handler dispatch must use the same
 * snapshot or a request admitted for the old tool could execute the new one.
 */
const BOUND_TOOL = Symbol("McpApp.boundTool");
const COMPILED_INPUT_SCHEMA = Symbol("McpApp.compiledInputSchema");

/**
 * Tool definition with its executable policies.
 */
interface ToolWithHandler extends MCPTool {
  handler: ToolHandler;
  [COMPILED_INPUT_SCHEMA]?: CompiledSchemaValidator;
}

type ToolExecutionContext = MiddlewareContext & {
  [BOUND_TOOL]?: ToolWithHandler;
};

interface ToolExecutionResult {
  result: MiddlewareResult;
  tool?: ToolWithHandler;
}

/**
 * Internal tracking of registered resources
 */
interface RegisteredResourceInfo {
  resource: MCPResource;
  handler: ResourceHandler;
}

// ── Track A (spec 2026-07-28) — Stateless transport constants ───────────────

/** Namespaced protocolVersion key in params._meta (spec 2026-07-28) */
const STATELESS_PROTO_KEY = "io.modelcontextprotocol/protocolVersion";

/** Namespaced clientInfo key in params._meta (SEP-2575 stateless transport) */
const STATELESS_CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";

/** Namespaced clientCapabilities key in params._meta (SEP-2575 stateless transport) */
const STATELESS_CLIENT_CAPABILITIES_KEY =
  "io.modelcontextprotocol/clientCapabilities";

/** Protocol versions accepted by this server in stateless mode */
const STATELESS_SUPPORTED_VERSIONS: readonly string[] = [
  "2026-07-28",
];

/** Namespaced serverInfo key in a result's _meta (spec 2026-07-28, SHOULD) */
const STATELESS_SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

/**
 * Namespaced per-request log level in params._meta (spec 2026-07-28).
 * Replaces the removed `logging/setLevel` RPC: the level is now scoped to the
 * request that asked for it, so there is no server-side level to mutate.
 */
const STATELESS_LOG_LEVEL_KEY = "io.modelcontextprotocol/logLevel";

/**
 * W3C trace context keys in `params._meta` (spec 2026-07-28, SEP-414).
 *
 * Unlike every other per-request field these are NOT namespaced — the revision
 * documents the bare W3C names, so that a `_meta` envelope carries the same
 * key a caller would put in an HTTP header.
 */
const TRACEPARENT_KEY = "traceparent";
const TRACESTATE_KEY = "tracestate";

/** Protocol version whose wire format this server implements natively */
const SPEC_2026_07_28 = "2026-07-28";

/**
 * Tasks extension identifier (SEP-2663).
 *
 * Declaring it in `McpAppOptions.extensions` is what switches the extension on.
 * The spec forbids returning a task handle to a client that did not declare
 * support, and forbids advertising an extension we do not implement — so the
 * declaration gates both directions.
 */
const TASKS_EXTENSION_ID = "io.modelcontextprotocol/tasks";

/** Version echoed in MCP-Protocol-Version header on error responses (server's only accepted version) */
const STATELESS_FALLBACK_VERSION = "2026-07-28";

const JSONRPC_INVALID_PARAMS = ErrorCode.InvalidParams;

// ── Error codes (spec 2026-07-28, allocation policy) ────────────────────────
//
// The final spec partitions the JSON-RPC server-error range:
//   -32000..-32019  implementation-defined (existing SDK usage grandfathered)
//   -32020..-32099  reserved for the MCP specification
//
// The codes below were renumbered between the May 2026 Release Candidate — which
// 0.21.0 shipped against — and the final revision. Do not "restore" the RC
// values: -32001 and -32004 no longer carry these MCP-defined meanings.
//
// Note the policy is stricter than "the low range is grandfathered": the spec
// says new implementations SHOULD NOT use -32000..-32019 at all, and MUST NOT
// emit -32002 (which 2025-11-25 used for resource-not-found). Our auth and
// session errors therefore live outside the reserved range entirely — see
// auth/middleware.ts.

/** Headers disagree with the request body, or a required header is missing. */
const MCP_HEADER_MISMATCH = -32020;

/**
 * Client did not declare a capability the request requires.
 *
 * Emitted by the Tasks extension guard. `data.requiredCapabilities` must list
 * the missing capabilities alongside it.
 */
const MCP_MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;

/** Requested protocol version is not one this server implements. */
const MCP_UNSUPPORTED_PROTOCOL_VERSION = -32022;

interface StatelessClientMeta {
  readonly clientInfo?: Implementation;
  readonly clientCapabilities?: ClientCapabilities;
  readonly logLevel?: McpLogLevel;
  /** Caller's W3C trace context, so the tool span joins their trace. */
  readonly traceContext?: SpanContext;
}

/**
 * Read the W3C trace context out of `params._meta` (spec 2026-07-28, SEP-414).
 *
 * A malformed header leaves the span unparented rather than failing the call:
 * losing the trace join is an observability gap, refusing the tool call would
 * be an outage.
 *
 * `baggage` is deliberately NOT read. It is an unbounded, caller-controlled
 * key/value list that routinely carries tenant, user and session identifiers,
 * and the only thing this server could do with it is copy it into spans —
 * exporting whatever a caller put there to the trace backend, with no way to
 * know whether it holds a PII or a secret. Propagating it properly means the
 * OTel baggage API and an explicit allowlist of keys; until there is a use case
 * asking for that, reading it at all is a liability. The key stays reserved by
 * the spec, and this server ignores it.
 */
function readTraceContext(
  meta: Record<string, unknown>,
): { traceContext?: SpanContext } {
  const traceContext = parseTraceParent(
    meta[TRACEPARENT_KEY],
    meta[TRACESTATE_KEY],
  );
  return traceContext ? { traceContext } : {};
}

/** Valid `io.modelcontextprotocol/logLevel` values (RFC 5424 severities). */
const MCP_LOG_LEVELS: readonly McpLogLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

/**
 * Read the per-request log level out of `params._meta`.
 *
 * An unrecognized value is dropped rather than rejected: the level is an
 * optional hint, and failing a whole tool call because a client sent
 * `"verbose"` would be a worse outcome than emitting nothing.
 */
function readLogLevel(meta: Record<string, unknown>): McpLogLevel | undefined {
  const raw = meta[STATELESS_LOG_LEVEL_KEY];
  return typeof raw === "string" && MCP_LOG_LEVELS.includes(raw as McpLogLevel)
    ? raw as McpLogLevel
    : undefined;
}

/**
 * Validate the client-owned subscriptions/listen filter before it reaches the
 * registry. The registry deliberately works with a typed SubscriptionFilter;
 * casting untrusted JSON into it made truthy values subscribe to list changes
 * and let invalid URI entries reach the SSE acknowledgement.
 */
function validateSubscriptionFilter(
  filter: Record<string, unknown>,
):
  | { ok: true; filter: SubscriptionFilter }
  | {
    ok: false;
    message: string;
    bodyField: string;
    recovery: string;
  } {
  for (
    const field of [
      "toolsListChanged",
      "promptsListChanged",
      "resourcesListChanged",
    ] as const
  ) {
    if (filter[field] !== undefined && typeof filter[field] !== "boolean") {
      return {
        ok: false,
        message: `${field} must be a boolean when present`,
        bodyField: `params.notifications.${field}`,
        recovery:
          `Send ${field} as true or false, or omit it when that notification type is not requested.`,
      };
    }
  }

  for (const field of ["resourceSubscriptions", "taskIds"] as const) {
    const value = filter[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      return {
        ok: false,
        message: `${field} must be an array of strings when present`,
        bodyField: `params.notifications.${field}`,
        recovery:
          `Send ${field} as an array of strings, or omit it when no identifiers are requested.`,
      };
    }
    const malformedIndex = value.findIndex((entry) =>
      typeof entry !== "string"
    );
    if (malformedIndex !== -1) {
      return {
        ok: false,
        message: `${field} entries must be strings`,
        bodyField: `params.notifications.${field}[${malformedIndex}]`,
        recovery:
          `Send only string entries in ${field}; remove or replace the malformed entry.`,
      };
    }
  }

  return { ok: true, filter: filter as SubscriptionFilter };
}

/**
 * Stamp a result with the spec-2026-07-28 envelope: the required `resultType`
 * (SEP-2322) and the server's identity under `_meta` (SEP-2575, SHOULD).
 *
 * `_meta` is merged, never replaced — tool results carry their own `_meta` (MCP
 * Apps UI hints, for instance) and losing it would break the viewers.
 *
 * Pure by design so the envelope can be asserted directly in tests without
 * standing up a server; the caller decides whether the envelope applies.
 */
function completeResult(
  result: Record<string, unknown>,
  serverInfo: Implementation,
): Record<string, unknown> {
  const existingMeta = isRecord(result["_meta"]) ? result["_meta"] : undefined;
  return {
    ...result,
    resultType: "complete",
    _meta: { ...existingMeta, [STATELESS_SERVER_INFO_KEY]: serverInfo },
  };
}

/**
 * Reduce a handler-built result to the exact JSON object that will cross the
 * transport boundary. Preformatted proxy results bypass the normal text
 * serialisation path, so without this gate a BigInt or cycle could be stored as
 * a completed task and only explode on a later tasks/get response.
 */
function canonicaliseWireResult(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const serialised = JSON.stringify(result);
  if (serialised === undefined) {
    throw new Error("Tool result is not JSON-serialisable");
  }
  const canonical = JSON.parse(serialised);
  if (!isRecord(canonical)) {
    throw new Error("Tool result must serialise to an object");
  }
  return canonical;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * McpApp provides a high-performance MCP server
 *
 * Features:
 * - Wraps official @modelcontextprotocol/sdk
 * - Concurrency limiting (default: 10 max concurrent)
 * - Multiple backpressure strategies (sleep/queue/reject)
 * - Metrics for monitoring
 * - Graceful shutdown
 *
 * @example
 * ```typescript
 * const server = new McpApp({
 *   name: "my-server",
 *   version: "1.0.0",
 *   maxConcurrent: 5,
 *   backpressureStrategy: 'queue'
 * });
 *
 * server.registerTools(myTools, myHandlers);
 * await server.start();
 * ```
 */
export class McpApp {
  /**
   * Server name — the identifier reported to MCP clients in `InitializeResult.serverInfo.name`.
   *
   * Exposed as a public readonly field (0.16.1) so consumers can use it for
   * log prefixes, tracing context, or any UI that wants to echo the server
   * identity without having to thread `options.name` through their code.
   * Immutable after construction, same value that appears in the MCP
   * `initialize` response.
   */
  public readonly name: string;
  private requestQueue: RequestQueue;
  private rateLimiter: RateLimiter | null = null;
  private schemaValidator: SchemaValidator | null = null;
  private tools = new Map<string, ToolWithHandler>();

  /**
   * Tool name → parameters the tool asked clients to mirror into
   * `Mcp-Param-{Name}` headers (spec 2026-07-28, `x-mcp-header`).
   *
   * Populated at registration so the per-request path is a map lookup rather
   * than a schema walk. Tools without annotations are simply absent.
   */
  private mirroredParams = new Map<string, MirroredParam[]>();

  /**
   * Task store for the Tasks extension, or `null` when the consumer did not
   * declare it.
   *
   * Created only on declaration: a server not using Tasks should not pay for a
   * sweep timer, and a `tasks/*` call against it must read as the unimplemented
   * method it is (404 + -32601) rather than hitting an empty store.
   */
  private taskStore: TaskStore | null;

  /**
   * Set synchronously at the top of `stop()`.
   *
   * Checked before spawning a task, because the pipeline is async: a handler that
   * settles during shutdown would otherwise start work in a store already drained,
   * producing a task that outlives its server. A synchronous flag is what makes
   * the check reliable — anything awaited leaves the same window open.
   */
  private stopping = false;

  /**
   * Live `subscriptions/listen` streams.
   *
   * Initialized unconditionally in startHttp(); null before the server starts
   * or in stdio mode.
   */
  private subscriptions: SubscriptionRegistry | null = null;

  /** Era-aware stdio serving handle, present only while start() is active. */
  private stdioHandle: StdioServerHandle | null = null;

  /** Protocol instance pinned by the stdio era negotiator, when connected. */
  private activeStdioServer: Server | null = null;

  /**
   * Imported HMAC key for sealing `requestState`, or `null` when the deployment
   * configured none.
   *
   * Resolved lazily on first use rather than in the constructor, because
   * `importStateKey` is async and a constructor cannot await.
   */
  /**
   * In-flight or resolved key import.
   *
   * A Promise, not a value plus a loaded flag: the flag was set before the await,
   * so a second request arriving during the import saw "loaded" with the key
   * still null, received an UNSIGNED requestState, and could then submit raw
   * inputResponses past the verification guard. Memoising the Promise makes every
   * caller await the same import.
   */
  private mrtrKeyPromise: Promise<CryptoKey | null> | null = null;

  /**
   * Consumes a verified requestState nonce before the handler runs.
   *
   * A signed deployment always has a store: process-local by default, or the
   * shared atomic implementation supplied by the consumer.
   */
  private readonly mrtrReplayStore: MrtrReplayStore | null;

  /**
   * Validated `ttlMs`. The spec requires servers to provide a value `>= 0`, and
   * an integer — clients are told to ignore a negative one, which would make a
   * misconfiguration silently do nothing instead of failing.
   *
   * Resolved once at construction: a per-response check would pay for the same
   * validation on every list call, and a bad value is a deployment error that
   * should surface at startup (AX: fast fail early).
   */
  private readonly cacheTtlMs: number;
  private resources = new Map<string, RegisteredResourceInfo>();
  private options: McpAppOptions;
  private started = false;
  private resourceHandlersInstalled = false;

  // Middleware pipeline
  private customMiddlewares: Middleware[] = [];
  private middlewareRunner:
    | ((ctx: MiddlewareContext) => Promise<MiddlewareResult>)
    | null = null;

  // Auth provider (set from options.auth or auto-configured from env)
  private authProvider: AuthProvider | null = null;

  // Observability
  private serverMetrics = new ServerMetrics();

  constructor(options: McpAppOptions) {
    this.options = options;
    this.name = options.name;

    // enableSampling / samplingClient are no-ops since 0.24.0 (SamplingBridge
    // was removed with MCP 2026-07-28). Warn loudly so migrating consumers
    // know immediately rather than discovering it silently in production.
    if (options.enableSampling || options.samplingClient) {
      (options.logger ?? console.error)(
        "[McpApp] WARNING: enableSampling and samplingClient have no effect " +
          "as of 0.24.0 — the SamplingBridge was removed with MCP 2026-07-28. " +
          "Remove these options from your McpApp constructor call.",
      );
    }

    const ttlMs = options.cache?.ttlMs ?? 0;
    if (!Number.isInteger(ttlMs) || ttlMs < 0) {
      throw new Error(
        `[McpApp] cache.ttlMs must be a non-negative integer (got ${ttlMs}). ` +
          "The spec requires servers to provide ttlMs >= 0, and clients are told " +
          "to ignore a negative value — so a bad one would silently disable " +
          "caching instead of failing.",
      );
    }
    this.cacheTtlMs = ttlMs;

    this.taskStore = options.extensions?.[TASKS_EXTENSION_ID] !== undefined
      ? new TaskStore({
        onNotification: (task) => this.onTaskChanged(task),
        unrefTimer: (id) => unrefTimer(id as unknown as number),
      })
      : null;

    // Validate the shape of the MRTR key here rather than on first use. The
    // import itself is async so it stays lazy, but a typo in a 64-hex-character
    // secret should surface at boot, not on the first request that needs it —
    // by which point it is a runtime failure in production traffic.
    const mrtrKey = options.mrtr?.signingKey;
    if (mrtrKey !== undefined && !/^[0-9a-f]{64}$/.test(mrtrKey)) {
      throw new Error(
        "[McpApp] mrtr.signingKey must be 64 lowercase hex characters (32 bytes). " +
          "Generate one with: crypto.getRandomValues(new Uint8Array(32)) rendered as hex, " +
          "or the exported generateStateKey() + exportStateKey() helpers.",
      );
    }
    if (
      options.mrtr?.replayStore !== undefined && mrtrKey === undefined
    ) {
      throw new Error(
        "[McpApp] mrtr.replayStore requires mrtr.signingKey. " +
          "Only a verified token exposes a trusted nonce to consume.",
      );
    }
    this.mrtrReplayStore = mrtrKey === undefined
      ? null
      : options.mrtr?.replayStore ?? new MemoryMrtrReplayStore();
    if (mrtrKey !== undefined && options.mrtr?.replayStore === undefined) {
      (options.logger ?? console.error)(
        "[McpApp] WARNING: MRTR replay protection is process-local. " +
          "Load-balanced deployments must configure one shared atomic mrtr.replayStore.",
      );
    }

    // Create request queue with concurrency control
    this.requestQueue = new RequestQueue({
      maxConcurrent: options.maxConcurrent ?? 10,
      strategy: options.backpressureStrategy ?? "sleep",
      sleepMs: options.backpressureSleepMs ?? 10,
    });

    // Optional rate limiting
    if (options.rateLimit) {
      this.rateLimiter = new RateLimiter({
        maxRequests: options.rateLimit.maxRequests,
        windowMs: options.rateLimit.windowMs,
      });
    }

    // Optional schema validation
    if (options.validateSchema) {
      this.schemaValidator = new SchemaValidator();
    }

    // A stdio probe may be discarded before a legacy fallback is opened. The
    // official serving entry therefore requires a factory, and every factory
    // invocation must receive a fresh protocol instance. Registries and the
    // middleware pipeline remain on McpApp; handlers close over those maps.
    this.resourceHandlersInstalled = options.expectResources === true;
  }

  /** Build one unconnected SDK server for one negotiated stdio era. */
  private createProtocolServer(): Server {
    const cacheHint = {
      ttlMs: this.cacheTtlMs,
      cacheScope: this.options.cache?.scope ?? "private",
    } as const;
    // Tasks currently have an HTTP adapter only. Keep its extension out of
    // stdio discovery until the same application port is served here; claiming
    // it and answering every tasks/* call with MethodNotFound would make the
    // capability declaration a lie. Other consumer-declared extensions remain
    // transport-neutral.
    const stdioExtensions = Object.fromEntries(
      Object.entries(this.options.extensions ?? {}).filter(
        ([id]) => id !== TASKS_EXTENSION_ID,
      ),
    );
    const capabilities = {
      // No listChanged promise: live tool registration does not currently emit
      // tools/list_changed. The registry remains usable, but refresh is not a
      // protocol guarantee until that notification is wired.
      tools: {},
      ...(Object.keys(stdioExtensions).length > 0
        ? {
          extensions: stdioExtensions as Record<string, object>,
        }
        : {}),
    } as ServerCapabilities;
    const server = new Server(
      { name: this.options.name, version: this.options.version },
      {
        capabilities,
        instructions: this.options.instructions,
        cacheHints: {
          "server/discover": cacheHint,
          "tools/list": cacheHint,
          "resources/list": cacheHint,
          "resources/templates/list": cacheHint,
          "resources/read": cacheHint,
        },
      },
    );
    this.setupHandlers(server);
    if (this.resourceHandlersInstalled) {
      this.installResourceHandlersOn(server);
    }
    return server;
  }

  /**
   * Pre-install the resources handlers on the low-level
   * SDK Server. This declares the `resources` capability BEFORE transport
   * connection, allowing dynamic resource registration after start().
   *
   * The handlers read from `this.resources` Map which is populated lazily
   * by registerResource() calls (e.g., after async MCP discovery).
   */
  private installResourceHandlers(): void {
    if (this.resourceHandlersInstalled) return;
    if (this.started) {
      throw new Error(
        "[McpApp] Cannot install resource handlers after the server starts. " +
          "Set expectResources: true or register resources before start().",
      );
    }
    this.resourceHandlersInstalled = true;
  }

  /** Install resource handlers on one fresh protocol instance. */
  private installResourceHandlersOn(server: Server): void {
    // Declare resources capability before transport connects
    server.registerCapabilities({ resources: { listChanged: true } });

    // resources/list — returns currently registered resources
    server.setRequestHandler("resources/list", () => {
      return {
        resources: Array.from(this.resources.values()).map((r) =>
          this.toResourceListing(r.resource)
        ),
      } as unknown as ListResourcesResult;
    });

    // resources/read — serve resource content by URI
    server.setRequestHandler(
      "resources/read",
      async (request: ReadResourceRequest) => {
        const uri = request.params.uri;
        const info = this.resources.get(uri);
        if (!info) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            `Resource not found: ${uri}`,
          );
        }

        try {
          const finalContent = await this.readResourceForProtocol(
            uri,
            info.resource,
            info.handler,
          );
          return { contents: [finalContent] };
        } catch (error) {
          this.log(
            `[ERROR] Resource handler failed for ${uri}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          throw error;
        }
      },
    );

    // We currently expose concrete resources only. An explicit empty template
    // list is nevertheless required once the resources capability exists:
    // clients are entitled to ask which URI templates can be expanded.
    server.setRequestHandler("resources/templates/list", () => ({
      resourceTemplates: [],
    }));
    this.resourceLog("Resources capability installed");
  }

  /**
   * Setup MCP protocol request handlers
   */
  private setupHandlers(server: Server): void {
    // Wire up "initialized" notification callback (post-handshake)
    server.oninitialized = () => {
      this.initializedCallback?.();
    };

    // tools/list handler
    server.setRequestHandler("tools/list", () => {
      return { tools: this.buildToolListing() } as unknown as ListToolsResult;
    });

    // tools/call handler (delegates to middleware pipeline)
    server.setRequestHandler(
      "tools/call",
      async (
        request: CallToolRequest,
        ctx: ServerContext,
      ): Promise<CallToolResult | InputRequiredResult> => {
        const toolName = request.params.name;
        const args = request.params.arguments || {};

        // Per-request `_meta` is transport-independent. Trace context matters
        // here because a local server is exactly where a detached span is
        // hardest to correlate back to the host that caused it; `logLevel` is
        // read for the same reason it is on HTTP — the spec makes it
        // per-request, and a handler must stay silent without it.
        const meta = isRecord(request.params._meta)
          ? request.params._meta
          : undefined;
        const envelope = isRecord(ctx.mcpReq.envelope)
          ? ctx.mcpReq.envelope
          : undefined;
        const clientInfo = envelope?.[STATELESS_CLIENT_INFO_KEY] as
          | Implementation
          | undefined ?? server.getClientVersion();
        const clientCapabilities = envelope?.[
          STATELESS_CLIENT_CAPABILITIES_KEY
        ] as ClientCapabilities | undefined ??
          server.getClientCapabilities();
        const requestedLogLevel = envelope !== undefined
          ? readLogLevel(envelope)
          : undefined;
        const traceContext = meta !== undefined
          ? readTraceContext(meta)
          : undefined;
        const clientMeta: StatelessClientMeta | undefined =
          clientInfo !== undefined || clientCapabilities !== undefined ||
            requestedLogLevel !== undefined || traceContext !== undefined
            ? {
              ...(clientInfo !== undefined ? { clientInfo } : {}),
              ...(clientCapabilities !== undefined
                ? { clientCapabilities }
                : {}),
              ...(requestedLogLevel !== undefined
                ? { logLevel: requestedLogLevel }
                : {}),
              ...(traceContext ?? {}),
            }
            : undefined;

        // The v2 protocol layer lifts MRTR retry fields out of params before
        // invoking the handler. Preserve Casys' method/argument/principal and
        // single-use bindings on stdio just as the HTTP path does.
        const ingressDigest = await paramsDigest({
          arguments: args,
          name: toolName,
        });
        if ((ctx.mcpReq.droppedInputResponseKeys?.length ?? 0) > 0) {
          throw new ProtocolError(
            ProtocolErrorCode.InvalidParams,
            "inputResponses entries must be bare MCP result objects",
            {
              problem: "malformed_input_responses",
              droppedKeys: ctx.mcpReq.droppedInputResponseKeys,
              recovery:
                "Send each inputResponses value as the bare result object, without a {method, result} wrapper.",
            },
          );
        }
        const inputResponses = ctx.mcpReq.inputResponses;
        const echoedState = ctx.mcpReq.requestState<string>();
        const mrtr = await this.prepareProtocolMrtrRetry(
          inputResponses,
          echoedState,
          {
            principal: MRTR_NO_AUTH_PRINCIPAL,
            method: "tools/call",
            paramsDigest: ingressDigest,
          },
        );

        let result: unknown;
        let executedTool: ToolWithHandler | undefined;
        try {
          const execution = await this.executeToolCall(
            toolName,
            args,
            undefined,
            undefined,
            undefined,
            clientMeta,
            mrtr,
          );
          result = execution.result;
          executedTool = execution.tool;
        } catch (error) {
          return this.handleToolError(
            error,
            toolName,
          ) as unknown as CallToolResult;
        }

        if (isRecord(result) && result["resultType"] === "input_required") {
          const built = await this.buildInputRequiredResult(
            result as unknown as InputRequiredSignal,
            {
              clientCapabilities,
              principal: MRTR_NO_AUTH_PRINCIPAL,
              method: "tools/call",
              paramsDigest: ingressDigest,
            },
          );
          if (!built.ok) {
            throw new ProtocolError(
              built.code,
              built.message,
              built.data,
            );
          }
          return built.result as unknown as InputRequiredResult;
        }

        // Serialization errors are framework bugs, not tool errors —
        // let them propagate
        return this.buildToolCallResult(
          toolName,
          result,
          executedTool,
        ) as unknown as CallToolResult;
      },
    );
  }

  /**
   * The stateless HTTP `server/discover` result (spec 2026-07-28, SEP-2575).
   *
   * The stdio adapter deliberately does not call this builder: the official v2
   * serving entry owns discover, era selection, result stamping and its final
   * wire shape. Keeping this method HTTP-specific prevents a custom payload
   * from bypassing that authority again.
   */
  private buildDiscoverResult(): Record<string, unknown> {
    return this.stampResult(
      this.withCacheHints({
        supportedVersions: [...STATELESS_SUPPORTED_VERSIONS],
        capabilities: this.buildServerCapabilities(),
        serverInfo: {
          name: this.options.name,
          version: this.options.version,
        },
        ...(this.options.instructions
          ? { instructions: this.options.instructions }
          : {}),
      }, SPEC_2026_07_28),
      SPEC_2026_07_28,
    );
  }

  /**
   * Register tools with their handlers
   *
   * @param tools - Array of tool definitions (MCP format)
   * @param handlers - Map of tool name to handler function
   */
  registerTools(
    tools: MCPTool[],
    handlers: Map<string, ToolHandler>,
  ): void {
    if (this.started) {
      throw new Error(
        "[McpApp] Cannot register tools after server started. " +
          "Call registerTools() before start() or startHttp().",
      );
    }
    for (const tool of tools) {
      const handler = handlers.get(tool.name);
      if (!handler) {
        throw new Error(`No handler provided for tool: ${tool.name}`);
      }

      this.commitToolRegistration(tool, handler);
    }

    this.log(`Registered ${tools.length} tools`);
  }

  /**
   * Register a single tool
   *
   * @param tool - Tool definition
   * @param handler - Tool handler function
   */
  /**
   * Validate and index a tool's `x-mcp-header` annotations (spec 2026-07-28).
   *
   * Every registration path must go through here. Wiring it into `registerTools`
   * alone was a real bypass: a tool registered via `registerTool` or
   * `registerToolLive` carried annotations that clients would mirror into
   * `Mcp-Param-*` headers, while the server never required or checked them.
   *
   * Throws *before* the caller inserts the tool, so a rejected definition cannot
   * leave a half-registered tool behind.
   */
  private collectToolMirroredParams(tool: MCPTool): MirroredParam[] {
    const invalid: string[] = [];
    const mirrored = collectMirroredParams(
      tool.inputSchema,
      (reason) => invalid.push(reason),
    );
    if (invalid.length > 0) {
      throw new Error(
        `[McpApp] Tool "${tool.name}" has invalid x-mcp-header annotations:\n` +
          invalid.map((r) => `  - ${r}`).join("\n"),
      );
    }
    return mirrored;
  }

  /**
   * Validate and atomically commit one tool definition.
   *
   * Schema compilation and mirrored-header validation happen before any public
   * registry state changes. Re-registering an invalid live definition therefore
   * leaves the previous handler, scopes, schema and header policy intact.
   */
  private commitToolRegistration(tool: MCPTool, handler: ToolHandler): void {
    const mirrored = this.collectToolMirroredParams(tool);
    const requiredScopes = tool.requiredScopes === undefined
      ? undefined
      : (Object.freeze([...tool.requiredScopes]) as unknown as string[]);

    const stored: ToolWithHandler = {
      ...tool,
      ...(requiredScopes !== undefined ? { requiredScopes } : {}),
      handler,
    };

    // Ajv compiles before updating its name cache. If compilation throws, the
    // previous schema and every other registration surface remain unchanged.
    // The returned object is also retained on the tool snapshot so an in-flight
    // call never resolves validation through a later registration by name.
    const compiledInputSchema = this.schemaValidator?.addSchema(
      tool.name,
      tool.inputSchema,
    );
    if (compiledInputSchema) {
      stored[COMPILED_INPUT_SCHEMA] = compiledInputSchema;
    }

    this.tools.set(tool.name, stored);
    // Replace wholesale: re-registering a tool without annotations must clear
    // whatever a previous definition left behind.
    if (mirrored.length > 0) this.mirroredParams.set(tool.name, mirrored);
    else this.mirroredParams.delete(tool.name);
  }

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    if (this.started) {
      throw new Error(
        "[McpApp] Cannot register tools after server started. " +
          "Call registerTool() before start() or startHttp().",
      );
    }
    this.commitToolRegistration(tool, handler);

    this.log(`Registered tool: ${tool.name}`);
  }

  /**
   * Register a tool after the server has started (live registration).
   *
   * Unlike registerTool(), this can be called while the server is running.
   * The tool becomes immediately available for tools/list and tools/call.
   *
   * Use case: relay proxy where tools are registered dynamically
   * when remote owners connect/disconnect their tunnels.
   *
   * @param tool - Tool definition
   * @param handler - Tool handler function
   */
  registerToolLive(tool: MCPTool, handler: ToolHandler): void {
    this.commitToolRegistration(tool, handler);

    this.log(`Live-registered tool: ${tool.name} (total: ${this.tools.size})`);
  }

  /**
   * Register a tool that is only visible to the MCP App (UI layer),
   * not to the model via tools/list.
   *
   * Equivalent to registerTool() with _meta.ui.visibility: ["app"].
   * The tool is still callable via tools/call if the caller knows its name.
   *
   * @param tool - Tool definition
   * @param handler - Tool handler function
   */
  registerAppOnlyTool(tool: MCPTool, handler: ToolHandler): void {
    const merged: MCPTool = {
      ...tool,
      _meta: {
        ...tool._meta,
        ui: {
          ...tool._meta?.ui,
          visibility: ["app"],
        },
      } as MCPTool["_meta"],
    };
    this.registerTool(merged, handler);
  }

  /**
   * Unregister a tool (removes it from tools/list and tools/call).
   *
   * Can be called before or after start.
   * In-flight calls to this tool will complete normally.
   *
   * @param toolName - Name of the tool to remove
   * @returns true if the tool was found and removed
   */
  unregisterTool(toolName: string): boolean {
    const deleted = this.tools.delete(toolName);
    // Stale mirror metadata would make the server demand `Mcp-Param-*` headers
    // for a tool that no longer exists.
    this.mirroredParams.delete(toolName);
    this.schemaValidator?.removeSchema(toolName);
    if (deleted) {
      this.log(
        `Unregistered tool: ${toolName} (remaining: ${this.tools.size})`,
      );
    }
    return deleted;
  }

  // ============================================
  // Middleware Pipeline
  // ============================================

  /**
   * Add a custom middleware to the pipeline.
   * Must be called before start()/startHttp().
   *
   * Custom middlewares execute between rate-limit and validation:
   * rate-limit → **custom middlewares** → validation → backpressure → handler
   *
   * @param middleware - Middleware function
   * @returns this (for chaining)
   *
   * @example
   * ```typescript
   * server.use(async (ctx, next) => {
   *   console.log(`Calling ${ctx.toolName}`);
   *   const result = await next();
   *   console.log(`Done ${ctx.toolName}`);
   *   return result;
   * });
   * ```
   */
  use(middleware: Middleware): this {
    if (this.started) {
      throw new Error(
        "[McpApp] Cannot add middleware after server started. " +
          "Call use() before start() or startHttp().",
      );
    }
    this.customMiddlewares.push(middleware);
    this.middlewareRunner = null; // Invalidate cached runner
    return this;
  }

  /**
   * Build the middleware pipeline from config + custom middlewares.
   * Called once at start()/startHttp() time.
   *
   * Pipeline order:
   * rate-limit → auth → custom middlewares → scope-check → validation → backpressure → handler
   */
  private buildPipeline(): void {
    const pipeline: Middleware[] = [];

    // 1. Rate limiting (if configured)
    if (this.rateLimiter && this.options.rateLimit) {
      pipeline.push(
        createRateLimitMiddleware(this.rateLimiter, this.options.rateLimit),
      );
    }

    // 2. Auth middleware (if auth provider is set)
    if (this.authProvider) {
      pipeline.push(createAuthMiddleware(this.authProvider));
    }

    // 3. Custom middlewares (logging, tracing, etc.)
    pipeline.push(...this.customMiddlewares);

    // 4. Scope enforcement is always installed. A server may start without a
    // scoped tool and add one through registerToolLive() later. Resolve scopes
    // from the exact definition bound at call ingress, not from a startup map or
    // a second live-registry lookup, so authorization and handler dispatch cannot
    // disagree across a concurrent re-registration.
    pipeline.push(
      createScopeMiddleware((ctx) =>
        (ctx as ToolExecutionContext)[BOUND_TOOL]?.requiredScopes
      ),
    );

    // 5. Schema validation (if enabled)
    if (this.schemaValidator) {
      pipeline.push(createValidationMiddleware(
        this.schemaValidator,
        (ctx) =>
          (ctx as ToolExecutionContext)[BOUND_TOOL]?.[COMPILED_INPUT_SCHEMA],
      ));
    }

    // 6. Backpressure (always)
    pipeline.push(createBackpressureMiddleware(this.requestQueue));

    this.middlewareRunner = createMiddlewareRunner(pipeline, (ctx) => {
      const tool = (ctx as ToolExecutionContext)[BOUND_TOOL];
      if (!tool) {
        throw new Error(`Unknown tool: ${ctx.toolName}`);
      }
      return Promise.resolve(tool.handler(ctx.args, {
        toolName: tool.name,
        ...(ctx.request ? { request: ctx.request } : {}),
        ...(typeof ctx.sessionId === "string"
          ? { sessionId: ctx.sessionId }
          : {}),
        ...(ctx.authInfo ? { authInfo: ctx.authInfo as AuthInfo } : {}),
        ...(ctx.clientInfo !== undefined ? { clientInfo: ctx.clientInfo } : {}),
        ...(ctx.clientCapabilities !== undefined
          ? { clientCapabilities: ctx.clientCapabilities }
          : {}),
        ...(ctx.logLevel !== undefined ? { logLevel: ctx.logLevel } : {}),
        ...(ctx.inputResponses !== undefined
          ? { inputResponses: ctx.inputResponses }
          : {}),
        ...(ctx.retryVerified !== undefined
          ? { retryVerified: ctx.retryVerified }
          : {}),
      }));
    });
  }

  /**
   * Execute a tool call through the middleware pipeline.
   * Unified entry point for both STDIO and HTTP transports.
   *
   * @param toolName - Name of the tool to call
   * @param args - Tool arguments
   * @param request - HTTP request (undefined for STDIO)
   * @param sessionId - HTTP session ID (undefined for STDIO)
   * @returns Tool execution result
   */
  private async executeToolCall(
    toolName: string,
    args: Record<string, unknown>,
    request?: Request,
    sessionId?: string,
    preVerifiedAuthInfo?: AuthInfo,
    clientMeta?: StatelessClientMeta,
    mrtr?: {
      inputResponses?: Record<string, unknown>;
      retryVerified?: boolean;
    },
  ): Promise<ToolExecutionResult> {
    if (!this.middlewareRunner) {
      throw new Error(
        "[McpApp] Pipeline not built. Call start() or startHttp() first.",
      );
    }

    const ctx: ToolExecutionContext = {
      toolName,
      args,
      request,
      sessionId,
      // Pass pre-verified authInfo from the HTTP gate so the auth
      // middleware skips the redundant verifyToken call (avoids JWKS
      // race conditions on concurrent cold-cache requests).
      authInfo: preVerifiedAuthInfo,
      ...(clientMeta?.clientInfo !== undefined
        ? { clientInfo: clientMeta.clientInfo }
        : {}),
      ...(clientMeta?.clientCapabilities !== undefined
        ? { clientCapabilities: clientMeta.clientCapabilities }
        : {}),
      ...(clientMeta?.logLevel !== undefined
        ? { logLevel: clientMeta.logLevel }
        : {}),
      ...(mrtr?.inputResponses !== undefined
        ? { inputResponses: mrtr.inputResponses }
        : {}),
      ...(mrtr?.retryVerified !== undefined
        ? { retryVerified: mrtr.retryVerified }
        : {}),
      // One stable registry entry for this entire call. In-flight calls keep
      // the handler and authorization policy they entered with even if a live
      // registration replaces or removes the public name while they are queued.
      [BOUND_TOOL]: this.tools.get(toolName),
    };

    // OTel span + metrics
    const span = startToolCallSpan(
      toolName,
      {
        "mcp.tool.name": toolName,
        "mcp.server.name": this.options.name,
        "mcp.transport": request ? "http" : "stdio",
        "mcp.session.id": sessionId,
      },
      clientMeta?.traceContext,
    );

    // Update gauges before execution
    const queueMetrics = this.requestQueue.getMetrics();
    this.serverMetrics.setGauges({
      activeRequests: queueMetrics.inFlight,
      queuedRequests: queueMetrics.queued,
      rateLimiterKeys: this.rateLimiter?.getMetrics().keys ?? 0,
    });

    const start = performance.now();
    try {
      const result = await this.middlewareRunner(ctx);
      const durationMs = performance.now() - start;
      this.serverMetrics.recordToolCall(toolName, true, durationMs);
      endToolCallSpan(span, true, durationMs);
      return { result, tool: ctx[BOUND_TOOL] };
    } catch (error) {
      const durationMs = performance.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.serverMetrics.recordToolCall(toolName, false, durationMs);
      endToolCallSpan(span, false, durationMs, errorMsg);
      throw error;
    }
  }

  // ============================================
  // Resource Registration (MCP Apps SEP-1865)
  // ============================================

  /**
   * Apply CSP meta tag injection to HTML resource content (if configured).
   * Only transforms text HTML content; blob responses pass through unchanged.
   */
  private applyResourceCsp(content: ResourceContent): ResourceContent {
    if (!this.options.resourceCsp) return content;
    const mediaType = content.mimeType.split(";", 1)[0].trim().toLowerCase();
    if (
      !this.isTextResourceContent(content) ||
      mediaType !== "text/html"
    ) {
      return content;
    }

    const cspValue = buildCspHeader(this.options.resourceCsp);
    return {
      ...content,
      text: injectCspMetaTag(content.text, cspValue),
    };
  }

  private isTextResourceContent(
    content: ResourceContent,
  ): content is Extract<ResourceContent, { text: string }> {
    return "text" in content;
  }

  /** Standard padded base64 with zero pad bits, without whitespace or URL-safe substitutions. */
  private isCanonicalBase64(blob: string): boolean {
    try {
      // `atob` accepts several equivalent spellings. Re-encoding is what
      // rejects omitted padding, whitespace, URL-safe alphabets, and non-zero
      // pad bits such as `/x==` (whose canonical form is `/w==`). Both APIs are
      // Web-standard globals available in Deno and supported Node runtimes.
      return btoa(atob(blob)) === blob;
    } catch {
      return false;
    }
  }

  /**
   * Validate an untrusted handler result at the API boundary.
   *
   * TypeScript callers get the discriminated `ResourceContent` union at compile
   * time. This check closes the equivalent JavaScript, `any`, and unchecked
   * TypeScript paths before a malformed result reaches an MCP client.
   */
  private validateResourceContent(
    requestedUri: string,
    candidate: unknown,
    resource: MCPResource,
  ): ResourceContent {
    if (!isRecord(candidate)) {
      throw new Error("[McpApp] Resource handler must return an object");
    }

    const hasText = Object.prototype.hasOwnProperty.call(candidate, "text");
    const hasBlob = Object.prototype.hasOwnProperty.call(candidate, "blob");
    if (hasText === hasBlob) {
      throw new Error(
        "[McpApp] Resource content must contain exactly one of text or blob",
      );
    }
    if (candidate.uri !== requestedUri) {
      throw new Error(
        `[McpApp] Resource content URI must match requested URI: ${requestedUri}`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(candidate, "annotations")) {
      throw new Error(
        "[McpApp] Resource content annotations are not a ResourceContents field; put annotations on MCPResource metadata",
      );
    }
    if (candidate._meta !== undefined && !isRecord(candidate._meta)) {
      throw new Error(
        "[McpApp] Resource content _meta must be an object when supplied",
      );
    }
    if (
      typeof candidate.mimeType !== "string" ||
      candidate.mimeType.trim().length === 0
    ) {
      throw new Error(
        "[McpApp] Resource content mimeType must be a non-empty string",
      );
    }
    if (hasText && typeof candidate.text !== "string") {
      throw new Error("[McpApp] Resource content text must be a string");
    }
    if (hasBlob) {
      if (typeof candidate.blob !== "string") {
        throw new Error("[McpApp] Resource content blob must be a string");
      }
      if (!this.isCanonicalBase64(candidate.blob)) {
        throw new Error(
          "[McpApp] Resource content blob must be canonical standard base64",
        );
      }
    }

    if (
      resource.mimeType !== undefined &&
      candidate.mimeType !== resource.mimeType
    ) {
      throw new Error(
        `[McpApp] Resource content mimeType must match registered metadata: ${resource.mimeType}`,
      );
    }
    if (resource.size !== undefined) {
      const actualSize = hasText
        ? new TextEncoder().encode(candidate.text as string).byteLength
        : atob(candidate.blob as string).length;
      if (actualSize !== resource.size) {
        throw new Error(
          `[McpApp] Resource content size must match registered metadata: expected ${resource.size}, got ${actualSize}`,
        );
      }
    }

    // Do not forward arbitrary JavaScript fields to the wire. In particular,
    // annotations belong to Resource, not ResourceContents in the MCP schema.
    return hasText
      ? {
        uri: requestedUri,
        mimeType: candidate.mimeType,
        text: candidate.text as string,
        ...(candidate._meta !== undefined ? { _meta: candidate._meta } : {}),
      }
      : {
        uri: requestedUri,
        mimeType: candidate.mimeType,
        blob: candidate.blob as string,
        ...(candidate._meta !== undefined ? { _meta: candidate._meta } : {}),
      };
  }

  /** Run, validate, and CSP-harden a handler for a protocol response. */
  private async readResourceForProtocol(
    requestedUri: string,
    resource: MCPResource,
    handler: ResourceHandler,
  ): Promise<ResourceContent> {
    const content = this.validateResourceContent(
      requestedUri,
      await handler(new URL(requestedUri)),
      resource,
    );
    // Size attests the bytes delivered to the client. CSP injection changes a
    // text body, so validate the served representation too rather than only
    // the handler's pre-injection value.
    return this.validateResourceContent(
      requestedUri,
      this.applyResourceCsp(content),
      resource,
    );
  }

  /** Convert public metadata into the exact wire listing shape. */
  private toResourceListing(resource: MCPResource): Record<string, unknown> {
    return {
      uri: resource.uri,
      name: resource.name,
      ...(resource.title !== undefined ? { title: resource.title } : {}),
      ...(resource.description !== undefined
        ? { description: resource.description }
        : {}),
      ...(resource.mimeType !== undefined
        ? { mimeType: resource.mimeType }
        : {}),
      ...(resource.size !== undefined ? { size: resource.size } : {}),
      ...(resource.icons !== undefined ? { icons: resource.icons } : {}),
      ...(resource.annotations !== undefined
        ? { annotations: resource.annotations }
        : {}),
      ...(resource._meta !== undefined ? { _meta: resource._meta } : {}),
    };
  }

  /** Fail early rather than publishing a metadata value clients must ignore. */
  private validateResourceMetadata(resource: MCPResource): void {
    this.validateResourceUri(resource.uri);
    if (typeof resource.name !== "string" || resource.name.length === 0) {
      throw new Error("[McpApp] Resource name must be a non-empty string");
    }
    if (
      resource.mimeType !== undefined &&
      (typeof resource.mimeType !== "string" ||
        resource.mimeType.trim().length === 0)
    ) {
      throw new Error(
        "[McpApp] Resource mimeType must be a non-empty string when supplied",
      );
    }
    if (
      resource.size !== undefined &&
      (!Number.isSafeInteger(resource.size) || resource.size < 0)
    ) {
      throw new Error(
        `[McpApp] Resource size must be a non-negative safe integer (got ${resource.size})`,
      );
    }
  }

  /**
   * Resources are keyed by their wire URI, so accepting a spelling which URL
   * canonicalisation changes would make list/read/handler identity ambiguous.
   * Refuse it at registration instead of silently normalising a caller-owned
   * identifier. Non-`ui:` schemes are valid MCP resources and remain allowed.
   */
  private validateResourceUri(uri: string): void {
    if (typeof uri !== "string" || uri.length === 0) {
      throw new Error("[McpApp] Resource URI must be a non-empty string");
    }
    let canonical: string;
    try {
      canonical = new URL(uri).toString();
    } catch {
      throw new Error(`[McpApp] Resource URI must be an absolute URI: ${uri}`);
    }
    if (canonical !== uri) {
      throw new Error(
        `[McpApp] Resource URI must be canonical: received ${uri}, canonical form is ${canonical}`,
      );
    }
  }

  /** A consumer logger is observability, never a resource-commit dependency. */
  private resourceLog(message: string): void {
    try {
      this.log(message);
    } catch {
      // Deliberately ignored: a throwing logger must not contradict a committed
      // resource mutation or make a retry appear necessary.
    }
  }

  /**
   * Publish the one post-commit list-changed projection for a mutation.
   * It is best-effort by design: registry state is authoritative and callers
   * must not receive a false failure after it changes.
   */
  private notifyResourceListChanged(): void {
    if (!this.started) return;
    if (this.subscriptions !== null) {
      this.sendNotification("notifications/resources/list_changed");
      return;
    }
    const server = this.activeStdioServer;
    if (server === null) return;
    void server.sendResourceListChanged().catch((error) => {
      this.resourceLog(
        `[WARN] Resource list changed notification was not delivered: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }

  /**
   * Register a single resource
   *
   * @param resource - Resource definition with uri, name, description
   * @param handler - Callback that returns ResourceContent when resource is read
   * @throws Error if resource with same URI already registered
   *
   * @example
   * ```typescript
   * server.registerResource(
   *   { uri: "ui://my-server/viewer", name: "Viewer", description: "Data viewer" },
   *   async (uri) => ({
   *     uri: uri.toString(),
   *     mimeType: MCP_APP_MIME_TYPE,
   *     text: "<html>...</html>"
   *   })
   * );
   * ```
   */
  registerResource(resource: MCPResource, handler: ResourceHandler): void {
    this.validateResourceMetadata(resource);

    if (typeof handler !== "function") {
      throw new Error("[McpApp] Resource handler must be a function");
    }

    // Check for duplicate
    if (this.resources.has(resource.uri)) {
      throw new Error(
        `[McpApp] Resource already registered: ${resource.uri}`,
      );
    }

    // Static registrations lazily install the single low-level handler set.
    // Once a transport starts, handler installation would be too late, so a
    // deployment that needs late discovery must opt in with expectResources.
    if (!this.resourceHandlersInstalled) {
      if (this.started) {
        throw new Error(
          "[McpApp] Cannot register a resource after start without expectResources: true.",
        );
      }
      this.installResourceHandlers();
    }

    // The Map is the only registry. It commits atomically and has no secondary
    // SDK entry which could survive a failed rollback as a ghost resource.
    this.resources.set(resource.uri, { resource, handler });
    this.resourceLog(`Registered resource: ${resource.name} (${resource.uri})`);
    this.notifyResourceListChanged();
  }

  /**
   * Remove a resource from this server.
   *
   * It is safe before or after either transport starts once resources are
   * installed. Returns `false` when no such URI is present, so callers can make
   * idempotent cleanup calls without catching an error.
   */
  unregisterResource(uri: string): boolean {
    const info = this.resources.get(uri);
    if (!info) return false;

    this.resources.delete(uri);
    this.resourceLog(`Unregistered resource: ${uri}`);
    this.notifyResourceListChanged();
    return true;
  }

  /**
   * Register multiple resources
   *
   * @param resources - Array of resource definitions
   * @param handlers - Map of URI to handler function
   * @throws Error if any resource is missing a handler (fail-fast)
   */
  registerResources(
    resources: MCPResource[],
    handlers: Map<string, ResourceHandler>,
  ): void {
    // No mutation means no capability installation and no notification.
    if (resources.length === 0) return;
    // Validate all handlers exist BEFORE registering any (fail-fast)
    const missingHandlers: string[] = [];
    for (const resource of resources) {
      if (!handlers.has(resource.uri)) {
        missingHandlers.push(resource.uri);
      }
    }

    if (missingHandlers.length > 0) {
      throw new Error(
        `[McpApp] Missing handlers for resources:\n` +
          missingHandlers.map((uri) => `  - ${uri}`).join("\n"),
      );
    }

    // Validate no duplicates exist BEFORE registering any (atomic behavior)
    const duplicateUris: string[] = [];
    for (const resource of resources) {
      if (this.resources.has(resource.uri)) {
        duplicateUris.push(resource.uri);
      }
    }

    if (duplicateUris.length > 0) {
      throw new Error(
        `[McpApp] Resources already registered:\n` +
          duplicateUris.map((uri) => `  - ${uri}`).join("\n"),
      );
    }

    // A duplicate inside this batch would otherwise fail only when the second
    // registration is attempted, after the first has been made visible.
    const seenUris = new Set<string>();
    const repeatedUris = resources
      .map((resource) => resource.uri)
      .filter((uri) => {
        if (seenUris.has(uri)) return true;
        seenUris.add(uri);
        return false;
      });
    if (repeatedUris.length > 0) {
      throw new Error(
        `[McpApp] Resources are repeated in this batch:\n` +
          repeatedUris.map((uri) => `  - ${uri}`).join("\n"),
      );
    }

    for (const resource of resources) {
      this.validateResourceMetadata(resource);
      if (typeof handlers.get(resource.uri) !== "function") {
        throw new Error(
          `[McpApp] Resource handler must be a function: ${resource.uri}`,
        );
      }
    }
    if (!this.resourceHandlersInstalled) {
      if (this.started) {
        throw new Error(
          "[McpApp] Cannot register resources after start without expectResources: true.",
        );
      }
      this.installResourceHandlers();
    }
    // All validation and the one possible handler-install side effect happened
    // before this point. A Map update cannot partially fail, so the batch gets
    // one commit and one notification (or neither on validation failure).
    for (const resource of resources) {
      this.resources.set(resource.uri, {
        resource,
        handler: handlers.get(resource.uri)!,
      });
    }
    this.resourceLog(`Registered ${resources.length} resources`);
    if (resources.length > 0) this.notifyResourceListChanged();
  }

  /**
   * Register MCP Apps viewers with automatic dist path resolution.
   *
   * Replaces the manual pattern of: enumerate viewers → resolve paths → register resources.
   * Each viewer gets a `ui://{prefix}/{viewerName}` resource URI.
   *
   * Viewers whose dist is not found are skipped with a warning (not an error),
   * so that the server can start in dev without building UIs first.
   *
   * @returns Summary of registered and skipped viewers
   */
  registerViewers(config: RegisterViewersConfig): RegisterViewersSummary {
    if (!config.prefix) {
      throw new Error(
        "[McpApp] registerViewers: prefix is required",
      );
    }

    // Resolve viewer list: explicit or auto-discovered
    let viewerNames: string[];
    if (config.viewers) {
      viewerNames = config.viewers;
    } else if (config.discover) {
      viewerNames = discoverViewers(config.discover.uiDir, config.discover);
    } else {
      viewerNames = [];
    }

    const humanNameFn = config.humanName ?? defaultHumanName;
    const registered: string[] = [];
    const skipped: string[] = [];

    for (const viewerName of viewerNames) {
      const distPath = resolveViewerDistPath(
        config.moduleUrl,
        viewerName,
        config.exists,
      );

      if (!distPath) {
        this.log(
          `Warning: UI not built for ui://${config.prefix}/${viewerName}. ` +
            `Run the UI build step first.`,
        );
        skipped.push(viewerName);
        continue;
      }

      const resourceUri = `ui://${config.prefix}/${viewerName}`;
      const readFile = config.readFile;
      const currentDistPath = distPath;

      this.registerResource(
        {
          uri: resourceUri,
          name: humanNameFn(viewerName),
          description: `MCP App: ${viewerName}`,
          mimeType: MCP_APP_MIME_TYPE,
        },
        async () => {
          const html = await Promise.resolve(readFile(currentDistPath));
          const content: ResourceContent = {
            uri: resourceUri,
            mimeType: MCP_APP_MIME_TYPE,
            text: html,
          };
          if (config.csp) {
            content._meta = {
              ui: { csp: config.csp },
            };
          }
          return content;
        },
      );

      registered.push(viewerName);
    }

    if (registered.length > 0) {
      this.log(
        `Registered ${registered.length} viewer(s): ${registered.join(", ")}`,
      );
    }

    return { registered, skipped };
  }

  /**
   * Start the MCP server with stdio transport
   */
  // Keep the established Promise API and rejection semantics even though the
  // v2 serving entry returns its close handle synchronously.
  // deno-lint-ignore require-await
  async start(): Promise<void> {
    // Guard FIRST. Resetting before the guard meant a concurrent start() during
    // stop() cleared `stopping` and rebuilt the store on its way to failing with
    // "already started" — after which a held request produced a live task on a
    // stopped server. `startHttp()` had the order right; this did not.
    if (this.started) {
      throw new Error("Server already started");
    }

    // Same reset as the HTTP path. Without it a stdio server that had been stopped
    // kept `stopping` set and its store disposed, so it refused every task for the
    // rest of its life — with nothing to say why.
    this.prepareForStart();

    // Build middleware pipeline before connecting transport
    this.buildPipeline();

    this.stdioHandle = serveStdio(() => {
      const server = this.createProtocolServer();
      this.activeStdioServer = server;
      server.onclose = () => {
        if (this.activeStdioServer === server) {
          this.activeStdioServer = null;
        }
      };
      return server;
    }, {
      onerror: (error) => {
        this.log(`[ERROR] stdio transport: ${error.message}`);
      },
    });

    this.started = true;

    const rateLimitInfo = this.options.rateLimit
      ? `, rate limit: ${this.options.rateLimit.maxRequests}/${this.options.rateLimit.windowMs}ms`
      : "";
    const validationInfo = this.options.validateSchema
      ? ", schema validation: on"
      : "";

    this.log(
      `Server started (max concurrent: ${
        this.options.maxConcurrent ?? 10
      }, strategy: ${
        this.options.backpressureStrategy ?? "sleep"
      }${rateLimitInfo}${validationInfo})`,
    );
    this.log(`Tools available: ${this.tools.size}`);
  }

  /**
   * Restore the invariants a running server relies on.
   *
   * Called by both transports' start paths. `stop()` disposes the task store and
   * leaves it disposed — rebuilding it mid-teardown is what let an in-flight call
   * spawn into a store nobody would drain — so coming back up is where a live one
   * is created.
   */
  private prepareForStart(): void {
    this.stopping = false;
    if (
      this.options.extensions?.[TASKS_EXTENSION_ID] !== undefined &&
      (this.taskStore === null || this.taskStore.isDisposed)
    ) {
      this.taskStore = new TaskStore({
        onNotification: (task) => this.onTaskChanged(task),
        unrefTimer: (timerId) => unrefTimer(timerId as unknown as number),
      });
    }
  }

  async stop(): Promise<void> {
    // Synchronous, before any await: a handler settling during shutdown must see
    // this immediately or it can still spawn a task.
    this.stopping = true;

    // Release the subsystems whose timers exist from construction, BEFORE the
    // `started` guard: they are created in the constructor, so a server that
    // failed during startup still has them armed, and returning early left them
    // running with no way to reach them again.
    //
    // Disposed and left disposed — NOT replaced. Replacing here opened a window
    // where an in-flight call could spawn into a fresh store while the server was
    // stopping, producing a task that outlived its server. `startHttp()` builds a
    // new store instead, which keeps "a started server has a live store" true
    // without inventing one mid-teardown.
    if (this.taskStore) {
      this.taskStore.drain();
      this.taskStore.dispose();
    }
    if (this.subscriptions) {
      this.subscriptions.shutdown();
      this.subscriptions = null;
    }

    if (!this.started) {
      return;
    }

    // Stop HTTP server if running
    if (this.httpServer) {
      await this.httpServer.shutdown();
      this.httpServer = null;
    }

    if (this.stdioHandle) {
      const handle = this.stdioHandle;
      this.stdioHandle = null;
      await handle.close();
    }
    this.activeStdioServer = null;
    this.started = false;

    this.log("Server stopped");
  }

  // ============================================
  // HTTP Server Support
  // ============================================

  private httpServer: ServeHandle | null = null;

  /**
   * Start the MCP server with HTTP transport (Streamable HTTP compatible)
   *
   * This creates an HTTP server that handles MCP JSON-RPC requests.
   * Supports tools/list, tools/call, resources/list, resources/read.
   *
   * @param options - HTTP server options
   * @returns Server instance with shutdown method
   *
   * @example
   * ```typescript
   * const server = new McpApp({ name: "my-server", version: "1.0.0" });
   * server.registerTools(tools, handlers);
   * server.registerResource(resource, handler);
   *
   * const http = await server.startHttp({ port: 3000 });
   * // Server running on http://localhost:3000
   *
   * // Later: await http.shutdown();
   * ```
   */
  async startHttp(
    options: HttpServerOptions,
  ): Promise<
    { shutdown: () => Promise<void>; addr: { hostname: string; port: number } }
  > {
    if (this.started) {
      throw new Error("Server already started");
    }

    // Configure auth provider:
    // 1. Programmatic (options.auth.provider) takes priority
    // 2. Otherwise, auto-load from YAML + env vars
    if (this.options.auth?.provider) {
      this.authProvider = this.options.auth.provider;
      this.log(
        `Auth configured: provider=${this.authProvider.constructor.name}`,
      );
    } else {
      const authConfig = await loadAuthConfig();
      if (authConfig) {
        this.authProvider = createAuthProviderFromConfig(authConfig);
        this.log(
          `Auth auto-configured from config: provider=${authConfig.provider}`,
        );
      }
    }

    const requireAuth = options.requireAuth ?? false;
    if (requireAuth && !this.authProvider) {
      throw new Error(
        "[McpApp] HTTP auth is required (requireAuth=true) but no auth provider is configured.",
      );
    }
    if (!this.authProvider && !requireAuth) {
      this.log(
        "[WARN] HTTP auth is disabled. Set requireAuth=true or configure auth for production deployments.",
      );
    }

    // Build middleware pipeline (includes auth if configured)
    this.buildPipeline();

    const hostname = options.hostname ?? "0.0.0.0";
    this.prepareForStart();

    if (this.subscriptions === null) {
      this.subscriptions = new SubscriptionRegistry({
        serverInfo: { name: this.options.name, version: this.options.version },
      });
      this.subscriptions.startKeepAlive(
        setInterval,
        (id) => unrefTimer(id as unknown as number),
      );
    }

    const enableCors = options.cors ?? true;
    const corsOrigins = options.corsOrigins ?? "*";
    const maxBodyBytes = options.maxBodyBytes === null
      ? null
      : (options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
    const httpRateLimit = options.ipRateLimit;
    const httpRateLimiter = httpRateLimit
      ? new RateLimiter({
        maxRequests: httpRateLimit.maxRequests,
        windowMs: httpRateLimit.windowMs,
      })
      : null;

    // Create Hono app
    const app = new Hono();

    const isWildcardCors = corsOrigins === "*" ||
      (Array.isArray(corsOrigins) && corsOrigins.includes("*"));
    if (enableCors && isWildcardCors) {
      this.log(
        "[WARN] CORS wildcard origin ('*') is active. " +
          "Use corsOrigins: ['https://your-app.example.com'] in production.",
      );
    }

    // CORS middleware
    if (enableCors) {
      app.use(
        "*",
        cors({
          origin: corsOrigins,
          allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
          allowHeaders: [
            "Content-Type",
            "Accept",
            "Authorization",
            "mcp-protocol-version",
            // Spec 2026-07-28 request-metadata headers. Omitting them broke
            // browser clients outright: the preflight rejects the actual request
            // before the server ever sees it, so a conforming client could not
            // send the headers the server now requires.
            "mcp-method",
            "mcp-name",
            // `Mcp-Param-*` names are defined by the tools themselves, so the
            // allowlist is derived from the registered annotations rather than
            // opened to `*` — which would also widen it for every other header.
            //
            // Known limitation: a tool registered via `registerToolLive` AFTER
            // startHttp() is not reflected here. Register annotated tools before
            // starting, or widen `corsOrigins`/headers deliberately.
            ...[...this.mirroredParams.values()]
              .flat()
              .map((param) => `mcp-param-${param.headerName.toLowerCase()}`),
          ],
          exposeHeaders: [
            "Content-Length",
            "mcp-protocol-version",
          ],
          maxAge: 600,
        }),
      );
    }

    // Health check endpoint
    app.get(
      "/health",
      (c) =>
        c.json({
          status: "ok",
          server: this.options.name,
          version: this.options.version,
        }),
    );

    // Prometheus metrics endpoint
    app.get("/metrics", (_c) => {
      // Update gauges before serving
      const qm = this.requestQueue.getMetrics();
      this.serverMetrics.setGauges({
        activeRequests: qm.inFlight,
        queuedRequests: qm.queued,
        rateLimiterKeys: this.rateLimiter?.getMetrics().keys ?? 0,
      });
      return new Response(this.serverMetrics.toPrometheusFormat(), {
        headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    });

    // RFC 9728 Protected Resource Metadata endpoint
    app.get("/.well-known/oauth-protected-resource", (c) => {
      if (!this.authProvider) {
        return c.text("Not Found", 404);
      }
      return c.json(this.authProvider.getResourceMetadata());
    });

    // Auth verification helper for HTTP endpoints.
    // Returns an error Response if auth is required but token is missing/invalid.
    // Returns null if auth passes or is not configured.
    //
    // 0.15.0+: provider's getResourceMetadata() always returns a valid
    // absolute URL in resource_metadata_url (type-enforced). We used to
    // derive this URL from `metadata.resource` by string concatenation
    // (see `buildMetadataUrl` helper, removed 0.15.0), which produced a
    // broken URL when `resource` was an opaque URI per RFC 9728 § 2
    // (e.g., an OIDC project ID used as JWT audience).
    // Auth verification for HTTP endpoints. Returns the verified AuthInfo
    // on success, or an error Response if auth fails. The caller stores
    // the AuthInfo so the middleware pipeline can skip re-verification.
    const verifyHttpAuth = async (
      request: Request,
    ): Promise<{ authInfo: AuthInfo } | { denied: Response }> => {
      if (!this.authProvider) return { authInfo: {} as AuthInfo };

      const token = extractBearerToken(request);
      if (!token) {
        const metadata = this.authProvider.getResourceMetadata();
        return {
          denied: createUnauthorizedResponse(
            metadata.resource_metadata_url,
            "missing_token",
            "Authorization header with Bearer token required",
          ),
        };
      }

      const authInfo = await this.authProvider.verifyToken(token);
      if (!authInfo) {
        const metadata = this.authProvider.getResourceMetadata();
        return {
          denied: createUnauthorizedResponse(
            metadata.resource_metadata_url,
            "invalid_token",
            "Invalid or expired token",
          ),
        };
      }

      return { authInfo: freezeAuthInfo(authInfo) };
    };

    const checkHttpRateLimit = async (
      request: Request,
      sessionId?: string,
      overrideHeaders?: Headers, // Track A: sanitized headers for stateless mode (no mcp-session-id)
    ): Promise<{ allowed: boolean; retryAfterMs: number }> => {
      if (!httpRateLimiter || !httpRateLimit) {
        return { allowed: true, retryAfterMs: 0 };
      }

      const ip = getClientIpFromHeaders(request.headers);
      const context: HttpRateLimitContext = {
        ip,
        method: request.method,
        path: new URL(request.url).pathname,
        headers: overrideHeaders ?? request.headers,
        sessionId,
      };
      const key = httpRateLimit.keyExtractor?.(context) ?? ip;
      const behavior = httpRateLimit.onLimitExceeded ?? "reject";

      if (behavior === "wait") {
        try {
          await httpRateLimiter.waitForSlot(key);
          return { allowed: true, retryAfterMs: 0 };
        } catch {
          return {
            allowed: false,
            retryAfterMs: Math.max(
              httpRateLimiter.getTimeUntilSlot(key),
              httpRateLimit.windowMs,
            ),
          };
        }
      }

      if (!httpRateLimiter.checkLimit(key)) {
        return {
          allowed: false,
          retryAfterMs: httpRateLimiter.getTimeUntilSlot(key),
        };
      }

      return { allowed: true, retryAfterMs: 0 };
    };

    // Custom routes (registered before MCP catch-all)
    if (options.customRoutes) {
      for (const route of options.customRoutes) {
        app[route.method](route.path, (c) => route.handler(c.req.raw));
      }
    }

    // Legacy verbs from 2025-03-26..2025-11-25: GET opened a standalone SSE
    // stream, DELETE terminated a session. Neither exists in this revision, and
    // the spec says a server supporting only this revision SHOULD answer both
    // with 405 — not 404, which an older client would read as "no MCP endpoint
    // here" and use to fall back to the deprecated HTTP+SSE transport.
    // Use subscriptions/listen for server-initiated notifications.
    // deno-lint-ignore no-explicit-any
    const methodNotAllowed = (c: any) => c.text("Method Not Allowed", 405);
    app.get("/mcp", methodNotAllowed);
    app.get("/", methodNotAllowed);
    app.delete("/mcp", methodNotAllowed);
    app.delete("/", methodNotAllowed);

    // MCP endpoint - POST handles JSON-RPC
    const handleMcpPost = async (
      c: {
        req: {
          json: () => Promise<unknown>;
          raw: Request;
          header: (name: string) => string | undefined;
        };
        json: (data: unknown, status?: number) => Response;
        /** Accumulate a response header (Hono Context API — Track A: MCP-Protocol-Version) */
        header: (name: string, value: string) => void;
      },
    ) => {
      let requestId: string | number | null = null;
      try {
        // Strip mcp-session-id from headers passed to rate-limit context
        // so a keyExtractor cannot use session IDs to bypass IP-level limits.
        const rlHeaders = (() => {
          const h = new Headers(c.req.raw.headers);
          h.delete("mcp-session-id");
          return h;
        })();
        const rateLimit = await checkHttpRateLimit(
          c.req.raw,
          undefined,
          rlHeaders,
        );
        if (!rateLimit.allowed) {
          const retryAfter = Math.max(
            1,
            Math.ceil(rateLimit.retryAfterMs / 1000),
          );
          return jsonRpcResponse(
            {
              jsonrpc: "2.0",
              id: null,
              error: {
                code: -32000,
                message: `Rate limit exceeded. Retry after ${retryAfter}s`,
              },
            },
            429,
            { "Retry-After": retryAfter.toString() },
          );
        }

        let body: {
          id?: string | number;
          method?: string;
          params?: Record<string, unknown>;
        };
        try {
          const bodyBytes = await readBodyWithLimit(c.req.raw, maxBodyBytes);
          const bodyText = new TextDecoder().decode(bodyBytes);
          const parsed = JSON.parse(bodyText);
          if (!parsed || typeof parsed !== "object") {
            throw new Error("Invalid JSON payload");
          }
          body = parsed as {
            id?: string | number;
            method?: string;
            params?: Record<string, unknown>;
          };
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            return jsonRpcResponse({
              jsonrpc: "2.0",
              id: null,
              error: { code: -32000, message: error.message },
            }, 413);
          }
          throw error;
        }

        const { id, method, params } = body;
        requestId = id ?? null;

        // Auth gate: when requireAuth is configured, ALL requests (including
        // initialize) must be authenticated per MCP spec 2025-06-18. The 401
        // response with WWW-Authenticate triggers OAuth discovery in MCP
        // clients (Claude.ai, Cursor). Without this, clients receive a 200 on
        // initialize and never attempt the OAuth/DCR flow.
        let httpAuthInfo: AuthInfo | undefined;
        if (this.authProvider) {
          const authResult = await verifyHttpAuth(c.req.raw);
          if ("denied" in authResult) return authResult.denied;
          httpAuthInfo = authResult.authInfo;
        }

        // The `MCP-Protocol-Version` header is REQUIRED on every POST, and its
        // absence is a header-validation failure — not a malformed body. The
        // spec is explicit: "Validation failure conditions include: A required
        // standard header (MCP-Protocol-Version, Mcp-Method, Mcp-Name) is
        // missing", answered with 400 + -32020 (HeaderMismatch).
        //
        // This has to run BEFORE the `_meta` version check below, because a
        // legacy client sends neither and would otherwise get -32602 for a
        // missing body field when the primary violation is the missing header.
        // A client reading -32602 looks for the wrong fix.
        //
        // Notifications are exempt: the revision leaves header requirements for
        // notification POSTs undefined, so demanding one there invents a rule.
        if (
          id !== undefined && c.req.header("MCP-Protocol-Version") === undefined
        ) {
          return jsonRpcResponse(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: MCP_HEADER_MISMATCH,
                message:
                  "Missing required header 'MCP-Protocol-Version'. It must be present and match params._meta['io.modelcontextprotocol/protocolVersion'].",
                data: {
                  problem: "missing_header",
                  header: "MCP-Protocol-Version",
                  recovery:
                    "Send MCP-Protocol-Version: 2026-07-28 and the matching _meta field.",
                },
              },
            },
            400,
            { "MCP-Protocol-Version": SPEC_2026_07_28 },
          );
        }

        // Per-request protocolVersion validation (spec 2026-07-28).
        // Must run BEFORE any method dispatch so every call (not just initialize)
        // is validated. Sets MCP-Protocol-Version header on all subsequent responses
        // via Hono's c.header() accumulation.
        // Key location: params._meta[STATELESS_PROTO_KEY] (SEP-2575 Final).
        const clientVersion = isRecord(params) && isRecord(params["_meta"])
          ? params["_meta"][STATELESS_PROTO_KEY]
          : undefined;

        // `clientCapabilities` is a REQUIRED per-request `_meta` field in the
        // final spec (`clientInfo` is not — it is only SHOULD). A request
        // missing a required field is malformed: -32602 + HTTP 400.
        //
        // Checked after the version so a client on an unsupported revision
        // gets the clearer version error first.
        // Must be an OBJECT, not merely present. `!== undefined` accepted
        // `null`, a scalar or an array, which then reached the handler as a
        // supposed ClientCapabilities and failed later as -32603 — an internal
        // error for what is plainly a malformed request.
        const capabilitiesValid = isRecord(params) &&
          isRecord(params["_meta"]) &&
          isRecord(params["_meta"][STATELESS_CLIENT_CAPABILITIES_KEY]);

        if (typeof clientVersion !== "string") {
          // Header uses fallback version — no negotiated version available yet
          return jsonRpcResponse(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: JSONRPC_INVALID_PARAMS,
                message: `Missing required field '${STATELESS_PROTO_KEY}'`,
              },
            },
            400,
            { "MCP-Protocol-Version": STATELESS_FALLBACK_VERSION },
          );
        }

        if (!STATELESS_SUPPORTED_VERSIONS.includes(clientVersion)) {
          // AX: data carries machine-readable supported/requested for agent recovery
          return jsonRpcResponse(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: MCP_UNSUPPORTED_PROTOCOL_VERSION,
                message: `Unsupported protocolVersion: "${clientVersion}"`,
                data: {
                  supported: [...STATELESS_SUPPORTED_VERSIONS],
                  requested: clientVersion,
                },
              },
            },
            400,
            { "MCP-Protocol-Version": STATELESS_FALLBACK_VERSION },
          );
        }

        if (!capabilitiesValid) {
          return jsonRpcResponse(
            {
              jsonrpc: "2.0",
              id,
              error: {
                code: JSONRPC_INVALID_PARAMS,
                message:
                  `Missing or malformed field '${STATELESS_CLIENT_CAPABILITIES_KEY}' in params._meta: expected an object`,
                data: {
                  problem: "missing_field",
                  bodyField:
                    `params._meta['${STATELESS_CLIENT_CAPABILITIES_KEY}']`,
                  recovery:
                    "Send a ClientCapabilities object; `{}` is valid and means no capabilities declared.",
                },
              },
            },
            400,
            { "MCP-Protocol-Version": STATELESS_FALLBACK_VERSION },
          );
        }

        // Track C: request-metadata headers (SEP-2243).
        //
        // Notifications are exempt: the revision explicitly leaves header
        // requirements for notification POSTs undefined, so a missing
        // `Mcp-Method` there is not a violation to invent.
        if (id !== undefined) {
          const validation = validateRequestHeaders({
            getHeader: (name) => c.req.header(name),
            method: typeof method === "string" ? method : "",
            params: isRecord(params) ? params : undefined,
            bodyProtocolVersion: clientVersion,
            mirroredParams: typeof params?.name === "string"
              ? this.mirroredParams.get(params.name)
              : undefined,
          });
          if (!validation.ok) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: MCP_HEADER_MISMATCH,
                  message: validation.message,
                  // AX: the caller has to fix the request, so what to fix
                  // travels as data. `problem` is an enum to switch on,
                  // `recovery` is one concrete action — neither requires
                  // parsing the English message.
                  data: validation.detail,
                },
              },
              400,
              { "MCP-Protocol-Version": STATELESS_FALLBACK_VERSION },
            );
          }
        }

        const statelessVersion: string = clientVersion;
        // Spec 2026-07-28: echo negotiated version in every response header.
        // c.header() accumulates headers — all subsequent c.json() calls inherit it.
        c.header("MCP-Protocol-Version", statelessVersion);

        if (method === "server/discover") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.buildDiscoverResult(),
          });
        }

        // Initialize — respond without creating a session or emitting Mcp-Session-Id.
        // statelessVersion is guaranteed defined here (version check above returned early otherwise).
        if (method === "initialize") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult({
              protocolVersion: statelessVersion,
              capabilities: this.buildServerCapabilities(),
              serverInfo: {
                name: this.options.name,
                version: this.options.version,
              },
              ...(this.options.instructions
                ? { instructions: this.options.instructions }
                : {}),
            }, statelessVersion),
          });
          // Note: c.json() inherits MCP-Protocol-Version header set above.
          // No Mcp-Session-Id header emitted — stateless by design.
        }

        // Tools call (delegates to middleware pipeline, which handles auth internally)
        if (method === "tools/call") {
          // Dispatch by method rather than the truthiness of `name`. An empty
          // string can be represented faithfully by Mcp-Name, but it is not a
          // usable tool name and must be InvalidParams rather than an apparent
          // method that this server does not implement.
          const toolParams = isRecord(params) ? params : undefined;
          if (
            toolParams === undefined ||
            typeof toolParams["name"] !== "string" ||
            toolParams["name"].length === 0
          ) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "tools/call requires a non-empty string 'name' parameter",
                },
              },
              400,
            );
          }
          const toolName = toolParams["name"];
          const args = (toolParams["arguments"] as Record<string, unknown>) ||
            {};
          const statelessClientMeta:
            | StatelessClientMeta
            | undefined = isRecord(params) && isRecord(params["_meta"])
              ? {
                clientInfo: params["_meta"][STATELESS_CLIENT_INFO_KEY] as
                  | Implementation
                  | undefined,
                clientCapabilities: params["_meta"][
                  STATELESS_CLIENT_CAPABILITIES_KEY
                ] as ClientCapabilities | undefined,
                logLevel: readLogLevel(params["_meta"]),
                ...readTraceContext(params["_meta"]),
              }
              : undefined;

          // MRTR retry fields live in `params` directly — siblings of `_meta`,
          // not members of it, unlike every other per-request field. Reading them
          // from `_meta` yields a silent undefined even when the client sent them.
          //
          // MRTR is always enabled on 2026-07-28 (the only supported version).
          const mrtrEnabled = true;

          // Digest of the arguments AS RECEIVED, taken before the middleware
          // pipeline runs. Re-deriving it at seal time would hash whatever the
          // pipeline left in `args` — validation coercion, defaults, redaction —
          // so a client replaying the request byte-for-byte would fail
          // `wrong_params` through no fault of its own.
          const ingressDigest = mrtrEnabled
            ? await paramsDigest({ arguments: args, name: toolName })
            : "";
          // A scalar or array `inputResponses` was silently dropped, so a client
          // sending the wrong shape saw its answers ignored and the same
          // InputRequiredResult come back, with nothing to indicate why.
          const rawResponses = mrtrEnabled && isRecord(params)
            ? params["inputResponses"]
            : undefined;
          if (rawResponses !== undefined && !isRecord(rawResponses)) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "inputResponses must be an object keyed by the ids from inputRequests",
                  data: {
                    problem: "malformed_field",
                    bodyField: "params.inputResponses",
                    recovery:
                      "Send an object whose keys match the inputRequests keys the server issued.",
                  },
                },
              },
              400,
              {
                "MCP-Protocol-Version": statelessVersion,
              },
            );
          }
          const echoedResponses = isRecord(rawResponses)
            ? rawResponses
            : undefined;
          const echoedState = mrtrEnabled && isRecord(params) &&
              typeof params["requestState"] === "string"
            ? params["requestState"]
            : undefined;

          // A retry carrying answers but no token cannot be verified, and the
          // server always issues a token when it has a key. So this combination
          // is either a confused client or an attempt to inject answers past the
          // verification gate — refuse it rather than forwarding unverified
          // responses to the handler.
          // Resolved only when MRTR is actually in play. Resolving on every 2026
          // tools/call meant a transient key-import failure also broke ordinary
          // tools that never touch MRTR.
          const needsKey = mrtrEnabled &&
            (echoedResponses !== undefined || echoedState !== undefined);
          const guardKey = needsKey
            ? await this.getMrtrKeySafe(
              id,
              statelessVersion,
            )
            : { key: null as CryptoKey | null };
          if ("error" in guardKey) return guardKey.error;
          // Only a signed retry needs an authenticated principal. Ordinary
          // calls and explicitly unprotected state retain their prior behavior.
          let retryPrincipal = MRTR_NO_AUTH_PRINCIPAL;
          if (echoedState !== undefined && guardKey.key !== null) {
            const principal = callerPrincipal(httpAuthInfo);
            if (principal === null) {
              return noPrincipalError(id, statelessVersion);
            }
            retryPrincipal = principal;
          }

          const retryOutcome = await guardMrtrRetry({
            ...(echoedResponses !== undefined
              ? { inputResponses: echoedResponses }
              : {}),
            ...(echoedState !== undefined ? { requestState: echoedState } : {}),
            key: guardKey.key,
            replayStore: this.mrtrReplayStore,
            bindings: {
              principal: retryPrincipal,
              method: "tools/call",
              paramsDigest: ingressDigest,
            },
          });
          if (retryOutcome.kind === "missing_state") {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "inputResponses supplied without the requestState issued with them",
                  data: {
                    problem: "missing_request_state",
                    recovery:
                      "Echo back the exact requestState string from the InputRequiredResult alongside inputResponses.",
                  },
                },
              },
              400,
              { "MCP-Protocol-Version": statelessVersion },
            );
          }
          if (retryOutcome.kind === "invalid_state") {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: `Invalid requestState: ${retryOutcome.reason}`,
                  data: { reason: retryOutcome.reason },
                },
              },
              400,
              { "MCP-Protocol-Version": statelessVersion },
            );
          }
          if (retryOutcome.kind === "replay_store_unavailable") {
            if (retryOutcome.reason === "consume_failed") {
              this.log(
                "[WARN] MRTR replay store unavailable; retry rejected before handler",
              );
            }
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: ErrorCode.InternalError,
                  message: "MRTR replay protection is unavailable",
                  data: {
                    problem: "mrtr_replay_store_unavailable",
                    recovery: retryOutcome.reason === "missing"
                      ? "Configure mrtr.signingKey with a working replay store and retry the full interaction."
                      : "Restore the shared replay store, then restart the interaction to obtain a fresh requestState.",
                  },
                },
              },
              500,
              { "MCP-Protocol-Version": statelessVersion },
            );
          }
          if (retryOutcome.kind === "replayed") {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: "Invalid requestState: replayed",
                  data: { reason: "replayed" },
                },
              },
              400,
              { "MCP-Protocol-Version": statelessVersion },
            );
          }
          const retryVerified = retryOutcome.retryVerified;

          try {
            const execution = await this.executeToolCall(
              toolName,
              args,
              c.req.raw,
              undefined,
              httpAuthInfo,
              statelessClientMeta,
              {
                ...(echoedResponses !== undefined
                  ? { inputResponses: echoedResponses }
                  : {}),
                ...(retryVerified !== undefined ? { retryVerified } : {}),
              },
            );
            const { result, tool: executedTool } = execution;
            // MRTR: the handler is asking the client for input rather than
            // returning a result. Checked BEFORE the task branch and before
            // stampResult, which would overwrite resultType with "complete".
            if (
              mrtrEnabled && isRecord(result) &&
              result["resultType"] === "input_required"
            ) {
              const sealPrincipal = callerPrincipal(httpAuthInfo);
              if (sealPrincipal === null) {
                return noPrincipalError(
                  id,
                  statelessVersion,
                );
              }
              const built = await this.buildInputRequiredResult(
                result as unknown as InputRequiredSignal,
                {
                  clientCapabilities: statelessClientMeta?.clientCapabilities,
                  principal: sealPrincipal,
                  method: "tools/call",
                  paramsDigest: ingressDigest,
                },
              );
              if (!built.ok) {
                return jsonRpcResponse(
                  {
                    jsonrpc: "2.0",
                    id,
                    error: {
                      code: built.code,
                      message: built.message,
                      ...(built.data !== undefined ? { data: built.data } : {}),
                    },
                  },
                  // Status follows the code: an InternalError is a server fault
                  // (500), a capability or shape problem is the caller's (400).
                  // Flattening both to 400 told a client to fix a request that a
                  // misconfigured signing key had broken — and the sibling ingress
                  // path already answered 500 for exactly that.
                  built.code === ErrorCode.InternalError ? 500 : 400,
                  {
                    "MCP-Protocol-Version": statelessVersion,
                  },
                );
              }
              return c.json({ jsonrpc: "2.0", id, result: built.result });
            }

            // Tasks extension: the handler asked for a task handle instead of
            // a synchronous result.
            if (isAsyncTaskDescriptor(result)) {
              const guard = this.requireTasksCapability(
                statelessClientMeta?.clientCapabilities,
                id,
              );
              if (guard) return guard;

              // Owner binding: the spec requires an authorization check on every
              // task-related request, and a task id alone is only one line of
              // defence.
              if (this.stopping || this.taskStore === null) {
                return jsonRpcResponse(
                  {
                    jsonrpc: "2.0",
                    id,
                    error: {
                      code: ErrorCode.InternalError,
                      message:
                        "Server is shutting down; no new tasks are accepted.",
                      data: {
                        problem: "server_stopping",
                        recovery: "Retry against a running instance.",
                      },
                    },
                  },
                  503,
                  {
                    "MCP-Protocol-Version": statelessVersion,
                  },
                );
              }
              const ownerPrincipal = callerPrincipal(httpAuthInfo);
              if (ownerPrincipal === null) {
                return noPrincipalError(
                  id,
                  statelessVersion,
                );
              }
              const owner = await taskOwnerKeyFor(
                this.options,
                httpAuthInfo,
                c.req.raw,
                ownerPrincipal,
              );
              if (owner === null) {
                return noOwnerKeyError(
                  id,
                  statelessVersion,
                );
              }
              // Re-checked, and wrapped: the guard above sits before two awaits
              // (the principal lookup and the async owner hook), so shutdown can
              // begin in between. Without this, spawn()'s post-disposal throw
              // would escape to the POST-level catch and be reported as -32700
              // "Parse error".
              let task;
              try {
                task = this.taskStore.spawn(
                  result,
                  owner,
                  // Same conversion the synchronous path uses, so a handler's
                  // return value produces an identical result either way.
                  (raw) =>
                    this.buildToolCallResult(toolName, raw, executedTool),
                );
              } catch (spawnError) {
                // Narrowed to the actual shutdown condition. A blanket catch
                // reported a legitimate throw from the handler's own task setup as
                // "server is shutting down" — a diagnosis that sends the reader to
                // look at the wrong thing entirely, on a perfectly healthy server.
                if (this.stopping || this.taskStore.isDisposed) {
                  return jsonRpcResponse(
                    {
                      jsonrpc: "2.0",
                      id,
                      error: {
                        code: ErrorCode.InternalError,
                        message:
                          "Server is shutting down; no new tasks are accepted.",
                        data: {
                          problem: "server_stopping",
                          recovery: "Retry against a running instance.",
                        },
                      },
                    },
                    503,
                    {
                      "MCP-Protocol-Version": statelessVersion,
                    },
                  );
                }
                // A real failure: let the tool error path report it as such.
                throw spawnError;
              }
              return c.json({
                jsonrpc: "2.0",
                id,
                // NOT stampResult(): that writes resultType "complete", and a
                // CreateTaskResult carries "task". Its fields are flat on the
                // result, not nested under a `task` key.
                //
                // Note the asymmetry with tasks/get below, which DOES carry
                // "complete" — that is an ordinary RPC response which happens to
                // describe a task. The spec states this distinction three times;
                // conflating them is the likeliest mistake here.
                result: this.stampResult(
                  { ...task },
                  statelessVersion,
                  "task",
                ),
              });
            }

            return c.json({
              jsonrpc: "2.0",
              id,
              result: this.stampResult(
                this.buildToolCallResult(toolName, result, executedTool),
                statelessVersion,
              ),
            });
          } catch (error) {
            // Handle AuthError with proper HTTP status codes
            if (error instanceof AuthError) {
              if (
                error.code === "missing_token" || error.code === "invalid_token"
              ) {
                return createUnauthorizedResponse(
                  error.resourceMetadataUrl,
                  error.code,
                  error.message,
                );
              }
              if (error.code === "insufficient_scope") {
                return createForbiddenResponse(
                  error.requiredScopes ?? [],
                  error.resourceMetadataUrl,
                );
              }
            }

            // Delegate to centralized error handler
            try {
              const isErrorResult = this.handleToolError(error, toolName);
              return c.json({
                jsonrpc: "2.0",
                id,
                // An `isError: true` tool result is still a completed JSON-RPC
                // result, so it carries `resultType: "complete"`. Only MRTR
                // interim results (Track B) use `"input_required"`.
                result: this.stampResult(
                  isErrorResult as Record<string, unknown>,
                  statelessVersion,
                ),
              });
            } catch (rethrown) {
              this.log(
                `Error executing tool ${toolName}: ${
                  rethrown instanceof Error
                    ? rethrown.message
                    : String(rethrown)
                }`,
              );
              const errorMessage = rethrown instanceof Error
                ? rethrown.message
                : "Tool execution failed";
              const errorCode = errorMessage.startsWith("Unknown tool")
                ? -32602
                : errorMessage.startsWith("Rate limit")
                ? -32000
                : -32603;
              return c.json({
                jsonrpc: "2.0",
                id,
                error: { code: errorCode, message: errorMessage },
              });
            }
          }
        }

        // Auth gate already applied above (covers all methods including tools/call, tools/list, etc.)
        // Note: tools/call also runs auth again in the middleware pipeline (createAuthMiddleware),
        // which provides per-tool scope enforcement. The top-level check above is the gate
        // that triggers OAuth discovery (401 with WWW-Authenticate).

        // Tools list
        if (method === "tools/list") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult(
              this.withCacheHints(
                { tools: this.buildToolListing() },
                statelessVersion,
              ),
              statelessVersion,
            ),
          });
        }

        // Resources list
        if (method === "resources/list") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult(
              this.withCacheHints({
                resources: Array.from(this.resources.values()).map((r) =>
                  this.toResourceListing(r.resource)
                ),
              }, statelessVersion),
              statelessVersion,
            ),
          });
        }

        // Concrete resources only for now. Keep this endpoint explicit rather
        // than falling through to MethodNotFound once resources are advertised.
        if (method === "resources/templates/list") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult(
              this.withCacheHints({ resourceTemplates: [] }, statelessVersion),
              statelessVersion,
            ),
          });
        }

        // Resources read
        if (method === "resources/read") {
          // Dispatch by method, not the truthiness of its routing parameter.
          // `uri: ""` has a valid empty Mcp-Name header representation, but it
          // is not a usable resource URI. Letting it skip this branch turned a
          // malformed resources/read into a misleading -32601 method-not-found.
          const uri = isRecord(params) && typeof params["uri"] === "string" &&
              params["uri"].length > 0
            ? params["uri"]
            : undefined;
          if (uri === undefined) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "resources/read requires a non-empty string 'uri' parameter",
                },
              },
              400,
            );
          }
          const resourceInfo = this.resources.get(uri);

          if (!resourceInfo) {
            return c.json({
              jsonrpc: "2.0",
              id,
              error: { code: -32602, message: `Resource not found: ${uri}` },
            });
          }

          try {
            const finalContent = await this.readResourceForProtocol(
              uri,
              resourceInfo.resource,
              resourceInfo.handler,
            );
            return c.json({
              jsonrpc: "2.0",
              id,
              result: this.stampResult(
                this.withCacheHints(
                  { contents: [finalContent] },
                  statelessVersion,
                  {
                    // resources/read is the only cacheable method an MRTR retry
                    // can target, so it is the only one that needs this guard.
                    isMrtrRetry: isRecord(params) &&
                      (params["requestState"] !== undefined ||
                        params["inputResponses"] !== undefined),
                  },
                ),
                statelessVersion,
              ),
            });
          } catch (error) {
            this.log(
              `Error reading resource ${uri}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
            return c.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: -32603,
                message: error instanceof Error
                  ? error.message
                  : "Resource read failed",
              },
            });
          }
        }

        // ── subscriptions/listen (SEP-2575) ──────────────────────────────
        //
        // Replaces the removed HTTP GET stream and resources/subscribe. The
        // response IS the stream: a long-lived SSE body carrying only the
        // notification types the client opted into.
        if (method === "subscriptions/listen" && this.subscriptions !== null) {
          const registry = this.subscriptions;

          // A notification-shaped listen makes no sense: the response IS the
          // stream, and the subscription id IS this request's id — with no id
          // there is nothing to correlate notifications to.
          if (id === undefined) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "subscriptions/listen requires a JSON-RPC id: the response is the notification stream, and the id identifies the subscription",
                },
              },
              400,
            );
          }
          const subscriptionId: string | number = id as string | number;
          // A missing or non-object filter is malformed, not "subscribe to
          // nothing": a client that meant to subscribe would otherwise get a
          // 200 stream that stays silent forever, with no way to tell why.
          if (!isRecord(params) || !isRecord(params["notifications"])) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message:
                    "subscriptions/listen requires a 'notifications' object naming the types to receive",
                  data: {
                    problem: "missing_field",
                    bodyField: "params.notifications",
                    recovery:
                      'Send params.notifications, e.g. { toolsListChanged: true } or { resourceSubscriptions: ["ui://x"] }.',
                  },
                },
              },
              400,
            );
          }
          const filter = validateSubscriptionFilter(
            params["notifications"] as Record<string, unknown>,
          );
          if (!filter.ok) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: filter.message,
                  data: {
                    problem: "malformed_field",
                    bodyField: filter.bodyField,
                    recovery: filter.recovery,
                  },
                },
              },
              400,
            );
          }
          const requested = filter.filter;

          // Recognising `taskIds` is mandatory even though pushing task updates is
          // not: a client that asks for task notifications without declaring the
          // Tasks extension MUST be refused. Accepting it would open a stream that
          // can never deliver, with nothing to say why.
          if (
            Array.isArray(requested.taskIds) && requested.taskIds.length > 0
          ) {
            const guard = this.requireTasksCapability(
              isRecord(params["_meta"])
                ? params["_meta"][STATELESS_CLIENT_CAPABILITIES_KEY] as
                  | ClientCapabilities
                  | undefined
                : undefined,
              id,
            );
            if (guard) return guard;
          }

          // Computed ONCE by the registry and reused for both the
          // acknowledgement and the registration. Deriving it independently here
          // is how a client ends up told it subscribed to a set the registry does
          // not actually enforce.
          const agreed = registry.computeAgreedFilter(requested);

          let internalKey: string | null = null;
          const stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
              let closed = false;
              const sink: SubscriptionSink = {
                enqueue(chunk) {
                  // The cancel() callback fires before unregister(), so a write
                  // can race a closed controller on every client disconnect.
                  if (closed) return;
                  try {
                    controller.enqueue(chunk);
                  } catch {
                    closed = true;
                  }
                },
                close() {
                  if (closed) return;
                  closed = true;
                  try {
                    controller.close();
                  } catch { /* already closed */ }
                },
                get isClosed() {
                  return closed;
                },
              };

              // The acknowledgement MUST be the first message on the stream, so
              // it is enqueued BEFORE registering — otherwise a fan-out landing
              // in between would precede it.
              sink.enqueue(
                encodeSSEEvent(
                  buildAcknowledgedMessage(subscriptionId, agreed),
                ),
              );
              internalKey = registry.register(subscriptionId, agreed, sink);
            },
            cancel: () => {
              // Client closed the stream: that IS the cancellation signal on
              // HTTP, and the server must send nothing further.
              if (internalKey !== null) {
                registry.unregister(internalKey, "client");
              }
            },
          });

          return new Response(stream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              // Tells nginx and friends not to buffer, without which events sit
              // in a proxy until the buffer fills.
              "X-Accel-Buffering": "no",
              "MCP-Protocol-Version": statelessVersion,
            },
          });
        }

        // ── Tasks extension (io.modelcontextprotocol/tasks) ──────────────
        //
        // The capability guard repeats on every one of these, not just at task
        // creation: the spec requires the missing-capability error for a
        // non-declaring client issuing tasks/get, tasks/update OR tasks/cancel.
        // Guarding creation alone would still let such a client poll and cancel
        // tasks it could never have been handed.
        // Capability-gated: a non-declaring client must not reach tasks/*.
        // The version gate (STATELESS_SUPPORTED_VERSIONS) upstream of this block
        // already rejects any peer running a pre-2026 protocol version.
        if (
          this.taskStore !== null &&
          (method === "tasks/get" || method === "tasks/update" ||
            method === "tasks/cancel")
        ) {
          // These are requests, never notifications. Without an id they would
          // otherwise slip past header validation — which exempts notifications —
          // then mutate task state and answer with an id-less, malformed
          // JSON-RPC response.
          if (id === undefined) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id: null,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: `${method} is a request and requires a JSON-RPC id`,
                  data: {
                    problem: "missing_field",
                    bodyField: "id",
                    recovery:
                      "Send the call as a JSON-RPC request with an id, not as a notification.",
                  },
                },
              },
              400,
            );
          }
          const store = this.taskStore;
          const guard = this.requireTasksCapability(
            isRecord(params) && isRecord(params["_meta"])
              ? params["_meta"][STATELESS_CLIENT_CAPABILITIES_KEY] as
                | ClientCapabilities
                | undefined
              : undefined,
            id,
          );
          if (guard) return guard;

          const taskId =
            isRecord(params) && typeof params["taskId"] === "string"
              ? params["taskId"]
              : undefined;
          if (taskId === undefined) {
            return jsonRpcResponse(
              {
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: `${method} requires a string 'taskId' parameter`,
                },
              },
              400,
            );
          }

          const callerBase = callerPrincipal(httpAuthInfo);
          if (callerBase === null) {
            return noPrincipalError(
              id,
              statelessVersion,
            );
          }
          const caller = await taskOwnerKeyFor(
            this.options,
            httpAuthInfo,
            c.req.raw,
            callerBase,
          );
          if (caller === null) {
            return noOwnerKeyError(
              id,
              statelessVersion,
            );
          }

          if (method === "tasks/get") {
            const task = store.get(taskId, caller);
            if (task === null) {
              return c.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: `Unknown taskId: ${taskId}`,
                },
              });
            }
            // "complete", not "task" — see the note at task creation.
            return c.json({
              jsonrpc: "2.0",
              id,
              result: this.stampResult({ ...task }, statelessVersion),
            });
          }

          if (method === "tasks/update") {
            // Spec field name is `inputResponses`, matching MRTR's vocabulary.
            const responses = isRecord(params) &&
                isRecord(params["inputResponses"])
              ? params["inputResponses"]
              : undefined;
            if (responses === undefined) {
              return jsonRpcResponse(
                {
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: JSONRPC_INVALID_PARAMS,
                    message: "tasks/update requires an 'inputResponses' object",
                  },
                },
                400,
              );
            }
            if (!store.update(taskId, responses, caller)) {
              // SHOULD be an error for an unknown id — and an id belonging to
              // another caller is reported identically, so the response never
              // confirms that someone else's task exists.
              return c.json({
                jsonrpc: "2.0",
                id,
                error: {
                  code: JSONRPC_INVALID_PARAMS,
                  message: `Unknown taskId: ${taskId}`,
                },
              });
            }
            // MUST be an EMPTY acknowledgement (beyond the resultType envelope).
            // Returning the task state instead would look helpful and be
            // non-conformant — and the spec calls the ack eventually consistent,
            // so any state returned here could already be stale.
            return c.json({
              jsonrpc: "2.0",
              id,
              result: this.stampResult({}, statelessVersion),
            });
          }

          // tasks/cancel — likewise an empty ack. Cancellation is cooperative:
          // the server acknowledges intent, and the task may still finish or
          // reach a different terminal status.
          if (!store.cancel(taskId, caller)) {
            return c.json({
              jsonrpc: "2.0",
              id,
              error: {
                code: JSONRPC_INVALID_PARAMS,
                message: `Unknown taskId: ${taskId}`,
              },
            });
          }
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult({}, statelessVersion),
          });
        }

        // `ping` and `logging/setLevel` were REMOVED by spec 2026-07-28.
        // They fall through to method-not-found below (404 + -32601), which is
        // how a client distinguishes a modern server from a legacy HTTP+SSE one.
        if (method === "prompts/list") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult(
              this.withCacheHints({ prompts: [] }, statelessVersion),
              statelessVersion,
            ),
          });
        }
        if (method === "completion/complete") {
          return c.json({
            jsonrpc: "2.0",
            id,
            result: this.stampResult(
              { completion: { values: [] } },
              statelessVersion,
            ),
          });
        }

        // Handle notifications: a method and NO id (JSON-RPC 2.0).
        //
        // `!id` was wrong: `0` is a valid id and is falsy, so a request with
        // `id: 0` was answered 202-with-no-body as though it were a
        // notification. The spec only forbids `null`.
        if (method && id === undefined) {
          return new Response(null, { status: 202 });
        }

        // Malformed request: no method at all
        if (!method) {
          return c.json({
            jsonrpc: "2.0",
            id: id ?? null,
            error: {
              code: -32600,
              message: "Invalid Request: missing 'method' field",
            },
          });
        }

        // Method not found.
        //
        // Spec 2026-07-28 requires HTTP **404** here, not 200: "If the server
        // does not implement the requested RPC method, it MUST respond with
        // 404 Not Found and a JSON-RPC error with code -32601". The status is
        // load-bearing — a client probing an unknown URL uses exactly this
        // response to tell a modern MCP endpoint from a legacy HTTP+SSE server.
        //
        // This also covers the removed methods (`ping`, `logging/setLevel`).
        return jsonRpcResponse(
          {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          },
          404,
        );
      } catch (error) {
        this.log(
          `HTTP request error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return c.json({
          jsonrpc: "2.0",
          id: requestId,
          error: { code: -32700, message: "Parse error" },
        });
      }
    };

    // deno-lint-ignore no-explicit-any
    app.post("/mcp", handleMcpPost as any);
    // deno-lint-ignore no-explicit-any
    app.post("/", handleMcpPost as any);

    // Embedded mode: skip serve(), surface the Hono fetch handler to the
    // caller and let them mount it inside their own framework (Fresh, Hono,
    // Express, etc.).
    if (options.embedded) {
      if (!options.embeddedHandlerCallback) {
        throw new Error(
          "[McpApp] embedded=true requires embeddedHandlerCallback",
        );
      }
      // deno-lint-ignore no-explicit-any
      options.embeddedHandlerCallback(app.fetch as any);
      this.started = true;
      this.log(
        `HTTP handler ready (embedded mode — no port bound, max concurrent: ${
          this.options.maxConcurrent ?? 10
        })`,
      );
      return {
        shutdown: async () => {
          await this.stop();
        },
        addr: { hostname: "embedded", port: 0 },
      };
    }

    // Start server
    this.httpServer = serve(
      {
        port: options.port,
        hostname,
        maxBodyBytes,
        onListen: options.onListen ?? ((info) => {
          this.log(
            `HTTP server started on http://${info.hostname}:${info.port}`,
          );
        }),
      },
      app.fetch,
    );

    this.started = true;

    const rateLimitInfo = this.options.rateLimit
      ? `, rate limit: ${this.options.rateLimit.maxRequests}/${this.options.rateLimit.windowMs}ms`
      : "";
    const validationInfo = this.options.validateSchema
      ? ", schema validation: on"
      : "";

    this.log(
      `Server started HTTP mode (max concurrent: ${
        this.options.maxConcurrent ?? 10
      }, strategy: ${
        this.options.backpressureStrategy ?? "sleep"
      }${rateLimitInfo}${validationInfo})`,
    );
    this.log(
      `Tools available: ${this.tools.size}, Resources: ${this.resources.size}`,
    );

    return {
      shutdown: async () => {
        await this.stop();
      },
      addr: { hostname, port: options.port },
    };
  }

  /**
   * Build the HTTP middleware stack and return its fetch handler without
   * binding a port. Use this when you want to mount the MCP HTTP layer
   * inside another HTTP framework on Deno (Fresh, Hono, `Deno.serve`) or
   * Node (Express, Hono-on-Node) instead of giving up port ownership to
   * {@link startHttp}.
   *
   * **Runtime targets:** `@casys/mcp-server` is Deno-first — the canonical
   * deployment path is Deno 2.x on Deno Deploy or self-hosted Deno, with
   * a Node 20+ distribution via `scripts/build-node.sh` as a secondary
   * target. Cloudflare Workers, workerd, and browser runtimes are not
   * supported — if you target those, use
   * [`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server)
   * directly instead.
   *
   * The returned handler accepts a Web Standard {@link Request} and returns
   * a Web Standard {@link Response}. It exposes the same routes as
   * {@link startHttp}: `POST /mcp`, `GET /health`, `GET /metrics`, and
   * `GET /.well-known/oauth-protected-resource`. `GET /mcp` returns 405.
   *
   * Auth, multi-tenant middleware, scope checks, and rate limiting are all
   * applied identically. OTel hooks are started, so the server is fully
   * live after this returns — just without its own listening socket.
   *
   * Multi-tenant SaaS pattern: cache one `McpApp` per tenant
   * and call `getFetchHandler()` once per server, then dispatch each
   * inbound request to the right cached handler from your framework's
   * routing layer.
   *
   * @example
   * ```typescript
   * // In a Fresh route at routes/mcp/[...path].tsx
   * const server = new McpApp({ name: "my-mcp", version: "1.0.0" });
   * server.registerTools(tools, handlers);
   * const handler = await server.getFetchHandler({
   *   requireAuth: true,
   *   auth: { provider: myAuthProvider },
   * });
   * // Later, in your route handler:
   * return await handler(ctx.req);
   * ```
   *
   * @param options - Same as {@link startHttp}, minus `port`/`hostname`/`onListen`.
   * @returns A Web Standard fetch handler.
   */
  async getFetchHandler(
    options: Omit<HttpServerOptions, "port" | "hostname" | "onListen"> = {},
  ): Promise<FetchHandler> {
    let captured: FetchHandler | null = null;
    await this.startHttp({
      // port/hostname are unused in embedded mode but the type requires them.
      // Pass sentinel values that would never bind even if used.
      port: 0,
      ...options,
      embedded: true,
      embeddedHandlerCallback: (handler) => {
        captured = handler;
      },
    });
    if (!captured) {
      // Defensive: startHttp should always invoke the callback synchronously
      // before returning. If it didn't, something is structurally wrong.
      throw new Error(
        "[McpApp] getFetchHandler: embedded callback was not invoked",
      );
    }
    return captured;
  }

  /**
   * Read the MCP Apps capability advertised by the connected client.
   *
   * Returns the capability object (possibly empty `{}`) when the client
   * advertised support for MCP Apps via its `extensions` capability,
   * or `undefined` when:
   * - the client did not send capabilities yet (called before initialize)
   * - the client did not advertise the MCP Apps extension at all
   * - the client sent a malformed extension value
   *
   * Use this from a tool handler to decide whether to return a UI
   * resource (`_meta.ui`) or a text-only fallback. Hosts that don't
   * support MCP Apps will silently drop the `_meta.ui` field, but
   * checking explicitly lets you serve a richer text response when
   * the UI path isn't available.
   *
   * @returns MCP Apps capability or `undefined` if not supported.
   *
   * @example
   * ```typescript
   * const cap = app.getClientMcpAppsCapability();
   * if (cap?.mimeTypes?.includes(MCP_APP_MIME_TYPE)) {
   *   return {
   *     content: [{ type: "text", text: summary }],
   *     _meta: { ui: { resourceUri: "ui://my-app/dashboard" } },
   *   };
   * }
   * return { content: [{ type: "text", text: detailedTextFallback }] };
   * ```
   *
   * @see {@link getMcpAppsCapability} for the standalone reader
   * @see {@link MCP_APPS_EXTENSION_ID} for the extension key
   */
  getClientMcpAppsCapability(): McpAppsClientCapability | undefined {
    return getMcpAppsCapability(
      this.activeStdioServer?.getClientCapabilities(),
    );
  }

  /**
   * Get queue metrics for monitoring
   */
  getMetrics(): QueueMetrics {
    return this.requestQueue.getMetrics();
  }

  /**
   * Get full server metrics (counters, histograms, gauges)
   */
  getServerMetrics(): import("./observability/metrics.ts").ServerMetricsSnapshot {
    const qm = this.requestQueue.getMetrics();
    this.serverMetrics.setGauges({
      activeRequests: qm.inFlight,
      queuedRequests: qm.queued,
      rateLimiterKeys: this.rateLimiter?.getMetrics().keys ?? 0,
    });
    return this.serverMetrics.getSnapshot();
  }

  /**
   * Get Prometheus text format metrics
   */
  getPrometheusMetrics(): string {
    return this.serverMetrics.toPrometheusFormat();
  }

  /**
   * Get rate limiter metrics (if rate limiting is enabled)
   */
  getRateLimitMetrics(): { keys: number; totalRequests: number } | null {
    return this.rateLimiter?.getMetrics() ?? null;
  }

  /**
   * Get rate limiter instance (for advanced use cases)
   */
  getRateLimiter(): RateLimiter | null {
    return this.rateLimiter;
  }

  /**
   * Get schema validator instance (for advanced use cases)
   */
  getSchemaValidator(): SchemaValidator | null {
    return this.schemaValidator;
  }

  /**
   * Check if server is started
   */
  isStarted(): boolean {
    return this.started;
  }

  /**
   * Get number of registered tools
   */
  getToolCount(): number {
    return this.tools.size;
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // ============================================
  // Resource Introspection (MCP Apps)
  // ============================================

  /**
   * Get number of registered resources
   */
  getResourceCount(): number {
    return this.resources.size;
  }

  /**
   * Get registered resource URIs
   */
  getResourceUris(): string[] {
    return Array.from(this.resources.keys());
  }

  /**
   * Check if a resource is registered
   */
  hasResource(uri: string): boolean {
    return this.resources.has(uri);
  }

  /**
   * Get resource info by URI (for testing/debugging)
   */
  getResourceInfo(uri: string): MCPResource | undefined {
    return this.resources.get(uri)?.resource;
  }

  /**
   * Read resource content by URI.
   * Invokes the registered handler directly (no MCP protocol round-trip).
   * Returns null if the resource is not registered.
   */
  async readResourceContent(uri: string): Promise<ResourceContent | null> {
    const entry = this.resources.get(uri);
    if (!entry) return null;
    return this.validateResourceContent(
      uri,
      await entry.handler(new URL(uri)),
      entry.resource,
    );
  }

  /**
   * Send a JSON-RPC notification to the connected transport.
   *
   * Routing depends on the transport:
   * - **HTTP**: fanned out to `subscriptions/listen` streams, only to
   *   subscribers that opted into that notification type.
   * - **stdio**: written to stdout via the SDK transport.
   *
   * @param method - Notification method (e.g. "notifications/tools/list_changed")
   * @param params - Notification parameters
   */
  sendNotification(
    method: string,
    params?: Record<string, unknown>,
  ): void {
    if (!this.started) return;

    // Route through the subscription registry (subscriptions/listen streams).
    if (this.subscriptions !== null) {
      switch (method) {
        case "notifications/tools/list_changed":
          this.subscriptions.fanOut("toolsListChanged");
          return;
        case "notifications/prompts/list_changed":
          this.subscriptions.fanOut("promptsListChanged");
          return;
        case "notifications/resources/list_changed":
          this.subscriptions.fanOut("resourcesListChanged");
          return;
        case "notifications/resources/updated": {
          const uri = isRecord(params) && typeof params["uri"] === "string"
            ? params["uri"]
            : undefined;
          if (uri === undefined) {
            this.log(
              "[WARN] notifications/resources/updated requires a string 'uri' param; dropped",
            );
            return;
          }
          this.subscriptions.fanOutResourceUpdated(uri);
          return;
        }
        default:
          // subscriptions/listen carries only the four change types a client can
          // opt into. Anything else — a request-scoped progress or log message —
          // belongs on the response stream of the request it relates to, which is
          // not something this method can reach. Say so rather than drop silently.
          this.log(
            `[WARN] sendNotification("${method}") has no delivery channel in stateless mode: ` +
              "only the four subscriptions/listen change types can be pushed. " +
              "Request-scoped notifications must travel on their own request's response stream.",
          );
          return;
      }
    }

    // For stdio mode, send via the one protocol instance pinned by the era
    // negotiator. A probe instance may already be closed while its replacement
    // is being built, so never route through the constructor-time template.
    const server = this.activeStdioServer;
    if (server === null) return;
    void server.notification({ method, params }).catch(() => {
      // Transport may not support notifications yet (pre-initialized).
    });
  }

  /**
   * Register a callback for the "initialized" notification.
   * Called after client sends "initialized" (post-handshake).
   */
  onInitialized(callback: () => void): void {
    this.initializedCallback = callback;
  }

  private initializedCallback: (() => void) | null = null;

  /**
   * Check if a handler result is a pre-formatted MCP result.
   * Pre-formatted results have a `content` array and are passed through
   * without re-wrapping. This supports proxy/gateway patterns.
   */
  private isPreformattedResult(
    result: unknown,
  ): result is {
    content: Array<{ type: string; text: string }>;
    _meta?: Record<string, unknown>;
  } {
    if (!result || typeof result !== "object") return false;
    const obj = result as Record<string, unknown>;
    return Array.isArray(obj.content) &&
      obj.content.length > 0 &&
      typeof obj.content[0] === "object" &&
      obj.content[0] !== null &&
      "type" in obj.content[0] &&
      "text" in obj.content[0];
  }

  /**
   * Apply the spec-2026-07-28 result envelope when — and only when — the peer
   * negotiated that revision.
   *
   * This helper applies on the custom stateless HTTP transport, which only
   * accepts 2026-07-28. Stdio results are neutral here: the official v2 codec
   * stamps modern responses and leaves a negotiated legacy connection clean.
   *
   * Omitting the envelope for a genuinely legacy peer is safe in the other
   * direction too: the spec instructs clients to read a missing `resultType` as
   * `"complete"`.
   *
   * Every HTTP result path funnels through here. Adding a new one without it is
   * the failure mode to watch for — hence the conformance test that walks the
   * method table rather than asserting one endpoint at a time.
   *
   * @param negotiatedVersion Version from the request's `_meta`, or `undefined`
   *   where no per-request negotiation happens.
   */
  private stampResult(
    result: Record<string, unknown>,
    negotiatedVersion?: string,
    resultType: "complete" | "task" = "complete",
  ): Record<string, unknown> {
    if (negotiatedVersion !== SPEC_2026_07_28) return result;
    return {
      ...completeResult(result, {
        name: this.options.name,
        version: this.options.version,
      }),
      resultType,
    };
  }

  /**
   * Validate one MRTR retry delivered through the v2 protocol server.
   *
   * The SDK owns era-specific lifting and legacy fulfilment; Casys owns the
   * integrity bindings and nonce consumption of its sealed requestState.
   * Protocol errors deliberately escape the tool-error wrapper so clients see
   * a JSON-RPC error instead of a successful tools/call result with isError.
   */
  private async prepareProtocolMrtrRetry(
    inputResponses: Record<string, unknown> | undefined,
    requestState: string | undefined,
    context: {
      principal: string;
      method: string;
      paramsDigest: string;
    },
  ): Promise<{
    inputResponses?: Record<string, unknown>;
    retryVerified?: boolean;
  }> {
    const needsKey = inputResponses !== undefined || requestState !== undefined;
    let key: CryptoKey | null = null;
    if (needsKey) {
      try {
        key = await this.getMrtrKey();
      } catch (error) {
        throw new ProtocolError(
          ProtocolErrorCode.InternalError,
          "MRTR signing key is unavailable",
          {
            problem: "mrtr_key_unavailable",
            detail: error instanceof Error ? error.message : String(error),
            recovery:
              "Check mrtr.signingKey. The import is retried on the next request, so a transient failure clears itself.",
          },
        );
      }
    }

    const outcome = await guardMrtrRetry({
      ...(inputResponses !== undefined ? { inputResponses } : {}),
      ...(requestState !== undefined ? { requestState } : {}),
      key,
      replayStore: this.mrtrReplayStore,
      bindings: context,
    });

    if (outcome.kind === "missing_state") {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "inputResponses supplied without the requestState issued with them",
        {
          problem: "missing_request_state",
          recovery:
            "Echo back the exact requestState string from the InputRequiredResult alongside inputResponses.",
        },
      );
    }
    if (outcome.kind === "invalid_state") {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Invalid requestState: ${outcome.reason}`,
        { reason: outcome.reason },
      );
    }
    if (outcome.kind === "replay_store_unavailable") {
      if (outcome.reason === "consume_failed") {
        this.log(
          "[WARN] MRTR replay store unavailable; retry rejected before handler",
        );
      }
      throw new ProtocolError(
        ProtocolErrorCode.InternalError,
        "MRTR replay protection is unavailable",
        {
          problem: "mrtr_replay_store_unavailable",
          recovery: outcome.reason === "missing"
            ? "Configure mrtr.signingKey with a working replay store and retry the full interaction."
            : "Restore the shared replay store, then restart the interaction to obtain a fresh requestState.",
        },
      );
    }
    if (outcome.kind === "replayed") {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        "Invalid requestState: replayed",
        { reason: "replayed" },
      );
    }

    return {
      ...(inputResponses !== undefined ? { inputResponses } : {}),
      ...(outcome.retryVerified !== undefined
        ? { retryVerified: outcome.retryVerified }
        : {}),
    };
  }

  /**
   * Resolve the MRTR signing key once, warning if a deployment has none.
   *
   * A missing key is not an error: the spec permits unprotected `requestState`
   * when tampering can cause nothing worse than the request failing. It is a
   * loud warning because that condition is easy to believe and hard to verify.
   */
  /**
   * Key lookup that reports failure instead of throwing.
   *
   * The `tools/call` call sites sit outside the tool try/catch, so a throw would
   * reach the POST-level catch and surface as -32700 "Parse error" — the same trap
   * the earlier throwing principal guard fell into. Returns a ready response
   * instead.
   */
  private async getMrtrKeySafe(
    id: unknown,
    version: string,
  ): Promise<{ key: CryptoKey | null } | { error: Response }> {
    try {
      return { key: await this.getMrtrKey() };
    } catch (error) {
      return {
        error: jsonRpcResponse(
          {
            jsonrpc: "2.0",
            id,
            error: {
              code: ErrorCode.InternalError,
              message: "MRTR signing key is unavailable",
              data: {
                problem: "mrtr_key_unavailable",
                detail: error instanceof Error ? error.message : String(error),
                recovery:
                  "Check mrtr.signingKey. The import is retried on the next request, so a transient failure clears itself.",
              },
            },
          },
          500,
          { "MCP-Protocol-Version": version },
        ),
      };
    }
  }

  private getMrtrKey(): Promise<CryptoKey | null> {
    // Assigned synchronously, so two concurrent callers share one import rather
    // than one of them observing a half-initialised state.
    //
    // A REJECTED import is un-memoised in the catch below: caching the rejection
    // poisoned the instance permanently, and every later retry surfaced it through
    // the POST-level catch as -32700 "Parse error" — wrong code, and no second
    // attempt ever made. A transient WebCrypto failure should not be terminal.
    this.mrtrKeyPromise ??= (async () => {
      const hex = this.options.mrtr?.signingKey;
      if (hex === undefined) {
        this.log(
          "[WARN] MRTR requestState is unprotected: no mrtr.signingKey configured. " +
            "A client can tamper with it. Only acceptable when requestState " +
            "influences nothing beyond whether the request succeeds.",
        );
        return null;
      }
      try {
        return await importStateKey(hex);
      } catch (error) {
        // Drop the memoised rejection so a later request retries the import.
        this.mrtrKeyPromise = null;
        throw new Error(
          `[McpApp] mrtr.signingKey could not be imported: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })();
    return this.mrtrKeyPromise;
  }

  /**
   * Turn a handler's `InputRequiredSignal` into the wire result.
   *
   * Validates what the spec puts on the server rather than the client:
   *  - at least one of `inputRequests` / `requestState` must be present;
   *  - no input request may name a capability the client did not declare.
   *
   * A violation is the server author's bug, so it surfaces as `-32603` rather
   * than being emitted as an invalid MRTR result for the client to puzzle over.
   */
  private async buildInputRequiredResult(
    signal: InputRequiredSignal,
    context: {
      clientCapabilities: ClientCapabilities | undefined;
      principal: string;
      method: string;
      /** Digest of the arguments as received, taken before the pipeline ran. */
      paramsDigest: string;
    },
  ): Promise<
    { ok: true; result: Record<string, unknown> } | {
      ok: false;
      message: string;
      code: number;
      data?: Record<string, unknown>;
    }
  > {
    const requests = signal.inputRequests;

    // `Object.keys(null)` throws, and `inputRequests: null` survives JSON — so an
    // unchecked map reached the generic tool-error path as a 200 instead of being
    // classified as the malformed server output it is. Validated before enumerating.
    if (requests !== undefined && !isRecord(requests)) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message: "Malformed inputRequest: inputRequests must be an object",
      };
    }

    const hasRequests = requests !== undefined &&
      Object.keys(requests).length > 0;

    if (!hasRequests && signal.requestState === undefined) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message:
          "An InputRequiredResult must carry at least one of inputRequests or requestState (spec 2026-07-28, MRTR server rule 6)",
      };
    }

    let canonicalRequests: Record<string, unknown> | undefined;
    if (hasRequests) {
      const check = checkInputRequestCapabilities(
        requests as Record<string, InputRequestEntry>,
        context.clientCapabilities as Record<string, unknown> | undefined,
      );
      if (!check.ok) {
        // A structurally invalid input request is the SERVER's bug. Reporting it
        // as -32021 told the client to declare a capability it already had, and
        // hid the real fault behind a client-facing error.
        if (check.kind === "malformed") {
          return {
            ok: false,
            code: ErrorCode.InternalError,
            message: `Malformed inputRequest: ${
              check.missingCapabilities.join(", ")
            }`,
          };
        }
        // Spec rule 7 is a MUST NOT on the server: never ask for input the
        // client cannot provide. Emitting it anyway would strand the request.
        return {
          ok: false,
          code: MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
          message:
            `Cannot request input for capabilities the client did not declare: ${
              check.missingCapabilities.join(", ")
            }`,
          // ClientCapabilities-shaped so a typed client can read it directly and
          // learn which capability to declare.
          data: {
            // The check supplies a nested shape for sub-capabilities; otherwise
            // the names are top-level keys.
            requiredCapabilities: check.requiredCapabilities ??
              Object.fromEntries(
                check.missingCapabilities.map((cap) => [cap, {}]),
              ),
          },
        };
      }
      canonicalRequests = check.canonicalRequests;
    }

    // Seal the token so the retry can be proven legitimate. The payload holds
    // only bindings — principal, method, argument digest, expiry, nonce — not
    // application state: since the digest guarantees identical arguments, a
    // handler rebuilds its context from those.
    //
    // The principal binding is only meaningful when auth is configured; see the
    // verification site. Sealing happens AFTER the capability check on purpose —
    // no point minting a token for a result that will be refused.
    // Resolved here regardless of `needsKey` at ingress: a FIRST leg carries
    // neither MRTR field and still needs a sealed token. A rejected import is
    // reported as what it is rather than surfacing as a tool failure — the
    // handler did nothing wrong.
    let key: CryptoKey | null;
    try {
      key = await this.getMrtrKey();
    } catch (error) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message: "MRTR signing key is unavailable",
        data: {
          problem: "mrtr_key_unavailable",
          detail: error instanceof Error ? error.message : String(error),
          recovery:
            "Check mrtr.signingKey. The import is retried on the next request, so a transient failure clears itself.",
        },
      };
    }
    let requestState = signal.requestState;
    if (key !== null) {
      const ttl = this.options.mrtr?.defaultTtlSecs ?? 300;
      requestState = await sealRequestState({
        sub: context.principal,
        method: context.method,
        paramsDigest: context.paramsDigest,
        exp: Math.floor(Date.now() / 1000) + ttl,
        nonce: bytesToHexLocal(crypto.getRandomValues(new Uint8Array(16))),
      }, key);
    }

    // No `?? requests` fallback. Falling back to the handler's object would
    // silently restore the very bypass this closes — a fallback that reopens a
    // security hole is worse than a failure. If the invariant ever breaks, say so.
    if (hasRequests && canonicalRequests === undefined) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message:
          "Internal invariant violated: inputRequests were not canonicalised before emission",
      };
    }

    // Serialisation can EMPTY the map: JSON drops keys whose value is `undefined`,
    // so `{ ask: undefined }` canonicalises to `{}`. The at-least-one rule was
    // checked against the original, so that emitted an InputRequiredResult with an
    // empty map and — where no key is configured — no requestState either, leaving
    // the client nothing to answer and no reason to retry.
    const canonicalCount = canonicalRequests === undefined
      ? 0
      : Object.keys(canonicalRequests).length;
    if (hasRequests && canonicalCount === 0) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message:
          "inputRequests contained no serialisable entries (keys with an undefined value are dropped by JSON)",
      };
    }
    if (canonicalCount === 0 && requestState === undefined) {
      return {
        ok: false,
        code: ErrorCode.InternalError,
        message:
          "An InputRequiredResult must carry at least one of inputRequests or requestState (spec 2026-07-28, MRTR server rule 6)",
      };
    }

    return {
      ok: true,
      result: {
        resultType: "input_required",
        // This path deliberately cannot use stampResult(): that would replace
        // its `input_required` discriminator with `complete`. It is still a
        // 2026 Result, though, so carry the same server identity envelope as
        // every other response.
        _meta: {
          [STATELESS_SERVER_INFO_KEY]: {
            name: this.options.name,
            version: this.options.version,
          },
        },
        // The clone the check inspected, NOT the handler's object. Serialising the
        // original a second time lets a stateful `toJSON()` return a different
        // value for the response than the gate approved.
        ...(canonicalRequests !== undefined
          ? { inputRequests: canonicalRequests }
          : {}),
        ...(requestState !== undefined ? { requestState } : {}),
      },
    };
  }

  /**
   * Reject a Tasks request from a client that did not declare the extension.
   *
   * Returns a ready 400 response to return, or `null` when the client is
   * entitled to proceed. Two distinct spec rules converge here: a server
   * **MUST NOT** hand a task to a non-declaring client, and **MUST** answer the
   * missing-capability error when one calls `tasks/*`.
   *
   * `-32021` (`MissingRequiredClientCapability`) is the code, and
   * `data.requiredCapabilities` is required to list what was missing — a client
   * that gets this back needs to know which capability to add, not just that
   * something was absent.
   */
  private requireTasksCapability(
    clientCapabilities: ClientCapabilities | undefined,
    id: unknown,
  ): Response | null {
    if (this.taskStore === null) {
      return jsonRpcResponse(
        {
          jsonrpc: "2.0",
          id,
          error: {
            code: ErrorCode.MethodNotFound,
            message:
              `Tasks extension is not enabled on this server (declare "${TASKS_EXTENSION_ID}" in McpAppOptions.extensions)`,
          },
        },
        404,
      );
    }

    const extensions = clientCapabilities?.extensions;
    const declared = isRecord(extensions) &&
      extensions[TASKS_EXTENSION_ID] !== undefined;
    if (declared) return null;

    return jsonRpcResponse(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: MCP_MISSING_REQUIRED_CLIENT_CAPABILITY,
          message:
            `Client did not declare the "${TASKS_EXTENSION_ID}" extension`,
          // ClientCapabilities-shaped, per the schema: capability keys mapping
          // to their settings object. An array of names would not deserialise
          // into `ClientCapabilities` on a typed client.
          data: {
            requiredCapabilities: { extensions: { [TASKS_EXTENSION_ID]: {} } },
          },
        },
      },
      400,
    );
  }

  /**
   * Task status transitions, for pushing to subscribers.
   *
   * The spec's notification method is `notifications/tasks` — not a
   * `tasks/`-prefixed name, which would collide with the request methods.
   *
   * Delivery goes out over `subscriptions/listen` once that route is wired
   * (Track G); the registry exists but the transport does not yet open streams.
   * Until then this is intentionally a no-op beyond the log: polling via
   * `tasks/get` is the spec's default and works without it.
   */
  private onTaskChanged(task: DetailedTask): void {
    this.log(`task ${task.taskId} → ${task.status}`);
  }

  /**
   * Add the required `CacheableResult` fields (spec 2026-07-28, SEP-2549).
   *
   * Applies to `tools/list`, `prompts/list`, `resources/list`, `resources/read`
   * and `resources/templates/list`, where the final spec makes both fields
   * required rather than optional. Same version gate as {@link stampResult}:
   * neither field exists in an earlier revision.
   *
   * Both are hints — a client that ignores them stays correct, it just polls
   * more often.
   */
  private withCacheHints(
    result: Record<string, unknown>,
    negotiatedVersion?: string,
    request?: { readonly isMrtrRetry?: boolean },
  ): Record<string, unknown> {
    if (negotiatedVersion !== SPEC_2026_07_28) return result;

    // A result produced by an MRTR retry MUST NOT be cached: it depends on
    // `inputResponses` / `requestState`, which are not part of the cache key, so
    // a cache would serve it for a later request that supplied different input.
    // Emitting no hints is how a server declines to make the result cacheable —
    // clients read an absent ttlMs as 0.
    if (request?.isMrtrRetry) return result;

    return {
      ...result,
      ttlMs: this.cacheTtlMs,
      cacheScope: this.options.cache?.scope ?? "private",
    };
  }

  /**
   * Capabilities advertised on `server/discover` and `initialize`.
   *
   * Single source of truth: these two responses used to build the same object
   * independently, which is how they drift.
   *
   * `extensions` (spec 2026-07-28) is the declaration point for opt-in
   * extensions such as `io.modelcontextprotocol/tasks`. It is emitted only when
   * the consumer actually declares one — an empty `extensions: {}` would read as
   * "this server supports no extensions", which is a stronger claim than we can
   * make while MCP Apps support is de-facto (via `ui://` resources) rather than
   * declared. Wire it up here once the Apps extension identifier is pinned.
   */
  private buildServerCapabilities(): Record<string, unknown> {
    const { extensions } = this.options;
    // The declaration in options is the single source of truth: `taskStore` is
    // created from it, so advertising and behaviour cannot drift apart.
    return {
      tools: {},
      // Capability lifetime is defined by installed handlers, not the current
      // Map size. A dynamic registry may correctly be empty at initialize and
      // gain resources later; `listChanged` tells clients to refresh then.
      resources: this.resourceHandlersInstalled
        ? { listChanged: true }
        : undefined,
      ...(extensions && Object.keys(extensions).length > 0
        ? { extensions }
        : {}),
    };
  }

  /**
   * Build the tools/list response, filtering out app-only tools
   * and passing through outputSchema/annotations when defined.
   */
  private buildToolListing(): Array<Record<string, unknown>> {
    return Array.from(this.tools.values())
      .filter((t) => {
        const vis = (t._meta?.ui as { visibility?: unknown } | undefined)
          ?.visibility;
        if (Array.isArray(vis) && !vis.includes("model")) return false;
        return true;
      })
      .map((t) => {
        const entry: Record<string, unknown> = {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          _meta: t._meta,
        };
        if (t.outputSchema !== undefined) entry.outputSchema = t.outputSchema;
        if (t.annotations !== undefined) entry.annotations = t.annotations;
        return entry;
      })
      // Spec 2026-07-28 (minor change 3): return tools in a deterministic order.
      // It lets clients cache the list and improves LLM prompt-cache hit rates.
      //
      // Map iteration is already insertion-ordered, so this only matters where
      // registration order itself is unstable — which it is for the relay/proxy
      // case, where tools are registered as child servers are discovered
      // asynchronously. Sorting by name makes the output independent of who
      // answered first.
      //
      // Deliberately not `localeCompare`: that orders differently per host
      // locale, reintroducing the very non-determinism being removed here.
      .sort((a, b) =>
        (a.name as string) < (b.name as string)
          ? -1
          : (a.name as string) > (b.name as string)
          ? 1
          : 0
      );
  }

  /**
   * Check if a handler result is a StructuredToolResult
   * (has content as string + structuredContent as object).
   */
  private isStructuredToolResult(
    result: unknown,
  ): result is StructuredToolResult {
    if (!result || typeof result !== "object") return false;
    const obj = result as Record<string, unknown>;
    return (
      typeof obj.content === "string" &&
      obj.structuredContent !== null &&
      obj.structuredContent !== undefined &&
      typeof obj.structuredContent === "object" &&
      !Array.isArray(obj.structuredContent)
    );
  }

  /**
   * Build a CallToolResult from the handler's return value.
   * Priority: preformatted > structuredToolResult > plain value.
   */
  private buildToolCallResult(
    toolName: string,
    result: unknown,
    executedTool?: ToolWithHandler,
  ): Record<string, unknown> {
    // Proxy/gateway pattern — pass through as-is
    if (this.isPreformattedResult(result)) {
      return canonicaliseWireResult(result as Record<string, unknown>);
    }

    // Result metadata belongs to the same definition whose handler produced the
    // value. A live replacement may already occupy this name by the time an
    // asynchronous handler or task completes.
    const tool = executedTool ?? this.tools.get(toolName);

    // StructuredToolResult: separate content (for LLM) and structuredContent (for viewer)
    if (this.isStructuredToolResult(result)) {
      const r: Record<string, unknown> = {
        content: [{ type: "text", text: result.content }],
        structuredContent: result.structuredContent,
      };
      if (tool?._meta) r._meta = tool._meta;
      return canonicaliseWireResult(r);
    }

    // Plain value: JSON-stringify into content[0].text
    const r: Record<string, unknown> = {
      content: [{
        type: "text",
        text: typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2),
      }],
    };
    if (tool?._meta) r._meta = tool._meta;
    return canonicaliseWireResult(r);
  }

  /**
   * Handle a tool execution error using the configured toolErrorMapper.
   * Returns an isError result if the mapper handles it, otherwise rethrows.
   */
  private handleToolError(
    error: unknown,
    toolName: string,
  ): Record<string, unknown> {
    const mapper = this.options.toolErrorMapper;
    if (mapper) {
      let msg: string | null;
      try {
        msg = mapper(error, toolName);
      } catch (mapperError) {
        this.log(
          `toolErrorMapper threw for tool ${toolName}: ${
            mapperError instanceof Error
              ? mapperError.message
              : String(mapperError)
          } (original error: ${
            error instanceof Error ? error.message : String(error)
          })`,
        );
        // Fall through to rethrow original error
        msg = null;
      }
      if (msg !== null) {
        this.log(`Tool ${toolName} returned business error: ${msg}`);
        return {
          content: [{ type: "text", text: msg }],
          isError: true,
        };
      }
    }
    // No mapper or mapper returned null → rethrow
    this.log(
      `Error executing tool ${toolName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    throw error;
  }

  /**
   * Log message using custom logger or stderr
   */
  private log(msg: string): void {
    if (this.options.logger) {
      this.options.logger(msg);
    } else {
      console.error(`[${this.options.name}] ${msg}`);
    }
  }
}

// ── registerViewers types ──────────────────────────────────────────

/** Configuration for registerViewers() */
export interface RegisterViewersConfig {
  /** URI prefix — viewers get `ui://{prefix}/{viewerName}` */
  prefix: string;
  /** import.meta.url of the consumer's server.ts (for resolving dist paths) */
  moduleUrl: string;
  /** Check if a path or URL exists. Receives a filesystem path for local
   *  modules (file://) or an HTTPS URL for remote modules (JSR, CDN). */
  exists: (path: string) => boolean;
  /** Read a file and return its content as string */
  readFile: (path: string) => string | Promise<string>;
  /** Explicit list of viewer names. If omitted, use `discover`. */
  viewers?: string[];
  /** Auto-discover viewers by scanning a directory */
  discover?: {
    uiDir: string;
  } & DiscoverViewersFS;
  /** Custom function to generate human-readable names. Default: kebab-to-Title. */
  humanName?: (viewerName: string) => string;
  /** MCP Apps CSP — declares external domains the viewer needs (tiles, APIs, CDNs).
   *  Uses McpUiCsp from @casys/mcp-compose (resourceDomains, connectDomains). */
  csp?: {
    resourceDomains?: string[];
    connectDomains?: string[];
    frameDomains?: string[];
  };
}

/** Summary returned by registerViewers() */
export interface RegisterViewersSummary {
  registered: string[];
  skipped: string[];
}

/** Default: "invoice-viewer" → "Invoice Viewer" */
function defaultHumanName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
