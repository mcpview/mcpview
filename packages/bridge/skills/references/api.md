# @mcpview/bridge — Full API Reference

Version 0.2.0. All exports from `src/mod.ts`.

---

## `startResourceServer(config)`

Start the HTTP resource server. Returns a `ResourceServer` instance.

```ts
function startResourceServer(config: ResourceServerConfig): ResourceServer;
```

**Throws** if `platform === "telegram"` and neither `telegramBotToken` nor
`auth` is provided.

### `ResourceServerConfig`

```ts
interface ResourceServerConfig {
  // Required: asset directories keyed by server name (matches ui:// host)
  assetDirectories: Record<string, string>;

  // Required: platform name used when creating sessions and configuring bridge.js
  platform: string; // "telegram" | "line" | any string

  // Bridge options (port, CORS, debug)
  options?: BridgeOptions;

  // Custom CSP directives applied to all served HTML pages
  csp?: CspOptions;

  // Custom auth handler (takes precedence over telegramBotToken)
  auth?: BridgeAuthHandler;

  // Shortcut: creates a Telegram HMAC-SHA256 auth handler for this token
  // Requires platform === "telegram"
  telegramBotToken?: string;

  // MCP backend for forwarding JSON-RPC and resolving ui:// resources
  backend?: McpBackend;

  // Path for the built-in UI proxy route. Default: "/ui". null = disabled.
  uiPath?: string | null;

  // Called on every authenticated JSON-RPC message before backend.handleMessage()
  // Return null to fall through to backend
  onMessage?: (
    session: BridgeSession,
    message: McpAppsMessage,
  ) => Promise<McpAppsMessage | null>;

  // Custom HTTP route handler for requests not matching built-in paths
  // Return Response, { html, pendingNotifications? }, or null (404)
  onHttpRequest?: (
    request: Request,
  ) => Promise<
    | Response
    | { html: string; pendingNotifications?: PendingNotification[] }
    | null
  >;
}
```

### `BridgeOptions`

```ts
interface BridgeOptions {
  resourceServerPort?: number; // Default: 0 (OS-assigned)
  allowedOrigins?: readonly string[]; // Default: ["*"]
  debug?: boolean; // Default: false
}
```

### `CspOptions`

```ts
interface CspOptions {
  scriptSources?: readonly string[]; // Added to script-src
  connectSources?: readonly string[]; // Added to connect-src
  frameAncestors?: readonly string[]; // Added to frame-ancestors
  allowInline?: boolean; // Default: true (unsafe-inline)
}
```

Default CSP (no options):
`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'`

---

### `ResourceServer`

```ts
interface ResourceServer {
  readonly baseUrl: string; // e.g. "http://localhost:54321"
  readonly sessions: SessionStore; // Live session store

  // Store a tool result for delivery via ?ref= URL param. Expires in 5 minutes.
  storeToolResult(result: ToolResultData): string; // returns ref string

  // Retrieve and consume a stored result (single-use).
  consumeToolResult(ref: string): ToolResultData | undefined;

  stop(): Promise<void>;
}
```

### `ToolResultData`

```ts
interface ToolResultData {
  readonly content: ReadonlyArray<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  readonly isError?: boolean;
}
```

### `buildToolResultFromData(data)`

Converts `ToolResultData` into a `PendingNotification` with method
`ui/notifications/tool-result`.

```ts
function buildToolResultFromData(data: ToolResultData): PendingNotification;
```

---

## `JsonRpcMcpBackend`

Generic backend for MCP servers exposing an HTTP JSON-RPC endpoint.

```ts
class JsonRpcMcpBackend implements McpBackend {
  constructor(options: JsonRpcMcpBackendOptions);
  handleMessage(
    session: BridgeSession,
    message: McpAppsMessage,
  ): Promise<McpAppsMessage | null>;
  readResource(uri: string): Promise<string | UiResourceResponse | null>;
}
```

