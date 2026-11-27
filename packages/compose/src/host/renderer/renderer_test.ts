/**
 * Tests for the renderer module.
 *
 * @module renderer/renderer_test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderComposite } from "./html-generator.ts";
import { buildCompositeUi } from "../../core/composer/composer.ts";
import type { CollectedUiResource } from "../../core/types/resources.ts";

// =============================================================================
// HTML Structure Tests
// =============================================================================

Deno.test("renderComposite - generates valid HTML5 structure", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "a", resourceUri: "ui://a", slot: 0 },
      { source: "b", resourceUri: "ui://b", slot: 1 },
    ],
    { layout: "split" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "<html>");
  assertStringIncludes(html, '<meta charset="UTF-8">');
  assertStringIncludes(html, "<title>mcp-compose</title>");
  assertStringIncludes(html, "<style>");
  assertStringIncludes(html, "</style>");
  assertStringIncludes(html, "<script>");
  assertStringIncludes(html, "</script>");
  assertStringIncludes(html, "</html>");
});

Deno.test("renderComposite - includes viewport meta tag", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, '<meta name="viewport"');
  assertStringIncludes(html, "width=device-width");
  assertStringIncludes(html, "initial-scale=1");
});

// =============================================================================
// Layout CSS Tests
// =============================================================================

Deno.test("renderComposite - includes container with layout class for all layouts", () => {
  const layouts = ["split", "tabs", "grid", "stack"] as const;

  for (const layout of layouts) {
    const descriptor = buildCompositeUi(
      [{ source: "test", resourceUri: "ui://test", slot: 0 }],
      { layout },
    );
    const html = renderComposite(descriptor);

    assertStringIncludes(html, `class="layout-${layout}"`);
  }
});

Deno.test("renderComposite - split layout puts mounted panels in adjustable columns", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "a", resourceUri: "ui://a", slot: 0 },
      { source: "b", resourceUri: "ui://b", slot: 1 },
    ],
    { layout: "split" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "grid-auto-flow: column");
  assertStringIncludes(html, '<button type="button" data-compose-grip aria-label="Move a">');
  assertStringIncludes(html, '<section class="compose-viewer" data-compose-panel');
  // The handle sits on the edge. The embedded viewer owns its visible header.
  assertEquals(html.includes("<header"), false);
});

Deno.test("renderComposite - grid layout has CSS grid", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "grid" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "display: grid");
  assertStringIncludes(html, "grid-template-columns");
  assertStringIncludes(html, "repeat(auto-fit, minmax(min(100%, 400px), 1fr))");
});

Deno.test("renderComposite exposes only the widths declared for that viewer", () => {
  const descriptor = buildCompositeUi([
    { source: "stock", resourceUri: "ui://stock", slot: 0, supportedWidths: [380, 640] },
    { source: "receipt", resourceUri: "ui://receipt", slot: 1 },
  ]);
  const sections = Array.from(
    renderComposite(descriptor).matchAll(/<section\b[^>]*>/g),
    (m) => m[0],
  );
  assertEquals(sections.length, 2);
  assertStringIncludes(sections[0], 'data-compose-widths="380 640"');
  assertEquals(sections[1].includes("data-compose-widths"), false);
});

Deno.test("renderComposite - stack rows accommodate each viewer's natural height", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "grid-auto-rows: minmax(auto, 1fr)");
  assertStringIncludes(html, "var(--compose-native-height, 200px)");
});

Deno.test("renderComposite - tabs layout has tab bar and active state", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "tab1", resourceUri: "ui://tab1", slot: 0 },
      { source: "tab2", resourceUri: "ui://tab2", slot: 1 },
    ],
    { layout: "tabs" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, ".tab-bar");
  assertStringIncludes(html, ".tab.active");
  assertStringIncludes(html, "switchTab");
  assertStringIncludes(html, 'class="tab active"');
  assertStringIncludes(html, 'class="tab"');
});

Deno.test("renderComposite - tabs layout handles empty resources", () => {
  const descriptor = buildCompositeUi([], { layout: "tabs" });

  const html = renderComposite(descriptor);

  assertStringIncludes(html, 'class="layout-tabs"');
  assertStringIncludes(html, "tab-bar");
  assertStringIncludes(html, "No UI components available");
  assertEquals(html.includes("<iframe"), false);
});

// =============================================================================
// Iframe Attributes Tests
// =============================================================================

Deno.test("renderComposite - iframes have required attributes", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "postgres:query", resourceUri: "ui://postgres/table/123", slot: 0 },
      { source: "viz:chart", resourceUri: "ui://viz/chart/456", slot: 1 },
    ],
    { layout: "split" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, 'id="ui-0"');
  assertStringIncludes(html, 'id="ui-1"');
  assertStringIncludes(html, 'data-slot="0"');
  assertStringIncludes(html, 'data-slot="1"');
  assertStringIncludes(html, 'data-source="postgres:query"');
  assertStringIncludes(html, 'data-source="viz:chart"');
  assertStringIncludes(html, 'src="ui://postgres/table/123"');
  assertStringIncludes(html, 'src="ui://viz/chart/456"');
});

Deno.test("renderComposite - handles empty resources array", () => {
  const descriptor = buildCompositeUi([], { layout: "stack" });

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, 'class="layout-stack"');
  assertEquals(html.includes('data-slot="0"'), false);
});

// =============================================================================
// Event Bus Tests
// =============================================================================

Deno.test("renderComposite - includes syncRules in script", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "a", resourceUri: "ui://a", slot: 0 },
      { source: "b", resourceUri: "ui://b", slot: 1 },
    ],
    {
      layout: "split",
      sync: [{ from: "a", event: "click", to: "b", action: "highlight" }],
    },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "const syncRules =");
  assertStringIncludes(html, '"from":0');
  assertStringIncludes(html, '"event":"click"');
  assertStringIncludes(html, '"to":1');
  assertStringIncludes(html, '"action":"highlight"');
});

Deno.test("renderComposite - event bus handles ui/initialize", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "ui/initialize");
  assertStringIncludes(html, "protocolVersion");
  assertStringIncludes(html, "2026-01-26");
  assertStringIncludes(html, "hostInfo");
  assertStringIncludes(html, "hostCapabilities");
  assertStringIncludes(html, "hostContext");
});

Deno.test("renderComposite - event bus routes ui/compose/event via sync rules", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  // Cross-UI sync remains compose-event-only. Initial tool-result delivery is
  // lifecycle hydration, not an alternative sync route.
  assertStringIncludes(html, "COMPOSE_METHOD");
  assertStringIncludes(html, "ui/compose/event");
  assertStringIncludes(html, "syncRules");
  assertStringIncludes(html, "sendComposeEvent");
});

Deno.test("renderComposite - event bus handles broadcast to='*'", () => {
  const descriptor = buildCompositeUi(
    [
      { source: "a", resourceUri: "ui://a", slot: 0 },
      { source: "b", resourceUri: "ui://b", slot: 1 },
    ],
    {
      layout: "split",
      sync: [{ from: "a", event: "change", to: "*", action: "refresh" }],
    },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, '"to":"*"');
  assertStringIncludes(html, "rule.to === '*'");
  assertStringIncludes(html, "filter(([slot]) => slot !== sourceSlot)");
});

Deno.test("renderComposite - event bus warns on malformed + unknown messages", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "console.warn");
  assertStringIncludes(html, "Malformed JSON-RPC");
  // ui/compose/event rejects missing event name with a warn
  assertStringIncludes(html, "ui/compose/event missing or invalid event name");
  // Any other method the event bus doesn't understand warns
  assertStringIncludes(html, "Unknown method");
});

// =============================================================================
// Theme / CSS Variables Tests
// =============================================================================

Deno.test("renderComposite - includes CSS variables for theming", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "tabs" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, "--mcc-border-color");
  assertStringIncludes(html, "--mcc-bg-secondary");
  assertStringIncludes(html, "--mcc-bg-primary");
  assertStringIncludes(html, "--mcc-accent-color");
  assertStringIncludes(html, "body.dark");
  assertStringIncludes(html, "prefers-color-scheme: dark");
});

// =============================================================================
// Shared Context Tests
// =============================================================================

Deno.test("renderComposite - includes sharedContext in event bus", () => {
  const resources: CollectedUiResource[] = [
    { source: "a", resourceUri: "ui://a", slot: 0, context: { workflowId: "wf-test" } },
  ];

  const descriptor = buildCompositeUi(resources, {
    layout: "stack",
    sharedContext: ["workflowId"],
  });
  const html = renderComposite(descriptor);

  assertStringIncludes(html, "const sharedContext =");
  assertStringIncludes(html, '"workflowId":"wf-test"');
});

Deno.test("renderComposite - forwards sharedContext in compose events", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    {
      layout: "stack",
      sync: [{ from: "a", event: "test", to: "*", action: "update" }],
    },
  );

  const html = renderComposite(descriptor);

  // sharedContext is embedded in the ui/compose/event payload forwarded
  // to targets via sendComposeEvent (not in a legacy sendToolResult).
  assertStringIncludes(html, "sharedContext");
  assertStringIncludes(html, "sendComposeEvent");
});

// =============================================================================
// XSS Protection Tests
// =============================================================================

Deno.test("renderComposite - escapes HTML in source names", () => {
  const descriptor = buildCompositeUi(
    [{ source: '<script>alert("xss")</script>', resourceUri: "ui://test", slot: 0 }],
    { layout: "tabs" },
  );

  const html = renderComposite(descriptor);

  assertEquals(html.includes('<script>alert("xss")</script>'), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

// =============================================================================
// Interactive Host Bridge Options
// =============================================================================

Deno.test("renderComposite - preserves legacy iframe output when no host bridge is configured", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor);

  assertStringIncludes(html, 'src="ui://a"');
  assertEquals(html.includes("sandbox="), false);
  assertEquals(html.includes('"serverTools":true'), false);
  assertEquals(html.includes('"serverResources":true'), false);
});

Deno.test("renderComposite - renders an opt-in local slot bridge with a safe sandbox", () => {
  const descriptor = buildCompositeUi(
    [{ source: "console_snapshot", resourceUri: "ui://console/snapshot", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor, {
    slots: {
      0: {
        iframeSrc: "/ui/0",
        expectedOrigin: "http://127.0.0.1:49152",
        capabilities: { serverTools: true, serverResources: true },
        initialToolResult: { structuredContent: { runId: "run-1" } },
      },
    },
  });

  assertStringIncludes(html, 'src="/ui/0"');
  assertStringIncludes(html, 'sandbox="allow-scripts allow-same-origin"');
  assertStringIncludes(html, 'expectedOrigin":"http://127.0.0.1:49152"');
  assertStringIncludes(html, 'rpcEndpoint":"/api/slots/0/mcp"');
  assertStringIncludes(html, '"serverTools":true');
  assertStringIncludes(html, '"serverResources":true');
  assertStringIncludes(html, '"hasInitialToolResult":true');
});

Deno.test("renderComposite - permits explicit sandbox overrides per host or slot", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const noSandbox = renderComposite(descriptor, {
    iframeSandbox: false,
    slots: { 0: { iframeSrc: "/ui/0" } },
  });
  const trustedSandbox = renderComposite(descriptor, {
    slots: { 0: { iframeSrc: "/ui/0", sandbox: "allow-scripts allow-same-origin" } },
  });

  assertEquals(noSandbox.includes("sandbox="), false);
  assertStringIncludes(trustedSandbox, 'sandbox="allow-scripts allow-same-origin"');
});

Deno.test("renderComposite - canonicalizes an expected child origin and rejects opaque origins", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );

  const html = renderComposite(descriptor, {
    slots: { 0: { expectedOrigin: "https://child.example.test/path?ignored=yes" } },
  });
  assertStringIncludes(html, 'expectedOrigin":"https://child.example.test"');

  let error: unknown;
  try {
    renderComposite(descriptor, { slots: { 0: { expectedOrigin: "file:///tmp/app.html" } } });
  } catch (cause) {
    error = cause;
  }
  assertEquals(error instanceof TypeError, true);
});

Deno.test("renderComposite - escapes injected tool result JSON before embedding it in a script", () => {
  const descriptor = buildCompositeUi(
    [{ source: "a", resourceUri: "ui://a", slot: 0 }],
    { layout: "stack" },
  );
  const payload = "</script><script>globalThis.pwned = true</script>";

  const html = renderComposite(descriptor, {
    slots: { 0: { initialToolResult: { content: [{ type: "text", text: payload }] } } },
  });

  assertEquals(html.includes(payload), false);
  assertStringIncludes(html, "\\u003c/script\\u003e\\u003cscript\\u003e");
});
