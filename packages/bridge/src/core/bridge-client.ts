/**
 * BridgeClient — the core of the MCP Apps Bridge.
 *
 * Runs client-side inside the platform webview. It:
 * 1. Monkey-patches `window.parent.postMessage` to intercept MCP JSON-RPC
 *    messages from the App class (`@modelcontextprotocol/ext-apps`).
 * 2. Routes intercepted messages to the resource server via BridgeTransport.
 * 3. Dispatches incoming messages from the resource server as MessageEvents
 *    to the App class.
 * 4. Translates platform lifecycle events into MCP notifications.
 * 5. Synthesizes the `ui/initialize` response using platform adapter data.
 *
 * This allows unmodified MCP App HTML to work inside Telegram/LINE webviews.
 */

import type { PlatformAdapter } from "./adapter.ts";
import { MessageRouter } from "./message-router.ts";
import {
  buildHostContextChangedNotification,
  buildInitializeResponse,
  isJsonRpcMessage,
} from "./protocol.ts";
import type { BridgeTransport } from "./transport.ts";
import type {
  HostCapabilities,
  HostContext,
  LifecycleEvent,
  McpAppsMessage,
  McpAppsRequest,
} from "./types.ts";
import { McpAppsMethod } from "./types.ts";

/** Options for creating a BridgeClient. */
export interface BridgeClientOptions {
  /** WebSocket URL of the resource server bridge endpoint. */
  readonly serverUrl: string;
  /** Platform adapter instance (Telegram, LINE, etc.). */
  readonly platform: PlatformAdapter;
  /** Transport implementation. Defaults to WebSocketTransport if not provided. */
  readonly transport: BridgeTransport;
  /** Session ID assigned by the resource server. */
  readonly sessionId: string;
  /** Bridge name/version reported in ui/initialize. */
  readonly bridgeInfo?: { readonly name: string; readonly version: string };
  /** Request timeout in ms. Defaults to 30_000. */
  readonly requestTimeoutMs?: number;
}

/**
 * The MCP Apps Bridge client.
 *
 * Injected into the MCP App HTML by the resource server (`bridge.js`).
 * Intercepts postMessage, routes via WebSocket, translates platform events.
 */
export class BridgeClient {
  private readonly platform: PlatformAdapter;
  private readonly transport: BridgeTransport;
  private readonly router: MessageRouter;
  private readonly options: BridgeClientOptions;

  private hostContext: HostContext | null = null;
  private started = false;

  private originalPostMessage:
    | ((
      message: unknown,
      targetOrigin: string,
      transfer?: Transferable[],
    ) => void)
    | null = null;

  constructor(options: BridgeClientOptions) {
    this.options = options;
    this.platform = options.platform;
    this.transport = options.transport;
    this.router = new MessageRouter();
  }

  /**
   * Start the bridge:
   * 1. Initialize the platform adapter to get HostContext
   * 2. Connect transport to resource server
   * 3. Intercept postMessage from App class
   * 4. Listen for platform lifecycle events
   * 5. Register ui/initialize handler to synthesize response
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error("[BridgeClient] Already started.");
    }

    // 1. Init platform and get host context
    this.hostContext = await this.platform.initialize();

    // 2. Connect transport
    const wsUrl =
      `${this.options.serverUrl}/bridge?session=${this.options.sessionId}`;
    await this.transport.connect(wsUrl);

    // 3. Forward incoming messages from resource server to App class
    this.transport.onMessage((message: McpAppsMessage) => {
      this.handleIncomingMessage(message);
    });

    // 4. Register handler for ui/initialize (App -> Bridge)
    this.router.onRequest(McpAppsMethod.UI_INITIALIZE, (params) => {
      return this.handleInitialize(params);
    });

    // 5. Register handler for ui/open-link (delegate to platform)
    this.router.onRequest(McpAppsMethod.UI_OPEN_LINK, async (params) => {
      const url = params?.url;
      if (typeof url !== "string") {
        throw new Error("ui/open-link requires a 'url' parameter.");
      }
      await this.platform.openLink(url);
      return {};
    });

    // 6. Intercept postMessage
    this.interceptPostMessage();

    // 7. Listen for platform lifecycle events
    this.platform.onLifecycleEvent((event: LifecycleEvent) => {
      this.handleLifecycleEvent(event);
    });

    this.started = true;
  }

  /** Stop the bridge, restore postMessage, disconnect transport. */
  destroy(): void {
    this.restorePostMessage();
    this.transport.disconnect();
    this.router.destroy();
    this.started = false;
  }

  /** Whether the bridge is currently running. */
  get isStarted(): boolean {
    return this.started;
  }

  /** The current host context (null before start). */
  get currentHostContext(): HostContext | null {
    return this.hostContext;
  }

  // -------------------------------------------------------------------------
  // postMessage interception
  // -------------------------------------------------------------------------

  private interceptPostMessage(): void {
    // deno-lint-ignore no-explicit-any
    const _global = globalThis as any;
    if (!_global.parent?.postMessage) {
      // Not in a frame context (e.g. server-side). Skip interception.
      return;
    }

    this.originalPostMessage = _global.parent.postMessage.bind(_global.parent);

    _global.parent.postMessage = (
      message: unknown,
      targetOrigin: string,
      transfer?: Transferable[],
    ) => {
      if (isJsonRpcMessage(message)) {
        // Route MCP JSON-RPC messages through the bridge
        this.handleOutgoingMessage(message as McpAppsMessage);
      } else if (this.originalPostMessage) {
        // Non-JSON-RPC messages pass through untouched
        this.originalPostMessage(message, targetOrigin, transfer);
      }
    };
  }

