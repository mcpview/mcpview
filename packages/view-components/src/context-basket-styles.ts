/** Optional plain CSS for the controlled context basket; uses the shared theme tokens. */
export const MCP_VIEW_CONTEXT_BASKET_CSS: string = String.raw`
.mcp-view-context-root {
  position: relative; display: inline-flex; min-width: 0; max-width: 100%;
  align-items: center; gap: .375rem; color: var(--mcp-view-muted);
  font-family: var(--mcp-view-font-body); font-size: var(--mcp-view-size-chip);
}
.mcp-view-context-single, .mcp-view-context-trigger {
  display: inline-flex; min-width: 0; align-items: center; gap: .25rem;
  border: 1px solid color-mix(in srgb, var(--mcp-view-accent) 30%, transparent);
  border-radius: var(--mcp-view-radius-control, 5px);
  background: color-mix(in srgb, var(--mcp-view-accent) 8%, transparent);
}
.mcp-view-context-single { padding: .125rem .125rem .125rem .5rem; }
.mcp-view-context-activeLabel, .mcp-view-context-trigger { color: var(--mcp-view-accent-text); }
.mcp-view-context-activeLabel, .mcp-view-context-chevron { flex-shrink: 0; }
.mcp-view-context-singleLabel, .mcp-view-context-itemLabel { color: var(--mcp-view-text); }
.mcp-view-context-singleLabel, .mcp-view-context-itemLabel, .mcp-view-context-itemDetail,
.mcp-view-context-eviction, .mcp-view-context-pendingLabel {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mcp-view-context-trigger, .mcp-view-context-remove, .mcp-view-context-clearAll,
.mcp-view-context-retry {
  font: inherit; cursor: pointer;
}
.mcp-view-context-trigger { padding: .25rem .5rem; }
.mcp-view-context-remove {
  display: grid; width: 1.5rem; height: 1.5rem; flex-shrink: 0; place-items: center;
  padding: 0; border: 0; border-radius: var(--mcp-view-radius-sm, 3px);
  background: transparent; color: var(--mcp-view-quiet); font-size: var(--mcp-view-size-body); line-height: 1;
}
.mcp-view-context-trigger:hover, .mcp-view-context-remove:hover {
  background: color-mix(in srgb, var(--mcp-view-accent) 12%, transparent);
}
.mcp-view-context-remove:hover { color: var(--mcp-view-text); }
.mcp-view-context-root button:focus-visible {
  outline: 2px solid var(--mcp-view-accent); outline-offset: 1px;
}
.mcp-view-context-popover {
  position: absolute; top: 100%; z-index: 30; margin-top: .375rem;
  width: 14rem; max-width: calc(100vw - 24px); padding: .375rem;
  border: 1px solid var(--mcp-view-border); border-radius: var(--mcp-view-radius, 8px);
  background: var(--mcp-view-panel);
}
.mcp-view-context-popover[data-align="start"] { left: 0; }
.mcp-view-context-popover[data-align="end"] { right: 0; }
.mcp-view-context-list { display: flex; max-height: 16rem; flex-direction: column; overflow-y: auto; }
.mcp-view-context-item {
  display: flex; min-width: 0; align-items: center; gap: .5rem;
  border-radius: var(--mcp-view-radius-sm, 3px); padding: .25rem .375rem;
}
.mcp-view-context-item:hover { background: var(--mcp-view-subtle); }
.mcp-view-context-itemContent { min-width: 0; flex: 1; }
.mcp-view-context-itemLabel, .mcp-view-context-itemDetail { display: block; }
.mcp-view-context-itemDetail, .mcp-view-context-clearAll, .mcp-view-context-eviction {
  font-size: var(--mcp-view-size-micro); color: var(--mcp-view-quiet);
}
.mcp-view-context-clearAll {
  width: 100%; margin-top: .25rem; padding: .375rem .375rem 0;
  border: 0; border-top: 1px solid var(--mcp-view-border-soft);
  background: transparent; text-align: left;
}
.mcp-view-context-clearAll:hover, .mcp-view-context-error { color: var(--mcp-view-danger); }
.mcp-view-context-pending, .mcp-view-context-error { display: inline-flex; align-items: center; gap: .25rem; }
.mcp-view-context-pending { min-width: 0; }
.mcp-view-context-error { flex-shrink: 0; }
.mcp-view-context-spinner { flex-shrink: 0; animation: mcp-view-context-spin 1s linear infinite; }
.mcp-view-context-eviction { max-width: 9rem; }
.mcp-view-context-root[data-compact] .mcp-view-context-singleLabel,
.mcp-view-context-root[data-compact] .mcp-view-context-eviction { max-width: 6rem; }
.mcp-view-context-root[data-compact] .mcp-view-context-activeLabel,
.mcp-view-context-errorLabel[data-hidden] {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.mcp-view-context-retry {
  border: 1px solid currentColor; border-radius: var(--mcp-view-radius-sm, 3px);
  padding: .125rem .375rem; background: transparent; color: inherit;
}
.mcp-view-context-root button:disabled { cursor: default; opacity: .55; }
@keyframes mcp-view-context-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mcp-view-context-spinner { animation: none; } }
`;

/**
 * Optional row/card selection treatment. Set data-context-state from
 * useActiveContext().selectionState(item); shared light/dark theme tokens apply.
 */
export const MCP_VIEW_CONTEXT_SELECTION_CSS: string = String.raw`
.mcp-view-context-selection {
  border: 1px solid var(--mcp-view-border); border-radius: var(--mcp-view-radius-control, 5px);
  background: var(--mcp-view-panel); color: var(--mcp-view-text);
}
.mcp-view-context-selection[data-context-state="selected"] {
  border-color: var(--mcp-view-accent);
  background: color-mix(in srgb, var(--mcp-view-accent) 12%, var(--mcp-view-panel));
  box-shadow: inset 3px 0 var(--mcp-view-accent);
}
.mcp-view-context-selection[data-context-state="adding"] {
  border-color: var(--mcp-view-accent); border-style: dashed;
  background: color-mix(in srgb, var(--mcp-view-accent) 12%, var(--mcp-view-panel));
  box-shadow: inset 3px 0 var(--mcp-view-accent);
}
.mcp-view-context-selection[data-context-state="removing"] {
  border-color: var(--mcp-view-quiet); border-style: dashed;
  background: var(--mcp-view-subtle); color: var(--mcp-view-muted);
}
.mcp-view-context-selection:focus-visible {
  outline: 2px solid var(--mcp-view-accent); outline-offset: 2px;
}
.mcp-view-context-selection-status {
  margin-inline-start: .5rem; font-size: var(--mcp-view-size-chip); color: var(--mcp-view-muted);
}
`;
