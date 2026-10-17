import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/server";

Deno.test("@casys/mcp-platform declares the sub-paths of @mcpview/server", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../server/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-platform re-exports @mcpview/server", () => {
  assertModuleParity(".", alias, target);
});
