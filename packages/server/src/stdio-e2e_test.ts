/**
 * The stdio transport, end to end, through a real subprocess.
 *
 * `stdio-discover_test.ts` drives the SDK `Server` directly over an in-memory
 * transport, which is fast but reaches into a private field and never calls
 * `start()`. Two independent reviews flagged the same gap: those tests stay
 * green if `start()` connects the wrong instance, or stops installing handlers
 * altogether. This one spawns `deno run` on a fixture server and talks JSON-RPC
 * down its stdin, so nothing between `McpApp.start()` and the wire is mocked.
 *
 * Each exchange owns one fixture process and keeps it alive until its replies
 * have arrived.
 */

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";

const FIXTURE = new URL("./testdata/stdio-e2e-server.ts", import.meta.url)
  .pathname;

interface Response {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

function isTerminalResponse(message: object): boolean {
  return !("method" in message) && ("result" in message || "error" in message);
}

// Process startup under external CPU contention can exceed one second. This
// ceiling applies only before the first reply; it is separate from EOF handling.
const STARTUP_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 1_000;
const CLEANUP_TIMEOUT_MS = 1_000;

interface ExchangeOptions {
  spawn?: () => Deno.ChildProcess;
  startupTimeoutMs?: number;
  responseTimeoutMs?: number;
  sequential?: boolean;
  quietWindowMs?: number;
}

async function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "stdio fixture timed out",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(message)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Batch modern requests while reading replies concurrently, matching by id.
 * Legacy initialize must complete before sending the remaining requests.
 * Keep stdin open until every reply arrives: EOF aborts SDK in-flight work.
 */
async function exchange(
  requests: ReadonlyArray<Record<string, unknown>>,
  {
    spawn = () =>
      new Deno.Command(Deno.execPath(), {
        args: ["run", "--allow-all", "--no-check", FIXTURE],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn(),
    startupTimeoutMs = STARTUP_TIMEOUT_MS,
    responseTimeoutMs = RESPONSE_TIMEOUT_MS,
    sequential = false,
    quietWindowMs = 0,
  }: ExchangeOptions = {},
): Promise<{
  responses: Map<number, Response>;
  messages: Array<Record<string, unknown>>;
  resourceNotificationsAfter: Map<number, number>;
  stderr: string;
}> {
  const child = spawn();
  const writer = child.stdin.getWriter();
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const encoder = new TextEncoder();
  const byId = new Map<number, Response>();
  const messages: Array<Record<string, unknown>> = [];
  const resourceNotificationsAfter = new Map<number, number>();
  let stderr = "";
  let readError: unknown;
  let ended = false;

  const pump = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    consume: (chunk: string) => void,
  ): Promise<void> => {
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        consume(decoder.decode(value, { stream: true }));
      }
      consume(decoder.decode());
    } catch (error) {
      readError ??= error;
      // Parsing can fail while the pipe is still open; releasing its lock alone
      // would leave the resource behind and prevent cleanup from cancelling it.
      await reader.cancel().catch(() => {});
    } finally {
      reader.releaseLock();
    }
  };
  // Observe failures immediately, including while a stdin write is pending.
  const stderrDone = pump(stderrReader, (chunk) => {
    stderr += chunk;
  });
  let buffered = "";
  const stdoutDone = pump(stdoutReader, (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      messages.push(message);
      if (
        typeof message.id === "number" &&
        isTerminalResponse(message)
      ) {
        if (byId.has(message.id)) {
          throw new Error(
            `stdio fixture sent duplicate response id ${message.id}: ${
              JSON.stringify(message)
            }`,
          );
        }
        byId.set(message.id, message as Response);
      }
    }
  }).finally(() => {
    ended = true;
  });
  const waitFor = async (ids: number[]): Promise<void> => {
    let received = byId.size;
    let deadline = Date.now() +
      (received ? responseTimeoutMs : startupTimeoutMs);
    while (ids.some((id) => !byId.has(id))) {
      if (readError) throw readError;
      if (ended) {
        throw new Error(
          `stdio fixture exited before replying to ids ${
            JSON.stringify(ids.filter((id) => !byId.has(id)))
          }`,
        );
      }
      if (byId.size !== received) {
        received = byId.size;
        deadline = Date.now() + responseTimeoutMs;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `stdio fixture did not answer ids ${
            JSON.stringify(ids.filter((id) => !byId.has(id)))
          }`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  let failure: unknown;
  try {
    for (const request of requests) {
      await within(
        writer.write(encoder.encode(`${JSON.stringify(request)}\n`)),
        byId.size ? responseTimeoutMs : startupTimeoutMs,
      );
      if (
        (sequential || request.method === "initialize") &&
        typeof request.id === "number"
      ) {
        await waitFor([request.id]);
        if (quietWindowMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, quietWindowMs));
          resourceNotificationsAfter.set(
            request.id,
            messages.filter((message) =>
              message.method === "notifications/resources/list_changed"
            ).length,
          );
        }
      }
    }
    await waitFor(
      requests.flatMap((request) =>
        typeof request.id === "number" ? [request.id] : []
      ),
    );
  } catch (error) {
    failure = error;
  } finally {
    const kill = () => {
      try {
        child.kill("SIGKILL");
      } catch { /* Already exited. */ }
    };
    // A failed write can leave close queued behind it: kill before awaiting it.
    if (failure) kill();
    const cleanup = Promise.allSettled([
      writer.close(),
      child.status,
      stdoutDone,
      stderrDone,
    ]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") failure ??= result.reason;
      }
    });
    try {
      if (!failure) {
        try {
          await within(cleanup, CLEANUP_TIMEOUT_MS);
        } catch (error) {
          failure = error;
        }
      }
      if (failure) {
        kill();
        // Explicitly cancel reads as well as killing the process; don't leave
        // pending reads or a queued write alive after reporting the failure.
        await within(
          Promise.allSettled([
            writer.abort(),
            stdoutReader.cancel(),
            stderrReader.cancel(),
            cleanup,
          ]),
          CLEANUP_TIMEOUT_MS,
        );
      }
    } catch (cleanupError) {
      failure = new AggregateError(
        [failure, cleanupError],
        "stdio fixture cleanup failed",
      );
    } finally {
      writer.releaseLock();
    }
  }
  failure ??= readError;
  if (failure) {
    throw new Error(
      `${failure}\nresponses: ${
        JSON.stringify([...byId.values()])
      }\nstderr:\n${stderr}`,
      { cause: failure },
    );
  }
  return { responses: byId, messages, resourceNotificationsAfter, stderr };
}

