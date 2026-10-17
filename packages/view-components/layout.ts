/**
 * Responsive viewer layout for `@mcpview/components` Apps.
 *
 * Import as `@mcpview/components/layout`. The decision
 * (`resolveViewerLayout`, `layoutWidth`, `touchInput`, `viewerBoundsStyle`) is
 * pure; the Preact hooks (`useViewerLayout`, `useContainerWidth`,
 * `useCoarsePointer`) measure the DOM but take the host context as a
 * parameter, so this entry loads no MCP Apps runtime.
 *
 * @module
 */

export * from "./src/layout/mod.ts";
