/**
 * OAuth client-auth helpers for MCP clients.
 *
 * Includes the local callback server, OAuth client provider wiring, token
 * stores, and Client ID Metadata Document (CIMD) helpers.
 *
 * @module lib/server/client-auth
 */

// OAuth provider wiring
export { prepareOAuthProvider } from "./connect.ts";
export type { PrepareOAuthResult } from "./connect.ts";

// OAuthClientProvider implementation
export { OAuthClientProviderImpl } from "./provider.ts";

// Local callback server
export { CallbackServer } from "./callback-server.ts";
export type { CallbackServerOptions } from "./callback-server.ts";

// Types
export type {
  CimdClientConfig,
  OAuthClientConfig,
  OAuthClientConfigBase,
  StaticClientConfig,
  StoredCredentials,
  TokenStore,
} from "./types.ts";

// Token stores
export { MemoryTokenStore } from "./token-store/memory-store.ts";
export { FileTokenStore } from "./token-store/file-store.ts";

// Client ID Metadata Documents (CIMD)
export {
  buildClientIdMetadataDocument,
  CimdConfigError,
  isCimdConfig,
} from "./client-id-metadata.ts";
export type {
  CimdConfigErrorCode,
  ClientIdMetadataDocument,
} from "./client-id-metadata.ts";
