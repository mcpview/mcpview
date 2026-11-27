/**
 * End-to-end compose tests — full pipeline from manifests + templates to HTML.
 *
 * Starts real stub servers, calls tools, composes dashboard.
 * Requires --allow-run --allow-net --allow-read --allow-env.
 *
 * @module stubs/tests/compose_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseManifest } from "../../src/runtime/manifest.ts";
import { loadTemplate } from "../../src/runtime/template.ts";
import { composeDashboard } from "../../src/runtime/compose.ts";
import type { McpManifest } from "../../src/runtime/types.ts";

const STUBS_DIR = new URL("../", import.meta.url).pathname;
const PROJECT_ROOT = new URL("../../", import.meta.url).pathname;

const TEST_OPTS = { sanitizeOps: false, sanitizeResources: false };

/** Load all stub manifests with absolute paths and env vars. */
async function loadAllManifests(): Promise<Map<string, McpManifest>> {
  const map = new Map<string, McpManifest>();
  for (const name of ["stub-list", "stub-detail", "stub-chart", "stub-filter"]) {
    const json = await Deno.readTextFile(`${STUBS_DIR}${name}/manifest.json`);
    const manifest = parseManifest(json);
    if (manifest.transport.type === "stdio") {
      manifest.transport.args = manifest.transport.args?.map((a) =>
        a.startsWith("stubs/") ? `${PROJECT_ROOT}${a}` : a
      );
      if (name === "stub-list") {
        manifest.transport.env = { STUB_API_KEY: "test-key" };
      }
    }
    map.set(manifest.name, manifest);
  }
  return map;
}

Deno.test({
  name: "compose e2e - filter-chart dashboard",
  ...TEST_OPTS,
  fn: async () => {
    const manifests = await loadAllManifests();
    const template = await loadTemplate(`${STUBS_DIR}templates/filter-chart.yaml`);
    manifests.get("stub-chart")!.tools[0].supportedWidths = [380, 760];

    const result = await composeDashboard({ template, manifests });

    assertEquals(result.descriptor.layout, "split");
    assertEquals(result.descriptor.children.length, 2);
    assertEquals(result.descriptor.children.map((child) => child.supportedWidths), [
      undefined,
      [380, 760],
    ]);
    assertEquals(result.descriptor.sync.length, 1);
    assertEquals(
      result.descriptor.children.map((child) => [child.componentId, child.slot]),
      [["filters", 0], ["chart", 1]],
    );
    assertEquals(result.descriptor.sync[0], {
      from: 0,
      event: "filter.changed",
      to: 1,
      action: "data.update",
    });

    assertStringIncludes(result.html, "<!DOCTYPE html>");
    assertStringIncludes(result.html, "layout-split");

    for (const child of result.descriptor.children) {
      assertEquals(
        child.resourceUri.startsWith("ui://"),
        false,
        `resourceUri should be resolved: ${child.resourceUri}`,
      );
      assertStringIncludes(child.resourceUri, "http://");
    }

    assertEquals(result.warnings.length, 0, `Warnings: ${result.warnings.join("; ")}`);
  },
});

Deno.test({
  name: "compose e2e - master-detail dashboard",
  ...TEST_OPTS,
  fn: async () => {
    const manifests = await loadAllManifests();
    const template = await loadTemplate(`${STUBS_DIR}templates/master-detail.yaml`);

    const result = await composeDashboard({ template, manifests });

    assertEquals(result.descriptor.layout, "split");
    assertEquals(result.descriptor.children.length, 2);
    assertEquals(result.descriptor.sync.length, 1);

    const syncRule = result.descriptor.sync[0];
    assertEquals(syncRule.event, "item.selected");
    assertEquals(syncRule.action, "item.show");
    assertEquals(typeof syncRule.from, "number");
    assertEquals(typeof syncRule.to, "number");
  },
});

Deno.test({
  name: "compose e2e - full dashboard (4 stubs, grid, 3 sync)",
  ...TEST_OPTS,
  fn: async () => {
    const manifests = await loadAllManifests();
    const template = await loadTemplate(`${STUBS_DIR}templates/full-dashboard.yaml`);

    const result = await composeDashboard({ template, manifests });

    assertEquals(typeof result.descriptor.layout, "object"); // areas layout
    assertEquals(result.descriptor.children.length, 4);
    assertEquals(result.descriptor.sync.length, 3);

    for (const child of result.descriptor.children) {
      assertStringIncludes(child.resourceUri, "http://");
    }

    assertStringIncludes(result.html, "layout-areas");
    assertStringIncludes(result.html, "syncRules");
    assertStringIncludes(result.html, "COMPOSE_METHOD");
  },
});
