/**
 * Shared utilities for stub MCP servers.
 *
 * @module stubs/shared
 */

import type { McpApp } from "@casys/mcp-server";

/** MCP Apps MIME type for HTML UI resources. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

/**
 * Browser-compatible composeEvents() function, inlined into stub HTML UIs.
 * This is a minified version of src/sdk/compose-events.ts that runs in iframes.
 */
export const COMPOSE_EVENTS_JS = `
function composeEvents() {
  var METHOD = "ui/compose/event";
  var handlers = new Map();
  var nextId = 1;
  var onMessage = function(e) {
    var msg = e.data;
    if (!msg || typeof msg !== "object") return;
    if (msg.jsonrpc !== "2.0" || msg.method !== METHOD) return;
    var p = msg.params;
    if (!p || typeof p.action !== "string") return;
    var set = handlers.get(p.action);
    if (!set) return;
    var payload = { data: p.data, sourceSlot: p.sourceSlot, sharedContext: p.sharedContext };
    set.forEach(function(h) { h(payload); });
  };
  window.addEventListener("message", onMessage);
  return {
    emit: function(event, data) {
      window.parent.postMessage({ jsonrpc: "2.0", method: METHOD, id: nextId++, params: { event: event, data: data } }, "*");
    },
    on: function(action, handler) {
      if (!handlers.has(action)) handlers.set(action, new Set());
      handlers.get(action).add(handler);
      return function() { var s = handlers.get(action); if (s) { s.delete(handler); if (s.size === 0) handlers.delete(action); } };
    },
    destroy: function() { window.removeEventListener("message", onMessage); handlers.clear(); }
  };
}`;

/** Tiny fixture-only MCP Apps handshake for exercising component surfaces. */
export const COMPOSABLE_VIEW_JS = `
function connectComponentView(catalog) {
  var CAPABILITY = "io.casys.mcp.view-components/v1";
  var CONTEXT = "io.casys.mcp.surface/v1";
  var requestId = "compose-init-" + Math.random().toString(36).slice(2);
  var initialized = false;

  function applySurface(surface) {
    if (!surface || !Array.isArray(surface.components)) return;
    var root = document.querySelector("[data-component-surface]");
    if (!root) return;
    var nodes = new Map();
    root.querySelectorAll("[data-view-component]").forEach(function(node) {
      nodes.set(node.dataset.viewComponent, node);
      node.hidden = true;
    });
    surface.components.forEach(function(item) {
      var node = nodes.get(item.component);
      if (!node) return;
      node.hidden = false;
      node.dataset.componentId = item.id;
      if (item.area) node.style.gridArea = item.area;
      root.appendChild(node);
    });
    var layout = surface.layout || { type: "stack" };
    var gaps = { none: "0", xs: ".25rem", sm: ".5rem", md: "1rem", lg: "1.5rem" };
    root.dataset.surfaceLayout = layout.type;
    root.style.display = "grid";
    root.style.gap = gaps[layout.gap || "md"];
    root.style.gridTemplateColumns = layout.type === "grid"
      ? "repeat(" + (layout.columns || 2) + ", minmax(0, 1fr))"
      : layout.type === "row"
      ? "repeat(" + surface.components.length + ", minmax(0, 1fr))"
      : "minmax(0, 1fr)";
  }

  function applyHostContext(hostContext) {
    var composition = hostContext && hostContext[CONTEXT];
    var dataset = document.documentElement.dataset;
    if (!composition || typeof composition !== "object") return;
    dataset.casysSurfaceInstance = composition.instanceId || "";
    dataset.casysSurfaceStatus = composition.status || "";
    dataset.casysSurfaceSource = composition.source || "";
    if (composition.status === "ready") applySurface(composition.surface);
  }

  window.addEventListener("message", function(event) {
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id === requestId && message.result) {
      applyHostContext(message.result.hostContext);
      if (!initialized) {
        initialized = true;
        window.parent.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/initialized",
          params: {}
        }, "*");
      }
      return;
    }
    if (message.method === "ui/notifications/host-context-changed") {
      applyHostContext(message.params);
    }
  });

  window.parent.postMessage({
    jsonrpc: "2.0",
    id: requestId,
    method: "ui/initialize",
    params: {
      appInfo: { name: document.title, version: "0.1.0" },
      protocolVersion: "2026-01-26",
      appCapabilities: { experimental: { [CAPABILITY]: catalog } }
    }
  }, "*");
}`;

/**
 * Start a stub server with HTTP + /ui route.
 * Shared boilerplate for all stubs.
 */
export async function startStubServer(
  server: McpApp,
  defaultPort: number,
): Promise<void> {
  const cliArgs = Deno.args;
  const portArg = cliArgs.find((a) => a.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : defaultPort;

  if (cliArgs.includes("--http")) {
    await server.startHttp({
      port,
      cors: true,
      customRoutes: [{
        method: "get" as const,
        path: "/ui",
        handler: async (req: Request) => {
          const uri = new URL(req.url).searchParams.get("uri");
          if (!uri) return new Response("Missing uri", { status: 400 });
          const content = await server.readResourceContent(uri);
          if (!content) return new Response("Not found", { status: 404 });
          return new Response(content.text, { headers: { "Content-Type": "text/html" } });
        },
      }],
      onListen: (info: { hostname: string; port: number }) => {
        console.error(
          `[${server.name}] HTTP server listening on http://${info.hostname}:${info.port}`,
        );
      },
    });
  } else {
    await server.start();
  }
}

/**
 * Wrap HTML body content into a complete HTML5 document with composeEvents inlined.
 *
 * NOTE: COMPOSE_EVENTS_JS is a browser-compatible copy of src/sdk/compose-events.ts.
 * Keep in sync manually — see SYNC marker below.
 */
export function buildStubHtml(title: string, bodyHtml: string, script: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; color: #333; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
    }
    [data-view-component] { min-width: 0; }
    [data-view-component][hidden] { display: none !important; }
  </style>
</head>
<body>
  ${bodyHtml}
  <script>
    ${COMPOSE_EVENTS_JS}
    ${COMPOSABLE_VIEW_JS}
    ${script}
  </script>
</body>
</html>`;
}
