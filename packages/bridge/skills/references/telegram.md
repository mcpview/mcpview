# @mcpview/bridge — Telegram Mini App Patterns

Reference for Telegram-specific behavior in `@casys/mcp-bridge` v0.2.0.

---

## Full Telegram Mini App setup

### 1. Server-side (Deno)

```ts
import { JsonRpcMcpBackend, startResourceServer } from "@mcpview/bridge";

const backend = new JsonRpcMcpBackend({
  endpointUrl: "http://localhost:3000/mcp",
});

const server = startResourceServer({
  platform: "telegram",
  assetDirectories: {
    "my-app": "./public", // serves ./public/* at /app/my-app/*
  },
  telegramBotToken: Deno.env.get("TELEGRAM_BOT_TOKEN")!,
  backend,
  options: {
    debug: true, // logs session creation, auth events, messages
  },
  csp: {
    // Telegram Mini Apps are served in an iframe from web.telegram.org
    frameAncestors: ["https://web.telegram.org"],
    connectSources: ["wss://*"], // if your app uses WebSockets directly
  },
});

console.log("App URL:", `${server.baseUrl}/app/my-app/index.html`);
// Set this as the Telegram Mini App URL in @BotFather
```

### 2. Telegram bot configuration

In `@BotFather`:

- `/newapp` or `/editapp` → set the Mini App URL to
  `{server.baseUrl}/app/my-app/index.html`
- The URL must be publicly accessible (use ngrok or a tunnel in development)

### 3. What happens at runtime

1. User opens the Mini App in Telegram
2. Telegram loads the HTML page from the resource server
3. `bridge.js` is already injected — it runs immediately
4. `bridge.js` reads `window.Telegram.WebApp` and calls `tg.ready()` +
   `tg.expand()`
5. `bridge.js` opens a WebSocket to `/bridge?session=<id>`
6. `bridge.js` sends `{ type: "auth", initData: tg.initData }` on connect
7. Server validates HMAC-SHA256 and replies
   `{ type: "auth_ok", userId, username }`
8. The MCP App's `ui/initialize` is handled locally by `bridge.js` (HostContext
   built from Telegram SDK)
9. All subsequent JSON-RPC traffic (tools/call, resources/read, etc.) flows over
   the WebSocket

---

## Theme variables

There are two sets of theme CSS variables with different lifetimes:

### `--tg-*` variables (from Telegram SDK, set by bridge.js automatically)

Telegram injects these into the page CSS before the Mini App loads. They are
always available regardless of the bridge. They reflect raw Telegram theme
colors:

```css
--tg-color-scheme /* "light" | "dark" */
  --tg-theme-bg-color
  --tg-theme-text-color
  --tg-theme-hint-color
  --tg-theme-link-color
  --tg-theme-button-color
  --tg-theme-button-text-color
  --tg-theme-secondary-bg-color
  /* etc. */
```

Use these in your MCP App HTML for Telegram-native theming if you don't need
cross-platform support.

### `--color-*` variables (from TelegramPlatformAdapter, set via HostContext)

These are provided in `HostContext.styles.variables` during `ui/initialize` and
on `ui/notifications/host-context-changed`. `bridge.js` applies them to
`document.documentElement` style. They are semantically named for cross-platform
compatibility:

```css
--color-background-primary /* from bg_color */
  --color-background-secondary /* from secondary_bg_color */
  --color-background-header /* from header_bg_color */
  --color-background-section /* from section_bg_color */
  --color-text-primary /* from text_color */
  --color-text-secondary /* from subtitle_text_color */
  --color-text-hint /* from hint_color */
  --color-text-link /* from link_color */
  --color-button-primary /* from button_color */
  --color-button-text /* from button_text_color */
  --color-border-primary /* from section_separator_color */
  --color-ring-primary /* from accent_text_color */
```

`--color-*` variables are only set if the corresponding Telegram theme param is
present in `themeParams`. Not all clients provide all params.

---

## initData validation (HMAC-SHA256)

The bridge validates `initData` automatically when `telegramBotToken` is
provided. The algorithm (per Telegram docs):

1. Parse `initData` as a URL query string
2. Extract and remove the `hash` parameter
3. Sort remaining `key=value` pairs alphabetically
4. Join with `\n` to form `data_check_string`
5. Compute `secret_key = HMAC-SHA256(key="WebAppData", data=botToken)`
6. Compute `expected = HMAC-SHA256(key=secret_key, data=data_check_string)`
7. Compare `hex(expected)` with `hash` using `crypto.subtle.verify`
   (timing-safe)
8. Check `auth_date` freshness (default max age: 24 hours)

**After successful validation, `session` contains:**

```ts
session.authenticated = true;
session.userId; // Telegram user ID (number)
session.username; // Telegram username (string | undefined)
session.principalId; // Same as userId
session.authContext; // { provider: "telegram", userId, username }
```

**Auth message shape** (sent by bridge.js, handled automatically):

```json
{ "type": "auth", "initData": "..." }
```

