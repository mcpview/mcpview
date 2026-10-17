/**
 * Strict MCP Apps fixture used to verify compose against the protocol path.
 *
 * This server intentionally has no HTTP `/ui` shortcut. Its App HTML can only
 * be obtained through `resources/read`, which is the MCP contract a host must
 * implement for arbitrary servers.
 *
 * @module stubs/strict-resource/fixture
 */

import {
  MCP_APP_MIME_TYPE,
  MCP_APPS_PROTOCOL_VERSION as EXT_APPS_PROTOCOL_VERSION,
  McpApp,
} from "@casys/mcp-server";

/** Name exposed by the fixture MCP server and its compose manifest. */
export const STRICT_RESOURCE_SERVER_NAME = "strict-resource";

/** UI resource exposed exclusively through MCP `resources/read`. */
export const STRICT_RESOURCE_URI = "ui://strict-resource/dashboard";

/** Tool that instantiates the MCP App and supplies its initial result. */
export const STRICT_RENDER_TOOL = "render_strict_dashboard";

/** App-only tool the fixture App calls through the host's `serverTools` bridge. */
export const STRICT_REFRESH_TOOL = "strict_refresh_dashboard";

/** Protocol version advertised by the fixture App during `ui/initialize`. */
export const MCP_APPS_PROTOCOL_VERSION = EXT_APPS_PROTOCOL_VERSION;

/**
 * A deliberately small, dependency-free MCP App.
 *
 * The script registers its `tool-result` listener before `ui/initialize`, then
 * exposes a refresh button that makes an actual `tools/call` request. Browser
 * tests can assert the documented `data-testid` attributes or inspect
 * `window.__strictResourceFixture`.
 */
export const STRICT_RESOURCE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Strict MCP resource fixture</title>
    <style>
      :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
      body { margin: 0; padding: 16px; }
      main { display: grid; gap: 12px; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      pre { margin: 0; padding: 10px; border-radius: 6px; background: color-mix(in srgb, CanvasText 8%, Canvas); overflow: auto; }
      button { width: fit-content; padding: 7px 10px; }
      [data-status="error"] { color: #b42318; }
    </style>
  </head>
  <body>
    <main data-testid="strict-resource-app" data-handshake="pending">
      <h1>Strict MCP resource</h1>
      <p>This fixture has no <code>/ui</code> route. The host must use MCP <code>resources/read</code>.</p>
      <section>
        <h2>Initial tool result</h2>
        <pre data-testid="initial-tool-result">waiting for ui/notifications/tool-result</pre>
      </section>
      <button type="button" data-testid="refresh" disabled>Refresh through app-only tool</button>
      <section>
        <h2>Refresh result</h2>
        <pre data-testid="refresh-result">not requested</pre>
      </section>
      <p data-testid="status" data-status="pending">Waiting for host handshake.</p>
    </main>
    <script>
      (() => {
        const APP_PROTOCOL = ${JSON.stringify(MCP_APPS_PROTOCOL_VERSION)};
        const APP_INFO = { name: "strict-resource-fixture", version: "0.1.0" };
        const REFRESH_TOOL = ${JSON.stringify(STRICT_REFRESH_TOOL)};
        const root = document.querySelector('[data-testid="strict-resource-app"]');
        const initial = document.querySelector('[data-testid="initial-tool-result"]');
        const refreshButton = document.querySelector('[data-testid="refresh"]');
        const refreshResult = document.querySelector('[data-testid="refresh-result"]');
        const status = document.querySelector('[data-testid="status"]');
        const pending = new Map();
        let nextId = 1;

        const fixture = window.__strictResourceFixture = {
          initialResult: undefined,
          lastRefreshResult: undefined,
          host: undefined,
          refreshTool: REFRESH_TOOL
        };

        function setStatus(text, kind) {
          status.textContent = text;
          status.dataset.status = kind;
        }

        function renderResult(target, result) {
          const structured = result && result.structuredContent;
          target.textContent = JSON.stringify(structured || result || {}, null, 2);
        }

        function request(method, params) {
          const id = nextId++;
          return new Promise((resolve, reject) => {
            const timer = window.setTimeout(() => {
              pending.delete(id);
              reject(new Error("Timed out waiting for host response to " + method));
            }, 5000);
            pending.set(id, { resolve, reject, timer });
            window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
          });
        }

        // This listener is deliberately registered before ui/initialize. MCP
        // Apps delivers tool-result as a one-shot notification after handshake.
        window.addEventListener("message", (event) => {
          if (event.source !== window.parent) return;
          const message = event.data;
          if (!message || message.jsonrpc !== "2.0") return;

          if (message.method === "ui/notifications/tool-result") {
            fixture.initialResult = message.params;
            renderResult(initial, message.params);
            return;
          }

          if (Object.prototype.hasOwnProperty.call(message, "id") && pending.has(message.id)) {
            const entry = pending.get(message.id);
            pending.delete(message.id);
            window.clearTimeout(entry.timer);
            if (message.error) entry.reject(new Error(message.error.message || "Host request failed"));
            else entry.resolve(message.result);
          }
        });

        refreshButton.addEventListener("click", async () => {
          refreshButton.disabled = true;
          setStatus("Calling app-only refresh tool…", "pending");
          try {
            const result = await request("tools/call", {
              name: REFRESH_TOOL,
              arguments: { requestedBy: "strict-resource-fixture" }
            });
            fixture.lastRefreshResult = result;
            renderResult(refreshResult, result);
            setStatus("App-only tool call succeeded.", "ok");
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), "error");
          } finally {
            refreshButton.disabled = false;
          }
        });

        request("ui/initialize", {
          appInfo: APP_INFO,
          appCapabilities: {},
          protocolVersion: APP_PROTOCOL
        }).then((host) => {
          fixture.host = host;
          root.dataset.handshake = "ready";
          refreshButton.disabled = false;
          setStatus("Host handshake completed.", "ok");
          window.parent.postMessage({
            jsonrpc: "2.0",
            method: "ui/notifications/initialized",
            params: {}
          }, "*");
        }).catch((error) => {
          root.dataset.handshake = "error";
          setStatus(error instanceof Error ? error.message : String(error), "error");
        });
      })();
    </script>
  </body>
