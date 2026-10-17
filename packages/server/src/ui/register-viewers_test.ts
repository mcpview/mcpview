/**
 * Tests for registerViewers() on McpApp
 *
 * Integration tests: verifies that registerViewers() correctly registers
 * MCP Apps resources using the viewer utilities.
 *
 * @module lib/server/src/ui/register-viewers_test
 */

import { assertEquals, assertThrows } from "@std/assert";
import { McpApp } from "../mcp-app.ts";
import { MCP_APP_MIME_TYPE } from "../types.ts";

function createTestServer(): McpApp {
  return new McpApp({
    name: "test-server",
    version: "1.0.0",
    logger: () => {},
  });
}

// ── registerViewers — basic registration ─────────────────────────

Deno.test("registerViewers - registers all viewers as resources", () => {
  const server = createTestServer();
  // Simulate all viewers having built dist
  const existsFn = () => true;
  const readFileFn = (path: string) => `<html>${path}</html>`;

  server.registerViewers({
    prefix: "mcp-einvoice",
    viewers: ["invoice-viewer", "doclist-viewer"],
    moduleUrl: "file:///project/server.ts",
    exists: existsFn,
    readFile: readFileFn,
  });

  assertEquals(server.getResourceCount(), 2);
  assertEquals(server.hasResource("ui://mcp-einvoice/invoice-viewer"), true);
  assertEquals(server.hasResource("ui://mcp-einvoice/doclist-viewer"), true);
});

Deno.test("registerViewers - resources have correct metadata", () => {
  const server = createTestServer();
  server.registerViewers({
    prefix: "mcp-test",
    viewers: ["my-viewer"],
    moduleUrl: "file:///project/server.ts",
    exists: () => true,
    readFile: () => "<html>test</html>",
  });

  const info = server.getResourceInfo("ui://mcp-test/my-viewer");
  assertEquals(info?.name, "My Viewer");
  assertEquals(info?.mimeType, MCP_APP_MIME_TYPE);
  assertEquals(info?.uri, "ui://mcp-test/my-viewer");
});

Deno.test("registerViewers - handler returns correct content", async () => {
  const server = createTestServer();
  server.registerViewers({
    prefix: "mcp-test",
    viewers: ["chart"],
    moduleUrl: "file:///project/server.ts",
    exists: () => true,
    readFile: () => "<html>chart content</html>",
  });

  const content = await server.readResourceContent("ui://mcp-test/chart");
  assertEquals(content?.text, "<html>chart content</html>");
  assertEquals(content?.mimeType, MCP_APP_MIME_TYPE);
});

// ── registerViewers — missing builds ─────────────────────────────

Deno.test("registerViewers - skips viewers without dist, registers the rest", () => {
  const server = createTestServer();
  const existsFn = (path: string) => path.includes("invoice-viewer");

  server.registerViewers({
    prefix: "mcp-test",
    viewers: ["invoice-viewer", "missing-viewer"],
    moduleUrl: "file:///project/server.ts",
    exists: existsFn,
    readFile: () => "<html></html>",
  });

  assertEquals(server.getResourceCount(), 1);
  assertEquals(server.hasResource("ui://mcp-test/invoice-viewer"), true);
  assertEquals(server.hasResource("ui://mcp-test/missing-viewer"), false);
});

Deno.test("registerViewers - returns registration summary", () => {
  const server = createTestServer();
  const existsFn = (path: string) => path.includes("ok-viewer");

  const summary = server.registerViewers({
    prefix: "mcp-test",
    viewers: ["ok-viewer", "missing-viewer"],
    moduleUrl: "file:///project/server.ts",
    exists: existsFn,
    readFile: () => "<html></html>",
  });

  assertEquals(summary.registered, ["ok-viewer"]);
  assertEquals(summary.skipped, ["missing-viewer"]);
});

// ── registerViewers — auto-discover ──────────────────────────────

Deno.test("registerViewers - auto-discovers viewers when viewers omitted", () => {
  const server = createTestServer();

  server.registerViewers({
    prefix: "mcp-test",
    moduleUrl: "file:///project/server.ts",
    exists: () => true,
    readFile: () => "<html></html>",
    discover: {
      uiDir: "/project/src/ui",
      readDir: () => [
        { name: "invoice-viewer", isDirectory: true },
        { name: "doclist-viewer", isDirectory: true },
        { name: "shared", isDirectory: true },
        { name: "global.css", isDirectory: false },
      ],
      hasIndexHtml: (_dir: string, name: string) =>
        ["invoice-viewer", "doclist-viewer"].includes(name),
    },
  });

  assertEquals(server.getResourceCount(), 2);
  assertEquals(server.hasResource("ui://mcp-test/doclist-viewer"), true);
  assertEquals(server.hasResource("ui://mcp-test/invoice-viewer"), true);
});

// ── registerViewers — edge cases ─────────────────────────────────

Deno.test("registerViewers - empty viewers list registers nothing", () => {
  const server = createTestServer();
  const summary = server.registerViewers({
    prefix: "mcp-test",
    viewers: [],
    moduleUrl: "file:///project/server.ts",
    exists: () => true,
    readFile: () => "<html></html>",
  });

  assertEquals(server.getResourceCount(), 0);
  assertEquals(summary.registered, []);
  assertEquals(summary.skipped, []);
});

Deno.test("registerViewers - custom humanName function", () => {
  const server = createTestServer();
  server.registerViewers({
    prefix: "mcp-test",
    viewers: ["kpi-dashboard"],
    moduleUrl: "file:///project/server.ts",
    exists: () => true,
    readFile: () => "<html></html>",
    humanName: (name) => `Custom: ${name}`,
  });

  const info = server.getResourceInfo("ui://mcp-test/kpi-dashboard");
  assertEquals(info?.name, "Custom: kpi-dashboard");
});

Deno.test("registerViewers - throws if prefix is empty", () => {
  const server = createTestServer();
  assertThrows(
    () =>
      server.registerViewers({
        prefix: "",
        viewers: ["viewer"],
        moduleUrl: "file:///project/server.ts",
        exists: () => true,
        readFile: () => "",
      }),
    Error,
    "prefix",
  );
});
