/**
 * Authentication types for McpApp.
 *
 * Types follow RFC 9728 (OAuth Protected Resource Metadata)
 * and MCP Auth spec (draft 2025-11-25).
 *
 * @module lib/server/auth/types
 */

// ============================================================================
// HttpsUrl brand — 0.16.0
// ============================================================================

declare const httpsUrlBrand: unique symbol;

/**
 * A string that has been validated as a syntactically valid absolute HTTP(S)
 * URL. Cannot be constructed by type assertion — callers MUST go through
 * {@link httpsUrl} (which parses, normalizes, and throws on invalid input) so
 * the invariant is enforced at both the type level and runtime.
 *
 * Added in 0.16.0 to lift `resource_metadata_url`, `authorization_servers`,
 * and the URL-resource branch of {@link JwtAuthProviderOptions} from raw
 * `string` into a type that structurally encodes the invariant. The motivating
 * incident was 0.14.x silently producing `"://host/.well-known/..."` in
 * `WWW-Authenticate` headers when callers mis-set `resource` — a class of bug
 * that 0.15.x closed with runtime guards and 0.16.0 closes at the type level.
 */
export type HttpsUrl = string & { readonly [httpsUrlBrand]: never };

/**
 * Parse, validate, and normalize a string as an absolute HTTP(S) URL.
 *
 * Trims leading/trailing whitespace before parsing so YAML keys with trailing
 * spaces don't produce unparseable URLs. Delegates parsing to `new URL()`,
 * which lowercases the scheme — so `HTTPS://foo.com` is accepted and returned
 * as `https://foo.com/`.
 *
 * @throws if the string is empty/whitespace-only, unparseable as a URL, or
 *         uses a non-HTTP(S) scheme (RFC 9728 § 3 requires HTTPS for metadata
 *         documents; http is permitted here for local dev only).
 *
 * @example
 * ```typescript
 * const url = httpsUrl("https://my-mcp.example.com");
 * // url is of type HttpsUrl and can be passed wherever HttpsUrl is required.
 * ```
 */
export function httpsUrl(raw: string): HttpsUrl {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(
      `[httpsUrl] empty or whitespace-only string is not a valid URL. ` +
        `Expected an absolute HTTP(S) URL like ` +
        `"https://my-mcp.example.com/.well-known/oauth-protected-resource".`,
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `[httpsUrl] not a parseable URL: ${JSON.stringify(raw)}. ` +
        `Expected an absolute HTTP(S) URL like ` +
        `"https://my-mcp.example.com/.well-known/oauth-protected-resource".`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `[httpsUrl] must use http:// or https:// scheme, got ${
        JSON.stringify(parsed.protocol)
      } in ${JSON.stringify(raw)}. Per RFC 9728 § 3, the protected resource ` +
        `metadata document must be served over HTTP(S).`,
    );
  }
  return parsed.toString() as HttpsUrl;
}

/**
 * Non-throwing variant of {@link httpsUrl}. Returns the normalized `HttpsUrl`
 * on success, `null` on any validation failure. Use this when you need to
 * branch on validity without catching exceptions — typically to detect whether
 * an RFC 9728 § 2 `resource` identifier is an HTTP(S) URL (the URL-resource
 * branch) or an opaque URI (the opaque-resource branch that requires an
 * explicit metadata URL).
 */
export function tryHttpsUrl(raw: string): HttpsUrl | null {
  try {
    return httpsUrl(raw);
  } catch {
    return null;
  }
}

// ============================================================================
// Runtime auth types
// ============================================================================

/**
 * Information extracted from a validated token.
 * Frozen (Object.freeze) before being passed to tool handlers.
 */
export interface AuthInfo {
  /** User ID (sub claim from JWT) */
  subject: string;

  /** OAuth client ID (optional - azp or client_id claim) */
  clientId?: string;

  /** Granted scopes */
  scopes: string[];

