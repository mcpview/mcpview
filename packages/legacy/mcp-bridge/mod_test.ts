import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/bridge";
import * as aliasAdaptersNetwork from "./adapters-network.ts";
import * as targetAdaptersNetwork from "@mcpview/bridge/adapters/network";

Deno.test("@casys/mcp-bridge declares the sub-paths of @mcpview/bridge", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../bridge/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-bridge re-exports @mcpview/bridge", () => {
  assertModuleParity(".", alias, target);
});
Deno.test("@casys/mcp-bridge/adapters/network re-exports @mcpview/bridge/adapters/network", () => {
  assertModuleParity("./adapters/network", aliasAdaptersNetwork, targetAdaptersNetwork);
});
