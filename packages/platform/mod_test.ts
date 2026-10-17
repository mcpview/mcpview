import { assert, assertEquals } from "@std/assert";
import * as framework from "@casys/mcp-server";
import * as alias from "./mod.ts";

Deno.test("@casys/mcp-platform re-exports the framework", () => {
  assertEquals(typeof alias.McpApp, "function");
  // Parity: the deprecated alias must expose exactly the framework's API —
  // no dropped or added names. (export * skips only `default`, which the
  // framework does not define.)
  const aliasKeys = Object.keys(alias).sort();
  assert(aliasKeys.length > 0);
  assertEquals(aliasKeys, Object.keys(framework).sort());
});
