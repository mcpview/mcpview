/** Class for a standalone selected or partially selected visual item. */
export const CONTEXT_ROW_OUTLINE = "mcp-view-context-row-outline";

/** Opt-in outlines for adjacent selected rows and standalone pressed items. */
export const MCP_VIEW_CONTEXT_ROW_CSS: string = String.raw`
.${CONTEXT_ROW_OUTLINE}:is([aria-pressed="true"], [aria-pressed="mixed"]) {
  box-shadow: inset 0 0 0 2px var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
}

/* Only adjoining selected rows share edges. A visible detail or action rail
   after a row breaks the run before the next row. */
[data-mcp-view-context-row] {
  --mcp-view-context-row-top: 2px;
  --mcp-view-context-row-bottom: 2px;
  --mcp-view-context-row-seam: 0px;
}

[data-mcp-view-context-row="selected"]:not([data-mcp-view-context-row-break]):has(+ [data-mcp-view-context-row="selected"]) {
  --mcp-view-context-row-bottom: 0px;
  --mcp-view-context-row-seam: 1px;
}

[data-mcp-view-context-row="selected"]:not([data-mcp-view-context-row-break]) + [data-mcp-view-context-row="selected"] {
  --mcp-view-context-row-top: 0px;
}

[data-mcp-view-context-row="selected"] > [data-mcp-view-context-row-outline],
[data-mcp-view-context-row="selected"] > * > [data-mcp-view-context-row-outline] {
  position: relative;
  box-shadow:
    inset 2px 0 var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset -2px 0 var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset 0 var(--mcp-view-context-row-top) var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset 0 calc(-1 * var(--mcp-view-context-row-bottom)) var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
}

/* Collapsed table borders paint above the cells. Inset shadows on each
   cell join across the row while preserving the neutral border. */
tr[data-mcp-view-context-row="selected"] > td {
  --mcp-view-context-cell-left: 0px;
  --mcp-view-context-cell-right: 0px;
  box-shadow:
    inset var(--mcp-view-context-cell-left) 0 var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset calc(-1 * var(--mcp-view-context-cell-right)) 0 var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset 0 var(--mcp-view-context-row-top) var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight)),
    inset 0 calc(-1 * var(--mcp-view-context-row-bottom)) var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
}

tr[data-mcp-view-context-row="selected"] > td:first-child {
  --mcp-view-context-cell-left: 2px;
}

tr[data-mcp-view-context-row="selected"] > td:last-child {
  --mcp-view-context-cell-right: 2px;
}


/* Continue the side edges across the one-pixel neutral separator only. */
[data-mcp-view-context-row="selected"] > [data-mcp-view-context-row-outline]::after,
[data-mcp-view-context-row="selected"] > * > [data-mcp-view-context-row-outline]::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  inset-block-end: -1px;
  height: var(--mcp-view-context-row-seam);
  border-inline: 2px solid var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
  pointer-events: none;
}

tr[data-mcp-view-context-row="selected"] > td:is(:first-child, :last-child) {
  position: relative;
}

tr[data-mcp-view-context-row="selected"] > td:is(:first-child, :last-child)::after {
  content: "";
  position: absolute;
  inset-block-end: -1px;
  width: 2px;
  height: var(--mcp-view-context-row-seam);
  background: var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
  pointer-events: none;
}

tr[data-mcp-view-context-row="selected"] > td:first-child::after {
  inset-inline-start: 0;
}

tr[data-mcp-view-context-row="selected"] > td:last-child::after {
  inset-inline-end: 0;
}

tr[data-mcp-view-context-row="selected"] > td:only-child::after {
  width: auto;
  background: none;
  border-inline: 2px solid var(--mcp-view-context-row-accent, var(--mcp-view-accent, Highlight));
}
`;