</html>`;

/**
 * Build the strict server without any non-MCP UI route.
 *
 * @example
 * ```ts
 * const server = createStrictResourceServer();
 * // `resources/read` is the sole way to retrieve STRICT_RESOURCE_URI.
 * ```
 */
export function createStrictResourceServer(): McpApp {
  const server = new McpApp({
    name: STRICT_RESOURCE_SERVER_NAME,
    version: "0.1.0",
    logger: (message: string) => console.error(`[${STRICT_RESOURCE_SERVER_NAME}] ${message}`),
    // Ensure this fixture also catches raw, non-conforming HTTP shortcuts.
    transport: "stateless",
  });

  server.registerTool(
    {
      name: STRICT_RENDER_TOOL,
      description: "Render the strict MCP App fixture",
      inputSchema: {
        type: "object",
        properties: { scenario: { type: "string" } },
      },
      annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: STRICT_RESOURCE_URI } },
    },
    (args) => {
      const scenario = typeof args.scenario === "string" ? args.scenario : "default";
      return {
        content: [{ type: "text", text: `Strict MCP App ready for ${scenario}.` }],
        structuredContent: {
          fixture: "strict-resource",
          scenario,
          status: "ready",
          facts: ["resource via resources/read only", "initial result is structured"],
        },
        _meta: { ui: { resourceUri: STRICT_RESOURCE_URI } },
      };
    },
  );

  server.registerAppOnlyTool(
    {
      name: STRICT_REFRESH_TOOL,
      description: "Refresh the strict MCP App fixture",
      inputSchema: {
        type: "object",
        properties: { requestedBy: { type: "string" } },
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    (args) => {
      const requestedBy = typeof args.requestedBy === "string" ? args.requestedBy : "unknown";
      return {
        content: `Strict MCP App refreshed by ${requestedBy}.`,
        structuredContent: {
          fixture: "strict-resource",
          status: "refreshed",
          requestedBy,
        },
      };
    },
  );

  server.registerResource(
    {
      uri: STRICT_RESOURCE_URI,
      name: "Strict MCP resource fixture",
      description: "MCP App served only through resources/read",
      mimeType: MCP_APP_MIME_TYPE,
    },
    () => ({
      uri: STRICT_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text: STRICT_RESOURCE_HTML,
    }),
  );

  return server;
}
