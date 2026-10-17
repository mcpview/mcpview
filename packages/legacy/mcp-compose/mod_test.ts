import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/compose";
import * as aliasCore from "./core.ts";
import * as targetCore from "@mcpview/compose/core";
import * as aliasSdk from "./sdk.ts";
import * as targetSdk from "@mcpview/compose/sdk";
import * as aliasHost from "./host.ts";
import * as targetHost from "@mcpview/compose/host";
import * as aliasRuntime from "./runtime.ts";
import * as targetRuntime from "@mcpview/compose/runtime";
import * as aliasDeploy from "./deploy.ts";
import * as targetDeploy from "@mcpview/compose/deploy";

Deno.test("@casys/mcp-compose declares the sub-paths of @mcpview/compose", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../compose/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-compose re-exports @mcpview/compose", () => {
  assertModuleParity(".", alias, target);
});
Deno.test("@casys/mcp-compose/core re-exports @mcpview/compose/core", () => {
  assertModuleParity("./core", aliasCore, targetCore);
});
Deno.test("@casys/mcp-compose/sdk re-exports @mcpview/compose/sdk", () => {
  assertModuleParity("./sdk", aliasSdk, targetSdk);
});
Deno.test("@casys/mcp-compose/host re-exports @mcpview/compose/host", () => {
  assertModuleParity("./host", aliasHost, targetHost);
});
Deno.test("@casys/mcp-compose/runtime re-exports @mcpview/compose/runtime", () => {
  assertModuleParity("./runtime", aliasRuntime, targetRuntime);
});
Deno.test("@casys/mcp-compose/deploy re-exports @mcpview/compose/deploy", () => {
  assertModuleParity("./deploy", aliasDeploy, targetDeploy);
});
