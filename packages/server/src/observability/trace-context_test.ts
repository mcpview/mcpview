/**
 * W3C trace context parsing (spec 2026-07-28, SEP-414).
 *
 * `traceparent` / `tracestate` / `baggage` are the one exception to the `_meta`
 * prefix rule — the spec reserves the bare W3C names so a `_meta` envelope
 * carries what an HTTP header would.
 *
 * The rejection cases matter more than the happy path: a malformed header that
 * parses anyway produces a span attached to a trace id nobody else has, which
 * reads as a real correlation and is not one.
 */

import { assertEquals, assertExists } from "@std/assert";
import { TraceFlags } from "@opentelemetry/api";
import { parseTraceParent } from "./otel.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "00f067aa0ba902b7";
const SAMPLED = `00-${TRACE_ID}-${SPAN_ID}-01`;

Deno.test("traceparent - parses the W3C example", () => {
  const ctx = parseTraceParent(SAMPLED);

  assertExists(ctx);
  assertEquals(ctx.traceId, TRACE_ID);
  assertEquals(ctx.spanId, SPAN_ID);
  assertEquals(ctx.traceFlags, TraceFlags.SAMPLED);
  assertEquals(ctx.isRemote, true);
});

Deno.test("traceparent - an unsampled flag is preserved, not dropped", () => {
  // `00` means "not sampled", which is a decision to honour — not a reason to
  // discard the parent and start a detached trace.
  const ctx = parseTraceParent(`00-${TRACE_ID}-${SPAN_ID}-00`);

  assertExists(ctx);
  assertEquals(ctx.traceFlags, TraceFlags.NONE);
  assertEquals(ctx.traceId, TRACE_ID);
});

Deno.test("traceparent - reserved flag bits are masked off", () => {
  // Only the low bit is defined. A future spec may set others; a receiver must
  // not read them as sampling.
  const ctx = parseTraceParent(`00-${TRACE_ID}-${SPAN_ID}-ff`);

  assertExists(ctx);
  assertEquals(ctx.traceFlags, TraceFlags.SAMPLED);
});

Deno.test("traceparent - a future version parses as version 00", () => {
  const ctx = parseTraceParent(`cc-${TRACE_ID}-${SPAN_ID}-01`);

  assertExists(ctx);
  assertEquals(ctx.traceId, TRACE_ID);
});

Deno.test("traceparent - a future version may carry unknown trailing fields", () => {
  // The W3C forward-compatibility rule: a receiver parses the first 55
  // characters and ignores the rest when the next character is `-`. Rejecting
  // these would make this server drop trace context the day a version 01 ships
  // — the exact breakage the rule exists to prevent.
  const ctx = parseTraceParent(`cc-${TRACE_ID}-${SPAN_ID}-01-futurefield`);

  assertExists(ctx);
  assertEquals(ctx.traceId, TRACE_ID);
  assertEquals(ctx.spanId, SPAN_ID);
  assertEquals(ctx.traceFlags, TraceFlags.SAMPLED);
});

Deno.test("traceparent - trailing content must start a new field", () => {
  // Longer than 55 but the 56th character is not a separator: the extra
  // characters are not a field, so the header is malformed rather than future.
  assertEquals(
    parseTraceParent(`cc-${TRACE_ID}-${SPAN_ID}-01x`),
    undefined,
  );
});

Deno.test("traceparent - version 00 is a fixed 55-character format", () => {
  // The forward-compatibility allowance is for *higher* versions only. Version
  // 00 has no additional fields, so trailing content is corruption.
  assertEquals(parseTraceParent(`${SAMPLED}-extra`), undefined);
  assertEquals(parseTraceParent(`${SAMPLED}x`), undefined);
  assertEquals(parseTraceParent(SAMPLED)?.traceId, TRACE_ID);
});

Deno.test("traceparent - malformed values are rejected", () => {
  const rejected = [
    undefined,
    null,
    42,
    "",
    "not-a-traceparent",
    // Version ff is forbidden outright by W3C.
    `ff-${TRACE_ID}-${SPAN_ID}-01`,
    // All-zero ids are explicitly invalid.
    `00-${"0".repeat(32)}-${SPAN_ID}-01`,
    `00-${TRACE_ID}-${"0".repeat(16)}-01`,
    // Uppercase hex: accepting it yields an id that will not match the same
    // trace elsewhere in the pipeline.
    `00-${TRACE_ID.toUpperCase()}-${SPAN_ID}-01`,
    // Wrong lengths.
    `00-${TRACE_ID.slice(0, 31)}-${SPAN_ID}-01`,
    `00-${TRACE_ID}-${SPAN_ID}0-01`,
    // Leading whitespace shifts every field.
    ` ${SAMPLED}`,
  ];

  for (const value of rejected) {
    assertEquals(
      parseTraceParent(value),
      undefined,
      `expected rejection for ${JSON.stringify(value)}`,
    );
  }
});

Deno.test("tracestate - vendor entries survive a round trip", () => {
  const ctx = parseTraceParent(SAMPLED, "vendor1=abc,vendor2=def");

  assertExists(ctx?.traceState);
  assertEquals(ctx.traceState.get("vendor1"), "abc");
  assertEquals(ctx.traceState.get("vendor2"), "def");
  assertEquals(ctx.traceState.serialize(), "vendor1=abc,vendor2=def");
});

Deno.test("tracestate - a value containing '=' is a malformed member", () => {
  // The W3C ABNF excludes `=` (0x3D) and `,` (0x2C) from a value. Preserving
  // such a member would put it back on the wire on the next hop, turning one
  // peer's malformed header into ours.
  const ctx = parseTraceParent(SAMPLED, "vendor=a=b=c");

  assertEquals(ctx?.traceState, undefined);
});

