/**
 * Systematic shape coverage for `inputRequests`.
 *
 * Three consecutive review rounds found the same class of defect: a shape that
 * survives JSON serialisation, then breaks something before classification can
 * run, so it reaches the generic tool-error path as a 200 instead of the 500 a
 * malformed server output requires.
 *
 * Rather than wait for them to be found one at a time, this enumerates the space:
 * every position a value can occupy (the map, an entry, `method`, `params`) times
 * every JSON-survivable shape. The invariant is simple and total — a handler's
 * `input_required` either passes the checker or is classified, never throws.
 *
 * @module lib/server/mrtr/shape-fuzz_test
 */

import { assertEquals } from "@std/assert";
import { checkInputRequestCapabilities } from "./capability-check.ts";

/** Every shape that round-trips through JSON without being dropped. */
const JSON_SURVIVABLE: readonly unknown[] = [
  null,
  0,
  1,
  -1,
  1.5,
  "",
  "x",
  "toString",
  "constructor",
  "__proto__",
  "hasOwnProperty",
  true,
  false,
  [],
  ["x"],
  {},
  { nested: { deep: true } },
  { toString: null },
  { valueOf: null },
];

const ALL_CAPS = {
  elicitation: { url: {} },
  sampling: { tools: {} },
  roots: {},
};

Deno.test("shape fuzz - a bad map never throws, always classifies", () => {
  for (const shape of JSON_SURVIVABLE) {
    let threw: unknown;
    let ok: boolean | undefined;
    try {
      // deno-lint-ignore no-explicit-any
      const r = checkInputRequestCapabilities(shape as any, ALL_CAPS);
      ok = r.ok;
    } catch (e) {
      threw = e;
    }
    assertEquals(
      threw,
      undefined,
      `map ${JSON.stringify(shape)} threw: ${threw}`,
    );
    assertEquals(typeof ok, "boolean", `map ${JSON.stringify(shape)}`);
  }
});

Deno.test("shape fuzz - a bad entry never throws, always classifies", () => {
  for (const shape of JSON_SURVIVABLE) {
    let threw: unknown;
    let kind: string | undefined;
    try {
      // deno-lint-ignore no-explicit-any
      const r = checkInputRequestCapabilities({ k: shape as any }, ALL_CAPS);
      kind = r.ok ? "ok" : r.kind;
    } catch (e) {
      threw = e;
    }
    assertEquals(
      threw,
      undefined,
      `entry ${JSON.stringify(shape)} threw: ${threw}`,
    );
    // Only a well-formed request object may pass; everything else is malformed.
    assertEquals(
      kind === "ok" || kind === "malformed" || kind === "missing_capability",
      true,
      `entry ${JSON.stringify(shape)} → ${kind}`,
    );
  }
});

Deno.test("shape fuzz - a bad method never throws, always classifies", () => {
  for (const shape of JSON_SURVIVABLE) {
    let threw: unknown;
    let ok: boolean | undefined;
    try {
      const r = checkInputRequestCapabilities({
        // deno-lint-ignore no-explicit-any
        k: { method: shape as any, params: {} },
      }, ALL_CAPS);
      ok = r.ok;
    } catch (e) {
      threw = e;
    }
    assertEquals(
      threw,
      undefined,
      `method ${JSON.stringify(shape)} threw: ${threw}`,
    );
    // No shape in this list is one of the three permitted methods.
    assertEquals(ok, false, `method ${JSON.stringify(shape)} must be refused`);
  }
});

Deno.test("shape fuzz - a bad params never throws, always classifies", () => {
  for (const method of ["elicitation/create", "sampling/createMessage"]) {
    for (const shape of JSON_SURVIVABLE) {
      let threw: unknown;
      let ok: boolean | undefined;
      try {
        const r = checkInputRequestCapabilities({
          // deno-lint-ignore no-explicit-any
          k: { method: method as any, params: shape as any },
        }, ALL_CAPS);
        ok = r.ok;
      } catch (e) {
        threw = e;
      }
      assertEquals(
        threw,
        undefined,
        `${method} params ${JSON.stringify(shape)} threw: ${threw}`,
      );
      assertEquals(typeof ok, "boolean");
    }
  }
});

Deno.test("shape fuzz - a well-formed request still passes", () => {
  // The counterweight: a fuzz suite that rejects everything would pass while
  // proving nothing.
  const result = checkInputRequestCapabilities({
    ask: {
      method: "elicitation/create",
      params: { mode: "form", message: "hi", requestedSchema: {} },
    },
  }, ALL_CAPS);
  assertEquals(result.ok, true);
});
