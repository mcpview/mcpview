import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/server";
import * as aliasSnippets from "./snippets.ts";
import * as targetSnippets from "@mcpview/server/snippets";

Deno.test("@casys/mcp-platform declares the sub-paths of @mcpview/server", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../server/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-platform re-exports @mcpview/server", () => {
  assertModuleParity(".", alias, target);
});

Deno.test("@casys/mcp-platform/snippets re-exports @mcpview/server/snippets", () => {
  assertModuleParity("./snippets", aliasSnippets, targetSnippets);
});