Deno.test("tracestate - one malformed member does not discard the valid ones", () => {
  const ctx = parseTraceParent(SAMPLED, "good=1,BAD-UPPER=2,also_good=3");

  assertEquals(ctx?.traceState?.get("good"), "1");
  assertEquals(ctx?.traceState?.get("also_good"), "3");
  assertEquals(ctx?.traceState?.get("BAD-UPPER"), undefined);
  assertEquals(ctx?.traceState?.serialize(), "good=1,also_good=3");
});

Deno.test("tracestate - keys are validated against the ABNF", () => {
  // Simple keys are lowercase-led; the multi-tenant form allows one `@`.
  assertEquals(
    parseTraceParent(SAMPLED, "congo@vendor=t61")?.traceState?.get(
      "congo@vendor",
    ),
    "t61",
  );
  assertEquals(parseTraceParent(SAMPLED, "1nvalid=x")?.traceState, undefined);
  assertEquals(parseTraceParent(SAMPLED, "has space=x")?.traceState, undefined);
  assertEquals(parseTraceParent(SAMPLED, "a@b@c=x")?.traceState, undefined);
});

Deno.test("tracestate - a duplicate key keeps the first occurrence", () => {
  const ctx = parseTraceParent(SAMPLED, "dup=first,dup=second");

  assertEquals(ctx?.traceState?.get("dup"), "first");
  assertEquals(ctx?.traceState?.serialize(), "dup=first");
});

Deno.test("tracestate - surrounding whitespace is tolerated, per the OWS rule", () => {
  // The grammar puts optional whitespace around list members, so stripping SP
  // and HTAB there is correct. The value's own no-trailing-space rule is
  // enforced separately, by the ABNF pattern.
  const ctx = parseTraceParent(SAMPLED, " a=1 , b=2 ");

  assertEquals(ctx?.traceState?.get("a"), "1");
  assertEquals(ctx?.traceState?.get("b"), "2");
  assertEquals(ctx?.traceState?.serialize(), "a=1,b=2");
});

Deno.test("tracestate - an internal space in a value is preserved", () => {
  // 0x20 is inside the allowed range; only the trailing position is excluded.
  assertEquals(parseTraceParent(SAMPLED, "v=a b")?.traceState?.get("v"), "a b");
});

Deno.test("tracestate - set drops an invalid member without throwing", () => {
  // The OTel spec forbids an API method from throwing on incorrect use:
  // telemetry must not be able to take an application down. Returning the state
  // unchanged still keeps the invalid member off the wire.
  const state = parseTraceParent(SAMPLED, "a=1")?.traceState;
  assertExists(state);

  assertEquals(state.set("bad key", "x").serialize(), "a=1");
  assertEquals(state.set("ok", "has=equals").serialize(), "a=1");
  assertEquals(state.set("ok", "").serialize(), "a=1");

  // A valid mutation still applies.
  assertEquals(state.set("b", "2").serialize(), "b=2,a=1");
});

Deno.test("tracestate - an empty value is not a valid member", () => {
  // The ABNF ends the value with `nblk-chr`, so it cannot be empty.
  assertEquals(parseTraceParent(SAMPLED, "vendor=")?.traceState, undefined);
  assertEquals(
    parseTraceParent(SAMPLED, "empty=,full=1")?.traceState?.serialize(),
    "full=1",
  );
});

Deno.test("tracestate - only SP and HTAB separate list members", () => {
  // `String.trim()` would also eat CR/LF/FF/VT, none of which are legal here.
  // Accepting them means accepting a malformed list.
  assertEquals(
    parseTraceParent(SAMPLED, "a=1,\nb=2")?.traceState?.get("b"),
    undefined,
  );
  assertEquals(parseTraceParent(SAMPLED, "\ta=1 ")?.traceState?.get("a"), "1");
});

Deno.test("tracestate - list is capped at 32 members", () => {
  const raw = Array.from({ length: 40 }, (_, i) => `v${i}=x`).join(",");
  const ctx = parseTraceParent(SAMPLED, raw);

  assertEquals(ctx?.traceState?.serialize().split(",").length, 32);
  assertEquals(ctx?.traceState?.get("v31"), "x");
  assertEquals(ctx?.traceState?.get("v32"), undefined);
});

Deno.test("tracestate - set moves a mutated key to the front", () => {
  const ctx = parseTraceParent(SAMPLED, "a=1,b=2");
  const mutated = ctx?.traceState?.set("b", "9");

  assertEquals(mutated?.serialize(), "b=9,a=1");
});

Deno.test("tracestate - unset removes a key", () => {
  const ctx = parseTraceParent(SAMPLED, "a=1,b=2");

  assertEquals(ctx?.traceState?.unset("a").serialize(), "b=2");
});

Deno.test("tracestate - absent or unusable values leave no traceState", () => {
  assertEquals(parseTraceParent(SAMPLED)?.traceState, undefined);
  assertEquals(parseTraceParent(SAMPLED, "")?.traceState, undefined);
  assertEquals(parseTraceParent(SAMPLED, "garbage")?.traceState, undefined);
  assertEquals(parseTraceParent(SAMPLED, 42)?.traceState, undefined);
});

Deno.test("tracestate - a bad tracestate never invalidates the traceparent", () => {
  // The two headers are independent: dropping the parent because a vendor sent
  // a malformed tracestate would lose the correlation over a detail.
  const ctx = parseTraceParent(SAMPLED, "=novalue");

  assertExists(ctx);
  assertEquals(ctx.traceId, TRACE_ID);
});
