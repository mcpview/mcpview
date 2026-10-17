/**
 * MCP server cluster — start, connect, call tools, and shut down MCP servers.
 *
 * Two transport modes:
 * - **stdio**: The cluster starts the server as a child process with `--http --port=0`.
 *   The server picks a free port and prints the URL on stderr. All communication
 *   then goes through HTTP (no JSON-RPC over stdio).
 * - **http**: The cluster connects to an already-running server via its URL.
 *
 * Both modes support the modern stateless MCP HTTP protocol and legacy
 * Streamable HTTP. `auto` probes stateless `server/discover` first; only a
 * server that explicitly rejects that protocol falls back to the official SDK
 * client, which performs initialization and retains its session.
 *
 * ## AX (Agent Experience)
 *
 * - **Fast fail**: Invalid manifests, connection failures, and tool call errors
 *   produce structured `RuntimeError` objects with machine-readable codes.
 * - **Deterministic cleanup**: `stopAll()` always runs in a `finally` block
 *   pattern. Process handles are tracked and killed on shutdown.
 * - **Timeout-aware**: Tool calls and server startup have configurable timeouts
 *   with clear error messages on expiry.
 * - **No magic**: The cluster does not retry failed calls or silently swallow
 *   errors. Callers decide retry policy.
 *
 * @module runtime/cluster
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { COMPOSE_VERSION } from "../version.ts";
import type {
  McpCluster,
  McpConnection,
  McpHttpProtocol,
  McpListResourcesResult,
  McpListToolsResult,
  McpManifest,
  McpReadResourceResult,
  RuntimeError,
} from "./types.ts";
import { RuntimeErrorCode } from "./types.ts";

/** Default timeout for server startup (ms). */
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;

/** Default timeout for tool and resource calls (ms). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Pattern to detect the HTTP listening URL from server stderr.
 * Matches "listening on http://host:port" to avoid false positives
 * from warning messages containing URLs. */
const LISTEN_URL_PATTERN = /listening on (https?:\/\/[^\s]+)/;

/**
 * Connect to an already-running MCP server via HTTP.
 *
 * Performs MCP protocol discovery/initialization rather than relying on a
 * non-standard `/health` endpoint.
 *
 * @param manifest - Server manifest with http transport
 * @returns Active connection
 * @throws RuntimeError if health check fails
 *
 * @example
 * ```typescript
 * const conn = await connectHttp({
 *   name: "einvoice",
 *   transport: { type: "http", url: "http://localhost:3015" },
 *   tools: [...],
 * });
 * const result = await conn.callTool("invoice_search", { customer_id: "C-1" });
 * ```
 */
