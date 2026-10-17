/**
 * Tests for subscription-registry.ts (spec 2026-07-28, SEP-2575).
 *
 * Tests are executable documentation of the spec's normative requirements.
 * Edge cases and invariants are prioritised over happy-path repetition.
 *
 * All tests run without a real HTTP server: sinks are in-memory collectors
 * that capture Uint8Array chunks and decode them for assertion.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildAcknowledgedMessage,
  buildGracefulCloseResult,
  buildServerCancelledNotification,
  encodeSSEEvent,
  encodeSSEKeepAlive,
  intersectFilter,
  stampSubscriptionMeta,
  SubscriptionRegistry,
} from "./subscription-registry.ts";
import type { SubscriptionSink } from "./subscription-registry.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

const decoder = new TextDecoder();

/** Decode a Uint8Array chunk to a string. */
function decode(chunk: Uint8Array): string {
  return decoder.decode(chunk);
}

/** Decode and JSON-parse the first SSE event payload in a raw chunk. */
function parseSSEEvent(chunk: Uint8Array): Record<string, unknown> {
  const text = decode(chunk);
  // Format: "data: {json}\n\n"
  const match = text.match(/^data: (.+)\n\n$/s);
  if (!match) throw new Error(`Not a valid SSE event: ${JSON.stringify(text)}`);
  return JSON.parse(match[1]) as Record<string, unknown>;
}

/** Accumulating in-memory sink for testing. */
class MemorySink implements SubscriptionSink {
  readonly chunks: Uint8Array[] = [];
  private _closed = false;

  enqueue(chunk: Uint8Array): void {
    if (this._closed) return; // spec: implementations must silently swallow
    this.chunks.push(chunk);
  }

  close(): void {
    this._closed = true;
  }

  get isClosed(): boolean {
    return this._closed;
  }

  /** Decode all accumulated chunks into strings. */
  lines(): string[] {
    return this.chunks.map(decode);
  }

  /** Parse all accumulated chunks as SSE events. */
  events(): Record<string, unknown>[] {
    return this.chunks.map(parseSSEEvent);
  }
}

const SERVER_INFO = { name: "test-server", version: "1.0.0" };

function makeRegistry(
  overrides?: Partial<ConstructorParameters<typeof SubscriptionRegistry>[0]>,
) {
  return new SubscriptionRegistry({ serverInfo: SERVER_INFO, ...overrides });
}

// ── intersectFilter ───────────────────────────────────────────────────────────

Deno.test("intersectFilter: all fields omitted → empty result", () => {
  const result = intersectFilter({}, {
    toolsListChanged: true,
    promptsListChanged: true,
    resourcesListChanged: true,
  });
  assertEquals(result, {});
});

Deno.test("intersectFilter: client requests all, server supports all → all included", () => {
  const result = intersectFilter(
    {
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
      resourceSubscriptions: ["file:///a"],
    },
    {
      toolsListChanged: true,
      promptsListChanged: true,
      resourcesListChanged: true,
    },
  );
  assertEquals(result.toolsListChanged, true);
  assertEquals(result.promptsListChanged, true);
  assertEquals(result.resourcesListChanged, true);
  assertEquals(result.resourceSubscriptions, ["file:///a"]);
});

Deno.test("intersectFilter: server does not support prompts → omitted", () => {
  const result = intersectFilter(
    { toolsListChanged: true, promptsListChanged: true },
    { toolsListChanged: true, promptsListChanged: false },
  );
  assertEquals(result.toolsListChanged, true);
  assertEquals(result.promptsListChanged, undefined);
});

Deno.test("intersectFilter: server supports no resourceSubscriptions → URIs omitted", () => {
  const result = intersectFilter(
    { resourceSubscriptions: ["file:///foo"] },
    { resourceSubscriptions: [] },
  );
  assertEquals(result.resourceSubscriptions, undefined);
});

Deno.test("intersectFilter: server has URI mask → only allowed URIs pass through", () => {
  const result = intersectFilter(
    { resourceSubscriptions: ["file:///a", "file:///b", "file:///c"] },
    { resourceSubscriptions: ["file:///a", "file:///c"] },
  );
  assertEquals(result.resourceSubscriptions, ["file:///a", "file:///c"]);
});

Deno.test("intersectFilter: server serverSupports.resourceSubscriptions undefined → all URIs accepted", () => {
  const result = intersectFilter(
    { resourceSubscriptions: ["file:///x", "file:///y"] },
    { toolsListChanged: true }, // resourceSubscriptions not specified
  );
  assertEquals(result.resourceSubscriptions, ["file:///x", "file:///y"]);
});

