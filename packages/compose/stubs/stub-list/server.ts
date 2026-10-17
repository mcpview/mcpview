/**
 * Stub MCP: Clickable item list.
 * Emits "item.selected" on click, accepts "filter.apply" to filter.
 * Requires STUB_API_KEY env var (tests the env var flow).
 *
 * @module stubs/stub-list
 */

import { McpApp } from "@casys/mcp-server";
import { buildStubHtml, MCP_APP_MIME_TYPE, startStubServer } from "../shared.ts";

// Env var check (tests the requiredEnv flow)
const apiKey = Deno.env.get("STUB_API_KEY");
if (!apiKey) {
  console.error("[stub-list] STUB_API_KEY is required");
  Deno.exit(1);
}

const ITEMS = [
  { id: "ITEM-001", name: "Alpha Widget", category: "widgets", price: 29.99 },
  { id: "ITEM-002", name: "Beta Gadget", category: "gadgets", price: 49.99 },
  { id: "ITEM-003", name: "Gamma Widget", category: "widgets", price: 19.99 },
  { id: "ITEM-004", name: "Delta Gadget", category: "gadgets", price: 99.99 },
  { id: "ITEM-005", name: "Epsilon Tool", category: "tools", price: 14.99 },
];

const server = new McpApp({
  name: "stub-list",
  version: "0.1.0",
  logger: (msg: string) => console.error(`[stub-list] ${msg}`),
});

server.registerTool(
  {
    name: "list_items",
    description: "List items with optional category filter",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string" } },
    },
    _meta: {
      ui: {
        resourceUri: "ui://stub-list/item-list",
        emits: ["item.selected"],
        accepts: ["filter.apply"],
      },
    },
  },
  (args) => {
    const category = (args as Record<string, unknown>).category as string | undefined;
    const filtered = category && category !== "all"
      ? ITEMS.filter((i) => i.category === category)
      : ITEMS;
    return { items: filtered, total: filtered.length };
  },
);

server.registerResource(
  {
    uri: "ui://stub-list/item-list",
    name: "Item List",
    description: "MCP App: clickable item list",
    mimeType: MCP_APP_MIME_TYPE,
  },
  () => ({
    uri: "ui://stub-list/item-list",
    mimeType: MCP_APP_MIME_TYPE,
    text: buildStubHtml(
      "Item List",
      `
      <h3>Items</h3>
      <ul id="list" style="list-style:none;"></ul>
    `,
      `
      var items = ${JSON.stringify(ITEMS)};
      var listEl = document.getElementById("list");
      var events = composeEvents();

      function render(data) {
        listEl.innerHTML = data.map(function(item) {
          return '<li data-id="' + item.id + '" style="padding:8px;border-bottom:1px solid #eee;cursor:pointer;">' +
            '<strong>' + item.name + '</strong> <span style="color:#888;">(' + item.category + ')</span>' +
            ' <span style="float:right;">' + item.price + ' EUR</span></li>';
        }).join("");

        listEl.querySelectorAll("li").forEach(function(li) {
          li.addEventListener("click", function() {
            var id = li.dataset.id;
            var item = data.find(function(i) { return i.id === id; });
            if (item) events.emit("item.selected", item);
            listEl.querySelectorAll("li").forEach(function(el) { el.style.background = ""; });
            li.style.background = "rgba(74,144,217,0.15)";
          });
        });
      }
      render(items);

      events.on("filter.apply", function(payload) {
        var d = payload.data || {};
        var filtered = items.filter(function(i) {
          if (d.category && d.category !== "all" && i.category !== d.category) return false;
          if (d.search && i.name.toLowerCase().indexOf(d.search.toLowerCase()) === -1) return false;
          return true;
        });
        render(filtered);
      });
    `,
    ),
  }),
);

await startStubServer(server, 3022);