/**
 * Execute requests causally, collect responses and notifications, then keep the
 * process open for a bounded quiet window so delayed duplicate notifications
 * cannot be hidden by immediate EOF.
 */
async function exchangeSequentialMessages(
  requests: ReadonlyArray<Record<string, unknown>>,
  quietWindowMs = 100,
  options: ExchangeOptions = {},
): Promise<{
  messages: Array<Record<string, unknown>>;
  resourceNotificationsAfter: Map<number, number>;
}> {
  return await exchange(requests, {
    ...options,
    sequential: true,
    quietWindowMs,
  });
}

/**
 * Keep one real stdio process alive while each request waits for its reply.
 *
 * Lifecycle assertions need this ordering: writing an unregister call and a
 * later resources/list request in one batch lets the SDK schedule them
 * concurrently, which would prove timing rather than removal.
 */
async function exchangeSequential(
  requests: ReadonlyArray<Record<string, unknown>>,
  options: ExchangeOptions = {},
): Promise<Map<number, Response>> {
  const { responses } = await exchange(requests, {
    ...options,
    sequential: true,
  });
  return responses;
}

function request(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method, params };
}

const PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";
const SERVER_INFO = { name: "e2e-stdio", version: "9.9.9" };

function modernRequest(
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return request(id, method, {
    ...params,
    _meta: {
      [PROTOCOL_VERSION_KEY]: PROTOCOL_VERSION,
      [CLIENT_INFO_KEY]: { name: "e2e-modern", version: "1.0.0" },
      [CLIENT_CAPABILITIES_KEY]: {},
    },
  });
}

const HANDSHAKE = [
  request(1, "initialize", {
    protocolVersion: LEGACY_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "e2e", version: "1.0.0" },
  }),
  { jsonrpc: "2.0", method: "notifications/initialized" },
];

const harnesses = {
  exchange,
  exchangeSequential,
  exchangeSequentialMessages: (
    requests: ReadonlyArray<Record<string, unknown>>,
    options: ExchangeOptions,
  ) => exchangeSequentialMessages(requests, 100, options),
};

