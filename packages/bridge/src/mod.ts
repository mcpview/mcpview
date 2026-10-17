/**
 * @module @mcpview/bridge
 *
 * Bridge MCP Apps (interactive UI delivered via the MCP protocol) to
 * messaging platforms such as Telegram Mini Apps and LINE LIFF.
 *
 * Entry point for Deno.
 */

// Core types
export type {
  AdapterConfig,
  BridgeOptions,
  ContainerDimensions,
  DisplayMode,
  HostCapabilities,
  HostContext,
  HostContextStyles,
  LifecycleEvent,
  McpAppPermission,
  McpAppsErrorResponse,
  McpAppsMessage,
  McpAppsNotification,
  McpAppsRequest,
  McpAppsResponse,
  McpToolDeclaration,
  McpToolUiCsp,
  McpToolUiMeta,
  ResourceUri,
  SafeAreaInsets,
} from "./core/types.ts";

export { McpAppsMethod } from "./core/types.ts";

// Adapter interfaces
export type {
  LifecycleEventHandler,
  McpAppsAdapter,
  MessageHandler,
  PlatformAdapter,
} from "./core/adapter.ts";

// Message router
export { MessageRouter } from "./core/message-router.ts";
export type {
  NotificationHandler,
  RequestHandler,
} from "./core/message-router.ts";

// Resource resolver
export { parseResourceUri, resolveToHttp } from "./core/resource-resolver.ts";
export type { ResolveToHttpOptions } from "./core/resource-resolver.ts";

// Protocol builders and validators
export {
  buildDisplayModeRequest,
  buildErrorResponse,
  buildHostContextChangedNotification,
  buildInitializedNotification,
  buildInitializeResponse,
  buildLogNotification,
  buildMessageRequest,
  buildOpenLinkRequest,
  buildResourceReadRequest,
  buildResourceTeardownRequest,
  buildSuccessResponse,
  buildToolCallRequest,
  buildToolCancelledNotification,
  buildToolInputNotification,
  buildToolResultNotification,
  buildUpdateModelContextRequest,
  isErrorResponse,
  isJsonRpcMessage,
  isNotification,
  isRequest,
  isResponse,
  JsonRpcErrorCode,
  nextRequestId,
} from "./core/protocol.ts";

// Transport
export { WebSocketTransport } from "./core/transport.ts";
export type {
  BridgeTransport,
  TransportMessageHandler,
  TransportStateHandler,
} from "./core/transport.ts";

// Bridge client
export { BridgeClient } from "./core/bridge-client.ts";
export type { BridgeClientOptions } from "./core/bridge-client.ts";

// Base adapter (for custom platform implementations)
export { BasePostMessageAdapter } from "./adapters/base-adapter.ts";

// Adapters — Telegram
export { TelegramAdapter } from "./adapters/telegram/adapter.ts";
export { TelegramPlatformAdapter } from "./adapters/telegram/platform-adapter.ts";
export type {
  TelegramAdapterConfig,
  TelegramEventType,
  TelegramSafeAreaInset,
  TelegramThemeParams,
  TelegramWebApp,
} from "./adapters/telegram/types.ts";
export { getTelegramWebApp } from "./adapters/telegram/sdk-bridge.ts";

// Adapters — LINE
export { LineAdapter } from "./adapters/line/adapter.ts";
export type { LiffSdk, LineAdapterConfig } from "./adapters/line/types.ts";

// Adapters — Network tunnel
export {
  attachNetworkTunnelSocket,
  NETWORK_PROTOCOL_VERSION,
  NetworkRelay,
  NetworkRelayError,
  NetworkTunnelClient,
  WebSocketNetworkTransport,
} from "./adapters/network/mod.ts";
export type {
  AttachNetworkTunnelSocketArgs,
  NetworkAgentHello,
  NetworkAgentHelloAuthorization,
  NetworkAgentHelloAuthorizer,
  NetworkAgentReady,
  NetworkError,
  NetworkHeartbeat,
  NetworkMessage,
  NetworkRelayConcurrencyStrategy,
  NetworkRelayErrorCode,
  NetworkRelayOptions,
  NetworkToolCallHandler,
  NetworkToolCallHandlerOptions,
  NetworkToolCallRequest,
  NetworkToolCallResponse,
  NetworkTransportAuth,
  NetworkTunnelClientOptions,
  NetworkTunnelCloseReason,
  NetworkTunnelReconnectOptions,
  NetworkTunnelSocket,
  NetworkTunnelTransport,
  NetworkWebSocketFactory,
  NetworkWebSocketFactoryOptions,
  NetworkWebSocketLike,
  RegisteredNetworkAgent,
  RegisteredNetworkAgentSendOptions,
  RelayToolCall,
  WebSocketNetworkTransportOptions,
} from "./adapters/network/mod.ts";

// Resource server
export { buildCspHeader } from "./resource-server/csp.ts";
export type { CspOptions } from "./resource-server/csp.ts";
export { createTelegramAuthHandler } from "./resource-server/auth.ts";
export type {
  BridgeAuthHandler,
  BridgeAuthResult,
} from "./resource-server/auth.ts";
export { injectBridgeScript } from "./resource-server/injector.ts";
export { JsonRpcMcpBackend } from "./resource-server/backend.ts";
export type {
  JsonRpcMcpBackendOptions,
  McpBackend,
  UiResourceResponse,
} from "./resource-server/backend.ts";
export { SessionStore } from "./resource-server/session.ts";
export type {
  BridgeSession,
  PendingNotification,
} from "./resource-server/session.ts";
export {
  buildToolResultFromData,
  startResourceServer,
} from "./resource-server/server.ts";
export type {
  ResourceServer,
  ResourceServerConfig,
  ToolResultData,
} from "./resource-server/server.ts";
export { validateTelegramInitData } from "./resource-server/telegram-auth.ts";
export type { TelegramAuthResult } from "./resource-server/telegram-auth.ts";
