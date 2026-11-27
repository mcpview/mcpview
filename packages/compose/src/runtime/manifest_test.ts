/**
 * Tests for manifest parsing and validation.
 *
 * @module runtime/manifest_test
 */

import { assertEquals } from "@std/assert";
import { loadManifest, loadManifests, parseManifest, validateManifest } from "./manifest.ts";
import { RuntimeErrorCode } from "./types.ts";
import type { RuntimeError } from "./types.ts";

// =============================================================================
// validateManifest — stdio transport
// =============================================================================

Deno.test("validateManifest - valid stdio manifest passes", () => {
  const result = validateManifest({
    name: "postgres",
    transport: { type: "stdio", command: "pg-mcp" },
    tools: [{ name: "query" }],
  });
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("validateManifest - stdio with all optional fields", () => {
  const result = validateManifest({
    name: "postgres",
    transport: {
      type: "stdio",
      command: "deno",
      args: ["run", "server.ts"],
      env: { DATABASE_URL: "postgres://localhost" },
    },
    tools: [
      { name: "query", description: "Execute SQL", emits: ["rowSelected"], accepts: ["filter"] },
    ],
  });
  assertEquals(result.valid, true);
});

Deno.test("validateManifest - stdio missing command", () => {
  const result = validateManifest({
    name: "pg",
    transport: { type: "stdio" },
    tools: [{ name: "q" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("command")), true);
});

// =============================================================================
// validateManifest — http transport
// =============================================================================

Deno.test("validateManifest - valid http manifest passes", () => {
  const result = validateManifest({
    name: "postgres",
    transport: { type: "http", url: "http://localhost:3001" },
    tools: [{ name: "query" }],
  });
  assertEquals(result.valid, true);
});

Deno.test("validateManifest - tool viewer widths must be positive whole CSS pixels", () => {
  const manifest = {
    name: "dashboard",
    transport: { type: "http", url: "http://localhost:3001" },
  };
  for (const supportedWidths of [[], [380], [380, 680]]) {
    const parsed = parseManifest(JSON.stringify({
      ...manifest,
      tools: [{ name: "stock", supportedWidths }],
    }));
    assertEquals(parsed.tools[0].supportedWidths, supportedWidths);
  }
  for (const supportedWidths of [null, "380,680", 380, [0], [-1], [1.5], ["680"], [2 ** 53]]) {
    const result = validateManifest({ ...manifest, tools: [{ name: "stock", supportedWidths }] });
    assertEquals(result.valid, false);
    assertEquals(result.errors.some((error) => error.includes("tools[0].supportedWidths")), true);
  }
});

Deno.test("validateManifest - accepts explicit stateless protocol and app-only tool", () => {
  const result = validateManifest({
    name: "dashboard",
    transport: {
      type: "http",
      url: "http://localhost:3001/mcp",
      protocol: "stateless-2026-07-28",
    },
    tools: [{ name: "refresh", appCallable: true }],
  });
  assertEquals(result.valid, true);
});

Deno.test("validateManifest - rejects invalid protocol and appCallable values", () => {
  const result = validateManifest({
    name: "dashboard",
    transport: { type: "http", url: "http://localhost:3001", protocol: "websocket" },
    tools: [{ name: "refresh", appCallable: "yes" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((error) => error.includes("transport.protocol")), true);
  assertEquals(result.errors.some((error) => error.includes("appCallable")), true);
});

Deno.test("validateManifest - http missing url", () => {
  const result = validateManifest({
    name: "pg",
    transport: { type: "http" },
    tools: [{ name: "q" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("url")), true);
});

Deno.test("validateManifest - unknown transport type", () => {
  const result = validateManifest({
    name: "pg",
    transport: { type: "websocket" },
    tools: [{ name: "q" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("stdio")), true);
});

// =============================================================================
// validateManifest — general
// =============================================================================

Deno.test("validateManifest - missing name", () => {
  const result = validateManifest({
    transport: { type: "stdio", command: "cmd" },
    tools: [{ name: "q" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("name")), true);
});

Deno.test("validateManifest - missing transport", () => {
  const result = validateManifest({ name: "pg", tools: [{ name: "q" }] });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("transport")), true);
});

Deno.test("validateManifest - missing tools", () => {
  const result = validateManifest({
    name: "pg",
    transport: { type: "stdio", command: "cmd" },
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("tools")), true);
});

Deno.test("validateManifest - tool without name", () => {
  const result = validateManifest({
    name: "pg",
    transport: { type: "stdio", command: "cmd" },
    tools: [{ description: "no name" }],
  });
  assertEquals(result.valid, false);
  assertEquals(result.errors.some((e) => e.includes("tools[0]")), true);
});

Deno.test("validateManifest - null input", () => {
  const result = validateManifest(null);
  assertEquals(result.valid, false);
});

Deno.test("validateManifest - array input", () => {
  const result = validateManifest([]);
  assertEquals(result.valid, false);
});

Deno.test("validateManifest - multiple errors", () => {
  const result = validateManifest({});
  assertEquals(result.valid, false);
  assertEquals(result.errors.length >= 3, true);
});

// =============================================================================
// parseManifest
// =============================================================================

Deno.test("parseManifest - valid stdio JSON", () => {
  const manifest = parseManifest(
    '{"name":"pg","transport":{"type":"stdio","command":"pg-mcp"},"tools":[{"name":"query"}]}',
  );
  assertEquals(manifest.name, "pg");
  assertEquals(manifest.transport.type, "stdio");
  assertEquals(manifest.tools[0].name, "query");
});

Deno.test("parseManifest - valid http JSON", () => {
  const manifest = parseManifest(
    '{"name":"pg","transport":{"type":"http","url":"http://localhost:3001"},"tools":[{"name":"query"}]}',
  );
  assertEquals(manifest.name, "pg");
  assertEquals(manifest.transport.type, "http");
  if (manifest.transport.type === "http") {
    assertEquals(manifest.transport.url, "http://localhost:3001");
  }
});

Deno.test("parseManifest - invalid JSON throws MANIFEST_PARSE_ERROR", () => {
  try {
    parseManifest("not json");
    throw new Error("should have thrown");
  } catch (e) {
    const err = e as RuntimeError;
    assertEquals(err.code, RuntimeErrorCode.MANIFEST_PARSE_ERROR);
    assertEquals(err.message.includes("Invalid JSON"), true);
  }
});

Deno.test("parseManifest - valid JSON but invalid manifest", () => {
  try {
    parseManifest('{"name":"pg"}');
    throw new Error("should have thrown");
  } catch (e) {
    const err = e as RuntimeError;
    assertEquals(err.code, RuntimeErrorCode.MANIFEST_PARSE_ERROR);
    assertEquals(err.message.includes("Invalid manifest"), true);
  }
});

Deno.test("parseManifest - includes filePath in error", () => {
  try {
    parseManifest("bad", "/tmp/test.json");
    throw new Error("should have thrown");
  } catch (e) {
    const err = e as RuntimeError;
    assertEquals(err.message.includes("/tmp/test.json"), true);
  }
});

// =============================================================================
// loadManifest / loadManifests (file I/O)
// =============================================================================

Deno.test("loadManifest - reads from file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const path = `${tmpDir}/test.json`;
  await Deno.writeTextFile(
    path,
    JSON.stringify({
      name: "test",
      transport: { type: "stdio", command: "test-cmd" },
      tools: [{ name: "t1" }],
    }),
  );

  const manifest = await loadManifest(path);
  assertEquals(manifest.name, "test");
  assertEquals(manifest.tools[0].name, "t1");

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadManifests - loads directory of manifests", async () => {
  const tmpDir = await Deno.makeTempDir();
  await Deno.writeTextFile(
    `${tmpDir}/a.json`,
    JSON.stringify({
      name: "server-a",
      transport: { type: "stdio", command: "a" },
      tools: [{ name: "t1" }],
    }),
  );
  await Deno.writeTextFile(
    `${tmpDir}/b.json`,
    JSON.stringify({
      name: "server-b",
      transport: { type: "http", url: "http://localhost:4000" },
      tools: [{ name: "t2" }],
    }),
  );
  // Non-JSON file should be skipped
  await Deno.writeTextFile(`${tmpDir}/readme.txt`, "ignore me");

  const manifests = await loadManifests(tmpDir);
  assertEquals(manifests.size, 2);
  assertEquals(manifests.get("server-a")?.transport.type, "stdio");
  assertEquals(manifests.get("server-b")?.transport.type, "http");

  await Deno.remove(tmpDir, { recursive: true });
});
