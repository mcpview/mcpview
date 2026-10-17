/**
 * OpenTelemetry Integration for @casys/mcp-server
 *
 * Provides tracing for tool calls, auth, and middleware pipeline.
 *
 * Enable with:
 * - Deno: OTEL_DENO=true deno run --unstable-otel ...
 * - Node.js: OTEL_ENABLED=true node ...
 *
 * @module lib/server/observability/otel
 */

import {
  type Context,
  context as otelContext,
  type Span,
  type SpanContext,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Tracer,
  type TraceState,
} from "@opentelemetry/api";
import { env } from "../runtime/runtime.ts";

let serverTracer: Tracer | null = null;

/**
 * W3C `traceparent`: `<2 hex version>-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>`.
 *
 * Matches the 55-character prefix only — the trailing-content rule depends on
 * the version and is applied separately, see {@link parseTraceParent}.
 *
 * Case-sensitive on purpose. The spec mandates lowercase hex, and accepting
 * uppercase produces a trace id that will not match the same trace elsewhere in
 * the pipeline: a silently broken join is worse than a dropped header.
 */
const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})/;

/** `00-` + 32 + `-` + 16 + `-` + 2 = 55. */
const TRACEPARENT_PREFIX_LENGTH = 55;

/** All-zero ids are explicitly invalid in the W3C spec. */
const INVALID_TRACE_ID = "0".repeat(32);
const INVALID_SPAN_ID = "0".repeat(16);

/** W3C caps `tracestate` at 32 list members; the rest are dropped. */
const TRACESTATE_MAX_MEMBERS = 32;

/**
 * W3C `tracestate` key, both forms of the ABNF:
 * - simple: `lcalpha 0*255(lcalpha / DIGIT / "_" / "-" / "*" / "/")`
 * - multi-tenant: `tenant-id "@" system-id`
 */
const TRACESTATE_KEY =
  /^(?:[a-z][a-z0-9_\-*/]{0,255}|[a-z0-9][a-z0-9_\-*/]{0,240}@[a-z][a-z0-9_\-*/]{0,13})$/;

/**
 * W3C `tracestate` value — the ABNF is `0*255(chr) nblk-chr`:
 *
 * - `chr` is printable ASCII except comma and equals. `=` inside a value is
 *   forbidden, so a member carrying one is malformed, not a value to preserve.
 * - the final character is `nblk-chr`, which additionally excludes SP. That
 *   makes the value **non-empty** and forbids a trailing space, so `vendor=`
 *   is not a valid member.
 */
const TRACESTATE_VALUE =
  /^[\x20-\x2B\x2D-\x3C\x3E-\x7E]{0,255}[\x21-\x2B\x2D-\x3C\x3E-\x7E]$/;

/**
 * The grammar's optional whitespace around a list member is SP and HTAB only.
 * `String.trim()` also eats CR, LF, FF, VT and Unicode spaces — none of which
 * are legal separators here, so trimming with it would silently accept a
 * malformed list.
 */
function trimOws(member: string): string {
  return member.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "");
}

/**
 * `tracestate` carried to the next hop.
 *
 * `@opentelemetry/api` declares the interface but ships no implementation —
 * that lives in `@opentelemetry/core`. Pulling in the SDK package for one
 * key/value list would put a second OTel dependency in the public API, so this
 * is the minimum that satisfies the interface.
 *
 * Members are validated against the W3C ABNF rather than passed through: the
 * spec permits discarding invalid entries, and this list is re-serialised onto
 * the next hop — accepting a malformed member here means emitting a malformed
 * `tracestate` downstream, turning one peer's bug into ours.
 */
class ListTraceState implements TraceState {
  readonly #entries: ReadonlyArray<readonly [string, string]>;

  constructor(entries: ReadonlyArray<readonly [string, string]>) {
    this.#entries = entries;
  }

