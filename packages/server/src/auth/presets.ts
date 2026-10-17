/**
 * OIDC auth provider presets.
 *
 * Factory functions for common OIDC providers. Each preset pre-configures
 * the issuer, JWKS URI, and authorization server for the provider.
 *
 * Bridge layer (0.16.0): presets accept raw `string` fields for `resource`,
 * `resourceMetadataUrl`, and `authorizationServers`, then wrap them through
 * {@link httpsUrl} before passing to the branded {@link JwtAuthProviderOptions}
 * constructor. This keeps the YAML/env config pipeline (`createAuthProviderFromConfig`)
 * working with raw strings while the core `JwtAuthProvider` API enforces the
 * `HttpsUrl` brand at the type level.
 *
 * @module lib/server/auth/presets
 */

import { JwtAuthProvider } from "./jwt-provider.ts";
import { type HttpsUrl, httpsUrl, tryHttpsUrl } from "./types.ts";

/**
 * Base options shared by all presets.
 */
export interface PresetOptions {
  /** JWT audience (aud claim) */
  audience: string;
  /**
   * RFC 9728 § 2 resource identifier, as a raw string. Presets detect
   * whether this is an HTTP(S) URL or an opaque URI and pick the correct
   * {@link JwtAuthProviderOptions} branch internally. When opaque, you
   * MUST also supply {@link resourceMetadataUrl}.
   */
  resource: string;
  /** Scopes supported by this server */
  scopesSupported?: string[];
  /**
   * Absolute HTTP(S) URL where the `/.well-known/oauth-protected-resource`
   * metadata document is served publicly (RFC 9728 § 3). Required when
   * `resource` is an opaque URI; optional when `resource` is itself an
   * HTTP(S) URL (in which case the preset auto-derives). Empty and
   * whitespace-only values are treated as absent.
   */
  resourceMetadataUrl?: string;
}

/**
 * Options for {@link createOIDCAuthProvider}. Unlike 0.15.x where this
 * function accepted `JwtAuthProviderOptions` directly, 0.16.0 exposes a
 * preset-style interface with raw string fields — the preset wraps them
 * through {@link httpsUrl} internally.
 *
 * BREAKING: callers that previously passed a pre-built
 * `JwtAuthProviderOptions` to `createOIDCAuthProvider` must now pass
 * raw strings. Migration: just drop the `httpsUrl()` wrappers you'd
 * otherwise need at the call site.
 */
export interface OIDCPresetOptions extends PresetOptions {
  /** OIDC issuer (typically an HTTPS URL) */
  issuer: string;
  /**
   * JWKS URI for signature validation. Defaults to
   * `{issuer}/.well-known/jwks.json`.
   */
  jwksUri?: string;
  /**
   * Authorization servers, as raw strings. Defaults to `[issuer]` when
   * omitted. Each entry must be a valid absolute HTTP(S) URL — the preset
   * validates via {@link httpsUrl}.
   */
  authorizationServers?: string[];
}

/**
 * GitHub Actions OIDC provider.
 *
 * Validates tokens issued by GitHub Actions workflows.
 * Issuer: https://token.actions.githubusercontent.com
 *
 * @example
 * ```typescript
 * const provider = createGitHubAuthProvider({
 *   audience: "https://my-mcp.example.com",
 *   resource: "https://my-mcp.example.com",
 * });
 * ```
 */
export function createGitHubAuthProvider(
  options: PresetOptions,
): JwtAuthProvider {
  return buildJwtAuthProvider({
    issuer: "https://token.actions.githubusercontent.com",
    audience: options.audience,
    authorizationServers: ["https://token.actions.githubusercontent.com"],
    scopesSupported: options.scopesSupported,
    resource: options.resource,
    resourceMetadataUrl: options.resourceMetadataUrl,
  }, "createGitHubAuthProvider");
}

/**
 * Google OIDC provider.
 *
 * Validates tokens issued by Google accounts.
 * Issuer: https://accounts.google.com
 *
 * @example
 * ```typescript
 * const provider = createGoogleAuthProvider({
 *   audience: "https://my-mcp.example.com",
 *   resource: "https://my-mcp.example.com",
 * });
 * ```
 */
export function createGoogleAuthProvider(
  options: PresetOptions,
): JwtAuthProvider {
  return buildJwtAuthProvider({
    issuer: "https://accounts.google.com",
    audience: options.audience,
    authorizationServers: ["https://accounts.google.com"],
    jwksUri: "https://www.googleapis.com/oauth2/v3/certs",
    scopesSupported: options.scopesSupported,
    resource: options.resource,
    resourceMetadataUrl: options.resourceMetadataUrl,
  }, "createGoogleAuthProvider");
}

