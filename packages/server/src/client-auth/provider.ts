/**
 * OAuth client provider implementation.
 *
 * Implements OAuthClientProvider from the MCP SDK for authenticating
 * against OAuth-protected MCP servers. Handles token storage,
 * PKCE flow, and browser-based authorization.
 *
 * @module lib/server/client-auth/provider
 */

import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientConfig } from "./types.ts";
import {
  CimdConfigError,
  isCimdConfig,
  resolveClientMode,
  validateCimdClientConfig,
} from "./client-id-metadata.ts";

/**
 * Normalise an authorization server identifier before comparing it.
 *
 * `https://as.example.com` and `https://as.example.com/` name the same server,
 * and so do `HTTPS://AS.Example.com` and an explicit `:443`. Comparing raw
 * strings would read those as a server change and wipe valid credentials on
 * every call — a self-inflicted login loop. Falls back to the raw string if it
 * does not parse, which then simply never matches.
 */
function canonicalIssuer(value: string): string {
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

/**
 * An authorization server URL, safe to put in a log line.
 *
 * A URL may carry `userinfo` credentials, and a query string may carry a token
 * or an internal identifier. Origin and path are enough to tell an operator
 * which server is involved; the rest is only a way for secrets to reach a log
 * aggregator.
 */
function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

export class OAuthClientProviderImpl implements OAuthClientProvider {
  private serverUrl: string;
  private config: OAuthClientConfig;
  private _codeVerifier = "";
  private _clientInfo: OAuthClientInformationMixed | undefined;
  private _redirectUrl: string | undefined;
  /**
   * Issuer the SDK resolved for the request currently being authorized
   * (SEP-2352). Set by {@link saveDiscoveryState}, which `auth()` calls after
   * discovery and before it asks for tokens.
   */
  private _currentIssuer: string | undefined;

  constructor(serverUrl: string, config: OAuthClientConfig) {
    const mode = resolveClientMode(config);
    if (mode === "client_id_metadata") {
      validateCimdClientConfig(config);
    }
    this.serverUrl = serverUrl;
    this.config = config;
  }

  get redirectUrl(): string | URL {
    if (isCimdConfig(this.config)) {
      return this.config.clientRegistration.redirectUri;
    }
    return this._redirectUrl ?? "http://localhost:0/callback";
  }

  /** Set the redirect URL (called after CallbackServer binds to a port). */
  setRedirectUrl(url: string): void {
    if (isCimdConfig(this.config)) {
      if (url !== this.config.clientRegistration.redirectUri) {
        throw new CimdConfigError(
          "cimd_redirect_mismatch",
          "CIMD redirectUrl cannot differ from configured redirectUri",
          {
            redirectUrl: url,
            configuredRedirectUri: this.config.clientRegistration.redirectUri,
          },
          "Use clientRegistration.redirectUri as the runtime redirect URL.",
        );
      }
      return;
    }
    this._redirectUrl = url;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.config.clientName ?? "PML Client",
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client, PKCE only
      application_type: "native", // loopback CLI/desktop — prevents AS rejection of http://127.0.0.1 redirects
    };
  }

  clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (isCimdConfig(this.config)) {
      return Promise.resolve({
        client_id: this.config.clientRegistration.clientIdMetadataUrl,
      });
    }
    return Promise.resolve(
      this._clientInfo ?? {
        client_id: this.config.clientId,
      },
    );
  }

  saveClientInformation(
    info: OAuthClientInformationMixed,
  ): Promise<void> {
    this._clientInfo = info;
    return Promise.resolve();
  }

  /**
   * Record the authorization server the SDK just resolved (SEP-2352).
   *
   * `auth()` calls this after RFC 9728 discovery and before {@link tokens},
   * which is what makes the check there possible.
   *
   * The binding is the **discovered URL**, not `metadata.issuer`. That
   * distinction is the whole protection: `issuer` is a field the authorization
   * server publishes about itself, so an attacker's server reached at
   * `https://attacker.example.com` can claim
   * `issuer: "https://as-one.example.com"` and, since SDK 1.29 validates the
   * metadata's shape without checking it against the URL it was fetched from,
   * would be handed the credentials minted by the real AS-one. The URL the
   * client actually resolved is the one thing in this exchange the server
   * cannot forge.
   *
   * RFC 8414 does require `issuer` to match the discovery URL. A mismatch is
   * therefore a broken or hostile authorization server, and it is logged —
   * but nothing here depends on the claim being honest.
   */
  saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const resolved = canonicalIssuer(state.authorizationServerUrl);
    const claimed = state.authorizationServerMetadata?.issuer;

    if (claimed !== undefined && canonicalIssuer(claimed) !== resolved) {
      this.log(
        `authorization server at ${redactUrl(state.authorizationServerUrl)} ` +
          `claims issuer "${redactUrl(claimed)}" ` +
          "(RFC 8414 requires them to match); " +
          "binding credentials to the discovered URL",
      );
    }

    this._currentIssuer = resolved;
    return Promise.resolve();
  }

  /**
   * Stored tokens, unless they were issued by a different authorization server.
   *
   * SEP-2352 makes this a MUST, and the reason is concrete rather than
   * bureaucratic. `auth()` hands whatever this returns to
   * `refreshAuthorization(authorizationServerUrl, …)`, where the URL comes from
   * the MCP server's own protected-resource metadata. A server that changes —
   * or is made to advertise — a different authorization server would therefore
   * receive a refresh token minted by the previous one. The client must not let
   * the resource server pick who sees its credentials.
   *
   * The check only runs once an issuer is known, which is the case inside
   * `auth()`. A transport asking for the bearer to attach to an ordinary
   * request has no issuer in hand, and that path is not the exposure: those
   * tokens go to the MCP server they were minted for, not to an authorization
   * server.
   */
  async tokens(): Promise<OAuthTokens | undefined> {
    const stored = await this.config.tokenStore.get(this.serverUrl);
    if (!stored) return undefined;
    if (this._currentIssuer === undefined) return stored.tokens;

    if (stored.authServerUrl === undefined) {
      // Written before this binding existed: nothing proves which authorization
      // server minted them. Treated as unusable rather than trusted once —
      // the whole point is to stop handing credentials to an unverified party,
      // and "probably fine" is the assumption this check exists to remove. The
      // cost is one re-authorization per stored credential, at upgrade time.
      await this.config.tokenStore.delete(this.serverUrl);
      this.log(
        "discarding stored credentials with no recorded issuer (SEP-2352); re-authorization required",
      );
      return undefined;
    }

    if (canonicalIssuer(stored.authServerUrl) !== this._currentIssuer) {
      // A legitimate migration lands here too, and is handled the same way:
      // drop the old credentials and let the flow re-authorize against the new
      // server. What must not happen is the old refresh token travelling there.
      await this.config.tokenStore.delete(this.serverUrl);
      this.log(
        `authorization server changed for ${redactUrl(this.serverUrl)} ` +
          `(${redactUrl(stored.authServerUrl)} → ` +
          `${redactUrl(this._currentIssuer)}); ` +
          "stored credentials discarded, re-authorization required",
      );
      return undefined;
    }

    return stored.tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Sequential guard only: keep an existing refresh_token when a later save omits it.
    // This get/set is not atomic; concurrent saves for one serverUrl are unsupported
    // because refresh is serialized by the caller.
    const stored = await this.config.tokenStore.get(this.serverUrl);

    // …but only from the same authorization server. `auth({ authorizationCode })`
    // reaches here without going through `tokens()`, so this is the one path
    // where a credential from a previous issuer can survive: if the code
    // exchange returns no refresh token, carrying the old one over would
    // re-label another server's secret with the new issuer and hand it over on
    // the next refresh. A legacy record has no recorded issuer, so it cannot
    // clear this bar either.
    const inheritable = stored?.authServerUrl !== undefined &&
      this._currentIssuer !== undefined &&
      canonicalIssuer(stored.authServerUrl) === this._currentIssuer;

    const tokensToStore = tokens.refresh_token === undefined &&
        inheritable && stored?.tokens.refresh_token !== undefined
      ? { ...tokens, refresh_token: stored.tokens.refresh_token }
      : tokens;

    await this.config.tokenStore.set(this.serverUrl, {
      serverUrl: this.serverUrl,
      tokens: tokensToStore,
      obtainedAt: Date.now(),
      // Binds the credentials to their minter. Without it every save produces
      // exactly the legacy record `tokens()` has to throw away.
      ...(this._currentIssuer !== undefined
        ? { authServerUrl: this._currentIssuer }
        : {}),
    });
  }

  private log(message: string): void {
    this.config.logger?.(`[client-auth] ${message}`);
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.config.openBrowser(authorizationUrl.toString());
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    this._codeVerifier = codeVerifier;
    return Promise.resolve();
  }

  codeVerifier(): Promise<string> {
    return Promise.resolve(this._codeVerifier);
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all" || scope === "tokens") {
      await this.config.tokenStore.delete(this.serverUrl);
    }
    if (scope === "all" || scope === "verifier") {
      this._codeVerifier = "";
    }
    if (scope === "all" || scope === "client") {
      this._clientInfo = undefined;
    }
    if (scope === "all" || scope === "discovery") {
      // Keeping a stale issuer would make the next `tokens()` compare against
      // an authorization server the SDK has already given up on, and discard
      // credentials that are in fact still valid.
      this._currentIssuer = undefined;
    }
  }
}