export async function connectHttp(manifest: McpManifest): Promise<McpConnection> {
  if (manifest.transport.type !== "http") {
    throw {
      code: RuntimeErrorCode.PROCESS_START_FAILED,
      message: `Expected http transport for "${manifest.name}", got "${manifest.transport.type}"`,
      server: manifest.name,
    } satisfies RuntimeError;
  }

  let baseUrl = manifest.transport.url;
  try {
    baseUrl = normalizeBaseUrl(manifest.transport.url);
    return await createHttpConnection(
      manifest.name,
      baseUrl,
      manifest.transport.protocol ?? "auto",
    );
  } catch (cause) {
    throw {
      code: RuntimeErrorCode.PROCESS_START_FAILED,
      message: `Cannot initialize MCP connection to "${manifest.name}" at ${baseUrl}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      server: manifest.name,
      cause,
    } satisfies RuntimeError;
  }
}

/**
 * Start an MCP server as a child process and connect via HTTP.
 *
 * Launches the server with `--http --port=0` (dynamic port),
 * reads stderr to detect the listening URL, then communicates via HTTP.
 *
 * @param manifest - Server manifest with stdio transport
 * @param options - Startup options
 * @returns Active connection (with process handle for cleanup)
 * @throws RuntimeError if startup times out or fails
 *
 * @example
 * ```typescript
 * const conn = await startServer({
 *   name: "einvoice",
 *   transport: { type: "stdio", command: "deno", args: ["run", "server.ts"] },
 *   tools: [...],
 * });
 * ```
 */
export async function startServer(
  manifest: McpManifest,
  options?: { timeoutMs?: number },
): Promise<McpConnection> {
  if (manifest.transport.type !== "stdio") {
    throw {
      code: RuntimeErrorCode.PROCESS_START_FAILED,
      message: `Expected stdio transport for "${manifest.name}", got "${manifest.transport.type}"`,
      server: manifest.name,
    } satisfies RuntimeError;
  }

  const transport = manifest.transport;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

  // Validate required env vars before starting
  if (manifest.requiredEnv?.length) {
    const env = transport.env ?? {};
    const missing = manifest.requiredEnv.filter((k) => !env[k] && !Deno.env.get(k));
    if (missing.length > 0) {
      throw {
        code: RuntimeErrorCode.PROCESS_START_FAILED,
        message: `Server "${manifest.name}" requires env vars: ${missing.join(", ")}`,
        server: manifest.name,
      } satisfies RuntimeError;
    }
  }

  // Append --http --port=0 if not already present
  const args = [...(transport.args ?? [])];
  if (!args.includes("--http")) args.push("--http");
  if (!args.some((a) => a.startsWith("--port="))) args.push("--port=0");

  let process: Deno.ChildProcess;
  try {
    const command = new Deno.Command(transport.command, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: transport.env,
    });
    process = command.spawn();
  } catch (cause) {
    throw {
      code: RuntimeErrorCode.PROCESS_START_FAILED,
      message: `Failed to start "${manifest.name}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      server: manifest.name,
      cause,
    } satisfies RuntimeError;
  }

  // Drain stdout in background (we don't use it, prevent pipe pressure)
  drainStream(process.stdout);

  // Read stderr to find the listening URL. If startup fails before the URL is
  // announced, do not leave the owned child process behind.
  let baseUrl: string;
  try {
    baseUrl = await detectListenUrl(
      manifest.name,
      process.stderr,
      timeoutMs,
    );
  } catch (cause) {
    await stopProcess(process);
    throw cause;
  }

  try {
    return await createStdioConnection(
      manifest.name,
      baseUrl,
      transport.protocol ?? "auto",
      process,
    );
  } catch (cause) {
    await stopProcess(process);
    throw {
      code: RuntimeErrorCode.PROCESS_START_FAILED,
      message: `Cannot initialize MCP connection to "${manifest.name}" at ${baseUrl}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      server: manifest.name,
      cause,
    } satisfies RuntimeError;
  }
}

/**
 * Create a cluster manager for multiple MCP servers.
 *
 * @param manifests - All available manifests (keyed by name)
 * @param serverNames - Which servers to include in the cluster
 * @returns Cluster manager with startAll/stopAll/callTool
 *
 * @example
 * ```typescript
 * const cluster = createCluster(manifests, ["mcp-einvoice", "mcp-dataviz"]);
 * await cluster.startAll();
 * try {
 *   const result = await cluster.callTool("mcp-einvoice", "invoice_search", { id: "1" });
 * } finally {
 *   await cluster.stopAll();
 * }
 * ```
 */
export function createCluster(
  manifests: Map<string, McpManifest>,
  serverNames: string[],
): McpCluster {
  const connections = new Map<string, McpConnection>();
  let startup: Promise<void> | undefined;

  const startConnections = async (): Promise<void> => {
    // Validate all manifests exist before starting anything. A template may
    // legitimately have several panels from one source; the cluster owns one
    // connection per manifest, not one connection per panel.
    const resolvedManifests: McpManifest[] = [];
    for (const name of new Set(serverNames)) {
      const manifest = manifests.get(name);
      if (!manifest) {
        throw {
          code: RuntimeErrorCode.MANIFEST_NOT_FOUND,
          message: `Manifest "${name}" not found`,
          server: name,
        } satisfies RuntimeError;
      }
      resolvedManifests.push(manifest);
    }

    // Start all distinct servers in parallel.
    const results = await Promise.allSettled(
      resolvedManifests.map((manifest) =>
        manifest.transport.type === "http"
          ? connectHttp(manifest).then((conn) => ({ name: manifest.name, conn }))
          : startServer(manifest).then((conn) => ({ name: manifest.name, conn }))
      ),
    );

    // Collect successes and failures.
    const failures: string[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        connections.set(result.value.name, result.value.conn);
      } else {
        const err = result.reason as RuntimeError;
        failures.push(err.message ?? String(result.reason));
      }
    }

    // If any failed, clean up the ones that succeeded and throw.
    if (failures.length > 0) {
      await Promise.allSettled(
        [...connections.values()].map((conn) => conn.close()),
      );
      connections.clear();
      throw {
        code: RuntimeErrorCode.PROCESS_START_FAILED,
        message: `Failed to start ${failures.length} server(s): ${failures.join("; ")}`,
      } satisfies RuntimeError;
    }
  };

  return {
    async startAll(): Promise<void> {
      if (connections.size > 0) return;
      if (startup) return await startup;

      startup = startConnections();
      try {
        await startup;
      } finally {
        startup = undefined;
      }
    },

    // `async` is load-bearing despite the absence of `await`: the synchronous
    // `throw` below must reach callers as a rejected Promise. Dropping `async`
    // would make it throw synchronously, and `cluster.callTool(...).catch(...)`
    // would stop catching it.
    // deno-lint-ignore require-await
    async callTool(
      serverName: string,
      toolName: string,
      args?: Record<string, unknown>,
    ): Promise<unknown> {
      const conn = connections.get(serverName);
      if (!conn) {
        throw {
          code: RuntimeErrorCode.TOOL_CALL_FAILED,
          message: `No connection for server "${serverName}". Did you call startAll()?`,
          server: serverName,
          tool: toolName,
        } satisfies RuntimeError;
      }
      return conn.callTool(toolName, args);
    },

    // See callTool above: preserve rejected-Promise behavior for missing
    // connections instead of synchronously throwing from the cluster facade.
    // deno-lint-ignore require-await
    async readResource(serverName: string, uri: string): Promise<McpReadResourceResult> {
      const conn = connections.get(serverName);
      if (!conn) {
        throw {
          code: RuntimeErrorCode.RESOURCE_READ_FAILED,
          message: `No connection for server "${serverName}". Did you call startAll()?`,
          server: serverName,
        } satisfies RuntimeError;
      }
      return conn.readResource(uri);
    },

    // See callTool above: preserve rejected-Promise behavior for missing
    // connections instead of synchronously throwing from the cluster facade.
    // deno-lint-ignore require-await
    async listTools(serverName: string, cursor?: string): Promise<McpListToolsResult> {
      const conn = connections.get(serverName);
      if (!conn) {
        throw {
          code: RuntimeErrorCode.TOOL_LIST_FAILED,
          message: `No connection for server "${serverName}". Did you call startAll()?`,
          server: serverName,
        } satisfies RuntimeError;
      }
      return conn.listTools(cursor);
    },

    // See callTool above: preserve rejected-Promise behavior for missing
    // connections instead of synchronously throwing from the cluster facade.
    // deno-lint-ignore require-await
    async listResources(serverName: string, cursor?: string): Promise<McpListResourcesResult> {
      const conn = connections.get(serverName);
      if (!conn) {
        throw {
          code: RuntimeErrorCode.RESOURCE_LIST_FAILED,
          message: `No connection for server "${serverName}". Did you call startAll()?`,
          server: serverName,
        } satisfies RuntimeError;
      }
      return conn.listResources(cursor);
    },

    getUiBaseUrl(serverName: string): string | undefined {
      return connections.get(serverName)?.uiBaseUrl;
    },

    async stopAll(): Promise<void> {
      const results = await Promise.allSettled(
        [...connections.values()].map((conn) => conn.close()),
      );
      connections.clear();

      // Log failures but don't throw — cleanup is best-effort
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("[mcp-compose] Failed to close connection:", result.reason);
        }
      }
    },
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Read stderr line by line until a URL matching the listen pattern is found.
 * Times out with a RuntimeError if no URL appears.
 */
// `async` keeps a synchronous throw from `getReader()` inside the returned
// Promise, matching what callers expect from a `Promise<string>`-typed function.
// deno-lint-ignore require-await
async function detectListenUrl(
  serverName: string,
  stderr: ReadableStream<Uint8Array>,
  timeoutMs: number,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stderr.getReader();
  let buffer = "";
  let timerId: ReturnType<typeof setTimeout>;

  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reader.releaseLock();
      drainStream(stderr);
      reject(
        {
          code: RuntimeErrorCode.PROCESS_START_FAILED,
          message: `Server "${serverName}" did not report a listening URL within ${timeoutMs}ms`,
          server: serverName,
        } satisfies RuntimeError,
      );
    }, timeoutMs);
  });

  const detect = async (): Promise<string> => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          throw {
            code: RuntimeErrorCode.PROCESS_DIED,
            message:
              `Server "${serverName}" exited before reporting a listening URL. Stderr: ${buffer}`,
            server: serverName,
          } satisfies RuntimeError;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        for (const line of lines) {
          const match = line.match(LISTEN_URL_PATTERN);
          if (match) {
            reader.releaseLock();
            drainStream(stderr);
            return match[1].replace(/\/+$/, "");
          }
        }

        buffer = lines[lines.length - 1];
      }
    } finally {
      clearTimeout(timerId!);
    }
  };

  return Promise.race([detect(), timeout]);
}

/** Drain a stream in background to prevent pipe backpressure. */
function drainStream(stream: ReadableStream<Uint8Array>): void {
  const reader = stream.getReader();
  (async () => {
    try {
      while (!(await reader.read()).done) { /* discard */ }
    } catch {
      /* stream closed */
    } finally {
      reader.releaseLock();
    }
  })();
}

/** Protocol revision implemented by the stateless transport adapter. */
const STATELESS_PROTOCOL_VERSION = "2026-07-28";

/** Metadata required on every stateless MCP request. */
const STATELESS_PROTOCOL_META_KEY = "io.modelcontextprotocol/protocolVersion";
const STATELESS_CLIENT_CAPABILITIES_META_KEY = "io.modelcontextprotocol/clientCapabilities";
const STATELESS_CLIENT_INFO_META_KEY = "io.modelcontextprotocol/clientInfo";

/**
 * Create an MCP connection to an already-running HTTP server.
 *
 * `auto` is intentionally stateless-first: the 2026-07-28 protocol has no
 * session and asks clients to discover capabilities with `server/discover`.
 * Only explicit stateless incompatibility falls back to the official
 * Streamable HTTP SDK and its stateful `initialize` handshake.
 */
async function createHttpConnection(
  name: string,
  baseUrl: string,
  protocol: McpHttpProtocol,
): Promise<McpConnection> {
  return await createMcpConnection(name, "http", baseUrl, protocol);
}

/** Create an McpConnection backed by a child process + HTTP transport. */
async function createStdioConnection(
  name: string,
  baseUrl: string,
  protocol: McpHttpProtocol,
  process: Deno.ChildProcess,
): Promise<McpConnection> {
  return await createMcpConnection(
    name,
    "stdio",
    baseUrl,
    protocol,
    () => stopProcess(process),
  );
}

/**
 * Select a protocol-specific MCP connection.
 *
 * Compose deliberately exposes concrete operations rather than a generic
 * JSON-RPC escape hatch. The host can therefore enforce its slot/tool/resource
 * allow-lists before delegating to this runtime layer.
 */
async function createMcpConnection(
  name: string,
  transportType: "stdio" | "http",
  baseUrl: string,
  protocol: McpHttpProtocol,
  stopOwnedProcess?: () => Promise<void>,
): Promise<McpConnection> {
  if (protocol === "stateless-2026-07-28") {
    return await createStatelessConnection(name, transportType, baseUrl, stopOwnedProcess);
  }

  if (protocol === "streamable-http") {
    return await createStreamableConnection(name, transportType, baseUrl, stopOwnedProcess);
  }

  try {
    return await createStatelessConnection(name, transportType, baseUrl, stopOwnedProcess);
  } catch (cause) {
    if (!shouldFallbackToStreamable(cause)) throw cause;
    return await createStreamableConnection(name, transportType, baseUrl, stopOwnedProcess);
  }
}

/**
 * Connect with the official stateful Streamable HTTP SDK client.
 *
 * `Client.connect()` performs `initialize`, retains the negotiated protocol
 * and session ID, and adds those details to later requests.
 */
async function createStreamableConnection(
  name: string,
  transportType: "stdio" | "http",
  baseUrl: string,
  stopOwnedProcess?: () => Promise<void>,
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(mcpEndpointUrl(baseUrl));
  const client = new Client(
    { name: "@mcpview/compose", version: COMPOSE_VERSION },
    { capabilities: {} },
  );

  try {
    await client.connect(transport, { timeout: DEFAULT_STARTUP_TIMEOUT_MS });
  } catch (cause) {
    await client.close().catch(() => undefined);
    throw cause;
  }

  let closed = false;

  return {
    name,
    transportType,
    uiBaseUrl: baseUrl,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      try {
        // Streamable HTTP sessions are server-side state. Terminate them while
        // the transport is still open, then close local listeners regardless
        // of whether the server accepts DELETE (405 is handled by the SDK).
        await transport.terminateSession();
      } catch {
        // Cleanup remains best-effort, matching the cluster's prior contract.
      } finally {
        try {
          await client.close();
        } finally {
          await stopOwnedProcess?.();
        }
      }
    },
    async callTool(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
      try {
        return await client.callTool(
          { name: toolName, arguments: args ?? {} },
          undefined,
          { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
        );
      } catch (cause) {
        throw requestError({
          kind: "tool-call",
          serverName: name,
          toolName,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async readResource(uri: string): Promise<McpReadResourceResult> {
      try {
        return await client.readResource({ uri }, { timeout: DEFAULT_REQUEST_TIMEOUT_MS });
      } catch (cause) {
        throw requestError({
          kind: "resource-read",
          serverName: name,
          uri,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async listTools(cursor?: string): Promise<McpListToolsResult> {
      try {
        return await client.listTools(
          cursor === undefined ? undefined : { cursor },
          { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
        );
      } catch (cause) {
        throw requestError({
          kind: "tool-list",
          serverName: name,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async listResources(cursor?: string): Promise<McpListResourcesResult> {
      try {
        return await client.listResources(
          cursor === undefined ? undefined : { cursor },
          { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
        );
      } catch (cause) {
        throw requestError({
          kind: "resource-list",
          serverName: name,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
  };
}

/**
 * Connect to a stateless 2026-07-28 server by issuing `server/discover`.
 *
 * Every later request carries its own protocol/version/capability metadata;
 * no session is created or retained in this transport.
 */
async function createStatelessConnection(
  name: string,
  transportType: "stdio" | "http",
  baseUrl: string,
  stopOwnedProcess?: () => Promise<void>,
): Promise<McpConnection> {
  const client = new StatelessMcpClient(mcpEndpointUrl(baseUrl));
  const discovered = await client.request("server/discover", {}, DEFAULT_STARTUP_TIMEOUT_MS);

  if (
    !isRecord(discovered) ||
    !Array.isArray(discovered.supportedVersions) ||
    !discovered.supportedVersions.includes(STATELESS_PROTOCOL_VERSION)
  ) {
    throw new StatelessProtocolError(
      `Server does not advertise stateless protocol ${STATELESS_PROTOCOL_VERSION}`,
      { rpcCode: -32022 },
    );
  }

  let closed = false;

  return {
    name,
    transportType,
    uiBaseUrl: baseUrl,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await stopOwnedProcess?.();
    },
    async callTool(toolName: string, args?: Record<string, unknown>): Promise<unknown> {
      try {
        return await client.request(
          "tools/call",
          { name: toolName, arguments: args ?? {} },
          DEFAULT_REQUEST_TIMEOUT_MS,
        );
      } catch (cause) {
        throw requestError({
          kind: "tool-call",
          serverName: name,
          toolName,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async readResource(uri: string): Promise<McpReadResourceResult> {
      try {
        return await client.request(
          "resources/read",
          { uri },
          DEFAULT_REQUEST_TIMEOUT_MS,
        ) as McpReadResourceResult;
      } catch (cause) {
        throw requestError({
          kind: "resource-read",
          serverName: name,
          uri,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async listTools(cursor?: string): Promise<McpListToolsResult> {
      try {
        return await client.request(
          "tools/list",
          cursor === undefined ? {} : { cursor },
          DEFAULT_REQUEST_TIMEOUT_MS,
        ) as McpListToolsResult;
      } catch (cause) {
        throw requestError({
          kind: "tool-list",
          serverName: name,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
    async listResources(cursor?: string): Promise<McpListResourcesResult> {
      try {
        return await client.request(
          "resources/list",
          cursor === undefined ? {} : { cursor },
          DEFAULT_REQUEST_TIMEOUT_MS,
        ) as McpListResourcesResult;
      } catch (cause) {
        throw requestError({
          kind: "resource-list",
          serverName: name,
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          cause,
        });
      }
    },
  };
}

/**
 * Minimal client for the current stateless MCP HTTP revision.
 *
 * It is intentionally private: callers use the concrete, allow-listable
 * `McpConnection` operations above rather than arbitrary JSON-RPC methods.
 */
class StatelessMcpClient {
  #nextRequestId = 1;

  constructor(private readonly endpoint: URL) {}

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    const id = this.#nextRequestId++;
    const requestParams = withStatelessMetadata(params);
    const headers = new Headers({
      "Accept": "application/json",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": STATELESS_PROTOCOL_VERSION,
      "Mcp-Method": method,
    });
    const mcpName = mcpNameFor(method, requestParams);
    if (mcpName !== undefined) headers.set("Mcp-Name", encodeMcpHeaderValue(mcpName));

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params: requestParams }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      throw new StatelessProtocolError(`HTTP request failed: ${formatCause(cause)}`, { cause });
    }

    const payload = await readJsonRpcPayload(response);
    if (!isRecord(payload) || payload.id !== id) {
      throw new StatelessProtocolError("Response did not match its JSON-RPC request id", {
        status: response.status,
      });
    }
    const rpcError = jsonRpcError(payload);
    if (!response.ok || rpcError !== undefined) {
      throw new StatelessProtocolError(
        rpcError === undefined
          ? `HTTP ${response.status}`
          : `MCP error ${rpcError.code}: ${rpcError.message}`,
        {
          status: response.status,
          rpcCode: rpcError?.code,
          data: rpcError?.data,
        },
      );
    }

    if (!("result" in payload)) {
      throw new StatelessProtocolError("Response did not contain a JSON-RPC result", {
        status: response.status,
      });
    }

    return payload.result;
  }
}

/** A protocol error with enough structure to select the only safe fallback. */
class StatelessProtocolError extends Error {
  readonly status?: number;
  readonly rpcCode?: number;
  readonly data?: unknown;
  override readonly cause?: unknown;

  constructor(
    message: string,
    options: { status?: number; rpcCode?: number; data?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "StatelessProtocolError";
    this.status = options.status;
    this.rpcCode = options.rpcCode;
    this.data = options.data;
    this.cause = options.cause;
  }
}

/** Only protocol absence/rejection permits automatic fallback to legacy HTTP. */
function shouldFallbackToStreamable(cause: unknown): boolean {
  return cause instanceof StatelessProtocolError &&
    (cause.status === 404 || cause.rpcCode === -32022 || cause.rpcCode === -32601);
}

/** Attach the stateless revision's required per-request metadata. */
function withStatelessMetadata(params: Record<string, unknown>): Record<string, unknown> {
  const existingMeta = isRecord(params._meta) ? params._meta : {};
  return {
    ...params,
    _meta: {
      ...existingMeta,
      [STATELESS_PROTOCOL_META_KEY]: STATELESS_PROTOCOL_VERSION,
      [STATELESS_CLIENT_CAPABILITIES_META_KEY]: {},
      [STATELESS_CLIENT_INFO_META_KEY]: {
        name: "@mcpview/compose",
        version: COMPOSE_VERSION,
      },
    },
  };
}

/** Return the name/URI whose metadata header is required for a request. */
function mcpNameFor(method: string, params: Record<string, unknown>): string | undefined {
  if (method === "tools/call" && typeof params.name === "string") return params.name;
  if (method === "resources/read" && typeof params.uri === "string") return params.uri;
  return undefined;
}

/** Encode the restricted HTTP header value form required by MCP 2026-07-28. */
function encodeMcpHeaderValue(value: string): string {
  const sentinelPrefix = "=?base64?";
  const sentinelSuffix = "?=";
  const safe = /^(?:[\x21-\x7E](?:[\x20-\x7E\t]*[\x21-\x7E])?)?$/.test(value);
  const looksEncoded = value.startsWith(sentinelPrefix) && value.endsWith(sentinelSuffix);
  if (safe && !looksEncoded) return value;

  const bytes = new TextEncoder().encode(value);
  let latin1 = "";
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return `${sentinelPrefix}${btoa(latin1)}${sentinelSuffix}`;
}

/** Read a JSON response once, retaining malformed/empty responses as errors. */
async function readJsonRpcPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new StatelessProtocolError(`Invalid JSON response: ${formatCause(cause)}`, {
      status: response.status,
      cause,
    });
  }
}

function jsonRpcError(
  payload: unknown,
): { code: number; message: string; data?: unknown } | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  const code = payload.error.code;
  const message = payload.error.message;
  if (typeof code !== "number" || typeof message !== "string") return undefined;
  return {
    code,
    message,
    ...("data" in payload.error ? { data: payload.error.data } : {}),
  };
}

/** Return the Streamable HTTP endpoint for a base URL or a full `/mcp` URL. */
function mcpEndpointUrl(baseUrl: string): URL {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/mcp") ? path : `${path}/mcp`;
  return url;
}

/**
 * Canonicalize either a base URL or full `/mcp` endpoint to the base URL used
 * for UI resource provenance.
 */
function normalizeBaseUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.search = "";
  url.hash = "";
  let path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/mcp")) path = path.slice(0, -"/mcp".length);
  url.pathname = path === "" ? "/" : path;
  return url.toString().replace(/\/$/, "");
}

/** Stop an owned child process without letting cleanup obscure the root error. */
async function stopProcess(process: Deno.ChildProcess): Promise<void> {
  try {
    process.kill("SIGTERM");
  } catch {
    // The process may already have exited.
  }
  try {
    await process.status;
  } catch {
    // Best-effort cleanup.
  }
}

type RequestErrorKind = "tool-call" | "resource-read" | "tool-list" | "resource-list";

type RequestErrorInput = {
  kind: RequestErrorKind;
  serverName: string;
  toolName?: string;
  uri?: string;
  timeoutMs: number;
  cause: unknown;
};

/** Translate SDK and stateless transport errors into Compose runtime errors. */
function requestError(input: RequestErrorInput): RuntimeError {
  const target = requestTarget(input);
  const code = requestErrorCode(input.kind, isRequestTimeout(input.cause));

  return {
    code,
    message: isRequestTimeout(input.cause)
      ? `${target} on "${input.serverName}" timed out after ${input.timeoutMs}ms`
      : `${target} on "${input.serverName}" failed: ${formatCause(input.cause)}`,
    server: input.serverName,
    ...(input.toolName ? { tool: input.toolName } : {}),
    cause: input.cause,
  };
}

function requestTarget(input: RequestErrorInput): string {
  switch (input.kind) {
    case "tool-call":
      return `Tool call "${input.toolName}"`;
    case "resource-read":
      return `Resource read "${input.uri}"`;
    case "tool-list":
      return "Tools list";
    case "resource-list":
      return "Resources list";
  }
}

function requestErrorCode(kind: RequestErrorKind, timedOut: boolean): RuntimeErrorCode {
  switch (kind) {
    case "tool-call":
      return timedOut ? RuntimeErrorCode.TOOL_CALL_TIMEOUT : RuntimeErrorCode.TOOL_CALL_FAILED;
    case "resource-read":
      return timedOut
        ? RuntimeErrorCode.RESOURCE_READ_TIMEOUT
        : RuntimeErrorCode.RESOURCE_READ_FAILED;
    case "tool-list":
      return timedOut ? RuntimeErrorCode.TOOL_LIST_TIMEOUT : RuntimeErrorCode.TOOL_LIST_FAILED;
    case "resource-list":
      return timedOut
        ? RuntimeErrorCode.RESOURCE_LIST_TIMEOUT
        : RuntimeErrorCode.RESOURCE_LIST_FAILED;
  }
}

function formatCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRequestTimeout(cause: unknown): boolean {
  if (cause instanceof McpError) {
    return (cause as McpError).code === ErrorCode.RequestTimeout;
  }
  if (cause instanceof StatelessProtocolError) return isRequestTimeout(cause.cause);
  return cause instanceof DOMException && cause.name === "TimeoutError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