Also accepted:

```json
{ "type": "auth", "payload": { "initData": "..." } }
```

**Custom auth handler** (if you need more control):

```ts
import { createTelegramAuthHandler } from "@mcpview/bridge";

const server = startResourceServer({
  platform: "telegram",
  auth: createTelegramAuthHandler(botToken),
  // OR provide your own:
  auth: async (session, message) => {
    const initData = message.initData as string;
    // validate yourself
    return { valid: true, principalId: 12345, username: "alice" };
  },
  // ...
});
```

---

## containerDimensions — height vs maxHeight

`TelegramPlatformAdapter.getContainerDimensions()` returns:

```ts
{
  width: window.innerWidth,       // current window width
  maxHeight: tg.viewportStableHeight,  // stable viewport height (excludes keyboard)
}
```

`height` is not set. Reading `hostContext.containerDimensions?.height` returns
`undefined`.

**Why `maxHeight` and not `height`?** Telegram's `viewportStableHeight` is the
stable height after the virtual keyboard fully disappears. Using it as
`maxHeight` prevents layout jumps when the keyboard opens/closes. Use
`maxHeight` in your CSS (`max-height: var(--container-max-height)`), not
`height`.

When the viewport changes (keyboard opens/closes, user resizes), `bridge.js`
emits a `ui/notifications/host-context-changed` notification with the updated
`containerDimensions`.

---

## Locale behavior

`TelegramPlatformAdapter` reads locale from `navigator.language`, not from
Telegram's `initDataUnsafe.user.language_code`.

```ts
// What the adapter does:
private getLocale(): string {
  return (globalThis as any).navigator?.language ?? "en";
}
```

Consequence: on Telegram for Android, `navigator.language` reflects the **device
locale**, while `user.language_code` reflects the **Telegram app locale**. These
can differ.

If you need the Telegram-specific user language, read it from
`session.authContext` after authentication:

```ts
const telegramLocale = session.authContext?.username; // no — not available here
```

Actually, Telegram's `language_code` is in the `initData` `user` object. To get
it, parse `initDataUnsafe.user.language_code` from the auth context, or read it
from `initData` manually in your `onMessage` handler. The bridge does not expose
it on the session object.

---

## Lifecycle events

`TelegramPlatformAdapter` listens to these Telegram WebApp events:

| Telegram event    | Bridge LifecycleEvent | MCP notification                                                       |
| ----------------- | --------------------- | ---------------------------------------------------------------------- |
| `themeChanged`    | `theme-changed`       | `ui/notifications/host-context-changed` with `{ theme }`               |
| `viewportChanged` | `viewport-changed`    | `ui/notifications/host-context-changed` with `{ containerDimensions }` |
| `activated`       | `activated`           | None (internal only)                                                   |
| `deactivated`     | `deactivated`         | None (internal only)                                                   |

`activated`/`deactivated` are tracked but do not produce MCP notifications in
v0.2.0. They could be used for session keepalive in the future.

---

## CSP for Telegram Mini Apps

Telegram embeds Mini Apps in an iframe. The `frame-ancestors` directive must
include Telegram's web domain:

```ts
startResourceServer({
  csp: {
    frameAncestors: [
      "https://web.telegram.org",
      "https://*.telegram.org",
    ],
  },
  // ...
});
```

Without this, Telegram's web client will refuse to display the Mini App due to
CSP violations.

For Telegram mobile clients (iOS/Android), CSP `frame-ancestors` is not enforced
(it's a native webview), so the directive does not break anything.

---

## Tool result delivery pattern

When a tool call completes and you want to show a result page:

```ts
// In your MCP server's tool handler:
const ref = server.storeToolResult({
  content: [{ type: "text", text: "Result: done" }],
});

// Return a resource URI to the tool caller
return {
  content: [{
    type: "resource",
    resource: { uri: `ui://my-app/result?ref=${ref}` },
  }],
};
```

When the bridge opens `ui://my-app/result?ref=<ref>`, it serves the HTML and
automatically prepends a `ui/notifications/tool-result` notification to the
session. The MCP App receives it via WebSocket as soon as it connects and calls
`ui/initialize`.

Stored results expire after 5 minutes. They are single-use (consumed on first
retrieval).

---

## Custom HTTP routes for Telegram callbacks

Use `onHttpRequest` for webhook endpoints or custom routes alongside the
resource server:

```ts
startResourceServer({
  platform: "telegram",
  telegramBotToken: botToken,
  onHttpRequest: async (request) => {
    const url = new URL(request.url);

    // Telegram bot webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      const update = await request.json();
      await handleUpdate(update);
      return new Response("ok");
    }

    // Serve a custom page with bridge injection
    if (url.pathname === "/custom") {
      return {
        html: "<html><body>Hello</body></html>",
      };
    }

    return null; // 404
  },
  // ...
});
```

Routes handled by built-in paths (`/health`, `/session`, `/bridge`,
`/bridge.js`, `/app/`) are never passed to `onHttpRequest`.
