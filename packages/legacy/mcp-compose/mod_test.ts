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
import * as aliasCodeMode from "./code-mode.ts";
import * as targetCodeMode from "@mcpview/compose/code-mode";
import * as aliasBoard from "./code-mode-board.ts";
import * as targetBoard from "@mcpview/compose/code-mode/board";
import * as aliasLayout from "./code-mode-layout.ts";
import * as targetLayout from "@mcpview/compose/code-mode/layout";
import * as aliasLayoutRuns from "./code-mode-layout-runs.ts";
import * as targetLayoutRuns from "@mcpview/compose/code-mode/layout-runs";

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
Deno.test("@casys/mcp-compose/code-mode re-exports @mcpview/compose/code-mode", () => {
  assertModuleParity("./code-mode", aliasCodeMode, targetCodeMode);
});
Deno.test("@casys/mcp-compose/code-mode/board re-exports @mcpview/compose/code-mode/board", () => {
  assertModuleParity("./code-mode/board", aliasBoard, targetBoard);
});
Deno.test("@casys/mcp-compose/code-mode/layout re-exports @mcpview/compose/code-mode/layout", () => {
  assertModuleParity("./code-mode/layout", aliasLayout, targetLayout);
});
Deno.test("@casys/mcp-compose/code-mode/layout-runs re-exports @mcpview/compose/code-mode/layout-runs", () => {
  assertModuleParity("./code-mode/layout-runs", aliasLayoutRuns, targetLayoutRuns);
});
