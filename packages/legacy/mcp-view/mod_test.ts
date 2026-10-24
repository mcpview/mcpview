import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/view";
import * as aliasContracts from "./contracts.ts";
import * as targetContracts from "@mcpview/view/contracts";
import * as aliasReact from "./react.ts";
import * as targetReact from "@mcpview/view/react";
import * as aliasContext from "./context.ts";
import * as targetContext from "@mcpview/view/context";

Deno.test("@casys/mcp-view declares the sub-paths of @mcpview/view", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../view/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-view re-exports @mcpview/view", () => {
  assertModuleParity(".", alias, target);
});
Deno.test("@casys/mcp-view/contracts re-exports @mcpview/view/contracts", () => {
  assertModuleParity("./contracts", aliasContracts, targetContracts);
});
Deno.test("@casys/mcp-view/react re-exports @mcpview/view/react", () => {
  assertModuleParity("./react", aliasReact, targetReact);
});

Deno.test("@casys/mcp-view/context re-exports @mcpview/view/context", () => {
  assertModuleParity("./context", aliasContext, targetContext);
});
