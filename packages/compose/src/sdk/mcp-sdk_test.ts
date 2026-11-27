/**
 * Tests for the MCP SDK adapter.
 *
 * @module sdk/mcp-sdk_test
 */

import { assertEquals } from "@std/assert";
import { createMcpSdkCollector } from "./mcp-sdk.ts";
import type { McpSdkCallToolResult } from "./mcp-sdk.ts";

Deno.test("createMcpSdkCollector - collects from SDK-shaped result", () => {
  const collector = createMcpSdkCollector();
  const result: McpSdkCallToolResult = {
    content: [{ type: "text", text: "OK" }],
    _meta: { ui: { resourceUri: "ui://pg/table/1" } },
  };

  const resource = collector.collectFromSdk("postgres:query", result);

  assertEquals(resource?.source, "postgres:query");
  assertEquals(resource?.resourceUri, "ui://pg/table/1");
  assertEquals(resource?.slot, 0);
});

Deno.test("createMcpSdkCollector - skips error results", () => {
  const collector = createMcpSdkCollector();
  const result: McpSdkCallToolResult = {
    content: [{ type: "text", text: "Error occurred" }],
    _meta: { ui: { resourceUri: "ui://should/be/skipped" } },
    isError: true,
  };

  const resource = collector.collectFromSdk("failing:tool", result);

  assertEquals(resource, null);
  assertEquals(collector.getResources().length, 0);
});

Deno.test("createMcpSdkCollector - returns null for results without UI metadata", () => {
  const collector = createMcpSdkCollector();
  const result: McpSdkCallToolResult = {
    content: [{ type: "text", text: "No UI" }],
  };

  const resource = collector.collectFromSdk("tool", result);

  assertEquals(resource, null);
});

Deno.test("createMcpSdkCollector - preserves context", () => {
  const collector = createMcpSdkCollector();
  const result: McpSdkCallToolResult = {
    _meta: { ui: { resourceUri: "ui://test/1" } },
  };

  const resource = collector.collectFromSdk("tool", result, { key: "value" }, {
    supportedWidths: [400, 600],
  });

  assertEquals(resource?.context, { key: "value" });
  assertEquals(resource?.supportedWidths, [400, 600]);
});

Deno.test("createMcpSdkCollector - clear resets state", () => {
  const collector = createMcpSdkCollector();
  collector.collectFromSdk("a", { _meta: { ui: { resourceUri: "ui://a" } } });

  assertEquals(collector.getResources().length, 1);
  collector.clear();
  assertEquals(collector.getResources().length, 0);
});

Deno.test("createMcpSdkCollector - inner exposes core collector", () => {
  const collector = createMcpSdkCollector();

  // Can use the inner collector directly
  collector.inner.collect("direct", { _meta: { ui: { resourceUri: "ui://direct" } } });

  assertEquals(collector.getResources().length, 1);
  assertEquals(collector.getResources()[0].source, "direct");
});

Deno.test("createMcpSdkCollector - assigns incrementing slots", () => {
  const collector = createMcpSdkCollector();

  collector.collectFromSdk("a", { _meta: { ui: { resourceUri: "ui://a" } } });
  collector.collectFromSdk("err", {
    _meta: { ui: { resourceUri: "ui://err" } },
    isError: true,
  });
  const r = collector.collectFromSdk("b", { _meta: { ui: { resourceUri: "ui://b" } } });

  assertEquals(r?.slot, 1);
  assertEquals(collector.getResources().length, 2);
});
