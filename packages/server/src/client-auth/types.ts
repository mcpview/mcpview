/**
 * OAuth client auth types.
 *
 * Interfaces for token storage and OAuth client configuration.
 * Used by OAuthClientProviderImpl to authenticate against
 * OAuth-protected MCP servers.
 *
 * @module lib/server/client-auth/types
 */

import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** Stored OAuth credentials for one MCP server */
export interface StoredCredentials {
  /** The MCP server URL these credentials are for */
  serverUrl: string;
  /** OAuth tokens (access_token, refresh_token, etc.) */
  tokens: OAuthTokens;
  /** When the tokens were obtained (Unix epoch ms) */
  obtainedAt: number;
  /**
   * Issuer that minted these credentials (SEP-2352).
   *
   * Absent on records written before the binding existed; `tokens()` treats
   * that as unusable, since nothing proves who minted them.
   */
  authServerUrl?: string;
}

/** Abstract token storage — consumers provide the implementation */
export interface TokenStore {
  /** Retrieve stored credentials for a server, or null if none */
  get(serverUrl: string): Promise<StoredCredentials | null>;
  /** Store credentials for a server */
  set(serverUrl: string, credentials: StoredCredentials): Promise<void>;
  /** Delete credentials for a server */
  delete(serverUrl: string): Promise<void>;
  /** List all server URLs with stored credentials */
  list(): Promise<string[]>;
}

/** Fields shared by all OAuth client registration modes. */
export interface OAuthClientConfigBase {
  /** Client name shown in consent screen */
  clientName?: string;
  /** Scopes to request (space-separated in OAuth, array here) */
  scopes?: string[];
  /** Token storage backend */
  tokenStore: TokenStore;
  /** Callback to open browser — injected by consumer (platform-specific) */
  openBrowser: (url: string) => Promise<void>;
  /** Callback server port (0 = OS auto-assign, default: 0) */
  callbackPort?: number;
  /** Timeout for user to complete OAuth flow (ms, default: 120_000) */
  authTimeout?: number;
  /**
   * Optional sink for credential-lifecycle events.
   *
   * Notably an authorization-server change (SEP-2352): the client silently
   * drops its stored credentials and re-authorizes, and an operator debugging
   * an unexpected login prompt has no other way to see why.
   */
  logger?: (message: string) => void;
}

/** Static OAuth client registration (default, backwards-compatible mode). */
export interface StaticClientConfig extends OAuthClientConfigBase {
  /** OAuth Client ID (public — embedded in consumer binary) */
  clientId: string;
  /** Absence of clientRegistration selects static client-id behavior. */
  clientRegistration?: undefined;
}

/** CIMD client registration (explicit opt-in). */
export interface CimdClientConfig extends OAuthClientConfigBase {
  /** In CIMD mode, client_id is derived from clientIdMetadataUrl. */
  clientId?: never;
  clientRegistration: {
    method: "client_id_metadata";
    /** HTTPS URL of the hosted Client ID Metadata Document; also the client_id. */
    clientIdMetadataUrl: string;
    /** Runtime redirect URI published in the metadata document. */
    redirectUri: string;
    /** Optional display and extension metadata for the hosted document. */
    metadata?: {
      client_uri?: string;
      logo_uri?: string;
      contacts?: string[];
      extra?: Record<string, unknown>;
    };
  };
}

/** Configuration for creating an OAuthClientProvider */
export type OAuthClientConfig = StaticClientConfig | CimdClientConfig;
