/**
 * Sugar helper for preparing an authenticated MCP transport.
 *
 * Wires together OAuthClientProviderImpl with a CallbackServer.
 * The consumer is responsible for creating the StreamableHTTPClientTransport
 * and passing `result.provider` as the `authProvider` option.
 *
 * @module lib/server/client-auth/connect
 */

import { OAuthClientProviderImpl } from "./provider.ts";
import type { OAuthClientConfig } from "./types.ts";
import { CallbackServer } from "./callback-server.ts";
import {
  CimdConfigError,
  isCimdConfig,
  resolveClientMode,
} from "./client-id-metadata.ts";

export interface PrepareOAuthResult {
  /** The configured provider — pass as authProvider to StreamableHTTPClientTransport */
  provider: OAuthClientProviderImpl;
  /** The callback server instance (caller must close on error paths) */
  callbackServer: CallbackServer;
  /** The actual port the callback server is listening on */
  callbackPort: number;
}

/**
 * Prepare an OAuth client provider with a running callback server.
 *
 * Usage:
 * ```typescript
 * const { provider, callbackServer } = await prepareOAuthProvider(serverUrl, config);
 * const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
 * await client.connect(transport);
 * ```
 */
export async function prepareOAuthProvider(
  serverUrl: string,
  config: OAuthClientConfig,
): Promise<PrepareOAuthResult> {
  const mode = resolveClientMode(config);
  const provider = new OAuthClientProviderImpl(serverUrl, config);
  const callbackServer = new CallbackServer({
    port: config.callbackPort ?? 0,
    hostname: mode === "client_id_metadata" ? "127.0.0.1" : "localhost",
    timeout: config.authTimeout ?? 120_000,
  });
  const { port } = await callbackServer.start();

  if (isCimdConfig(config)) {
    if (port !== config.callbackPort) {
      await callbackServer.close();
      throw new CimdConfigError(
        "cimd_redirect_mismatch",
        "CIMD callback server bound to a different port than callbackPort",
        {
          callbackPort: config.callbackPort,
          boundPort: port,
          redirectUri: config.clientRegistration.redirectUri,
        },
        "Set callbackPort to the fixed port used by the callback server and publish the same port in redirectUri.",
      );
    }
    provider.setRedirectUrl(config.clientRegistration.redirectUri);
  } else {
    provider.setRedirectUrl(`http://localhost:${port}/callback`);
  }

  return { provider, callbackServer, callbackPort: port };
}