Deno.test("intersectFilter: empty resourceSubscriptions list from client → omitted", () => {
  const result = intersectFilter(
    { resourceSubscriptions: [] },
    { toolsListChanged: true },
  );
  assertEquals(result.resourceSubscriptions, undefined);
});

// ── buildAcknowledgedMessage ──────────────────────────────────────────────────

Deno.test("buildAcknowledgedMessage: correct shape with numeric id", () => {
  const msg = buildAcknowledgedMessage(1, { toolsListChanged: true });
  assertEquals(msg.jsonrpc, "2.0");
  assertEquals(msg.method, "notifications/subscriptions/acknowledged");
  const params = msg.params as Record<string, unknown>;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 1);
  const notifs = params.notifications as Record<string, unknown>;
  assertEquals(notifs.toolsListChanged, true);
});

Deno.test("buildAcknowledgedMessage: works with string id", () => {
  const msg = buildAcknowledgedMessage("req-42", {
    resourcesListChanged: true,
  });
  const params = msg.params as Record<string, unknown>;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], "req-42");
});

Deno.test("buildAcknowledgedMessage: no id field at top level (it is a notification)", () => {
  const msg = buildAcknowledgedMessage(7, {});
  assertEquals(msg.id, undefined);
});

// ── stampSubscriptionMeta ─────────────────────────────────────────────────────

Deno.test("stampSubscriptionMeta: injects subscriptionId into _meta", () => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
    params: {},
  };
  const stamped = stampSubscriptionMeta(notification, 3);
  const params = stamped.params as Record<string, unknown>;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 3);
});

Deno.test("stampSubscriptionMeta: preserves existing params fields (e.g. uri)", () => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/resources/updated",
    params: { uri: "file:///foo", _meta: {} },
  };
  const stamped = stampSubscriptionMeta(notification, 9);
  const params = stamped.params as Record<string, unknown>;
  assertEquals(params.uri, "file:///foo");
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 9);
});

Deno.test("stampSubscriptionMeta: preserves pre-existing _meta fields", () => {
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
    params: { _meta: { someKey: "someValue" } },
  };
  const stamped = stampSubscriptionMeta(notification, 1);
  const params = stamped.params as Record<string, unknown>;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["someKey"], "someValue");
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 1);
});

// ── buildGracefulCloseResult ──────────────────────────────────────────────────

Deno.test("buildGracefulCloseResult: correct JSON-RPC response shape", () => {
  const result = buildGracefulCloseResult(5, SERVER_INFO);
  assertEquals(result.jsonrpc, "2.0");
  assertEquals(result.id, 5);
  const r = result.result as Record<string, unknown>;
  assertEquals(r.resultType, "complete");
  const meta = r._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 5);
});

Deno.test("buildGracefulCloseResult: serverInfo present in _meta", () => {
  const result = buildGracefulCloseResult(1, SERVER_INFO);
  const r = result.result as Record<string, unknown>;
  const meta = r._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/serverInfo"], SERVER_INFO);
});

// ── buildServerCancelledNotification ─────────────────────────────────────────

Deno.test("buildServerCancelledNotification: correct shape", () => {
  const msg = buildServerCancelledNotification(42);
  assertEquals(msg.jsonrpc, "2.0");
  assertEquals(msg.method, "notifications/cancelled");
  const params = msg.params as Record<string, unknown>;
  assertEquals(params.requestId, 42);
});

Deno.test("buildServerCancelledNotification: carries subscriptionId in _meta", () => {
  // This was the one message on the stream built without stamping, while
  // fanOut() stamped every other one. The rule is unconditional: "All
  // notifications delivered on the stream carry
  // io.modelcontextprotocol/subscriptionId in _meta". On stdio, where every
  // subscription shares a single channel, an unstamped teardown cannot be
  // correlated to the subscription it ends.
  //
  // The shape assertion above passed throughout the bug — it never looked at
  // _meta. Asserting only the fields you remembered to set is how this survives.
  const params = buildServerCancelledNotification(7).params as Record<
    string,
    unknown
  >;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 7);
});

// ── encodeSSEEvent ────────────────────────────────────────────────────────────

Deno.test("encodeSSEEvent: format is 'data: {json}\\n\\n'", () => {
  const msg = {
    jsonrpc: "2.0",
    method: "notifications/tools/list_changed",
    params: {},
  };
  const encoded = decode(encodeSSEEvent(msg));
  assertEquals(encoded, `data: ${JSON.stringify(msg)}\n\n`);
});