### `JsonRpcMcpBackendOptions`

```ts
interface JsonRpcMcpBackendOptions {
  endpointUrl: string; // Full URL for JSON-RPC POST
  headers?: Readonly<Record<string, string>>; // Static request headers
  fetchFn?: typeof fetch; // Custom fetch (testing/custom runtimes)
}
```

### `McpBackend` (interface for custom backends)

```ts
interface McpBackend {
  handleMessage(
    session: BridgeSession,
    message: McpAppsMessage,
  ): Promise<McpAppsMessage | null>;
  readResource?(
    uri: string,
    request?: Request,
  ): Promise<string | UiResourceResponse | null>;
}
```

### `UiResourceResponse`

```ts
interface UiResourceResponse {
  html: string;
  csp?: CspOptions;
  pendingNotifications?: PendingNotification[];
}
```

---

## `BridgeClient`

Runs inside the webview. Injected automatically by `bridge.js` — only use
directly when building custom bridge clients.

```ts
class BridgeClient {
  constructor(options: BridgeClientOptions);
  start(): Promise<void>;
  destroy(): void;
  readonly isStarted: boolean;
  readonly currentHostContext: HostContext | null;
}
```

### `BridgeClientOptions`

```ts
interface BridgeClientOptions {
  serverUrl: string; // WebSocket URL of resource server
  platform: PlatformAdapter; // Platform adapter instance
  transport: BridgeTransport; // Transport (use WebSocketTransport)
  sessionId: string; // Session ID from resource server
  bridgeInfo?: { name: string; version: string }; // Reported in ui/initialize
  requestTimeoutMs?: number; // Default: 30000
}
```

---

## `TelegramPlatformAdapter`

Full `PlatformAdapter` implementation for Telegram Mini Apps. Use with
`BridgeClient` for custom client-side bridge setup.

```ts
class TelegramPlatformAdapter implements PlatformAdapter {
  readonly name: "telegram";
  initialize(): Promise<HostContext>; // calls tg.ready(), tg.expand()
  getTheme(): "light" | "dark"; // reads tg.colorScheme
  getContainerDimensions(): ContainerDimensions; // { width: innerWidth, maxHeight: viewportStableHeight }
  getAuthData(): Record<string, unknown>; // { initData, initDataUnsafe, platform, version }
  onLifecycleEvent(handler: LifecycleEventHandler): void;
  openLink(url: string): Promise<void>;
  sendMessage(text: string): Promise<void>; // calls tg.sendData() — CLOSES the Mini App
  destroy(): void;
}
```

Theme mapping from `TelegramThemeParams` to CSS variables (set in
`HostContext.styles.variables`):

| Telegram param            | CSS variable                   |
| ------------------------- | ------------------------------ |
| `bg_color`                | `--color-background-primary`   |
| `secondary_bg_color`      | `--color-background-secondary` |
| `text_color`              | `--color-text-primary`         |
| `subtitle_text_color`     | `--color-text-secondary`       |
| `section_separator_color` | `--color-border-primary`       |
| `accent_text_color`       | `--color-ring-primary`         |
| `hint_color`              | `--color-text-hint`            |
| `link_color`              | `--color-text-link`            |
| `button_color`            | `--color-button-primary`       |
| `button_text_color`       | `--color-button-text`          |
| `header_bg_color`         | `--color-background-header`    |
| `section_bg_color`        | `--color-background-section`   |

---

## `TelegramAdapter`

Minimal postMessage adapter (extends `BasePostMessageAdapter`). Does not handle
platform lifecycle, theme, or auth.

```ts
class TelegramAdapter extends BasePostMessageAdapter {
  readonly platform: "telegram";
}
```

---

## `LineAdapter`

Minimal LINE LIFF adapter (extends `BasePostMessageAdapter`). No LIFF SDK
initialization, no auth, no lifecycle events.

```ts
class LineAdapter extends BasePostMessageAdapter {
  readonly platform: "line";
}
```