  static #isValid(key: string, value: string): boolean {
    return TRACESTATE_KEY.test(key) && TRACESTATE_VALUE.test(value);
  }

  static parse(raw: string): ListTraceState | undefined {
    const seen = new Set<string>();
    const entries: Array<readonly [string, string]> = [];

    for (const member of raw.split(",")) {
      // Optional whitespace around a list member is part of the grammar; the
      // key and value themselves are matched exactly.
      const trimmed = trimOws(member);
      if (trimmed.length === 0) continue;

      const at = trimmed.indexOf("=");
      if (at <= 0) continue;

      const key = trimmed.slice(0, at);
      const value = trimmed.slice(at + 1);
      // Duplicate keys are invalid; the first occurrence is the live one.
      if (seen.has(key)) continue;
      if (!ListTraceState.#isValid(key, value)) continue;

      seen.add(key);
      entries.push([key, value]);
      if (entries.length === TRACESTATE_MAX_MEMBERS) break;
    }

    return entries.length > 0 ? new ListTraceState(entries) : undefined;
  }

  get(key: string): string | undefined {
    return this.#entries.find(([k]) => k === key)?.[1];
  }

  set(key: string, value: string): TraceState {
    // Returns the state unchanged rather than throwing. The OpenTelemetry
    // specification is explicit that "API methods MUST NOT throw unhandled
    // exceptions when used incorrectly by end users" — telemetry is not worth
    // taking an application down for. Rejecting the mutation still keeps the
    // invalid member off the wire, which is the property that matters.
    if (!ListTraceState.#isValid(key, value)) return this;
    // W3C: a mutated key moves to the front of the list.
    return new ListTraceState([
      [key, value] as const,
      ...this.#entries.filter(([k]) => k !== key),
    ].slice(0, TRACESTATE_MAX_MEMBERS));
  }

  unset(key: string): TraceState {
    return new ListTraceState(this.#entries.filter(([k]) => k !== key));
  }

  serialize(): string {
    return this.#entries.map(([k, v]) => `${k}=${v}`).join(",");
  }
}

/**
 * Parse a W3C trace context into an OTel `SpanContext` (spec 2026-07-28).
 *
 * The revision documents `traceparent` / `tracestate` / `baggage` as `_meta`
 * keys so a tool call joins the caller's trace instead of starting a detached
 * one. Returns `undefined` for anything malformed — a bad header leaves the span
 * unparented, it never fails the call.
 *
 * Version handling follows the W3C forward-compatibility rule, which is not
 * "reject anything unfamiliar":
 *
 * - `ff` is forbidden outright.
 * - `00` is a fixed 55-character format; anything longer is malformed.
 * - a higher version MAY carry fields this implementation does not know. The
 *   receiver parses the first 55 characters and ignores the rest, provided the
 *   next character is a `-`. Rejecting those would make this server drop trace
 *   context the day a new version ships — the exact breakage the rule exists to
 *   prevent.
 */
export function parseTraceParent(
  traceparent: unknown,
  tracestate?: unknown,
): SpanContext | undefined {
  if (typeof traceparent !== "string") return undefined;
  if (traceparent.length < TRACEPARENT_PREFIX_LENGTH) return undefined;

  const match = TRACEPARENT.exec(traceparent);
  if (!match) return undefined;

  const [, version, traceId, spanId, flags] = match;
  if (version === "ff") return undefined;

  if (version === "00") {
    if (traceparent.length !== TRACEPARENT_PREFIX_LENGTH) return undefined;
  } else if (
    traceparent.length > TRACEPARENT_PREFIX_LENGTH &&
    traceparent[TRACEPARENT_PREFIX_LENGTH] !== "-"
  ) {
    // Longer, but not a well-formed continuation: the extra characters are not
    // a new field, so the whole header is suspect.
    return undefined;
  }

  if (traceId === INVALID_TRACE_ID || spanId === INVALID_SPAN_ID) {
    return undefined;
  }

  const traceState = typeof tracestate === "string"
    ? ListTraceState.parse(tracestate)
    : undefined;

  return {
    traceId,
    spanId,
    // Only the sampled bit is defined; the rest of the byte is reserved.
    traceFlags: (parseInt(flags, 16) & TraceFlags.SAMPLED) as TraceFlags,
    isRemote: true,
    ...(traceState ? { traceState } : {}),
  };
}

/**
 * The OTel context a remote `SpanContext` should parent, or the active one.
 *
 * Note the fallback is the *active* context, not `ROOT_CONTEXT`: with no
 * caller-supplied trace context the span attaches to whatever span is active in
 * this process, and only becomes a root when there is none. That is the right
 * default — it preserves in-process nesting — but it means "no traceparent" and
 * "root span" are not synonyms.
 */
function parentContext(remote?: SpanContext): Context {
  const active = otelContext.active();
  return remote ? trace.setSpanContext(active, remote) : active;
}

/**
 * Get or create the MCP server tracer
 */
export function getServerTracer(): Tracer {
  if (!serverTracer) {
    serverTracer = trace.getTracer("mcp.server", "0.8.0");
  }
  return serverTracer;
}

/**
 * Span attributes for MCP tool calls
 */
export interface ToolCallSpanAttributes {
  "mcp.tool.name": string;
  "mcp.server.name"?: string;
  "mcp.transport"?: string;
  "mcp.session.id"?: string;
  "mcp.auth.subject"?: string;
  "mcp.auth.client_id"?: string;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Start a span for a tool call.
 * Caller MUST call span.end() when done.
 *
 * `remoteParent` is the caller's trace context, read from the request's `_meta`
 * (spec 2026-07-28). With it the span joins the caller's trace; without it the
 * span falls back to the active context, which is what every call produced
 * before the `_meta` keys were wired in — a server-side trace nobody could
 * correlate to the client that caused it.
 */
export function startToolCallSpan(
  toolName: string,
  attributes: ToolCallSpanAttributes,
  remoteParent?: SpanContext,
): Span {
  const tracer = getServerTracer();
  return tracer.startSpan(
    `mcp.tool.call ${toolName}`,
    { attributes },
    parentContext(remoteParent),
  );
}

/**
 * Record a tool call result on a span and end it.
 */
export function endToolCallSpan(
  span: Span,
  success: boolean,
  durationMs: number,
  error?: string,
): void {
  span.setAttribute("mcp.tool.duration_ms", durationMs);
  span.setAttribute("mcp.tool.success", success);

  if (error) {
    span.setAttribute("mcp.tool.error", error);
    span.recordException(new Error(error));
  }

  span.setStatus({
    code: success ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    message: error,
  });
  span.end();
}

/**
 * Record an auth event as a fire-and-forget span.
 */
export function recordAuthEvent(
  event: "verify" | "reject" | "cache_hit",
  attributes: Record<string, string | number | boolean | undefined>,
): void {
  const tracer = getServerTracer();
  tracer.startActiveSpan(`mcp.auth.${event}`, { attributes }, (span) => {
    span.setStatus({
      code: event === "reject" ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });
    span.end();
  });
}

/**
 * Check if OTEL is enabled.
 * Deno: OTEL_DENO=true  |  Node.js: OTEL_ENABLED=true
 */
export function isOtelEnabled(): boolean {
  try {
    return env("OTEL_DENO") === "true" || env("OTEL_ENABLED") === "true";
  } catch {
    // Deno without --allow-env throws NotCapable
    return false;
  }
}
