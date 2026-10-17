// deno-lint-ignore-file require-await
/**
 * Static (opaque) bearer-token auth provider.
 *
 * Validates a fixed set of pre-shared bearer tokens with no OIDC/JWT
 * infrastructure — no issuer, no JWKS endpoint, no key management. Suited to
 * same-network deployments (Docker, VPN, LAN), server-to-server integrations,
 * and CI pipelines where a full OAuth flow is disproportionate.
 *
 * The original string-list form maps every valid token to one shared
 * {@link AuthInfo}. An identity-aware credential form can instead assign a
 * distinct subject and scopes to each token. For externally issued identity,
 * expiry, rotation policy, or SSO, use {@link JwtAuthProvider} / the OIDC
 * presets instead.
 *
 * Per RFC 9728 the emitted {@link ProtectedResourceMetadata} carries an empty
 * `authorization_servers` array: there is no authorization server in a static
 * token scheme — tokens are provisioned out of band — which is the correct
 * signal for clients not to attempt AS discovery.
 *
 * @module lib/server/auth/static-token-provider
 */

import { AuthProvider } from "./provider.ts";
import {
  type AuthInfo,
  type HttpsUrl,
  httpsUrl,
  type ProtectedResourceMetadata,
} from "./types.ts";

/**
 * One opaque bearer token with caller identity owned by the resource server.
 *
 * Use this form only when the server provisions its own long-lived credentials.
 * The token is used exclusively as a lookup key; it is never copied into the
 * resulting {@link AuthInfo}, metadata, logs, or validation errors.
 */
export interface StaticTokenCredential {
  /** Opaque bearer token, normally loaded from env or a secrets manager. */
  readonly token: string;
  /** Stable non-empty caller identity. Reserved/control values are invalid. */
  readonly subject: string;
  /** Scopes granted to this credential. Default `[]`. */
  readonly scopes?: readonly string[];
}

/**
 * Options for {@link createStaticTokenAuthProvider} /
 * {@link StaticTokenAuthProvider}.
 */
export interface StaticTokenAuthProviderOptions {
  /**
   * RFC 9728 § 2 resource identifier — an absolute HTTP(S) URL identifying
   * this server, validated via {@link httpsUrl} at construction. Required: the
   * {@link AuthProvider} contract must emit Protected Resource Metadata, which
   * needs a resource URL.
   */
  resource: string;
  /**
   * `subject` reported in {@link AuthInfo} for every valid token in the shared
   * string-list form. Rejected when identity-aware credentials are used.
   * Default `"static-token-user"`.
   */
  subject?: string;
  /**
   * `scopes` granted to every valid token in the shared string-list form.
   * Default `[]` — a pure gate with no scopes, which is the common same-network
   * case. Rejected when identity-aware credentials are used.
   */
  scopes?: readonly string[];
  /**
   * `scopes_supported` advertised in the metadata document (what the resource
   * accepts). Defaults to shared `scopes` for the string-list form and to the
   * union of credential scopes for the identity-aware form.
   */
  scopesSupported?: readonly string[];
  /**
   * Explicit Protected Resource Metadata URL. When omitted it is auto-derived
   * from `resource` per RFC 9728 § 3.1, identically to {@link JwtAuthProvider}.
   * Empty / whitespace-only values are treated as absent.
   */
  resourceMetadataUrl?: string;
}

function freezeScopes(scopes: readonly string[]): string[] {
  return Object.freeze([...scopes]) as string[];
}

function freezeAuthInfo(
  subject: string,
  scopes: readonly string[],
): AuthInfo {
  return Object.freeze({
    subject,
    scopes: freezeScopes(scopes),
  }) as AuthInfo;
}

function normalizeScopeList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `[StaticTokenAuthProvider] ${field} must be an array of non-empty strings`,
    );
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const [index, rawScope] of value.entries()) {
    if (typeof rawScope !== "string" || rawScope.trim().length === 0) {
      throw new Error(
        `[StaticTokenAuthProvider] ${field} contains an invalid scope at index ${index}`,
      );
    }
    const scope = rawScope.trim();
    if (!seen.has(scope)) {
      seen.add(scope);
      normalized.push(scope);
    }
  }
  return normalized;
}

function normalizeCredentialScopes(value: unknown, index: number): string[] {
  if (value === undefined) return [];
  return normalizeScopeList(value, `credential at index ${index} scopes`);
}

function containsAsciiControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

