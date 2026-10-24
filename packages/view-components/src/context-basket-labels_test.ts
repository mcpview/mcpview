import { assertEquals, assertStringIncludes } from "@std/assert";
import { contextBasketLabels, contextBasketMessages } from "./context-basket-labels.ts";
import { MCP_VIEW_CONTEXT_BASKET_CSS } from "./context-basket-styles.ts";

Deno.test("basket labels use existing translator locale hierarchy and preserve untrusted data as text", () => {
  assertEquals(contextBasketMessages.locale("fr-CA"), "fr");
  assertEquals(contextBasketLabels("fr-CA").retry, "Réessayer");
  assertEquals(contextBasketLabels("zh-TW").retry, "Retry");
  assertEquals(contextBasketLabels("not_a_locale").active, "Active context");
  assertEquals(
    contextBasketLabels("fr").remove("<script>{label}</script>"),
    "Retirer <script>{label}</script> du contexte",
  );
});

Deno.test("basket CSS uses shared light/dark theme tokens and respects reduced motion", () => {
  assertStringIncludes(MCP_VIEW_CONTEXT_BASKET_CSS, "var(--mcp-view-panel)");
  assertStringIncludes(MCP_VIEW_CONTEXT_BASKET_CSS, "var(--mcp-view-text)");
  assertStringIncludes(MCP_VIEW_CONTEXT_BASKET_CSS, "prefers-reduced-motion");
});
