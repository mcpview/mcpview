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
 * One process for the whole file — spawning is the expensive part, and the
 * transport is stateless, so the requests are independent anyway.
 */

import { assertEquals, assertExists } from "@std/assert";

const FIXTURE = new URL("./testdata/stdio-e2e-server.ts", import.meta.url)
  .pathname;

interface Response {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { code: number; message: string };
}

/**
 * Send every request down one stdin, then read every response.
 *
 * Batching avoids interleaving reads with writes: the SDK answers out of order
 * (its `initialize` reply arrived after a later response in practice), so the
 * responses are matched by id rather than by position.
 */
async function exchange(
  requests: ReadonlyArray<Record<string, unknown>>,
): Promise<Map<number, Response>> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-check", FIXTURE],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  });

  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const encoder = new TextEncoder();

  for (const request of requests) {
    await writer.write(encoder.encode(`${JSON.stringify(request)}\n`));
  }
  await writer.close();

  const { stdout } = await child.output();

  const byId = new Map<number, Response>();
  for (const line of new TextDecoder().decode(stdout).split("\n")) {
    if (line.trim().length === 0) continue;
    const message = JSON.parse(line) as Response;
    if (typeof message.id === "number") byId.set(message.id, message);
  }
  return byId;
}

/**
 * Execute requests causally, collect responses and notifications, then keep the
 * process open for a bounded quiet window so delayed duplicate notifications
 * cannot be hidden by immediate EOF.
 */
async function exchangeSequentialMessages(
  requests: ReadonlyArray<Record<string, unknown>>,
  quietWindowMs = 100,
): Promise<{
  messages: Array<Record<string, unknown>>;
  resourceNotificationsAfter: Map<number, number>;
}> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-check", FIXTURE],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const messages: Array<Record<string, unknown>> = [];
  const resourceNotificationsAfter = new Map<number, number>();
  let buffered = "";
  const pump = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += value;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) {
          messages.push(JSON.parse(line) as Record<string, unknown>);
        }
      }
    }
  })();

  const waitForResponse = async (id: number): Promise<void> => {
    const deadline = Date.now() + 1_000;
    while (!messages.some((message) => message.id === id)) {
      if (Date.now() >= deadline) {
        throw new Error(`stdio fixture did not answer request ${id}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  try {
    for (const item of requests) {
      await writer.write(
        new TextEncoder().encode(`${JSON.stringify(item)}\n`),
      );
      if (typeof item.id === "number") {
        await waitForResponse(item.id);
        await new Promise((resolve) => setTimeout(resolve, quietWindowMs));
        resourceNotificationsAfter.set(
          item.id,
          messages.filter((message) =>
            message.method === "notifications/resources/list_changed"
          ).length,
        );
      }
    }
  } finally {
    await writer.close();
    await child.status;
    await pump;
  }
  return { messages, resourceNotificationsAfter };
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
): Promise<Map<number, Response>> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-check", FIXTURE],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  const reader = child.stdout
    .pipeThrough(new TextDecoderStream())
    .getReader();
  const pending: Response[] = [];
  const byId = new Map<number, Response>();
  let buffered = "";

  const readNext = async (): Promise<Response> => {
    while (pending.length === 0) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stdio fixture exited before replying");
      buffered += value;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) pending.push(JSON.parse(line) as Response);
      }
    }
    return pending.shift()!;
  };

  try {
    for (const message of requests) {
      await writer.write(
        new TextEncoder().encode(`${JSON.stringify(message)}\n`),
      );
      if (typeof message.id !== "number") continue;

      let response = await readNext();
      while (response.id !== message.id) {
        if (typeof response.id === "number") byId.set(response.id, response);
        response = await readNext();
      }
      byId.set(message.id, response);
    }
  } finally {
    await writer.close();
    await child.status;
    await reader.cancel();
  }
  return byId;
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

Deno.test("stdio e2e - modern discover and tools/list carry the 2026 result envelope", async () => {
  const responses = await exchange([
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
  const responses = await exchange([
    modernRequest(1, "tools/call", {
      name: "scoped_local",
      arguments: {},
    }),
  ]);

  const call = responses.get(1);
  assertExists(call?.result, "scoped stdio tool got no result");
  assertEquals(call.error, undefined);
  assertEquals(
    (call.result.content as Array<{ text: string }>)[0].text,
    "trusted-local",
  );
  assertEquals(call.result.resultType, "complete");
});

Deno.test("stdio e2e - legacy initialize keeps tools/list on the 2025 wire shape", async () => {
  const responses = await exchange([
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
  const responses = await exchange([
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