/**
 * Auth0 OIDC provider.
 *
 * Validates tokens issued by an Auth0 tenant.
 * Issuer: https://{domain}/
 *
 * @example
 * ```typescript
 * const provider = createAuth0AuthProvider({
 *   domain: "my-tenant.auth0.com",
 *   audience: "https://my-mcp.example.com",
 *   resource: "https://my-mcp.example.com",
 * });
 * ```
 */
export function createAuth0AuthProvider(
  options: PresetOptions & { domain: string },
): JwtAuthProvider {
  const issuer = `https://${options.domain}/`;
  return buildJwtAuthProvider({
    issuer,
    audience: options.audience,
    authorizationServers: [issuer],
    jwksUri: `${issuer}.well-known/jwks.json`,
    scopesSupported: options.scopesSupported,
    resource: options.resource,
    resourceMetadataUrl: options.resourceMetadataUrl,
  }, "createAuth0AuthProvider");
}

/**
 * Generic OIDC provider.
 *
 * For any OIDC-compliant provider not covered by presets.
 *
 * @example
 * ```typescript
 * const provider = createOIDCAuthProvider({
 *   issuer: "https://my-idp.example.com",
 *   audience: "https://my-mcp.example.com",
 *   resource: "https://my-mcp.example.com",
 *   authorizationServers: ["https://my-idp.example.com"],
 * });
 * ```
 */
export function createOIDCAuthProvider(
  options: OIDCPresetOptions,
): JwtAuthProvider {
  return buildJwtAuthProvider({
    issuer: options.issuer,
    audience: options.audience,
    jwksUri: options.jwksUri,
    authorizationServers: options.authorizationServers ?? [options.issuer],
    scopesSupported: options.scopesSupported,
    resource: options.resource,
    resourceMetadataUrl: options.resourceMetadataUrl,
  }, "createOIDCAuthProvider");
}

// ============================================================================
// Public bridge: raw strings → branded JwtAuthProviderOptions
// ============================================================================

/**
 * Raw-string options accepted by {@link buildJwtAuthProvider}. Mirrors
 * {@link JwtAuthProviderOptions} but with all URL fields as plain `string`
 * instead of {@link HttpsUrl}, and without the `kind` discriminant tag
 * (the bridge auto-detects).
 *
 * Exported for 3rd-party OIDC provider implementations that want to accept
 * YAML/env-style raw string config and delegate URL validation to the
 * bridge instead of reimplementing it. See `createGitHubAuthProvider`,
 * `createGoogleAuthProvider`, `createAuth0AuthProvider`, and
 * `createOIDCAuthProvider` for built-in consumers.
 */
export interface BuildJwtAuthProviderOptions {
  /** JWT issuer (iss claim) */
  issuer: string;
  /** JWT audience (aud claim) */
  audience: string;
  /**
   * JWKS URI for signature validation. Defaults to
   * `{issuer}/.well-known/jwks.json` when omitted.
   */
  jwksUri?: string;
  /**
   * Authorization servers that issue valid tokens, as raw strings. Each
   * entry must be a valid absolute HTTP(S) URL — the bridge validates
   * via {@link httpsUrl} and throws with a preset-named error if invalid.
   */
  authorizationServers: string[];
  /** Scopes supported by this server */
  scopesSupported?: string[];
  /**
   * RFC 9728 § 2 resource identifier, as a raw string. The bridge detects
   * whether this is an HTTP(S) URL or an opaque URI and picks the correct
   * {@link JwtAuthProviderOptions} branch internally. When opaque, you
   * MUST also supply {@link resourceMetadataUrl}.
   */
  resource: string;
  /**
   * Absolute HTTP(S) URL where the `/.well-known/oauth-protected-resource`
   * metadata document is served publicly (RFC 9728 § 3). Required when
   * `resource` is an opaque URI; optional when `resource` is itself an
   * HTTP(S) URL. Empty and whitespace-only values are treated as absent.
   */
  resourceMetadataUrl?: string;
}

