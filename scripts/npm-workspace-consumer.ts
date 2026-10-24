// Compiled and executed outside the repository by check-npm-workspace.mjs.
import assert from "node:assert/strict";
import * as server from "@mcpview/server";
import { createCollector } from "@mcpview/compose";
import { createMcpSdkCollector } from "@mcpview/compose/sdk";
import { parseResourceUri } from "@mcpview/bridge";
import { NetworkRelay } from "@mcpview/bridge/adapters/network";
import * as contracts from "@mcpview/contracts";
import { defineView, type ToolResult } from "@mcpview/view";
import * as compatibilityContracts from "@mcpview/view/contracts";
import { defineReactView } from "@mcpview/view/react";
import { defineComponentRegistry } from "@mcpview/components";
import { definePreactComponent } from "@mcpview/components/preact";
import { Badge } from "@mcpview/components/preact/components";
import { startSurfaceApp } from "@mcpview/components/surface";
import { resolveViewerLayout } from "@mcpview/components/layout";
import * as fonts from "@mcpview/components/fonts";

import * as legacy0 from "@casys/mcp-platform";
import * as canonical0 from "@mcpview/server";
import * as legacy1 from "@casys/mcp-server";
import * as canonical1 from "@mcpview/server";
import * as legacy2 from "@casys/mcp-view";
import * as canonical2 from "@mcpview/view";
import * as legacy3 from "@casys/mcp-view-components";
import * as canonical3 from "@mcpview/components";
import * as legacy4 from "@casys/mcp-view-contracts";
import * as canonical4 from "@mcpview/contracts";
import * as legacy5 from "@casys/mcp-compose";
import * as canonical5 from "@mcpview/compose";
import * as legacy6 from "@casys/mcp-bridge";
import * as canonical6 from "@mcpview/bridge";

for (
  const [legacy, canonical] of [
    [legacy0, canonical0],
    [legacy1, canonical1],
    [legacy2, canonical2],
    [legacy3, canonical3],
    [legacy4, canonical4],
    [legacy5, canonical5],
    [legacy6, canonical6],
  ]
) {
  assert.deepEqual(Object.keys(legacy).sort(), Object.keys(canonical).sort());
  for (const key of Object.keys(canonical)) {
    assert.equal(
      (legacy as Record<string, unknown>)[key],
      (canonical as Record<string, unknown>)[key],
    );
  }
}

assert.equal(server.ConcurrentMCPServer, server.McpApp);
assert.equal(typeof NetworkRelay, "function");
assert.equal(typeof parseResourceUri, "function");
for (
  const entry of [
    defineView,
    defineReactView,
    defineComponentRegistry,
    definePreactComponent,
    Badge,
    startSurfaceApp,
    resolveViewerLayout,
  ]
) assert.equal(typeof entry, "function");
assert(Object.keys(fonts).length > 0);
assert.equal(
  compatibilityContracts.VIEWER_SESSION_APPLY_ACTION,
  contracts.VIEWER_SESSION_APPLY_ACTION,
);

// Feed the viewer's SDK result type to both compose entry points.
const result: ToolResult = {
  content: [{ type: "text", text: "local npm consumer" }],
  _meta: { ui: { resourceUri: "ui://consumer/result" } },
};
const collector = createCollector();
collector.collect("consumer", result);
const sdkCollector = createMcpSdkCollector();
sdkCollector.collectFromSdk("consumer", result);
assert.equal(collector.getResources().length, 1);
assert.equal(sdkCollector.getResources().length, 1);

// Load and exercise the Node HTTP adapter rather than just checking exports.
const app = new server.McpApp({
  name: "npm-consumer",
  version: "0.0.0",
  logger: () => {},
});
app.registerTool({
  name: "ping",
  description: "Ping",
  inputSchema: { type: "object" },
}, () => "pong");
let ready!: (port: number) => void;
const listening = new Promise<number>((resolve) => ready = resolve);
const http = await app.startHttp({
  port: 0,
  hostname: "127.0.0.1",
  onListen: ({ port }) => ready(port),
});
try {
  const port = await listening;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`);
  assert.equal(response.status, 405);
  await response.text();
  const listing = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  assert.equal(listing.status, 200);
  assert.equal(listing.headers.get("mcp-session-id"), null);
  const data = await listing.json();
  assert.equal(data.result.tools[0].name, "ping");
} finally {
  await http.shutdown();
}
