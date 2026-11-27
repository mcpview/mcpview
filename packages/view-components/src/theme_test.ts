import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertStringIncludes,
} from "@std/assert";
import { MCP_VIEW_CONTEXT_ROW_CSS } from "./context-row-styles.ts";

import {
  installMcpViewTheme,
  MCP_VIEW_THEME_CSS,
  MCP_VIEW_THEME_STYLE_ID,
  MCP_VIEW_THEME_TOKENS,
  type McpViewThemeDocument,
} from "./theme.ts";

Deno.test("shared theme exposes the MCP View v2 component vocabulary", () => {
  for (
    const className of [
      ".mcp-view-card",
      ".mcp-view-card-title",
      ".mcp-view-metrics",
      ".mcp-view-table",
      ".mcp-view-cross-selection",
      ".mcp-view-key-values",
      ".mcp-view-button",
      ".mcp-view-state",
      ".mcp-view-state-busy",
      ".mcp-view-inline-code",
      ".mcp-view-path-bar",
      ".mcp-view-limit-gauge",
      ".mcp-view-artifact-row",
      ".mcp-view-semantic-element",
      ".mcp-view-element-section",
      '.mcp-view-key-values[data-layout="facts"]',
      ".mcp-view-collection-card",
      ".mcp-view-focused-view",
      ".mcp-view-disclosure-summary:focus-visible",
      ".mcp-view-collection-card > .mcp-view-card-header",
      ".mcp-view-collection-card > .mcp-view-semantic-list",
      '[data-density="chip"]',
      '[data-density="row"]',
      '[data-density="card"]',
      ":focus-visible",
      '[data-tone="danger"]',
      ".mcp-view-drill-hint",
      ".mcp-view-type-badge",
      ".mcp-view-stale-banner",
      ".mcp-view-slot-3d",
      ".mcp-view-tree-list",
      ".mcp-view-sparkline",
      ".mcp-view-series-chart",
      ".mcp-view-interval-plot",
      ".mcp-view-skeleton",
      ".mcp-view-path-bar-collapsed",
      ".mcp-view-notice-group",
    ]
  ) {
    assertStringIncludes(MCP_VIEW_THEME_CSS, className);
  }
});