  private restorePostMessage(): void {
    if (this.originalPostMessage) {
      // deno-lint-ignore no-explicit-any
      const _global = globalThis as any;
      if (_global.parent) {
        _global.parent.postMessage = this.originalPostMessage;
      }
      this.originalPostMessage = null;
    }
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  /**
   * Handle an outgoing message from the MCP App (intercepted from postMessage).
   *
   * Requests that the bridge handles locally (ui/initialize, ui/open-link)
   * are dispatched to the router. All other messages are forwarded to the
   * resource server via transport.
   */
  private async handleOutgoingMessage(message: McpAppsMessage): Promise<void> {
    // Check if the router has a handler for this method
    if ("method" in message && this.router.hasRequestHandler(message.method)) {
      const response = await this.router.handleMessage(message);
      if (response) {
        this.dispatchToApp(response);
      }
      return;
    }

    // Check notification handlers
    if (
      "method" in message &&
      !("id" in message) &&
      this.router.hasNotificationHandler(message.method)
    ) {
      await this.router.handleMessage(message);
      return;
    }

    // Forward to resource server
    this.transport.send(message);

    // Track outgoing requests for response matching
    if ("id" in message && "method" in message) {
      const req = message as McpAppsRequest;
      this.router
        .trackRequest(
          req.id,
          req.method,
          this.options.requestTimeoutMs ?? 30_000,
        )
        .then((result) => {
          this.dispatchToApp({
            jsonrpc: "2.0",
            id: req.id,
            result,
          });
        })
        .catch((err: Error) => {
          this.dispatchToApp({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32603, message: err.message },
          });
        });
    }
  }

  /**
   * Handle an incoming message from the resource server.
   *
   * Responses are routed to the pending request tracker (which resolves the
   * Promise created in handleOutgoingMessage — that Promise already calls
   * dispatchToApp, so we must NOT dispatch responses again here).
   *
   * Notifications are dispatched directly to the App class.
   */
  private async handleIncomingMessage(message: McpAppsMessage): Promise<void> {
    // Responses: let the router resolve the tracked request.
    // The .then() in handleOutgoingMessage will call dispatchToApp.
    if ("result" in message || "error" in message) {
      await this.router.handleMessage(message);
      return;
    }

    // Notifications from resource server: dispatch to App class.
    // Only notifications (method + no id), not requests (method + id).
    if ("method" in message && !("id" in message)) {
      this.dispatchToApp(message);
    }
  }

  /** Dispatch a message to the MCP App class as a MessageEvent. */
  private dispatchToApp(message: McpAppsMessage): void {
    // deno-lint-ignore no-explicit-any
    const _global = globalThis as any;
    if (
      typeof _global.dispatchEvent === "function" &&
      typeof _global.MessageEvent === "function"
    ) {
      _global.dispatchEvent(
        new _global.MessageEvent("message", {
          data: message,
          origin: this.options.serverUrl,
        }),
      );
    }
  }

  // -------------------------------------------------------------------------
  // ui/initialize handler
  // -------------------------------------------------------------------------

  private handleInitialize(
    _params: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!this.hostContext) {
      throw new Error(
        "[BridgeClient] Platform not initialized. Cannot handle ui/initialize.",
      );
    }

    const info = this.options.bridgeInfo ?? {
      name: "@mcpview/bridge",
      version: "0.2.0",
    };

    const capabilities: HostCapabilities = {
      serverTools: { listChanged: false },
      serverResources: { listChanged: false },
      logging: {},
      openLinks: {},
    };

    const response = buildInitializeResponse("__placeholder__", {
      protocolVersion: "2025-11-25",
      hostInfo: info,
      hostCapabilities: capabilities,
      hostContext: this.hostContext,
    });

    // Return just the result (the router wraps it in a response)
    return response.result as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Platform lifecycle events
  // -------------------------------------------------------------------------

  private handleLifecycleEvent(event: LifecycleEvent): void {
    switch (event.type) {
      case "theme-changed": {
        const theme = this.platform.getTheme();
        if (this.hostContext) {
          this.hostContext = { ...this.hostContext, theme };
        }
        this.dispatchToApp(
          buildHostContextChangedNotification({ theme }),
        );
        break;
      }

      case "viewport-changed": {
        const containerDimensions = this.platform.getContainerDimensions();
        if (this.hostContext) {
          this.hostContext = { ...this.hostContext, containerDimensions };
        }
        this.dispatchToApp(
          buildHostContextChangedNotification({ containerDimensions }),
        );
        break;
      }

      case "teardown": {
        // Notify the app it's being torn down, then disconnect
        this.dispatchToApp({
          jsonrpc: "2.0",
          method: McpAppsMethod.UI_RESOURCE_TEARDOWN,
          params: { reason: event.reason ?? "platform-close" },
        });
        this.destroy();
        break;
      }

      case "activated":
      case "deactivated":
        // Internal lifecycle events — no MCP equivalent.
        // Could be used for session keepalive in the future.
        break;
    }
  }
}