/**
 * {@link AuthProvider} that accepts a fixed set of opaque bearer tokens.
 *
 * Token lookup is O(1) via a pre-built `Map`. The string-list form stores the
 * same frozen {@link AuthInfo} for every token; the credential form stores one
 * distinct frozen value per token. Tokens are trimmed to match the bearer value
 * the HTTP middleware extracts. Note that `Map.get()` is not constant-time —
 * prefer long, high-entropy tokens (>= 32 random bytes) and rotate them
 * regularly.
 *
 * @example
 * ```typescript
 * const provider = new StaticTokenAuthProvider(
 *   [Deno.env.get("MCP_AUTH_TOKEN")!],
 *   { resource: "https://my-mcp.example.com", scopes: ["tools:invoke"] },
 * );
 * ```
 *
 * @example Identity-aware credentials
 * ```typescript
 * const provider = new StaticTokenAuthProvider(
 *   [
 *     { token: aliceToken, subject: "alice", scopes: ["erp:read"] },
 *     {
 *       token: automationToken,
 *       subject: "automation",
 *       scopes: ["erp:read", "erp:write"],
 *     },
 *   ],
 *   { resource: "https://my-mcp.example.com" },
 * );
 * ```
 */
export class StaticTokenAuthProvider extends AuthProvider {
  private readonly authByToken: Map<string, AuthInfo>;
  private readonly resource: string;
  private readonly resourceMetadataUrl: HttpsUrl;
  private readonly scopesSupported: string[] | undefined;

  constructor(
    entries: readonly string[] | readonly StaticTokenCredential[],
    options: StaticTokenAuthProviderOptions,
  ) {
    super();

    if (entries.length === 0) {
      throw new Error(
        "[StaticTokenAuthProvider] `tokens` must contain at least one token",
      );
    }

    const rawEntries = entries as readonly unknown[];
    const allStrings = rawEntries.every((entry) => typeof entry === "string");
    const allObjects = rawEntries.every((entry) =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry)
    );
    if (!allStrings && !allObjects) {
      throw new Error(
        "[StaticTokenAuthProvider] entries must be either all token strings or all credential objects",
      );
    }

    const authByToken = new Map<string, AuthInfo>();
    let scopesSupported: string[] | undefined;

    if (allStrings) {
      const tokens = rawEntries as readonly string[];
      if (tokens.some((token) => token.trim().length === 0)) {
        throw new Error(
          "[StaticTokenAuthProvider] `tokens` must not contain empty entries",
        );
      }

      // Keep the original shared-authority contract exactly: normalized
      // duplicates collapse, and every token resolves to this same object.
      const sharedAuthInfo = freezeAuthInfo(
        options.subject ?? "static-token-user",
        options.scopes ?? [],
      );
      const scopes = sharedAuthInfo.scopes;
      for (const token of tokens) authByToken.set(token.trim(), sharedAuthInfo);

      scopesSupported = options.scopesSupported !== undefined
        ? freezeScopes(options.scopesSupported)
        : (scopes.length > 0 ? scopes : undefined);
    } else {
      if (options.subject !== undefined || options.scopes !== undefined) {
        throw new Error(
          "[StaticTokenAuthProvider] identity-aware credentials cannot be combined with shared `subject` or `scopes` options",
        );
      }

      const grantedScopes: string[] = [];
      const grantedScopeSet = new Set<string>();
      for (const [index, rawEntry] of rawEntries.entries()) {
        const entry = rawEntry as Record<string, unknown>;
        if (
          typeof entry.token !== "string" || entry.token.trim().length === 0
        ) {
          throw new Error(
            `[StaticTokenAuthProvider] credential at index ${index} must contain a non-empty token`,
          );
        }
        const token = entry.token.trim();
        if (authByToken.has(token)) {
          throw new Error(
            `[StaticTokenAuthProvider] duplicate token mapping at credential index ${index}`,
          );
        }

        if (
          typeof entry.subject !== "string" ||
          entry.subject.trim().length === 0 ||
          entry.subject.trim() === "unknown" ||
          containsAsciiControl(entry.subject.trim())
        ) {
          throw new Error(
            `[StaticTokenAuthProvider] credential at index ${index} must contain a non-empty, non-reserved subject without control characters`,
          );
        }
        const subject = entry.subject.trim();
        const scopes = normalizeCredentialScopes(entry.scopes, index);
        for (const scope of scopes) {
          if (!grantedScopeSet.has(scope)) {
            grantedScopeSet.add(scope);
            grantedScopes.push(scope);
          }
        }
        authByToken.set(token, freezeAuthInfo(subject, scopes));
      }

      if (options.scopesSupported !== undefined) {
        const declaredScopes = normalizeScopeList(
          options.scopesSupported,
          "`scopesSupported`",
        );
        const declaredSet = new Set(declaredScopes);
        if (grantedScopes.some((scope) => !declaredSet.has(scope))) {
          throw new Error(
            "[StaticTokenAuthProvider] `scopesSupported` must include every scope granted by an identity-aware credential",
          );
        }
        scopesSupported = freezeScopes(declaredScopes);
      } else {
        scopesSupported = grantedScopes.length > 0
          ? freezeScopes(grantedScopes)
          : undefined;
      }
    }

