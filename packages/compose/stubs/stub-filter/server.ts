/**
 * Stub MCP: Filter controls panel.
 * Emits "filter.changed" when user changes filter values.
 *
 * @module stubs/stub-filter
 */

import { McpApp } from "@casys/mcp-server";
import { buildStubHtml, MCP_APP_MIME_TYPE, startStubServer } from "../shared.ts";

const CATEGORIES = ["all", "widgets", "gadgets", "tools"];

const server = new McpApp({
  name: "stub-filter",
  version: "0.1.0",
  logger: (msg: string) => console.error(`[stub-filter] ${msg}`),
});

server.registerTool(
  {
    name: "show_filters",
    description: "Show filter controls",
    inputSchema: { type: "object", properties: {} },
    _meta: {
      ui: {
        resourceUri: "ui://stub-filter/filter-panel",
        emits: ["filter.changed"],
      },
    },
  },
  () => ({ categories: CATEGORIES }),
);

server.registerResource(
  {
    uri: "ui://stub-filter/filter-panel",
    name: "Filter Panel",
    description: "MCP App: filter controls",
    mimeType: MCP_APP_MIME_TYPE,
  },
  () => ({
    uri: "ui://stub-filter/filter-panel",
    mimeType: MCP_APP_MIME_TYPE,
    text: buildStubHtml(
      "Filter Panel",
      `
      <div data-component-surface>
        <section data-view-component="filter.active-filter">
          <h3>Active filter</h3>
          <strong id="active-filter">all</strong>
        </section>
        <section data-view-component="filter.controls">
          <h3>Filters</h3>
          <label>Category</label>
          <select id="category">
            ${CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}
          </select>
          <br><br>
          <label>Search</label>
          <input id="search" type="text" placeholder="Search...">
        </section>
      </div>
    `,
      `
      var events = composeEvents();
      connectComponentView({
        components: {
          "filter.active-filter": { title: "Active filter" },
          "filter.controls": { title: "Filter controls" }
        },
        defaultSurface: {
          layout: { type: "stack", gap: "sm" },
          components: [
            { id: "active", component: "filter.active-filter" },
            { id: "controls", component: "filter.controls" }
          ]
        }
      });
      var cat = document.getElementById("category");
      var search = document.getElementById("search");
      var active = document.getElementById("active-filter");
      function emitFilter() {
        active.textContent = cat.value + (search.value ? ' · "' + search.value + '"' : "");
        events.emit("filter.changed", { category: cat.value, search: search.value });
      }
      cat.addEventListener("change", emitFilter);
      search.addEventListener("input", emitFilter);
    `,
    ),
  }),
);

await startStubServer(server, 3020);
