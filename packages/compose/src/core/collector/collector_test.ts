/**
 * Tests for the collector module (extractor + collector).
 *
 * @module collector/collector_test
 */

import { assertEquals, assertThrows } from "@std/assert";
import { extractUiMeta } from "./extractor.ts";
import { createCollector } from "./collector.ts";

// =============================================================================
// extractUiMeta Tests
// =============================================================================

Deno.test("extractUiMeta - extracts resourceUri from valid result", () => {
  const result = {
    content: [{ type: "text", text: "OK" }],
    _meta: { ui: { resourceUri: "ui://pg/table/1" } },
  };

  const meta = extractUiMeta(result);

  assertEquals(meta?.resourceUri, "ui://pg/table/1");
});

Deno.test("extractUiMeta - extracts visibility array", () => {
  const result = {
    _meta: { ui: { resourceUri: "ui://test", visibility: ["model", "app"] } },
  };

  const meta = extractUiMeta(result);

  assertEquals(meta?.visibility, ["model", "app"]);
});

Deno.test("extractUiMeta - returns null for null input", () => {
  assertEquals(extractUiMeta(null), null);
});

Deno.test("extractUiMeta - returns null for non-object input", () => {
  assertEquals(extractUiMeta("string"), null);
  assertEquals(extractUiMeta(42), null);
  assertEquals(extractUiMeta(true), null);
  assertEquals(extractUiMeta(undefined), null);
});

Deno.test("extractUiMeta - returns null for missing _meta", () => {
  assertEquals(extractUiMeta({ content: [] }), null);
});

Deno.test("extractUiMeta - returns null for missing ui", () => {
  assertEquals(extractUiMeta({ _meta: {} }), null);
  assertEquals(extractUiMeta({ _meta: { other: "data" } }), null);
});

Deno.test("extractUiMeta - returns null for missing resourceUri", () => {
  assertEquals(extractUiMeta({ _meta: { ui: {} } }), null);
});

Deno.test("extractUiMeta - returns null for empty resourceUri", () => {
  assertEquals(extractUiMeta({ _meta: { ui: { resourceUri: "" } } }), null);
});

Deno.test("extractUiMeta - returns null for non-string resourceUri", () => {
  assertEquals(extractUiMeta({ _meta: { ui: { resourceUri: 42 } } }), null);
});

Deno.test("extractUiMeta - visibility is undefined when not array", () => {
  const result = {
    _meta: { ui: { resourceUri: "ui://test", visibility: "invalid" } },
  };

  const meta = extractUiMeta(result);

  assertEquals(meta?.resourceUri, "ui://test");
  assertEquals(meta?.visibility, undefined);
});

// =============================================================================
// createCollector Tests
// =============================================================================

Deno.test("createCollector - collects resource from valid tool result", () => {
  const collector = createCollector();
  const result = {
    _meta: { ui: { resourceUri: "ui://pg/table/1" } },
  };

  const resource = collector.collect("postgres:query", result);

  assertEquals(resource?.source, "postgres:query");
  assertEquals(resource?.resourceUri, "ui://pg/table/1");
  assertEquals(resource?.slot, 0);
});

Deno.test("createCollector - assigns incrementing slot indices", () => {
  const collector = createCollector();

  collector.collect("a", { _meta: { ui: { resourceUri: "ui://a" } } });
  collector.collect("b", { _meta: { ui: { resourceUri: "ui://b" } } });
  const r3 = collector.collect("c", { _meta: { ui: { resourceUri: "ui://c" } } });

  assertEquals(r3?.slot, 2);
  assertEquals(collector.getResources().length, 3);
});

Deno.test("createCollector - keeps the viewer's width choices local to its resource", () => {
  const collector = createCollector();
  const result = { _meta: { ui: { resourceUri: "ui://stock", supportedWidths: [100] } } };
  const widths = [380, 680];
  const panel = collector.collect("stock", result, undefined, { supportedWidths: widths });
  widths.push(900);
  assertEquals(panel?.supportedWidths, [380, 680]);
  assertEquals(
    collector.collect("fixed", result, undefined, { supportedWidths: [] })?.supportedWidths,
    [],
  );
  assertEquals(collector.collect("default", result)?.supportedWidths, undefined);
  assertThrows(
    () => collector.collect("invalid", result, undefined, { supportedWidths: [NaN] }),
    TypeError,
    "supportedWidths",
  );
});

Deno.test("createCollector - returns null for result without UI metadata", () => {
  const collector = createCollector();

  const result = collector.collect("tool", { content: [{ type: "text", text: "OK" }] });

  assertEquals(result, null);
  assertEquals(collector.getResources().length, 0);
});

Deno.test("createCollector - preserves context", () => {
  const collector = createCollector();
  const ctx = { query: "SELECT * FROM users", userId: "u123" };

  const resource = collector.collect(
    "postgres:query",
    { _meta: { ui: { resourceUri: "ui://pg/1" } } },
    ctx,
  );

  assertEquals(resource?.context, ctx);
});

Deno.test("createCollector - getResources returns copy", () => {
  const collector = createCollector();
  collector.collect("a", { _meta: { ui: { resourceUri: "ui://a" } } });

  const r1 = collector.getResources();
  const r2 = collector.getResources();

  assertEquals(r1.length, r2.length);
  // Mutating returned array does not affect internal state
  r1.push({ source: "fake", resourceUri: "ui://fake", slot: 99 });
  assertEquals(collector.getResources().length, 1);
});

Deno.test("createCollector - clear resets state", () => {
  const collector = createCollector();
  collector.collect("a", { _meta: { ui: { resourceUri: "ui://a" } } });
  collector.collect("b", { _meta: { ui: { resourceUri: "ui://b" } } });

  assertEquals(collector.getResources().length, 2);

  collector.clear();

  assertEquals(collector.getResources().length, 0);
});

Deno.test("createCollector - slot resets after clear", () => {
  const collector = createCollector();
  collector.collect("a", { _meta: { ui: { resourceUri: "ui://a" } } });
  collector.clear();

  const resource = collector.collect("b", { _meta: { ui: { resourceUri: "ui://b" } } });

  assertEquals(resource?.slot, 0);
});

Deno.test("createCollector - skips results without metadata without incrementing slot", () => {
  const collector = createCollector();

  collector.collect("a", { _meta: { ui: { resourceUri: "ui://a" } } });
  collector.collect("no-ui", { content: [] });
  const r = collector.collect("b", { _meta: { ui: { resourceUri: "ui://b" } } });

  assertEquals(r?.slot, 1);
  assertEquals(collector.getResources().length, 2);
});