    if (!options.resource?.trim()) {
      throw new Error("[StaticTokenAuthProvider] `resource` is required");
    }

    // Validate `resource` as an absolute HTTP(S) URL unconditionally, so the
    // documented guarantee holds even when `resourceMetadataUrl` is supplied.
    const resourceUrl = httpsUrl(options.resource);

    this.authByToken = authByToken;

    // Store the caller's raw resource string (RFC 9728 allows opaque URIs, and
    // JwtAuthProvider does the same); `resourceUrl` above is used only for
    // validation and metadata-URL derivation.
    this.resource = options.resource;
    this.scopesSupported = scopesSupported;

    // RFC 9728 § 3.1: when `resourceMetadataUrl` is omitted, insert the
    // well-known suffix between the resource's origin and its path/query
    // (identical derivation to JwtAuthProvider).
    if (options.resourceMetadataUrl?.trim()) {
      this.resourceMetadataUrl = httpsUrl(options.resourceMetadataUrl);
    } else {
      const parsed = new URL(resourceUrl);
      const pathPart = parsed.pathname === "/" ? "" : parsed.pathname;
      this.resourceMetadataUrl = httpsUrl(
        `${parsed.origin}/.well-known/oauth-protected-resource${pathPart}${parsed.search}`,
      );
    }
  }

  async verifyToken(token: string): Promise<AuthInfo | null> {
    // Trim to match how tokens are stored (and how the HTTP middleware extracts
    // the bearer), so direct callers and the middleware path behave identically.
    return this.authByToken.get(token.trim()) ?? null;
  }

  getResourceMetadata(): ProtectedResourceMetadata {
    // Fresh object per call (matching JwtAuthProvider) so a caller cannot
    // mutate shared metadata — e.g. the `authorization_servers` array.
    return {
      resource: this.resource,
      resource_metadata_url: this.resourceMetadataUrl,
      // No authorization server: static tokens are provisioned out of band.
      authorization_servers: [],
      scopes_supported: this.scopesSupported,
      bearer_methods_supported: ["header"],
    };
  }
}

/**
 * Create a static (opaque) bearer-token {@link AuthProvider}.
 *
 * @param entries Either a non-empty shared-authority list of bearer tokens, or
 *   a non-empty list of identity-aware credentials. Load tokens from env / a
 *   secrets manager — never hard-code them in source.
 * @param options Provider configuration; `options.resource` is required.
 *
 * @example
 * ```typescript
 * import { createStaticTokenAuthProvider, McpApp } from "@casys/mcp-server";
 *
 * const app = new McpApp({
 *   name: "my-server",
 *   version: "1.0.0",
 *   auth: {
 *     provider: createStaticTokenAuthProvider(
 *       (Deno.env.get("MCP_AUTH_TOKENS") ?? "").split(",").filter(Boolean),
 *       { resource: "https://my-mcp.example.com" },
 *     ),
 *   },
 * });
 * await app.startHttp({ port: 7654, requireAuth: true });
 * ```
 *
 * @example Identity and scopes per credential
 * ```typescript
 * const provider = createStaticTokenAuthProvider(
 *   [
 *     { token: aliceToken, subject: "alice", scopes: ["read"] },
 *     { token: ciToken, subject: "ci", scopes: ["read", "write"] },
 *   ],
 *   { resource: "https://my-mcp.example.com" },
 * );
 * ```
 */
export function createStaticTokenAuthProvider(
  entries: readonly string[] | readonly StaticTokenCredential[],
  options: StaticTokenAuthProviderOptions,
): StaticTokenAuthProvider {
  return new StaticTokenAuthProvider(entries, options);
}