---

## `McpAppsMethod`

Enum of well-known JSON-RPC method names.

```ts
const McpAppsMethod = {
  // Initialization
  UI_INITIALIZE: "ui/initialize",
  UI_NOTIFICATIONS_INITIALIZED: "ui/notifications/initialized",

  // App -> Host requests
  TOOLS_CALL: "tools/call",
  RESOURCES_READ: "resources/read",
  UI_OPEN_LINK: "ui/open-link",
  UI_MESSAGE: "ui/message",
  UI_UPDATE_MODEL_CONTEXT: "ui/update-model-context",
  UI_REQUEST_DISPLAY_MODE: "ui/request-display-mode",
  NOTIFICATIONS_MESSAGE: "notifications/message",

  // Host -> App notifications
  UI_TOOL_INPUT: "ui/notifications/tool-input",
  UI_TOOL_INPUT_PARTIAL: "ui/notifications/tool-input-partial",
  UI_TOOL_RESULT: "ui/notifications/tool-result",
  UI_TOOL_CANCELLED: "ui/notifications/tool-cancelled",
  UI_HOST_CONTEXT_CHANGED: "ui/notifications/host-context-changed",
  UI_SIZE_CHANGED: "ui/notifications/size-changed",
  UI_RESOURCE_TEARDOWN: "ui/resource-teardown",
} as const;
```

---

## Auth

### `createTelegramAuthHandler(botToken)`

Returns a `BridgeAuthHandler` that validates Telegram `initData` using
HMAC-SHA256.

```ts
function createTelegramAuthHandler(botToken: string): BridgeAuthHandler;
```

Accepts both `{ type: "auth", initData: "..." }` and
`{ type: "auth", payload: { initData: "..." } }`.

### `validateTelegramInitData(initData, botToken, maxAgeSeconds?)`

Low-level validation function. Returns `TelegramAuthResult`.

```ts
async function validateTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds?: number, // Default: 86400
): Promise<TelegramAuthResult>;
```

```ts
interface TelegramAuthResult {
  valid: boolean;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  authDate?: Date;
  error?: string;
}
```

### `BridgeAuthHandler` / `BridgeAuthResult`

```ts
type BridgeAuthHandler = (
  session: BridgeSession,
  message: Record<string, unknown>,
) => Promise<BridgeAuthResult>;

interface BridgeAuthResult {
  valid: boolean;
  principalId?: string | number;
  username?: string;
  context?: Record<string, unknown>;
  error?: string;
}
```

---

## Session

### `BridgeSession`

```ts
interface BridgeSession {
  readonly id: string;
  readonly platform: string;
  readonly createdAt: number;
  lastActivity: number;
  authenticated: boolean;
  principalId?: string | number;
  userId?: number;
  username?: string;
  authContext?: Record<string, unknown>;
  pendingNotifications?: PendingNotification[];
}
```

Sessions expire after 30 minutes of inactivity. Max 10,000 concurrent sessions.

### `SessionStore`

```ts
class SessionStore {
  constructor(maxAgeMs?: number); // Default: 30 * 60 * 1000
  create(platform: string): BridgeSession;
  get(id: string): BridgeSession | undefined;
  touch(id: string): void;
  remove(id: string): boolean;
  cleanup(): number; // removes expired sessions, returns count
  readonly size: number;
  clear(): void;
}
```

---

## Core types

### `HostContext`

Provided to MCP App during `ui/initialize`.

```ts
interface HostContext {
  theme: "light" | "dark";
  styles?: HostContextStyles;
  containerDimensions?: ContainerDimensions;
  platform?: "web" | "desktop" | "mobile";
  locale?: string;
  timeZone?: string;
  safeAreaInsets?: SafeAreaInsets;
}
```

### `ContainerDimensions`

```ts
interface ContainerDimensions {
  width?: number;
  maxWidth?: number;
  height?: number;
  maxHeight?: number;
}
```

