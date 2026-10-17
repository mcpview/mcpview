# @casys/mcp-bridge

[![npm](https://img.shields.io/npm/v/@casys/mcp-bridge)](https://www.npmjs.com/package/@casys/mcp-bridge)
[![JSR](https://jsr.io/badges/@casys/mcp-bridge)](https://jsr.io/@casys/mcp-bridge)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Bridge MCP traffic across hosts that cannot talk directly.

`@casys/mcp-bridge` started as a bridge for
[MCP Apps](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
interactive UIs: turn any MCP tool with a `ui://` resource into a Telegram Mini
App or LINE LIFF app.

It now also exposes network tunnel primitives for Casys-style
SaaS-to-private-network deployments: a local runtime opens an outbound WebSocket
to a relay, and the relay routes MCP tool calls back through that socket. That
local runtime can be a small wrapper daemon, or the MCP server process itself if
the MCP server is already the long-lived process that can reach private data.

```
UI bridge:
  MCP Server (tools with ui:// resources)
          |
          v
  @casys/mcp-bridge Resource Server
          |
          v
  Telegram Mini App / LINE LIFF WebView

Network bridge:
  Online MCP endpoint / SaaS relay
      ^
      | outbound WebSocket
      |
  Local runtime: MCP server + bridge client
      |
      v
  Private ERP / DB / local service
```

---

## Install

```bash
# npm
npm install @casys/mcp-bridge

# Deno
deno add jsr:@casys/mcp-bridge
```

---

## Quick Start

### 1. Create a resource server

```typescript
import { JsonRpcMcpBackend, startResourceServer } from "@casys/mcp-bridge";

const server = startResourceServer({
  assetDirectories: {
    "my-app": "./my-app",
  },
  platform: "telegram",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  options: {
    resourceServerPort: 4000,
  },
  backend: new JsonRpcMcpBackend({
    endpointUrl: "https://my-mcp.example.com/mcp",
  }),
});

console.log(`Bridge running at ${server.baseUrl}`);
```

### 2. Create your MCP App HTML

```html
<!DOCTYPE html>
<html>
  <head>
    <title>My MCP App</title>
  </head>
  <body>
    <button id="btn">Get Data</button>
    <div id="result"></div>
    <script>
    // bridge.js is auto-injected by the resource server
    // It intercepts postMessage and routes via WebSocket to your handler

    window.addEventListener("mcp-bridge-ready", () => {
      document.getElementById("btn").onclick = async () => {
        const id = Date.now();
        window.parent.postMessage({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "get_data", arguments: {} },
        }, "*");
      };
    });

    window.addEventListener("message", (e) => {
      if (e.data?.result) {
        document.getElementById("result").textContent = JSON.stringify(
          e.data.result,
        );
      }
    });
    </script>
  </body>
</html>
```

### 3. Expose via HTTPS and configure Telegram

```bash
# Option A: Reverse proxy (recommended for production)
# Add to your Caddy/nginx config:
#   /app/*  -> localhost:4000
#   /bridge -> localhost:4000

# Option B: ngrok (for development)
ngrok http 4000
```

Then configure your Telegram bot via [@BotFather](https://t.me/BotFather):

1. `/setmenubutton` -> select your bot
2. Enter your HTTPS URL: `https://your-domain.com/app/my-app/index.html`
3. Open the bot on Telegram mobile -> tap Menu Button

---

## How It Works

### UI bridge

1. **User opens Mini App** in Telegram (or LINE)
2. **Resource server** serves the MCP App HTML with `bridge.js` auto-injected
3. **bridge.js** intercepts `postMessage` calls from the MCP App
4. Messages are routed via **WebSocket** to the resource server
5. Resource server forwards **`tools/call`** and **`resources/read`** to your
   configured backend
6. Response flows back: backend -> WebSocket -> bridge.js -> MCP App

The MCP App doesn't know it's running in Telegram. It uses the standard MCP Apps
SDK (`postMessage`), and the bridge handles the translation.

### Network bridge

1. **Local runtime starts** inside the private network
2. **Bridge client opens an outbound WebSocket** to the SaaS relay
3. **Relay authenticates `agent.hello`** and registers the agent for a
   `tenantId` + `targetType`
4. **SaaS calls `NetworkRelay.callTool()`** for private work
5. **Tool call crosses the socket** as `tool.call`
6. **Local handler runs** against the private ERP, DB, filesystem, or MCP server
7. **Result returns** as `tool.result`, or a structured `error`

This is the Casys relay mode. It is the path used by products such as
`erp-platform`, where an online MCP endpoint handles tenant auth and routing,
then sends selected tool calls through the tunnel to a local runtime. For a
local ERP, that runtime typically runs `mcp-erp` next to ERPNext/Dolibarr and
uses `@casys/mcp-bridge/adapters/network` only for the relay transport.

`daemon` here describes the runtime role, not necessarily a separate package:
the tunnel client can live in a standalone wrapper, or inside the MCP server
binary/process.

### Direct OpenAI tunnel mode

When the goal is to publish a local/private MCP server directly to ChatGPT,
Codex, the Responses API, or AgentKit, use OpenAI's official
[`tunnel-client`](https://github.com/openai/tunnel-client) around your
`@casys/mcp-server` server instead of reimplementing OpenAI's control plane in
`mcp-bridge`.

```text
Local MCP server built with @casys/mcp-server
  -> Streamable HTTP / stdio
  -> OpenAI tunnel-client
  -> OpenAI-hosted tunnel endpoint
  -> ChatGPT / Codex / Responses API / AgentKit
```

`@casys/mcp-bridge` remains the reusable bridge layer for Casys-owned relays and
host integrations. It does not implement OpenAI tunnel IDs, runtime/admin API
keys, connector management, or OpenAI's hosted control-plane protocol.

---

## API

### Resource Server

```typescript
import { JsonRpcMcpBackend, startResourceServer } from "@casys/mcp-bridge";
import type { ResourceServerConfig } from "@casys/mcp-bridge";

const config: ResourceServerConfig = {
  assetDirectories: {
    "my-app": "./my-app",
  },
  platform: "telegram",
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  options: {
    resourceServerPort: 4000,
  },
  csp: {
    scriptSources: ["https://telegram.org"],
    connectSources: ["wss://my-domain.com"],
    frameAncestors: ["https://web.telegram.org"],
  },
  backend: new JsonRpcMcpBackend({
    endpointUrl: "https://my-mcp.example.com/mcp",
  }),
};
```

### Protocol Helpers

```typescript
import {
  buildErrorResponse,
  buildSuccessResponse,
  buildToolCallRequest,
  isRequest,
  isResponse,
  MessageRouter,
} from "@casys/mcp-bridge";

const router = new MessageRouter();
router.onRequest("tools/call", async (params) => {
  return { content: [{ type: "text", text: "result" }] };
});
```

### Platform Adapters

```typescript
// Telegram — used internally by bridge.js, or standalone
import { TelegramPlatformAdapter } from "@casys/mcp-bridge";

const adapter = new TelegramPlatformAdapter();
const hostContext = await adapter.initialize();
// { colorScheme: "dark", viewportHeight: 640, ... }

// LINE LIFF
import { LineAdapter } from "@casys/mcp-bridge";
```

### Network Tunnel Primitives

Relay side:

```typescript
import {
  attachNetworkTunnelSocket,
  NetworkRelay,
} from "@casys/mcp-bridge/adapters/network";

const relay = new NetworkRelay({
  requestTimeoutMs: 30_000,
  concurrencyStrategy: "reject",
});

function handleTunnelSocket(socket: WebSocket, tenantId: string) {
  attachNetworkTunnelSocket({
    relay,
    socket,
    tenantId,
    authorizeAgentHello: async (hello) => {
      // Verify the agent token, tenant, target type, key version, and policy.
      if (hello.targetType !== "erpnext") {
        return { ok: false, closeCode: 4004, reason: "unsupported target" };
      }
      return { ok: true };
    },
  });
}

const result = await relay.callTool({
  tenantId: "tenant_123",
  targetType: "erpnext",
  toolName: "erpnext.customer_list",
  arguments: { limit: 10 },
  actorSubject: "user_123",
});
```

Local runtime side:

```typescript
import {
  NetworkTunnelClient,
  WebSocketNetworkTransport,
} from "@casys/mcp-bridge/adapters/network";

const client = new NetworkTunnelClient({
  transport: new WebSocketNetworkTransport({
    auth: { type: "bearer", token: () => Deno.env.get("BRIDGE_AGENT_TOKEN")! },
  }),
  tenantId: "tenant_123",
  targetType: "erpnext",
  agentId: "agent_local_1",
  keyVersion: 1,
  handleToolCall: async (call, options) => {
    // Run private-network work here. This can call an ERP SDK directly,
    // dispatch into mcp-erp, or forward into a local MCP server.
    return await callPrivateTool(call.toolName, call.arguments, {
      signal: options?.signal,
    });
  },
});

await client.start("wss://app.example.com/mcp/_tunnel");
```

### Resource URI Parsing

```typescript
import { parseResourceUri, resolveToHttp } from "@casys/mcp-bridge";

const uri = parseResourceUri("ui://my-server/dashboard.html?tab=metrics");
const httpUrl = resolveToHttp(uri, "https://my-domain.com");
// => "https://my-domain.com/app/my-server/dashboard.html?tab=metrics"

const proxyUrl = resolveToHttp(uri, "https://my-domain.com", { mode: "query" });
// => "https://my-domain.com/ui?uri=ui%3A%2F%2Fmy-server%2Fdashboard.html%3Ftab%3Dmetrics"
```

---

## Architecture

| Layer        | Component              | Role                                                                               |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| **Client**   | `bridge.js`            | IIFE injected into MCP App HTML. Intercepts postMessage, routes via WebSocket      |
| **Server**   | `ResourceServer`       | HTTP server (serves HTML + bridge.js), WebSocket endpoint, session management      |
| **Protocol** | `MessageRouter`        | JSON-RPC 2.0 routing, pending request tracking, timeout                            |
| **Adapters** | Platform runtimes      | Map host SDKs (Telegram/LINE today, extensible for others) to MCP Apps HostContext |
| **Network**  | `adapters/network`     | Outbound WebSocket tunnel primitives for SaaS-to-private-network tool calls        |
| **Security** | `CSP` + `SessionStore` | Content-Security-Policy headers, session auth, path traversal protection           |

---

## Development

```bash
# Run tests
deno task test

# Type-check
deno task check

# Lint
deno task lint

# Run the demo
deno task demo
```

---

## Companion Package

Built to work with [@casys/mcp-server](https://jsr.io/@casys/mcp-server), the
production MCP server framework.

Use `@casys/mcp-server` to build MCP tools with `ui://` resources, and
`@casys/mcp-bridge` to deliver them to messaging platforms or to route selected
private-network tool calls through a Casys-owned relay.

---

## License

MIT
