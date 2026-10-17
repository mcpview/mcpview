/**
 * End-to-end wiring of `_meta` trace context through a tool call.
 *
 * `trace-context_test.ts` proves the parser. This proves the plumbing, which is
 * the part that fails silently: every unit test there would still pass if
 * `readTraceContext` were never called, or if its result landed in the wrong
 * positional argument of `executeToolCall` and quietly became `mrtr`.
 *
 * Spans are captured through a fake global `TracerProvider`, registered once at
 * module load — see the note on the buffer below for why it cannot be per-test.
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type Context,
  type Span,
  type SpanContext,
  trace,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api";
import { McpApp } from "../mcp-app.ts";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const SPAN_ID = "00f067aa0ba902b7";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

interface Captured {
  readonly name: string;
  readonly parent: SpanContext | undefined;
}

/** Minimal no-op span: only its creation and parent are under test. */
function noopSpan(): Span {
  const span = {
    spanContext: () => ({ traceId: "", spanId: "", traceFlags: 0 }),
    setAttribute: () => span,
    setAttributes: () => span,
    addEvent: () => span,
    addLink: () => span,
    addLinks: () => span,
    setStatus: () => span,
    updateName: () => span,
    end: () => {},
    isRecording: () => false,
    recordException: () => {},
  } as unknown as Span;
  return span;
}

/**
 * Registered ONCE for the whole file, not per test.
 *
 * The API's `ProxyTracer` caches its delegate the first time it resolves one,
 * so re-registering a provider between tests leaves the proxy pointing at the
 * first tracer — spans then land in a previous test's buffer and the test reads
 * an empty one. One provider, one buffer, cleared per test.
 */
const captured: Captured[] = [];

const capturingTracer = {
  startSpan(name: string, _options?: unknown, context?: Context): Span {
    captured.push({
      name,
      parent: context ? trace.getSpanContext(context) : undefined,
    });
    return noopSpan();
  },
  startActiveSpan: ((_n: string, ..._rest: unknown[]) => undefined) as never,
} as unknown as Tracer;

const capturingProvider: TracerProvider = { getTracer: () => capturingTracer };
trace.setGlobalTracerProvider(capturingProvider);

// The registration is global, but its blast radius is this module: Deno gives
// each test file its own isolate, so another file still sees OTel's default
// no-op tracer. Verified rather than assumed — a probe in a sibling file got
// back the default `NonRecordingSpan` (an all-zero trace id) while this
// provider was installed.
//
// Within this module it cannot be unregistered between tests: the API's
// ProxyTracer caches its delegate on first resolution, so a second
// `setGlobalTracerProvider` leaves spans landing in the first buffer. Hence one
// provider and one buffer, cleared per test.

/** Clear the buffer and return the span opened by the next tool call. */
function reset(): void {
  captured.length = 0;
}

function toolSpan(): Captured | undefined {
  return captured.find((s) => s.name === "mcp.tool.call echo");
}

function buildApp(seen: { logLevel?: string }): McpApp {
  const app = new McpApp({
    name: "wiring-probe",
    version: "1.0.0",
    logger: () => {},
  });

  app.registerTool(
    { name: "echo", description: "echo", inputSchema: { type: "object" } },
    (_args, ctx) => {
      seen.logLevel = ctx?.logLevel;
      return "ok";
    },
  );

  return app;
}

async function callOverHttp(
  app: McpApp,
  meta: Record<string, unknown>,
): Promise<void> {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await app.startHttp({ port, onListen: () => {} });

  try {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "echo",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "echo",
          arguments: {},
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
            ...meta,
          },
        },
      }),
    });
    await response.json();
  } finally {
    await http.shutdown();
  }
}

Deno.test("wiring - a tool span is parented to the caller's traceparent", async () => {
  reset();
  await callOverHttp(buildApp({}), {
    traceparent: TRACEPARENT,
    tracestate: "vendor=abc",
  });

  const span = toolSpan();
  assertExists(span, "the tool call should have opened a span");
  assertExists(span.parent, "the span should have a remote parent");
  assertEquals(span.parent.traceId, TRACE_ID);
  assertEquals(span.parent.spanId, SPAN_ID);
  assertEquals(span.parent.isRemote, true);
  assertEquals(span.parent.traceState?.get("vendor"), "abc");
});

Deno.test("wiring - no traceparent leaves the span unparented", async () => {
  reset();
  await callOverHttp(buildApp({}), {});

  const span = toolSpan();
  assertExists(span);
  assertEquals(span.parent, undefined);
});

Deno.test("wiring - a malformed traceparent degrades to an unparented span", async () => {
  // The call must still succeed: losing the trace join is an observability
  // gap, refusing the call would be an outage.
  reset();
  await callOverHttp(buildApp({}), { traceparent: "not-a-traceparent" });

  const span = toolSpan();
  assertExists(span, "the call must still run");
  assertEquals(span.parent, undefined);
});

Deno.test("wiring - clientMeta reaches the handler in the right argument slot", async () => {
  // `executeToolCall` takes clientMeta as its SIXTH positional argument. Passing
  // it one position off would land it in `mrtr` and vanish without a type error
  // at the call site. `logLevel` is the observable half of the same object, so
  // seeing it in the handler proves the slot is right for `traceContext` too.
  reset();
  const seen: { logLevel?: string } = {};
  await callOverHttp(buildApp(seen), {
    "io.modelcontextprotocol/logLevel": "debug",
    traceparent: TRACEPARENT,
  });

  assertEquals(seen.logLevel, "debug");
});
