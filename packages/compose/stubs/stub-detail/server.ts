/**
 * Stub MCP: Item detail view.
 * Accepts "item.show" to display an item's details.
 *
 * @module stubs/stub-detail
 */

import { McpApp } from "@casys/mcp-server";
import { buildStubHtml, MCP_APP_MIME_TYPE, startStubServer } from "../shared.ts";

const ITEMS: Record<
  string,
  { id: string; name: string; category: string; price: number; description: string }
> = {
  "ITEM-001": {
    id: "ITEM-001",
    name: "Alpha Widget",
    category: "widgets",
    price: 29.99,
    description: "A high-quality alpha widget for daily use.",
  },
  "ITEM-002": {
    id: "ITEM-002",
    name: "Beta Gadget",
    category: "gadgets",
    price: 49.99,
    description: "Advanced beta gadget with smart features.",
  },
  "ITEM-003": {
    id: "ITEM-003",
    name: "Gamma Widget",
    category: "widgets",
    price: 19.99,
    description: "Affordable gamma widget, great value.",
  },
  "ITEM-004": {
    id: "ITEM-004",
    name: "Delta Gadget",
    category: "gadgets",
    price: 99.99,
    description: "Premium delta gadget, top of the line.",
  },
  "ITEM-005": {
    id: "ITEM-005",
    name: "Epsilon Tool",
    category: "tools",
    price: 14.99,
    description: "Essential epsilon tool for professionals.",
  },
};

const server = new McpApp({
  name: "stub-detail",
  version: "0.1.0",
  logger: (msg: string) => console.error(`[stub-detail] ${msg}`),
});

server.registerTool(
  {
    name: "show_item",
    description: "Show details for an item",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string" } },
      required: ["itemId"],
    },
    _meta: {
      ui: {
        resourceUri: "ui://stub-detail/item-detail",
        accepts: ["item.show"],
      },
    },
  },
  (args) => {
    const itemId = (args as Record<string, unknown>).itemId as string;
    const item = ITEMS[itemId];
    if (!item) return { error: `Item ${itemId} not found` };
    return item;
  },
);

server.registerResource(
  {
    uri: "ui://stub-detail/item-detail",
    name: "Item Detail",
    description: "MCP App: item detail view",
    mimeType: MCP_APP_MIME_TYPE,
  },
  () => ({
    uri: "ui://stub-detail/item-detail",
    mimeType: MCP_APP_MIME_TYPE,
    text: buildStubHtml(
      "Item Detail",
      `
      <div id="detail">
        <p style="color:#888;">Select an item to view details.</p>
      </div>
    `,
      `
      var detailEl = document.getElementById("detail");
      var events = composeEvents();

      function render(item) {
        detailEl.innerHTML =
          '<h2>' + item.name + '</h2>' +
          '<p style="color:#888;">' + item.category + '</p>' +
          '<p style="font-size:24px;margin:12px 0;">' + item.price + ' EUR</p>' +
          '<p>' + item.description + '</p>' +
          '<p style="color:#aaa;margin-top:16px;font-size:12px;">ID: ' + item.id + '</p>';
      }

      events.on("item.show", function(payload) {
        if (payload.data) render(payload.data);
      });
    `,
    ),
  }),
);

await startStubServer(server, 3023);
