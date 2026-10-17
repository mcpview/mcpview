import { assertExportMapParity, assertModuleParity } from "../../../scripts/alias-parity.ts";
import * as alias from "./mod.ts";
import * as target from "@mcpview/components";
import * as aliasPreact from "./preact.ts";
import * as targetPreact from "@mcpview/components/preact";
import * as aliasPreactComponents from "./preact-components.ts";
import * as targetPreactComponents from "@mcpview/components/preact/components";
import * as aliasScaffold from "./scaffold.ts";
import * as targetScaffold from "@mcpview/components/scaffold";
import * as aliasSurface from "./surface.ts";
import * as targetSurface from "@mcpview/components/surface";
import * as aliasLayout from "./layout.ts";
import * as targetLayout from "@mcpview/components/layout";
import * as aliasFonts from "./fonts.ts";
import * as targetFonts from "@mcpview/components/fonts";

Deno.test("@casys/mcp-view-components declares the sub-paths of @mcpview/components", async () => {
  await assertExportMapParity(
    new URL("./deno.json", import.meta.url),
    new URL("../../view-components/deno.json", import.meta.url),
  );
});

Deno.test("@casys/mcp-view-components re-exports @mcpview/components", () => {
  assertModuleParity(".", alias, target);
});
Deno.test("@casys/mcp-view-components/preact re-exports @mcpview/components/preact", () => {
  assertModuleParity("./preact", aliasPreact, targetPreact);
});
Deno.test("@casys/mcp-view-components/preact/components re-exports @mcpview/components/preact/components", () => {
  assertModuleParity("./preact/components", aliasPreactComponents, targetPreactComponents);
});
Deno.test("@casys/mcp-view-components/scaffold re-exports @mcpview/components/scaffold", () => {
  assertModuleParity("./scaffold", aliasScaffold, targetScaffold);
});
Deno.test("@casys/mcp-view-components/surface re-exports @mcpview/components/surface", () => {
  assertModuleParity("./surface", aliasSurface, targetSurface);
});
Deno.test("@casys/mcp-view-components/layout re-exports @mcpview/components/layout", () => {
  assertModuleParity("./layout", aliasLayout, targetLayout);
});
Deno.test("@casys/mcp-view-components/fonts re-exports @mcpview/components/fonts", () => {
  assertModuleParity("./fonts", aliasFonts, targetFonts);
});