for (const [name, helper] of Object.entries(harnesses)) {
  for (const blockedOperation of ["read", "write"] as const) {
    Deno.test({
      name:
        `stdio harness - ${name} times out a blocked ${blockedOperation} and reaps the child`,
      sanitizeResources: true,
      sanitizeOps: true,
      async fn() {
        const timeoutMs = 300;
        const watchdogMs = timeoutMs + 2 * CLEANUP_TIMEOUT_MS + 2_000;
        let child: Deno.ChildProcess | undefined;
        let status: Deno.CommandStatus | undefined;
        const started = performance.now();
        const attempt: Promise<unknown> = helper([
          request(1, "never-answers", {
            // More than the pipe buffer: this fixture never reads stdin.
            value: blockedOperation === "write" ? "x".repeat(1_048_576) : "",
          }),
        ], {
          startupTimeoutMs: timeoutMs,
          responseTimeoutMs: timeoutMs,
          spawn() {
            child = new Deno.Command(Deno.execPath(), {
              args: [
                "run",
                "--no-check",
                new URL("./testdata/stdio-e2e-silent.ts", import.meta.url)
                  .pathname,
              ],
              stdin: "piped",
              stdout: "piped",
              stderr: "piped",
            }).spawn();
            child.status.then((result) => {
              status = result;
            });
            return child;
          },
        });
        assertExists(child);
        try {
          await assertRejects(
            () => within(attempt, watchdogMs, "stdio harness watchdog expired"),
            Error,
            blockedOperation === "read"
              ? "stdio fixture did not answer ids [1]"
              : "stdio fixture timed out",
          );
          assert(performance.now() - started < watchdogMs);
          // Check immediately: waiting here could hide premature helper return.
          assertExists(status, "helper returned before reaping its child");
          assertEquals(status.signal, "SIGKILL");
          assertEquals(status.success, false);
          assertEquals(child.stdin.locked, false);
          assertEquals(child.stdout.locked, false);
          assertEquals(child.stderr.locked, false);
        } finally {
          // Keep a regression from stranding the fixture if the watchdog fires.
          if (!status) {
            try {
              child.kill("SIGKILL");
            } catch { /* Already exited. */ }
          }
          await within(
            Promise.allSettled([attempt, child.status]),
            CLEANUP_TIMEOUT_MS,
          );
        }
      },
    });
  }
}

Deno.test("stdio e2e - modern discover and tools/list carry the 2026 result envelope", async () => {
  const { responses } = await exchange([
    modernRequest(1, "server/discover"),
    modernRequest(2, "tools/list"),
  ]);

  const discover = responses.get(1);
  assertExists(discover, "server/discover got no response at all");
  assertEquals(
    discover.error,
    undefined,
    `server/discover failed: ${JSON.stringify(discover.error)}`,
  );

  const result = discover.result;
  assertExists(result);
  assertEquals(result.supportedVersions, [PROTOCOL_VERSION]);
  assertEquals(result.instructions, "fixture server");
  assertEquals(result.resultType, "complete");
  assertEquals(result.cacheScope, "private");
  assertEquals(result.ttlMs, 0);
  assertEquals(
    (result._meta as Record<string, unknown>)[SERVER_INFO_KEY],
    SERVER_INFO,
  );

  // The rest of the server still works through the same process.
  const tools = responses.get(2);
  assertExists(tools?.result);
  assertEquals(
    (tools.result.tools as Array<{ name: string }>).map((t) => t.name),
    [
      "echo",
      "register_duplicate_resource_batch",
      "register_resource_batch",
      "register_second_lifecycle_resource",
      "scoped_local",
      "unregister_lifecycle_resource",
    ],
  );
  assertEquals(tools.result.resultType, "complete");
  assertEquals(tools.result.cacheScope, "private");
  assertEquals(tools.result.ttlMs, 0);
  assertEquals(
    (tools.result._meta as Record<string, unknown>)[SERVER_INFO_KEY],
    SERVER_INFO,
  );
});

Deno.test("stdio e2e - scoped tools remain available on the trusted local transport", async () => {
  const { responses, stderr } = await exchange([
    modernRequest(1, "tools/call", {
      name: "scoped_local",
      arguments: {},
    }),
  ]);

  const call = responses.get(1);
  const diagnostic = `scoped stdio response for id 1: ${
    JSON.stringify(call)
  }\nstderr:\n${stderr}`;
  assertExists(call?.result, diagnostic);
  assertEquals(call.error, undefined, diagnostic);
  assertEquals(
    (call.result.content as Array<{ text: string }> | undefined)?.[0]?.text,
    "trusted-local",
    diagnostic,
  );
  assertEquals(call.result.resultType, "complete", diagnostic);
});

Deno.test("stdio e2e - legacy initialize keeps tools/list on the 2025 wire shape", async () => {
  const { responses } = await exchange([
    ...HANDSHAKE,
    request(2, "tools/list"),
  ]);

  const initialize = responses.get(1);
  assertExists(initialize?.result);
  assertEquals(initialize.result.protocolVersion, LEGACY_PROTOCOL_VERSION);

  const tools = responses.get(2);
  assertExists(tools?.result);
  assertEquals(
    (tools.result.tools as Array<{ name: string }>).map((tool) => tool.name),
    [
      "echo",
      "register_duplicate_resource_batch",
      "register_resource_batch",
      "register_second_lifecycle_resource",
      "scoped_local",
      "unregister_lifecycle_resource",
    ],
  );
  assertEquals(tools.result.resultType, undefined);
  assertEquals(tools.result.cacheScope, undefined);
  assertEquals(tools.result.ttlMs, undefined);
  assertEquals(tools.result._meta, undefined);
});

