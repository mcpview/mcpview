import { MCP_VIEW_CONTEXT_ROW_CSS } from "./context-row-styles.ts";

/** Standalone styles for exploration and context controls. No global theme is required. */
export const MCP_VIEW_INTERACTION_CSS: string = String.raw`
.mcp-view-disclosure-row { display: flex; align-items: center; gap: .5rem; }
.mcp-view-disclosure-row > :first-child:not(.mcp-view-context-pin) { flex: 1; min-width: 0; }
.mcp-view-disclosure-row > .mcp-view-context-pin { margin-inline-start: auto; }
.mcp-view-context-pin {
  box-sizing: border-box; display: inline-grid; place-items: center; flex: none;
  width: 36px; height: 36px; min-width: 36px; min-height: 36px; padding: 0;
  border: 0; border-radius: var(--mcp-view-radius-control, 5px);
  background: transparent; color: var(--mcp-view-quiet, GrayText); cursor: pointer;
}
.mcp-view-context-pin:hover:not(:disabled) {
  background: var(--mcp-view-subtle, color-mix(in srgb, currentColor 8%, transparent));
}
.mcp-view-context-pin:focus-visible {
  outline: 2px solid var(--mcp-view-accent, Highlight); outline-offset: -2px;
}
.mcp-view-context-pin:disabled { opacity: .5; cursor: default; }
.mcp-view-context-pin-stroke {
  transform-box: fill-box; transform-origin: center; transform: rotate(30deg); stroke-width: 1.65;
}
.mcp-view-context-pin[aria-pressed="true"], .mcp-view-context-pin[aria-pressed="mixed"] {
  color: var(--mcp-view-accent-text, var(--mcp-view-accent, Highlight));
}
.mcp-view-context-pin[aria-pressed="true"] .mcp-view-context-pin-stroke,
.mcp-view-context-pin[aria-pressed="mixed"] .mcp-view-context-pin-stroke:first-child {
  transform: none; stroke-width: 2.5;
}
.mcp-view-context-pin[aria-pressed="mixed"] .mcp-view-context-pin-stroke:last-child {
  stroke-dasharray: 2 2.6;
}
.mcp-view-disclosure-chevron { display: inline-block; flex: none; }
.mcp-view-disclosure-chevron:dir(rtl) { transform: rotate(180deg); }
.mcp-view-disclosure-chevron[data-expanded="true"] { transform: rotate(90deg); }
@media (pointer: coarse) {
  .mcp-view-context-pin { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
}
@media (prefers-reduced-motion: no-preference) {
  .mcp-view-context-pin-stroke, .mcp-view-disclosure-chevron { transition: transform .18s; }
}
${MCP_VIEW_CONTEXT_ROW_CSS}
`;

/** Install only the interaction styles once in a standalone viewer's document. */
export function installMcpViewInteractionStyles(target: Document = document): HTMLStyleElement {
  const id = "mcp-view-interaction-styles";
  const existing = target.getElementById(id);
  if (existing) return existing as HTMLStyleElement;
  const style = target.createElement("style");
  style.id = id;
  style.textContent = MCP_VIEW_INTERACTION_CSS;
  target.head.append(style);
  return style;
}
