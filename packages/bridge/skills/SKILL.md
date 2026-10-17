# @mcpview/bridge — Reference Skill

**Registry:** `jsr:@mcpview/bridge` | **Runtime:** Deno

Bridge MCP Apps (interactive HTML UIs delivered via the MCP protocol) to
messaging platform webviews — Telegram Mini Apps and LINE LIFF.

---

## What it does

`@mcpview/bridge` solves one problem: an MCP App's HTML runs inside a platform
webview (Telegram, LINE) that does not speak the MCP protocol. The bridge
injects a `bridge.js` script into the served HTML, which intercepts
`postMessage` calls from the MCP App SDK and routes them over WebSocket to a
local HTTP resource server. The resource server forwards those JSON-RPC messages
to the MCP backend and relays responses back.

The result: unmodified MCP App HTML works inside Telegram Mini Apps without any
changes to the app code.

---

## Architecture

Three layers:

```
Platform WebView
  └─ Your App HTML
       └─ bridge.js (injected at serve time)
            │  WebSocket  /bridge?session=<id>
            ▼
Resource Server  (Deno HTTP, startResourceServer)
  ├─ GET  /app/<server>/<path>   — serve assets from disk + inject bridge.js
  ├─ GET  /bridge.js             — serve bridge client script
  ├─ WS   /bridge?session=<id>  — bidirectional JSON-RPC
  ├─ POST /session               — create session
  ├─ GET  /health                — health check
  └─ GET  /ui?uri=<ui://>        — proxy built-in UI route (configurable)
            │  HTTP JSON-RPC POST
            ▼
MCP Backend  (JsonRpcMcpBackend or custom McpBackend)
```

**bridge.js** runs inside the webview. It:

- Monkey-patches `window.parent.postMessage` to intercept MCP JSON-RPC
- Handles `ui/initialize` locally (builds `HostContext` from platform SDK)
- Forwards all other messages to the resource server via WebSocket
- Replays platform lifecycle events (`themeChanged`, `viewportChanged`) as MCP
  notifications

The resource server and backend run server-side in Deno.

---

## Installation

```sh
deno add jsr:@mcpview/bridge
```

Import:

```ts
import {
  JsonRpcMcpBackend,
  startResourceServer,
  TelegramPlatformAdapter,
} from "@mcpview/bridge";
```

---

## Quick start — Telegram

```ts
import { JsonRpcMcpBackend, startResourceServer } from "@mcpview/bridge";

const backend = new JsonRpcMcpBackend({
  endpointUrl: "http://localhost:3000/mcp",
});

const server = startResourceServer({
  platform: "telegram",
  assetDirectories: { "my-app": "./public" },
  telegramBotToken: Deno.env.get("TELEGRAM_BOT_TOKEN")!,
  backend,
});

console.log("Resource server:", server.baseUrl);
// Your HTML at ./public/index.html is now served at:
// {server.baseUrl}/app/my-app/index.html
// bridge.js is automatically injected.
```

**Telegram requires `telegramBotToken` or a custom `auth` handler.** Omitting
both throws at startup.

The bot then opens the Mini App to `{server.baseUrl}/app/my-app/index.html?...`
as a Telegram Web App URL.

---

## Platform support

| Platform | Adapter                                          | Auth                 | Theme                                         | Lifecycle events                                        |
| -------- | ------------------------------------------------ | -------------------- | --------------------------------------------- | ------------------------------------------------------- |
| Telegram | `TelegramPlatformAdapter`                        | HMAC-SHA256 initData | `--color-*` CSS vars via `HostContext.styles` | theme-changed, viewport-changed, activated, deactivated |
| LINE     | `LineAdapter` (extends `BasePostMessageAdapter`) | None built-in        | Not implemented                               | Not implemented                                         |

LINE support is minimal. `LineAdapter` is a thin `postMessage` wrapper — it does
not initialize the LIFF SDK, does not handle auth, and does not emit lifecycle
events.

---

## Security

**Telegram auth (HMAC-SHA256):**

- On WebSocket connect, `bridge.js` sends `{ type: "auth", initData: "..." }`
  before any JSON-RPC traffic.
- The resource server validates the Telegram `initData` signature against the
  bot token.
- Algorithm: HMAC-SHA256 using key `HMAC-SHA256("WebAppData", botToken)`,
  compared against `hash` param in initData.
- `auth_date` freshness is checked; default max age is 24 hours (86400 seconds).
- Unauthenticated sessions receive `auth_error` and the WebSocket is closed
  (code 4001/4003).
- After success, `session.authenticated = true`, `session.userId`,
  `session.username`, and `session.authContext` are populated.

**CSP:**

- Every served HTML page gets a `Content-Security-Policy` header via
  `buildCspHeader`.
- Base policy: `default-src 'none'`, then explicit allowlist for scripts,
  styles, images, fonts, and connections.
- `frame-ancestors 'self'` by default; add platform origins via
  `csp.frameAncestors`.
- Inline scripts/styles are allowed by default (`allowInline: true`). Set
  `allowInline: false` for stricter apps.

**Session limits:** max 10,000 concurrent sessions; sessions expire after 30
minutes of inactivity.

---

## Key caveats

1. **BridgeClient is iframe/webview-only.** It monkey-patches
   `window.parent.postMessage`. Outside a real webview context (e.g. Node.js
   server, test environment), the interception silently no-ops. Never
   instantiate `BridgeClient` server-side.

2. **`bridge.js` vs exported adapters do different things.** `bridge.js` (the
   injected script) runs inside the webview and handles platform initialization
   automatically using `TelegramPlatformAdapter`. The exported `TelegramAdapter`
   and `TelegramPlatformAdapter` classes are for advanced use cases — building
   custom bridge clients or testing. Most users never import them directly.

3. **`TelegramAdapter` vs `TelegramPlatformAdapter`:** `TelegramAdapter` extends
   `BasePostMessageAdapter` (raw postMessage bridge). `TelegramPlatformAdapter`
   implements the full `PlatformAdapter` interface with theme extraction,
   viewport tracking, safe area insets, and lifecycle events. Use
   `TelegramPlatformAdapter` when building a custom `BridgeClient`.

4. **`containerDimensions.maxHeight` not `height`.**
   `TelegramPlatformAdapter.getContainerDimensions()` returns
   `{ width, maxHeight }` where `maxHeight = tg.viewportStableHeight`. The
   `height` field is not set. MCP Apps that read `containerDimensions.height`
   will get `undefined`.

5. **Locale comes from `navigator.language`, not Telegram.**
   `TelegramPlatformAdapter` reads locale from the browser's
   `navigator.language`, not from `initDataUnsafe.user.language_code`. On
   Telegram for Android, these can differ.

6. **`sendMessage` (sendData) closes the Mini App.**
   `TelegramPlatformAdapter.sendMessage()` calls `tg.sendData()`, which sends
   data back to the bot and immediately closes the webview. This is a Telegram
   limitation, not a bridge bug.

7. **Port 0 = OS-assigned.** `BridgeOptions.resourceServerPort` defaults to 0,
   meaning the OS picks an available port. Always read `server.baseUrl` after
   `startResourceServer` returns — don't hardcode a port.

8. **Tool results via `?ref=`.** Use `server.storeToolResult(data)` to get a ref
   string, then append `?ref=<ref>` to the page URL. When the page is served,
   the resource server automatically attaches a `ui/notifications/tool-result`
   notification to the session. Results expire after 5 minutes and are
   single-use.

---

## References

- Full API reference: [references/api.md](references/api.md)
- Telegram-specific patterns: [references/telegram.md](references/telegram.md)