Deno.test("shared theme exposes offline heading body and mono typography roles", () => {
  assertEquals(MCP_VIEW_THEME_TOKENS.fontHeading, "--mcp-view-font-heading");
  assertEquals(MCP_VIEW_THEME_TOKENS.fontBody, "--mcp-view-font-body");
  assertEquals(MCP_VIEW_THEME_TOKENS.fontMono, "--mcp-view-font-mono");

  assertStringIncludes(MCP_VIEW_THEME_CSS, "--mcp-view-font-heading: var(");
  assertStringIncludes(MCP_VIEW_THEME_CSS, '"Space Grotesk"');
  assertStringIncludes(MCP_VIEW_THEME_CSS, '"Avenir Next"');
  assertStringIncludes(MCP_VIEW_THEME_CSS, "--mcp-view-font-body: var(");
  assertStringIncludes(MCP_VIEW_THEME_CSS, '"Work Sans"');
  assertStringIncludes(MCP_VIEW_THEME_CSS, "--font-sans,");
  assertStringIncludes(MCP_VIEW_THEME_CSS, "--mcp-view-font-mono: var(");
  assertStringIncludes(MCP_VIEW_THEME_CSS, '"JetBrains Mono"');
  assertStringIncludes(MCP_VIEW_THEME_CSS, '"SFMono-Regular"');
  assertStringIncludes(MCP_VIEW_THEME_CSS, "font-family: var(--mcp-view-font-body);");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-card-title,");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-element-reading-value,");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-element-limit {");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-element-limit-operator {");
  assertStringIncludes(
    MCP_VIEW_THEME_CSS,
    '.mcp-view-semantic-element[data-density="row"] .mcp-view-element-limit,',
  );
  assertStringIncludes(MCP_VIEW_THEME_CSS, "font-family: var(--mcp-view-font-heading);");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-element-provenance {");
  assertStringIncludes(MCP_VIEW_THEME_CSS, "font-family: var(--mcp-view-font-mono);");
  assertEquals(
    MCP_VIEW_THEME_CSS.indexOf("Type is role-based") >
      MCP_VIEW_THEME_CSS.indexOf(".mcp-view-button {"),
    true,
  );

  // The mono face carries the datasheet roles: labels, keys, units, markers,
  // verdicts, provenance and identifiers a reader compares character by
  // character. Titles, values and prose stay in the heading or body face. Every
  // rule block is scanned, so a mono face smuggled back through a
  // component-local rule fails the same way as one added to the role layer.
  const blocks = [...MCP_VIEW_THEME_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const monoSelectors = blocks
    .filter(([, , declarations]) =>
      declarations.includes("font-family: var(--mcp-view-font-mono);")
    )
    .flatMap(([, selectors]) => selectors.split(",").map((s) => s.trim()).filter(Boolean));
  assertEquals(monoSelectors, [
    ".mcp-view-code-block",
    ".mcp-view-inline-code",
    ".mcp-view-path-bar-item + .mcp-view-path-bar-item::before",
    ".mcp-view-card-eyebrow",
    ".mcp-view-metric-label",
    ".mcp-view-metric-unit",
    ".mcp-view-badge",
    ".mcp-view-table th",
    ".mcp-view-notice-group-label",
    ".mcp-view-key-value dt",
    ".mcp-view-element-section-title",
    ".mcp-view-element-ident-marker",
    ".mcp-view-element-reading-label",
    ".mcp-view-element-reading-unit",
    ".mcp-view-element-limit-label",
    ".mcp-view-element-limit-operator",
    ".mcp-view-element-limit-unit",
    ".mcp-view-element-verdict-label",
    ".mcp-view-element-verdict-value",
    ".mcp-view-element-provenance",
    '.mcp-view-semantic-element[data-density="row"] .mcp-view-element-reading-value',
    '.mcp-view-semantic-element[data-density="row"] .mcp-view-element-limit-value',
    ".mcp-view-series-chart-summary-label",
    ".mcp-view-series-chart-readout-value dd",
    ".mcp-view-artifact-row-uri",
    ".mcp-view-artifact-row-fingerprint",
    ".mcp-view-artifact-row-fingerprint code",
  ]);
  const roleLayer = MCP_VIEW_THEME_CSS.slice(MCP_VIEW_THEME_CSS.indexOf("Type is role-based"));
  assertStringIncludes(roleLayer, ".mcp-view-key-value dd,\n");
  assertStringIncludes(roleLayer, "font-variant-numeric: tabular-nums;");

  // Type reads from the px scale only, so a host that rescales rem cannot
  // squash the datasheet; InlineCode scales with its parent but is floored.
  const sizes = blocks.flatMap(([, , declarations]) =>
    [...declarations.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1])
  );
  assert(sizes.length > 0);
  for (const size of sizes) {
    if (size === "max(10px, 0.92em)") continue;
    assert(
      /^var\(--mcp-view-size-[a-z-]+\)$/.test(size),
      `font-size ${size} bypasses the --mcp-view-size-* scale`,
    );
  }
  const scale = [...MCP_VIEW_THEME_CSS.matchAll(/--mcp-view-size-([a-z-]+):\s*([^;]+);/g)];
  assertEquals(
    scale.map(([, name]) => name),
    [
      "micro",
      "chip",
      "meta",
      "note",
      "data",
      "cell",
      "body",
      "lede",
      "card-title",
      "total",
      "title",
      "metric",
    ],
  );
  for (const [, name, value] of scale) {
    const px = value.match(/^(\d*\.?\d+)px$/);
    assert(px && Number(px[1]) >= 10, `--mcp-view-size-${name}: ${value} is below the 10px floor`);
  }
  for (const [, name] of scale) {
    assertEquals(
      MCP_VIEW_THEME_TOKENS[camel(`size-${name}`) as keyof typeof MCP_VIEW_THEME_TOKENS],
      `--mcp-view-size-${name}`,
    );
  }

  assertFalse(/@import\b/i.test(MCP_VIEW_THEME_CSS));
  assertFalse(/@font-face\b/i.test(MCP_VIEW_THEME_CSS));
  assertFalse(/url\s*\(/i.test(MCP_VIEW_THEME_CSS));

  assertFalse(MCP_VIEW_THEME_CSS.includes("font-family: Inter"));

  // Row outlines use inset shadows to preserve collapsed table borders.
  assertFalse(MCP_VIEW_THEME_CSS.replace(MCP_VIEW_CONTEXT_ROW_CSS, "").includes("box-shadow:"));
  assertFalse(MCP_VIEW_THEME_CSS.includes("0 8px 28px"));

  const badgeStart = MCP_VIEW_THEME_CSS.indexOf(".mcp-view-badge {");
  const badgeEnd = MCP_VIEW_THEME_CSS.indexOf("}", badgeStart);
  const neutralBadge = MCP_VIEW_THEME_CSS.slice(badgeStart, badgeEnd);
  assertStringIncludes(neutralBadge, "var(--mcp-view-muted)");
  assertFalse(neutralBadge.includes("var(--mcp-view-success)"));
  assertFalse(MCP_VIEW_THEME_CSS.includes(".mcp-view-badge:not([data-tone])"));
  assertStringIncludes(MCP_VIEW_THEME_CSS, '.mcp-view-badge[data-tone="success"]');
});

Deno.test("the surface frames the viewer once and stacks its components with hairlines", () => {
  const shellStart = MCP_VIEW_THEME_CSS.indexOf(".mcp-view-surface {");
  const shell = MCP_VIEW_THEME_CSS.slice(shellStart, MCP_VIEW_THEME_CSS.indexOf("}", shellStart));
  assertStringIncludes(shell, "border: 1px solid var(--mcp-view-border);");
  assertStringIncludes(shell, "border-radius: var(--mcp-view-radius);");
  assertStringIncludes(shell, "background: var(--mcp-view-panel);");

  const ruleStart = MCP_VIEW_THEME_CSS.indexOf(".mcp-view-surface::before {");
  const rule = MCP_VIEW_THEME_CSS.slice(ruleStart, MCP_VIEW_THEME_CSS.indexOf("}", ruleStart));
  assertStringIncludes(rule, "height: 2px;");
  assertStringIncludes(rule, "var(--mcp-view-accent), var(--mcp-view-brand)");

  assertStringIncludes(
    MCP_VIEW_THEME_CSS,
    ".mcp-view-surface-stack > .mcp-view-component + .mcp-view-component {\n" +
      "  border-top: 1px solid var(--mcp-view-border);",
  );
  assertStringIncludes(
    MCP_VIEW_THEME_CSS,
    ".mcp-view-surface-row > .mcp-view-component + .mcp-view-component {\n" +
      "  border-inline-start: 1px solid var(--mcp-view-border);",
  );

  // A card or card-density element mounted directly under the surface drops
  // its own frame: the surface is the only border a viewer shows.
  const flatStart = MCP_VIEW_THEME_CSS.indexOf(
    ".mcp-view-surface > .mcp-view-component > .mcp-view-card,",
  );
  const flat = MCP_VIEW_THEME_CSS.slice(flatStart, MCP_VIEW_THEME_CSS.indexOf("}", flatStart));
  assertStringIncludes(
    flat,
    '.mcp-view-surface > .mcp-view-component > .mcp-view-semantic-element[data-density="card"]',
  );
  assertStringIncludes(flat, "border: 0;");
  assertStringIncludes(flat, "border-radius: 0;");

  // Card density lays readings out as a hairline strip; chip and row keep them inline.
  assertStringIncludes(MCP_VIEW_THEME_CSS, ".mcp-view-element-readings { display: contents; }");
  const stripStart = MCP_VIEW_THEME_CSS.indexOf(
    '.mcp-view-semantic-element[data-density="card"] .mcp-view-element-readings {',
  );
  const strip = MCP_VIEW_THEME_CSS.slice(stripStart, MCP_VIEW_THEME_CSS.indexOf("}", stripStart));
  assertStringIncludes(strip, "display: flex;");
  assertStringIncludes(strip, "flex-wrap: wrap;");
  assertStringIncludes(strip, "gap: 1px;");
  assertStringIncludes(strip, "overflow: hidden;");
  assertStringIncludes(strip, "flex: 1 0 100%;");
  // A short last row widens its tiles rather than leaving hairline-coloured holes.
  const tileStart = MCP_VIEW_THEME_CSS.indexOf(
    '.mcp-view-semantic-element[data-density="card"] .mcp-view-element-reading,',
  );
  const tile = MCP_VIEW_THEME_CSS.slice(tileStart, MCP_VIEW_THEME_CSS.indexOf("}", tileStart));
  assertStringIncludes(tile, "flex: 1 1 9rem;");
  // In a narrow container every tile takes its own row, as the old single column did.
  const narrowStart = MCP_VIEW_THEME_CSS.indexOf(
    '.mcp-view-semantic-element[data-density="card"] .mcp-view-element-reading,',
    tileStart + 1,
  );
  const narrow = MCP_VIEW_THEME_CSS.slice(
    narrowStart,
    MCP_VIEW_THEME_CSS.indexOf("}", narrowStart),
  );
  assertStringIncludes(narrow, "flex-basis: 100%;");
});

Deno.test("collection card keeps one outer border by flattening the nested list", () => {
  const cardStart = MCP_VIEW_THEME_CSS.indexOf(".mcp-view-collection-card {");
  const cardEnd = MCP_VIEW_THEME_CSS.indexOf("}", cardStart);
  const collectionCard = MCP_VIEW_THEME_CSS.slice(cardStart, cardEnd);
  assertStringIncludes(collectionCard, "padding: 0;");
  assertStringIncludes(collectionCard, "overflow: hidden;");
  assertFalse(collectionCard.includes("box-shadow"));

  const headerStart = MCP_VIEW_THEME_CSS.indexOf(
    ".mcp-view-collection-card > .mcp-view-card-header {",
  );
  const headerEnd = MCP_VIEW_THEME_CSS.indexOf("}", headerStart);
  const header = MCP_VIEW_THEME_CSS.slice(headerStart, headerEnd);
  assertStringIncludes(header, "border-bottom: 1px solid var(--mcp-view-border);");
  assertStringIncludes(header, "padding:");

  const listStart = MCP_VIEW_THEME_CSS.indexOf(
    ".mcp-view-collection-card > .mcp-view-semantic-list {",
  );
  const listEnd = MCP_VIEW_THEME_CSS.indexOf("}", listStart);
  const nestedList = MCP_VIEW_THEME_CSS.slice(listStart, listEnd);
  assertStringIncludes(nestedList, "border: 0;");
  assertStringIncludes(nestedList, "border-radius: 0;");
});

Deno.test("shared theme has readable explicit light and dark fallbacks", () => {
  assertStringIncludes(MCP_VIEW_THEME_CSS, "--mcp-view-text: var(--color-text-primary, #101519);");
  assertStringIncludes(
    MCP_VIEW_THEME_CSS,
    "--mcp-view-panel: var(--color-background-primary, #ffffff);",
  );
  assertEquals(MCP_VIEW_THEME_TOKENS.accent, "--mcp-view-accent");
  assertEquals(MCP_VIEW_THEME_TOKENS.brand, "--mcp-view-brand");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ':root[data-theme="dark"]');
  assertStringIncludes(MCP_VIEW_THEME_CSS, "--mcp-view-text: var(--color-text-primary, #e6ecf0);");
  assertStringIncludes(MCP_VIEW_THEME_CSS, ':root:not([data-theme="light"])');
});

Deno.test("installMcpViewTheme is idempotent", () => {
  let existing: HTMLStyleElement | null = null;
  let appends = 0;
  const target = {
    getElementById(id: string) {
      return id === MCP_VIEW_THEME_STYLE_ID ? existing : null;
    },
    createElement() {
      return { id: "", textContent: "" } as HTMLStyleElement;
    },
    head: {
      append(node: HTMLStyleElement) {
        appends += 1;
        existing = node;
      },
    },
  } as McpViewThemeDocument;

  const first = installMcpViewTheme(target);
  const second = installMcpViewTheme(target);

  assertStrictEquals(first, second);
  assertEquals(appends, 1);
  assertEquals(first.id, MCP_VIEW_THEME_STYLE_ID);
  assertEquals(first.textContent, MCP_VIEW_THEME_CSS);
});

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