Deno.test("encodeSSEEvent: no 'id:' line emitted (spec 2026-07-28 removes SSE event IDs)", () => {
  const msg = { jsonrpc: "2.0", method: "test", params: {} };
  const encoded = decode(encodeSSEEvent(msg));
  // The only line must start with 'data: '
  const lines = encoded.split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 1);
  assertEquals(lines[0].startsWith("data: "), true);
});

// ── encodeSSEKeepAlive ────────────────────────────────────────────────────────

Deno.test("encodeSSEKeepAlive: format is ':\\n\\n'", () => {
  const encoded = decode(encodeSSEKeepAlive());
  assertEquals(encoded, ":\n\n");
});

// ── SubscriptionRegistry: register / count ────────────────────────────────────

Deno.test("SubscriptionRegistry: count tracks live subscriptions", () => {
  const reg = makeRegistry();
  assertEquals(reg.count, 0);

  const sink1 = new MemorySink();
  const key1 = reg.register(1, { toolsListChanged: true }, sink1);
  assertEquals(reg.count, 1);

  const sink2 = new MemorySink();
  const key2 = reg.register(2, { promptsListChanged: true }, sink2);
  assertEquals(reg.count, 2);

  reg.unregister(key1, "client");
  assertEquals(reg.count, 1);

  reg.unregister(key2, "client");
  assertEquals(reg.count, 0);
});

Deno.test("SubscriptionRegistry: register returns unique internal keys even for same subscriptionId", () => {
  // Two concurrent connections MAY legitimately send id: 1 each.
  const reg = makeRegistry();
  const sink1 = new MemorySink();
  const sink2 = new MemorySink();
  const key1 = reg.register(1, {}, sink1);
  const key2 = reg.register(1, {}, sink2);
  assertNotEquals(key1, key2);
  assertEquals(reg.count, 2);
});

// ── SubscriptionRegistry: unregister (client) ────────────────────────────────

Deno.test("unregister client: no messages sent, sink not closed", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  const key = reg.register(1, { toolsListChanged: true }, sink);
  reg.unregister(key, "client");
  assertEquals(sink.chunks.length, 0);
  assertEquals(sink.isClosed, false);
  assertEquals(reg.count, 0);
});

Deno.test("unregister client: no-op when key is unknown", () => {
  const reg = makeRegistry();
  reg.unregister("nonexistent-key", "client"); // must not throw
  assertEquals(reg.count, 0);
});

// ── SubscriptionRegistry: unregister (server) ────────────────────────────────

Deno.test("unregister server: sends notifications/cancelled then graceful-close result, then closes sink", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  const key = reg.register(7, { toolsListChanged: true }, sink);

  reg.unregister(key, "server");

  assertEquals(sink.chunks.length, 2);
  assertEquals(sink.isClosed, true);

  // First message MUST be notifications/cancelled.
  const first = parseSSEEvent(sink.chunks[0]);
  assertEquals(first.method, "notifications/cancelled");
  const fp = first.params as Record<string, unknown>;
  assertEquals(fp.requestId, 7);

  // Second message MUST be the graceful-close result.
  const second = parseSSEEvent(sink.chunks[1]);
  assertEquals(second.id, 7);
  const sr = second.result as Record<string, unknown>;
  assertEquals(sr.resultType, "complete");
  const meta = sr._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 7);
});

Deno.test("unregister server: default initiator is 'client'", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  const key = reg.register(1, {}, sink);
  reg.unregister(key); // no initiator arg → defaults to "client"
  assertEquals(sink.chunks.length, 0);
});

// ── SubscriptionRegistry: fanOut ──────────────────────────────────────────────

Deno.test("fanOut toolsListChanged: only reaches sinks that opted in", () => {
  const reg = makeRegistry();
  const sink_tools = new MemorySink();
  const sink_prompts = new MemorySink();
  const sink_both = new MemorySink();

  reg.register(1, { toolsListChanged: true }, sink_tools);
  reg.register(2, { promptsListChanged: true }, sink_prompts);
  reg.register(
    3,
    { toolsListChanged: true, promptsListChanged: true },
    sink_both,
  );

  reg.fanOut("toolsListChanged");

  assertEquals(sink_tools.events().length, 1);
  assertEquals(
    sink_tools.events()[0].method,
    "notifications/tools/list_changed",
  );

  assertEquals(sink_prompts.events().length, 0); // not subscribed to tools

  assertEquals(sink_both.events().length, 1);
  assertEquals(
    sink_both.events()[0].method,
    "notifications/tools/list_changed",
  );
});

