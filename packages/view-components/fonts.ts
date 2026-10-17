/**
 * Embedded webfaces for the shared theme.
 *
 * Import as `@mcpview/components/fonts`. Opt-in and ~140 KB: a viewer
 * that must render identically inside a host iframe without network access
 * calls `installMcpViewFonts()` next to `installMcpViewTheme()`; one that can
 * rely on system faces leaves this entry out of its bundle.
 *
 * @module
 */

export {
  installMcpViewFonts,
  MCP_VIEW_FONT_FAMILIES,
  MCP_VIEW_FONTS_CSS,
  MCP_VIEW_FONTS_STYLE_ID,
  type McpViewFontFamily,
} from "./src/fonts.ts";