Telegram: `TelegramPlatformAdapter` sets `width` (from `innerWidth`) and
`maxHeight` (from `viewportStableHeight`). `height` is not set.

### `HostContextStyles`

```ts
interface HostContextStyles {
  variables?: Record<string, string>; // CSS custom properties
  css?: { fonts?: string };
}
```

### `SafeAreaInsets`

```ts
interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
```

### `LifecycleEvent`

```ts
interface LifecycleEvent {
  type:
    | "theme-changed"
    | "viewport-changed"
    | "activated"
    | "deactivated"
    | "teardown";
  reason?: string;
}
```

### `DisplayMode`

```ts
type DisplayMode = "inline" | "fullscreen" | "pip";
```

### `McpToolDeclaration`

```ts
interface McpToolDeclaration {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  _meta?: {
    ui?: McpToolUiMeta & {
      csp?: McpToolUiCsp;
      permissions?: readonly McpAppPermission[];
    };
  };
}
```

### `McpAppPermission`

```ts
type McpAppPermission =
  | "allow-downloads"
  | "allow-forms"
  | "allow-modals"
  | "allow-popups"
  | "allow-same-origin"
  | "allow-scripts"
  | "camera"
  | "microphone"
  | "geolocation"
  | "clipboard-read"
  | "clipboard-write";
```

---

## Transport

### `WebSocketTransport`

Default transport implementation for `BridgeClient`.

```ts
class WebSocketTransport implements BridgeTransport {
  connect(url: string): Promise<void>;
  disconnect(): void;
  send(message: McpAppsMessage): void;
  onMessage(handler: TransportMessageHandler): void;
  onStateChange(handler: TransportStateHandler): void;
}
```

---

## Protocol builders

All return typed JSON-RPC message objects.

```ts
buildInitializeResponse(id, params): McpAppsResponse
buildInitializedNotification(): McpAppsNotification
buildHostContextChangedNotification(context: Partial<HostContext>): McpAppsNotification
buildErrorResponse(id, code, message): McpAppsErrorResponse
buildSuccessResponse(id, result): McpAppsResponse
buildLogNotification(level, message): McpAppsNotification
buildDisplayModeRequest(id, mode): McpAppsRequest
buildMessageRequest(id, text): McpAppsRequest
buildOpenLinkRequest(id, url): McpAppsRequest
buildResourceReadRequest(id, uri): McpAppsRequest
buildResourceTeardownRequest(id, reason?): McpAppsRequest
buildToolCallRequest(id, name, args): McpAppsRequest
buildToolCancelledNotification(toolCallId): McpAppsNotification
buildToolInputNotification(input): McpAppsNotification
buildToolResultNotification(result): McpAppsNotification
buildUpdateModelContextRequest(id, context): McpAppsRequest
nextRequestId(): number
```

### Type guards

```ts
isJsonRpcMessage(value: unknown): boolean
isRequest(message: McpAppsMessage): message is McpAppsRequest
isNotification(message: McpAppsMessage): message is McpAppsNotification
isResponse(message: McpAppsMessage): message is McpAppsResponse
isErrorResponse(message: McpAppsMessage): message is McpAppsErrorResponse
```

### `JsonRpcErrorCode`

```ts
enum JsonRpcErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
}
```

---

## Resource resolver

```ts
function parseResourceUri(uri: string): ResourceUri;
function resolveToHttp(uri: ResourceUri, options: ResolveToHttpOptions): string;
```

```ts
interface ResourceUri {
  raw: string;
  server: string;
  path: string;
  query: Record<string, string>;
}
```

---

## CSP helper

```ts
function buildCspHeader(options?: CspOptions): string;
```

---

## Telegram SDK bridge

```ts
function getTelegramWebApp(): TelegramWebApp;
```

Reads `window.Telegram.WebApp`. Throws if the Telegram SDK is not loaded.