Deno.test("fanOut: notification carries subscriptionId in _meta", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(42, { toolsListChanged: true }, sink);

  reg.fanOut("toolsListChanged");

  const evt = sink.events()[0];
  const params = evt.params as Record<string, unknown>;
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 42);
});

Deno.test("fanOut: different subscriptions with same subscriptionId each get their own stamped copy", () => {
  // Two HTTP connections both sent id: 1 — both must receive the notification
  // stamped with their respective subscriptionId (same value, but each has an
  // independent stream).
  const reg = makeRegistry();
  const sink1 = new MemorySink();
  const sink2 = new MemorySink();
  reg.register(1, { toolsListChanged: true }, sink1);
  reg.register(1, { toolsListChanged: true }, sink2);

  reg.fanOut("toolsListChanged");

  assertEquals(sink1.events().length, 1);
  assertEquals(sink2.events().length, 1);
});

Deno.test("fanOut promptsListChanged reaches correct sinks", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(3, { promptsListChanged: true }, sink);
  reg.fanOut("promptsListChanged");
  assertEquals(sink.events()[0].method, "notifications/prompts/list_changed");
});

Deno.test("fanOut resourcesListChanged reaches correct sinks", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(4, { resourcesListChanged: true }, sink);
  reg.fanOut("resourcesListChanged");
  assertEquals(sink.events()[0].method, "notifications/resources/list_changed");
});

Deno.test("fanOut: dead sinks are pruned during fan-out", () => {
  const reg = makeRegistry();
  const deadSink = new MemorySink();
  deadSink.close(); // mark closed BEFORE registering
  reg.register(10, { toolsListChanged: true }, deadSink);
  assertEquals(reg.count, 1);

  reg.fanOut("toolsListChanged");

  // Dead sink pruned during fan-out.
  assertEquals(reg.count, 0);
  // No data was enqueued (sink was closed, enqueue is a no-op per spec).
  assertEquals(deadSink.chunks.length, 0);
});

// ── fanOutResourceUpdated ─────────────────────────────────────────────────────

Deno.test("fanOutResourceUpdated: reaches only subscriptions that include the URI", () => {
  const reg = makeRegistry();
  const sink_a = new MemorySink();
  const sink_b = new MemorySink();
  const sink_c = new MemorySink();

  reg.register(1, { resourceSubscriptions: ["file:///a"] }, sink_a);
  reg.register(2, { resourceSubscriptions: ["file:///b"] }, sink_b);
  reg.register(
    3,
    { resourceSubscriptions: ["file:///a", "file:///b"] },
    sink_c,
  );

  reg.fanOutResourceUpdated("file:///a");

  assertEquals(sink_a.events().length, 1);
  assertEquals(sink_b.events().length, 0); // not subscribed to ///a
  assertEquals(sink_c.events().length, 1);

  const evt = sink_a.events()[0];
  assertEquals(evt.method, "notifications/resources/updated");
  const params = evt.params as Record<string, unknown>;
  assertEquals(params.uri, "file:///a");
  const meta = params._meta as Record<string, unknown>;
  assertEquals(meta["io.modelcontextprotocol/subscriptionId"], 1);
});

Deno.test("fanOutResourceUpdated: no match → no messages sent", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(1, { resourceSubscriptions: ["file:///x"] }, sink);
  reg.fanOutResourceUpdated("file:///y");
  assertEquals(sink.chunks.length, 0);
});

// ── SubscriptionRegistry: shutdown ───────────────────────────────────────────

Deno.test("shutdown: sends server-teardown sequence to all live subscriptions", () => {
  const reg = makeRegistry();
  const sink1 = new MemorySink();
  const sink2 = new MemorySink();
  reg.register(1, { toolsListChanged: true }, sink1);
  reg.register(2, { promptsListChanged: true }, sink2);

  reg.shutdown();

  assertEquals(reg.count, 0);

  // Both sinks received teardown (cancelled + result + closed)
  for (const sink of [sink1, sink2]) {
    assertEquals(sink.chunks.length, 2);
    assertEquals(sink.isClosed, true);
    assertEquals(
      parseSSEEvent(sink.chunks[0]).method,
      "notifications/cancelled",
    );
    const r = parseSSEEvent(sink.chunks[1]).result as Record<string, unknown>;
    assertEquals(r.resultType, "complete");
  }
});

