# Composed result board

Run these commands from this directory with Node.js 20+ and Bun installed.

```sh
npm ci
npm run build
npm test
```

The pilot server serves `dist/index.html` at `ui://multi-mcp-snippets/board`. The output embeds its
script and CSS. It renders the selected receipts from `_meta["io.mcpview/snippet-panels"]` of the
initial MCP Apps tool result.

Compose collects each selected receipt and arranges the resulting panels. The CAD panel reads the
verified GLB snapshot attached by the CAD provider and draws its triangles in a local canvas. Drag
or use the arrow keys to orbit. The print estimate reads the slicer's reported settings and
estimates. Compatible providers can use the same panels by returning their respective result shapes
and, for CAD, an attached GLB snapshot.

Drag the grip at the top left to preview a move. Drag the bottom-right corner to preview the 320,
380 or 640 px format. A skeleton reserves the new space while the neighboring viewer moves. Release
to apply the format or press Escape to cancel. Mesh measurements and print settings expand in the
widest format and can also be opened manually. Each viewer determines its own height.

The panels run in the same MCP Apps frame and do not issue additional tools or resource requests.
The board can also display the text summary for a selected receipt without a matching adapter.