/**
 * Bridge raw-string options to a fully-constructed `JwtAuthProvider`.
 *
 * This is the shared validation + DU-branch-selection pathway used by all
 * four built-in preset factories (`createGitHubAuthProvider` et al). 0.17.0
 * exports it as public API so 3rd-party OIDC provider implementations
 * (Keycloak, Zitadel custom, Okta, ...) can reuse the same pathway instead
 * of reimplementing URL-vs-opaque detection, `HttpsUrl` wrapping, and
 * empty-metadata fall-through.
 *
 * Rules:
 * - `authorizationServers[]`: every entry must be a valid absolute HTTP(S)
 *   URL. Invalid entries throw with a `[${label}] authorizationServers[i]`
 *   prefix for pinpointing.
 * - `resource`: if parseable as HTTP(S) URL → `UrlResource` branch (metadata
 *   URL derivable per RFC 9728 § 3.1). Otherwise → `OpaqueResource` branch
 *   requiring explicit `resourceMetadataUrl`.
 * - `resourceMetadataUrl`: empty or whitespace-only strings are treated as
 *   absent (matches YAML-key-with-no-value semantics from 0.15.1).
 *
 * @param opts Raw-string options, as from YAML/env config.
 * @param label Identifier used in error messages — REQUIRED. Pass your
 *   factory name so error prefixes point at the actual caller rather than
 *   the anonymous bridge layer. E.g., `"createKeycloakAuthProvider"`.
 *   (0.17.0: required, was optional with a misleading default in the
 *   draft — type-design review recommendation Q4.)
 *
 * @example Custom OIDC provider factory
 * ```typescript
 * import { buildJwtAuthProvider, type JwtAuthProvider } from "@casys/mcp-server";
 *
 * export interface KeycloakPresetOptions {
 *   keycloakHost: string;
 *   realm: string;
 *   audience: string;
 *   resource: string;
 *   resourceMetadataUrl?: string;
 * }
 *
 * export function createKeycloakAuthProvider(
 *   options: KeycloakPresetOptions,
 * ): JwtAuthProvider {
 *   const issuer = `https://${options.keycloakHost}/realms/${options.realm}`;
 *   return buildJwtAuthProvider({
 *     issuer,
 *     audience: options.audience,
 *     authorizationServers: [issuer],
 *     jwksUri: `${issuer}/protocol/openid-connect/certs`,
 *     resource: options.resource,
 *     resourceMetadataUrl: options.resourceMetadataUrl,
 *   }, "createKeycloakAuthProvider");
 * }
 * ```
 */
export function buildJwtAuthProvider(
  opts: BuildJwtAuthProviderOptions,
  label: string,
): JwtAuthProvider {
  const wrappedAuthServers: HttpsUrl[] = opts.authorizationServers.map(
    (raw, i) => {
      try {
        return httpsUrl(raw);
      } catch (err) {
        throw new Error(
          `[${label}] authorizationServers[${i}] is not a valid ` +
            `HTTP(S) URL: ${(err as Error).message}`,
        );
      }
    },
  );

  const explicitMetadata: HttpsUrl | undefined = opts.resourceMetadataUrl &&
      opts.resourceMetadataUrl.trim().length > 0
    ? httpsUrl(opts.resourceMetadataUrl)
    : undefined;

  const base = {
    issuer: opts.issuer,
    audience: opts.audience,
    jwksUri: opts.jwksUri,
    authorizationServers: wrappedAuthServers,
    scopesSupported: opts.scopesSupported,
  };

  const resourceUrl = tryHttpsUrl(opts.resource);
  if (resourceUrl !== null) {
    // URL resource branch — metadata URL optional (derivable). 0.17.0 sets
    // the explicit `kind: "url"` tag so the DU narrowing in the constructor
    // body is structurally sound.
    return new JwtAuthProvider({
      ...base,
      kind: "url",
      resource: resourceUrl,
      resourceMetadataUrl: explicitMetadata,
    });
  }

  // Opaque resource branch — metadata URL required
  if (!explicitMetadata) {
    throw new Error(
      `[${label}] resourceMetadataUrl is required when 'resource' is ` +
        `not an HTTP(S) URL (got resource=${JSON.stringify(opts.resource)}). ` +
        `Per RFC 9728 § 2, 'resource' can be an opaque URI (e.g., an OIDC ` +
        `project ID used as JWT audience); in that case the metadata ` +
        `document URL is a separate concept and must be provided explicitly. ` +
        `Set 'resourceMetadataUrl' to the HTTPS URL where your ` +
        `/.well-known/oauth-protected-resource endpoint is served publicly.`,
    );
  }
  return new JwtAuthProvider({
    ...base,
    kind: "opaque",
    resource: opts.resource,
    resourceMetadataUrl: explicitMetadata,
  });
}
