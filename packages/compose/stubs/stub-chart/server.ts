/**
 * Stub MCP: Simple bar chart.
 * Accepts "data.update" to change displayed data.
 *
 * @module stubs/stub-chart
 */

import { McpApp } from "@casys/mcp-server";
import { buildStubHtml, MCP_APP_MIME_TYPE, startStubServer } from "../shared.ts";

const MOCK_DATA = [
  { label: "Jan", value: 30 },
  { label: "Feb", value: 45 },
  { label: "Mar", value: 28 },
  { label: "Apr", value: 60 },
  { label: "May", value: 52 },
];

const server = new McpApp({
  name: "stub-chart",
  version: "0.1.0",
  logger: (msg: string) => console.error(`[stub-chart] ${msg}`),
});

server.registerTool(
  {
    name: "render_chart",
    description: "Render a bar chart with mock data",
    inputSchema: { type: "object", properties: { metric: { type: "string" } } },
    _meta: {
      ui: {
        resourceUri: "ui://stub-chart/bar-chart",
        accepts: ["data.update"],
      },
    },
  },
  () => ({ data: MOCK_DATA }),
);

server.registerResource(
  {
    uri: "ui://stub-chart/bar-chart",
    name: "Bar Chart",
    description: "MCP App: bar chart",
    mimeType: MCP_APP_MIME_TYPE,
  },
  () => ({
    uri: "ui://stub-chart/bar-chart",
    mimeType: MCP_APP_MIME_TYPE,
    text: buildStubHtml(
      "Bar Chart",
      `
      <div data-component-surface>
        <section data-view-component="chart.series-summary">
          <h3>Series summary</h3>
          <strong id="summary">5 periods · peak 60</strong>
        </section>
        <section data-view-component="chart.selected-filter">
          <h3>Selection</h3>
          <p id="selection" style="color:#666;">Filter: all</p>
        </section>
        <section data-view-component="chart.bar-chart">
          <h3>Chart</h3>
          <div id="chart" style="display:flex;align-items:flex-end;gap:8px;height:200px;padding-top:16px;"></div>
        </section>
      </div>
    `,
      `
      var chartEl = document.getElementById("chart");
      var summaryEl = document.getElementById("summary");
      var selectionEl = document.getElementById("selection");
      var data = ${JSON.stringify(MOCK_DATA)};

      function render(d) {
        var max = Math.max.apply(null, d.map(function(x) { return x.value; }));
        summaryEl.textContent = d.length + " periods · peak " + max;
        chartEl.innerHTML = d.map(function(item) {
          var h = Math.round((item.value / max) * 180);
          return '<div style="flex:1;text-align:center;">' +
            '<div style="background:#4a90d9;height:' + h + 'px;border-radius:4px 4px 0 0;"></div>' +
            '<div style="font-size:12px;margin-top:4px;">' + item.label + '</div>' +
            '<div style="font-size:11px;color:#888;">' + item.value + '</div></div>';
        }).join("");
      }
      render(data);

      var events = composeEvents();
      connectComponentView({
        components: {
          "chart.series-summary": { title: "Series summary" },
          "chart.selected-filter": { title: "Selected filter" },
          "chart.bar-chart": { title: "Bar chart" }
        },
        defaultSurface: {
          layout: { type: "stack", gap: "sm" },
          components: [
            { id: "summary", component: "chart.series-summary" },
            { id: "selection", component: "chart.selected-filter" },
            { id: "chart", component: "chart.bar-chart" }
          ]
        }
      });
      events.on("data.update", function(payload) {
        if (payload.data) {
          var category = payload.data.category || "all";
          var search = payload.data.search ? ' · search "' + payload.data.search + '"' : "";
          selectionEl.textContent = "Filter: " + category + search;
        }
        if (payload.data && Array.isArray(payload.data.data)) {
          render(payload.data.data);
        }
      });
    `,
    ),
  }),
);

await startStubServer(server, 3021);
