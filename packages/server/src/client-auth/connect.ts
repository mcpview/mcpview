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
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { OAuthClientConfig } from "./types.ts";
import {
  CallbackServer,
  OAuthCallbackError,
  type OAuthCallbackResult,
} from "./callback-server.ts";
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
  /** Decoded callback; compare state with your expected value before finishAuth. */
  callbackPromise: Promise<OAuthCallbackResult>;
  /** Forward the captured response to the SDK, including its issuer parameter. */
  finishAuth(
    transport: Pick<StreamableHTTPClientTransport, "finishAuth">,
  ): Promise<void>;
}

/**
 * Prepare an OAuth client provider with a running callback server.
 *
 * Usage:
 * ```typescript
 * const { provider, callbackPromise, finishAuth } = await prepareOAuthProvider(serverUrl, config);
 * const transport = new StreamableHTTPClientTransport(new URL(serverUrl), { authProvider: provider });
 * // After the initial connection initiates authorization, compare the captured
 * // callback's state with your expected value, then complete and reconnect:
 * const callback = await callbackPromise;
 * await finishAuth(transport);
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
  const { port, callbackPromise } = await callbackServer.start();

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

  return {
    provider,
    callbackServer,
    callbackPort: port,
    callbackPromise,
    async finishAuth(transport) {
      const params = new URLSearchParams();
      try {
        const callback = await callbackPromise;
        params.set("code", callback.code);
        if (callback.iss !== undefined) params.set("iss", callback.iss);
        if (callback.state !== undefined) params.set("state", callback.state);
      } catch (error) {
        if (!(error instanceof OAuthCallbackError)) throw error;
        // Let the SDK validate the error response's issuer before surfacing its
        // untrusted error text, just as it does for successful callbacks.
        params.set("error", error.error);
        if (error.errorDescription !== undefined) {
          params.set("error_description", error.errorDescription);
        }
        if (error.iss !== undefined) params.set("iss", error.iss);
        if (error.state !== undefined) params.set("state", error.state);
      }
      await transport.finishAuth(params);
    },
  };
}
