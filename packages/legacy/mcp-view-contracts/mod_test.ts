import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/contracts";

Deno.test("@casys/mcp-view-contracts declares the sub-paths of @mcpview/contracts", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../view-contracts/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-view-contracts re-exports @mcpview/contracts", () => {
  assertModuleParity(".", alias, target);
});