Deno.test("stdio e2e - a modern discover probe can fall back to a fresh legacy server", async () => {
  const responses = await exchangeSequential([
    modernRequest(1, "server/discover"),
    request(2, "initialize", {
      protocolVersion: LEGACY_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "e2e-fallback", version: "1.0.0" },
    }),
    { jsonrpc: "2.0", method: "notifications/initialized" },
    request(3, "tools/list"),
  ]);

  assertEquals(responses.get(1)?.result?.resultType, "complete");
  assertEquals(
    responses.get(2)?.result?.protocolVersion,
    LEGACY_PROTOCOL_VERSION,
  );

  const tools = responses.get(3);
  assertExists(tools?.result, "legacy fallback did not keep serving tools");
  assertEquals(
    (tools.result.tools as Array<{ name: string }>).map((tool) => tool.name),
    [
      "echo",
      "register_duplicate_resource_batch",
      "register_resource_batch",
      "register_second_lifecycle_resource",
      "scoped_local",
      "unregister_lifecycle_resource",
    ],
  );
  assertEquals(tools.result.resultType, undefined);
});

Deno.test("stdio e2e - a real batch notifies exactly once and a rejected duplicate adds none", async () => {
  const { messages, resourceNotificationsAfter } =
    await exchangeSequentialMessages([
      ...HANDSHAKE,
      request(2, "resources/templates/list"),
      request(3, "resources/read", { uri: "ui://e2e-stdio/missing" }),
      request(4, "tools/call", {
        name: "register_resource_batch",
        arguments: {},
      }),
      request(5, "tools/call", {
        name: "register_duplicate_resource_batch",
        arguments: {},
      }),
    ]);
  const byId = new Map<number, Record<string, unknown>>();
  const notifications: string[] = [];
  for (const message of messages) {
    if (typeof message.id === "number") byId.set(message.id, message);
    if (typeof message.method === "string") notifications.push(message.method);
  }
  assertEquals(
    (byId.get(2)?.result as Record<string, unknown>).resourceTemplates,
    [],
  );
  assertEquals((byId.get(3)?.error as { code: number }).code, -32602);
  assertEquals(
    ((byId.get(4)?.result as Record<string, unknown>).content as Array<
      { text: string }
    >)[0].text,
    "registered batch",
  );
  assertEquals((byId.get(5)?.error as { code: number }).code, -32603);
  assertEquals(resourceNotificationsAfter.get(4), 1);
  assertEquals(resourceNotificationsAfter.get(5), 1);
  assertEquals(
    notifications.filter((method) =>
      method === "notifications/resources/list_changed"
    ),
    ["notifications/resources/list_changed"],
  );
});

Deno.test("stdio e2e - an unknown method is MethodNotFound, not a crash", async () => {
  const { responses } = await exchange([
    ...HANDSHAKE,
    request(2, "server/undiscover"),
    // Proves the process survived the thrown McpError and keeps serving.
    request(3, "tools/call", { name: "echo", arguments: { value: "alive" } }),
  ]);

  assertEquals(responses.get(2)?.error?.code, -32601);

  const call = responses.get(3);
  assertExists(call?.result, "the server stopped serving after the error");
  assertEquals(
    (call.result.content as Array<{ text: string }>)[0].text,
    "alive",
  );
});

Deno.test("stdio e2e - static resource unregister removes the SDK registration after start", async () => {
  const responses = await exchangeSequential([
    ...HANDSHAKE,
    request(2, "resources/list"),
    request(3, "resources/read", { uri: "ui://e2e-stdio/lifecycle" }),
    request(4, "tools/call", {
      name: "unregister_lifecycle_resource",
      arguments: {},
    }),
    request(5, "resources/list"),
    request(6, "resources/read", { uri: "ui://e2e-stdio/lifecycle" }),
  ]);

  const before = responses.get(2)?.result?.resources as
    | Array<{ uri: string; size?: number }>
    | undefined;
  assertEquals(
    before?.map(({ uri, size }) => ({ uri, size })),
    [{ uri: "ui://e2e-stdio/lifecycle", size: 5 }],
  );

  const firstRead = responses.get(3)?.result?.contents as
    | Array<{ text?: string; _meta?: Record<string, unknown> }>
    | undefined;
  assertEquals(firstRead?.[0]?.text, "hello");
  assertEquals(firstRead?.[0]?._meta, { fixture: "stdio" });

  const unregister = responses.get(4)?.result?.content as
    | Array<{ text: string }>
    | undefined;
  assertEquals(unregister?.[0]?.text, "removed");
  assertEquals(responses.get(5)?.result?.resources, []);
  assertEquals(responses.get(6)?.error?.code, -32602);
});