Deno.test("shutdown: stops keep-alive timer", () => {
  const reg = makeRegistry({ keepAliveIntervalMs: 100 });
  let timerStarted = false;
  let timerCleared = false;
  const fakeTimerId = 9999 as unknown as ReturnType<typeof setInterval>;
  reg.startKeepAlive(
    (_fn, _ms) => {
      timerStarted = true;
      return fakeTimerId;
    },
    undefined,
  );
  assertEquals(timerStarted, true);

  // Patch clearInterval to detect it was called.
  const originalClearInterval = globalThis.clearInterval;
  globalThis.clearInterval = ((id: unknown) => {
    if (id === fakeTimerId) timerCleared = true;
  }) as typeof globalThis.clearInterval;

  try {
    reg.shutdown();
    assertEquals(timerCleared, true);
  } finally {
    globalThis.clearInterval = originalClearInterval;
  }
});

// ── SubscriptionRegistry: keep-alive ─────────────────────────────────────────

Deno.test("startKeepAlive: calling twice is a no-op (no double timer)", () => {
  const reg = makeRegistry();
  let callCount = 0;
  reg.startKeepAlive((_fn, _ms) => {
    callCount++;
    return callCount as unknown as ReturnType<typeof setInterval>;
  });
  reg.startKeepAlive((_fn, _ms) => {
    callCount++;
    return callCount as unknown as ReturnType<typeof setInterval>;
  });
  assertEquals(callCount, 1);
  reg.stopKeepAlive();
});

Deno.test("_sendKeepAlive: sends SSE comment to all live sinks", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(1, { toolsListChanged: true }, sink);

  reg._sendKeepAlive();

  assertEquals(sink.chunks.length, 1);
  assertEquals(decode(sink.chunks[0]), ":\n\n");
});

Deno.test("_sendKeepAlive: prunes dead sinks", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register(1, {}, sink);
  sink.close(); // mark dead

  reg._sendKeepAlive();

  assertEquals(reg.count, 0);
});

// ── Ordering invariant ────────────────────────────────────────────────────────

Deno.test("ordering invariant: fanOut called before register cannot deliver to that subscription", () => {
  // This test documents the requirement that register() must be called AFTER
  // the acknowledged message is enqueued. The test simulates the case where
  // fanOut fires before register — the subscription does not yet exist and no
  // message is delivered. This is the correct behaviour: the acknowledged
  // message is the first one, not a fanOut-produced notification.
  const reg = makeRegistry();
  const sink = new MemorySink();

  // fanOut before register
  reg.fanOut("toolsListChanged");

  reg.register(1, { toolsListChanged: true }, sink);
  // The sink should be empty — no fanOut reached it yet.
  assertEquals(sink.chunks.length, 0);
});

// ── serverSupports mask ───────────────────────────────────────────────────────

Deno.test("registry with restricted serverSupports: requested type not in mask is excluded", () => {
  const reg = makeRegistry({
    serverSupports: {
      toolsListChanged: true,
      // promptsListChanged not included → server does not support it
      resourcesListChanged: true,
    },
  });

  const sink = new MemorySink();
  // Client requests both tools and prompts
  reg.register(1, { toolsListChanged: true, promptsListChanged: true }, sink);

  reg.fanOut("promptsListChanged");
  // Prompts is not in serverSupports, so intersectFilter excluded it from agreedFilter.
  assertEquals(sink.chunks.length, 0);

  reg.fanOut("toolsListChanged");
  // Tools IS in serverSupports.
  assertEquals(sink.chunks.length, 1);
});

// ── Graceful close result shape ───────────────────────────────────────────────

Deno.test("graceful close result on unregister(server): id matches subscriptionId", () => {
  const reg = makeRegistry();
  const sink = new MemorySink();
  reg.register("sub-abc", { toolsListChanged: true }, sink);
  reg.unregister(reg.register("sub-abc", {}, new MemorySink()), "client"); // create & remove another
  const realKey = reg.register(
    "sub-abc",
    { toolsListChanged: true },
    new MemorySink(),
  );

  // Use a fresh registry to get a clean key.
  const reg2 = makeRegistry();
  const sink2 = new MemorySink();
  const key2 = reg2.register("sub-xyz", { toolsListChanged: true }, sink2);
  reg2.unregister(key2, "server");

  const graceful = parseSSEEvent(sink2.chunks[1]);
  assertEquals(graceful.id, "sub-xyz");
  // suppress unused variable warning
  void realKey;
});