  /** Additional JWT claims */
  claims?: Record<string, unknown>;

  /** Token expiration timestamp (Unix epoch seconds) */
  expiresAt?: number;

  /**
   * Tenant identifier for multi-tenant servers.
   *
   * Populated by `createMultiTenantMiddleware` when a `TenantResolver`
   * is configured. Undefined on single-tenant servers.
   *
   * Tool handlers in multi-tenant servers should read this (never trust
   * raw JWT claims directly) to scope data access to the current tenant.
   */
  tenantId?: string;
}

/**
 * Auth configuration slot for {@link McpAppOptions.auth}.
 *
 * 0.17.0: slimmed to a single `provider` field. Previously exposed
 * `authorizationServers`, `resource`, and `scopesSupported` fields that
 * were NEVER read by `McpApp` at runtime (only `provider` was consumed at
 * `mcp-app.ts:1061`). Those fields were vestigial from a pre-0.15 design
 * where `McpApp` could auto-construct a `JwtAuthProvider` from its own
 * `auth:` option; that auto-construction path was removed when
 * `createAuthProviderFromConfig` took over YAML/env provider construction,
 * but the dead fields stayed in the interface. 0.17.0 deletes them as part
 * of the auth-module cleanup (mcpview/mcpview#13).
 *
 * The interface is kept (rather than reducing `McpAppOptions.auth` to a
 * bare `AuthProvider`) so that future additions like pipeline-level auth
 * hooks have a named extension point without another BC break.
 */
export interface AuthOptions {
  /**
   * The `AuthProvider` that validates bearer tokens and produces RFC 9728
   * metadata. Construct via {@link JwtAuthProvider}, any of the preset
   * factories (`createGitHubAuthProvider`, `createGoogleAuthProvider`,
   * `createAuth0AuthProvider`, `createOIDCAuthProvider`), or a custom
   * `AuthProvider` subclass for non-JWT token schemes.
   */
  provider: AuthProvider;
}

// Forward reference - actual class is in provider.ts
import type { AuthProvider } from "./provider.ts";

/**
 * RFC 9728 Protected Resource Metadata.
 * Returned by /.well-known/oauth-protected-resource
 *
 * @see https://datatracker.ietf.org/doc/html/rfc9728
 */
export interface ProtectedResourceMetadata {
  /**
   * RFC 9728 § 2 resource identifier. URI that identifies the protected
   * resource — used as the JWT `aud` claim. Can be an HTTP(S) URL OR an
   * opaque URI (e.g., an OIDC project ID). Stays `string` because RFC 9728
   * explicitly allows opaque URIs; callers must NOT assume it parses as
   * an URL.
   */
  resource: string;

  /**
   * Absolute HTTP(S) URL where this metadata document is served publicly.
   * Per RFC 9728 § 3, this is the URL a client discovers via the
   * WWW-Authenticate challenge. Always an HTTP(S) URL, regardless of
   * whether `resource` itself is an URL or an opaque URI.
   *
   * 0.16.0: typed as {@link HttpsUrl} (branded). The invariant is now
   * structurally enforced — producers must construct the value via
   * {@link httpsUrl}, which validates at runtime AND returns the brand.
   * Prior to 0.16.0 this was a raw `string` guarded only by a runtime
   * validator in the `JwtAuthProvider` constructor (0.15.1).
   */
  resource_metadata_url: HttpsUrl;

  /**
   * Authorization servers that can issue valid tokens.
   *
   * 0.16.0: each element is branded as {@link HttpsUrl} so downstream
   * consumers (e.g., MCP clients building discovery URLs) can rely on
   * them being parseable absolute URLs without re-validation. Construct
   * via {@link httpsUrl}.
   */
  authorization_servers: HttpsUrl[];

  /** Scopes this resource supports */
  scopes_supported?: string[];

  /** How bearer tokens can be presented (always ["header"]) */
  bearer_methods_supported: string[];
}
