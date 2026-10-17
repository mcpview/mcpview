/**
 * JWT Auth Provider using JWKS for token validation.
 *
 * Validates JWT tokens against a remote JWKS endpoint,
 * checking issuer, audience, and expiration.
 *
 * @module lib/server/auth/jwt-provider
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { AuthProvider } from "./provider.ts";
import {
  type AuthInfo,
  type HttpsUrl,
  httpsUrl,
  type ProtectedResourceMetadata,
} from "./types.ts";
import { isOtelEnabled, recordAuthEvent } from "../observability/otel.ts";

// ============================================================================
// JwtAuthProviderOptions — tagged discriminated union (0.17.0)
// ============================================================================

/**
 * Fields shared by both branches of {@link JwtAuthProviderOptions}.
 */
interface JwtAuthProviderOptionsBase {
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
   * Authorization servers that issue valid tokens. Each entry is a branded
   * {@link HttpsUrl} — raw strings are rejected at compile time. Construct
   * via {@link httpsUrl}.
   */
  authorizationServers: HttpsUrl[];
  /** Scopes supported by this server */
  scopesSupported?: string[];
}

/**
 * Options where `resource` is a verified HTTP(S) URL. The metadata URL is
 * auto-derived when `resourceMetadataUrl` is omitted, by applying RFC 9728
 * § 3.1 insertion to `resource`.
 *
 * Tagged with `kind: "url"` so TypeScript narrowing is sound at the function
 * body level (see 0.17.0 CHANGELOG — this fixes finding C1 from the 0.16.0
 * review where narrowing on `resourceMetadataUrl === undefined` failed to
 * propagate because `HttpsUrl extends string` collapsed the union).
 */
export interface JwtAuthProviderOptionsUrlResource
  extends JwtAuthProviderOptionsBase {
  /** Discriminant tag — MUST be `"url"` for this branch. */
  kind: "url";
  /** RFC 9728 § 2 resource identifier, pre-validated as HTTP(S) URL. */
  resource: HttpsUrl;
  /**
   * Metadata URL, optional — auto-derived from `resource` when omitted.
   */
  resourceMetadataUrl?: HttpsUrl;
}

/**
 * Options where `resource` is an opaque URI (per RFC 9728 § 2 — e.g., an
 * OIDC project ID used as JWT audience). The metadata URL is MANDATORY
 * because it cannot be derived from an opaque identifier.
 *
 * Tagged with `kind: "opaque"` to make the DU structurally disjoint (see
 * finding C2 from the 0.16.0 review — without the tag, `UrlResource` was
 * a structural subtype of `OpaqueResource` because `HttpsUrl extends
 * string`).
 */
export interface JwtAuthProviderOptionsOpaqueResource
  extends JwtAuthProviderOptionsBase {
  /** Discriminant tag — MUST be `"opaque"` for this branch. */
  kind: "opaque";
  /** RFC 9728 § 2 opaque resource identifier (NOT an URL). */
  resource: string;
  /**
   * Metadata URL, REQUIRED — cannot be derived from opaque `resource`.
   * Construct via {@link httpsUrl}.
   */
  resourceMetadataUrl: HttpsUrl;
}

/**
 * Configuration for JwtAuthProvider.
 *
 * 0.17.0: tagged discriminated union on `kind: "url" | "opaque"`. TypeScript
 * narrowing is now structurally sound — `if (options.kind === "url")` truly
 * narrows `options.resource` to `HttpsUrl` at the constructor body level.
 * The tag also makes the branches strictly disjoint: a caller cannot
 * accidentally satisfy `OpaqueResource` with an `HttpsUrl`-branded `resource`
 * (as was possible in 0.16.x — finding C2 from the type-design review).
 *
 * - `kind: "url"` → {@link JwtAuthProviderOptionsUrlResource},
 *   `resource: HttpsUrl` (wrap with {@link httpsUrl}),
 *   `resourceMetadataUrl` optional (auto-derived).
 * - `kind: "opaque"` → {@link JwtAuthProviderOptionsOpaqueResource},
 *   `resource: string` (raw opaque identifier),
 *   `resourceMetadataUrl: HttpsUrl` REQUIRED.
 *
 * The preset factories and the public `buildJwtAuthProvider` bridge accept
 * raw string `resource` and set the `kind` tag automatically via detection
 * — only callers that construct `JwtAuthProvider` directly (not through the
 * bridge) need to supply `kind` themselves. Custom OIDC providers written
 * on top of `buildJwtAuthProvider` are unaffected.
 *
 * BREAKING from 0.16.x: every direct `new JwtAuthProvider(...)` site must
 * add `kind: "url"` or `kind: "opaque"`. Preset users are unaffected.
 * See `postmortems/phase8-deployment.md` § 7 and `CHANGELOG.md` 0.15.0 /
 * 0.15.1 / 0.16.0 for the bug-class history this refactor closes.
 */
export type JwtAuthProviderOptions =
  | JwtAuthProviderOptionsUrlResource
  | JwtAuthProviderOptionsOpaqueResource;

// ============================================================================
// JwtAuthProvider
// ============================================================================

/**
 * Cached auth result with expiration
 */
interface CachedAuth {
  authInfo: AuthInfo;
  expiresAt: number; // ms timestamp
}

/**
 * JWT Auth Provider with JWKS validation.
 *
 * @example URL resource (auto-derives metadata URL)
 * ```typescript
 * import { httpsUrl, JwtAuthProvider } from "@casys/mcp-server";
 *
 * const provider = new JwtAuthProvider({
 *   kind: "url",
 *   issuer: "https://accounts.google.com",
 *   audience: "https://my-mcp.example.com",
 *   resource: httpsUrl("https://my-mcp.example.com"),
 *   authorizationServers: [httpsUrl("https://accounts.google.com")],
 * });
 * ```
 *
 * @example Opaque resource (explicit metadata URL required)
 * ```typescript
 * import { httpsUrl, JwtAuthProvider } from "@casys/mcp-server";
 *
 * // RFC 9728 § 2 Option B: OIDC project ID as JWT audience
 * const provider = new JwtAuthProvider({
 *   kind: "opaque",
 *   issuer: "https://my-tenant.zitadel.cloud",
 *   audience: "367545125829670172",
 *   resource: "367545125829670172",
 *   resourceMetadataUrl: httpsUrl(
 *     "https://my-mcp.example.com/.well-known/oauth-protected-resource",
 *   ),
 *   authorizationServers: [httpsUrl("https://my-tenant.zitadel.cloud")],
 * });
 * ```
 */
export class JwtAuthProvider extends AuthProvider {
  private jwks: ReturnType<typeof createRemoteJWKSet>;
  private options: JwtAuthProviderOptions;
  private readonly resourceMetadataUrl: HttpsUrl;

  // Token verification cache: hash(token) → AuthInfo with TTL
  // Prevents redundant JWKS fetches (network round-trip per tool call)
  private tokenCache = new Map<string, CachedAuth>();
  private static readonly MAX_CACHE_SIZE = 1000;
  private static readonly DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(options: JwtAuthProviderOptions) {
    super();

    if (!options.issuer) {
      throw new Error("[JwtAuthProvider] issuer is required");
    }
    if (!options.audience) {
      throw new Error("[JwtAuthProvider] audience is required");
    }
    if (!options.resource) {
      throw new Error("[JwtAuthProvider] resource is required");
    }
    if (!options.authorizationServers?.length) {
      throw new Error(
        "[JwtAuthProvider] at least one authorizationServer is required",
      );
    }

    // 0.17.0: narrow on the `kind` discriminant tag. TypeScript structurally
    // narrows the DU here — after `if (options.kind === "opaque")`, `options`
    // is `JwtAuthProviderOptionsOpaqueResource` and `resourceMetadataUrl` is
    // guaranteed non-undefined; after `else`, `options` is
    // `JwtAuthProviderOptionsUrlResource` and `options.resource` is
    // `HttpsUrl` (no widening, no runtime guess). This fixes finding C1 from
    // the 0.16.0 review — the previous narrowing on `resourceMetadataUrl !==
    // undefined` was unsound because `HttpsUrl extends string` collapsed the
    // union back to `string`. Tagging makes the branches strictly disjoint.
    //
    // URL branch derivation follows RFC 9728 § 3.1: when `resource` has a
    // path or query component, the well-known suffix is INSERTED between
    // the host and the path, not appended after it:
    //
    //   resource  = https://api.example.com/v1/mcp
    //   metadata  = https://api.example.com/.well-known/oauth-protected-resource/v1/mcp
    //
    // Fragments (`#...`) are intentionally dropped — they're client-side-only
    // per RFC 3986 § 3.5 and never part of a server-side metadata endpoint.
    if (options.kind === "opaque") {
      this.resourceMetadataUrl = options.resourceMetadataUrl;
    } else if (options.resourceMetadataUrl !== undefined) {
      this.resourceMetadataUrl = options.resourceMetadataUrl;
    } else {
      const parsed = new URL(options.resource);
      const pathPart = parsed.pathname === "/" ? "" : parsed.pathname;
      this.resourceMetadataUrl = httpsUrl(
        `${parsed.origin}/.well-known/oauth-protected-resource${pathPart}${parsed.search}`,
      );
    }

    this.options = options;
    const jwksUri = options.jwksUri ??
      `${options.issuer}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUri));
  }

  async verifyToken(token: string): Promise<AuthInfo | null> {
    // Check cache first (avoids JWKS network round-trip)
    const cacheKey = await this.hashToken(token);
    const cached = this.tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      if (isOtelEnabled()) {
        recordAuthEvent("cache_hit", {
          subject: cached.authInfo.subject ?? "",
        });
      }
      return cached.authInfo;
    }
    // Evict expired entry if present
    if (cached) this.tokenCache.delete(cacheKey);

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
      });

      const authInfo: AuthInfo = {
        subject: payload.sub ?? "unknown",
        clientId: (payload.azp as string | undefined) ??
          (payload.client_id as string | undefined),
        scopes: this.extractScopes(payload),
        claims: payload as Record<string, unknown>,
        expiresAt: payload.exp,
      };

      // Cache with TTL = min(token remaining lifetime, 5 minutes)
      const tokenExpiresMs = payload.exp ? payload.exp * 1000 : Infinity;
      const cacheTtl = Math.min(
        tokenExpiresMs - Date.now(),
        JwtAuthProvider.DEFAULT_CACHE_TTL_MS,
      );
      if (cacheTtl > 0) {
        // Evict oldest entries if cache is full
        if (this.tokenCache.size >= JwtAuthProvider.MAX_CACHE_SIZE) {
          const oldestKey = this.tokenCache.keys().next().value;
          if (oldestKey) this.tokenCache.delete(oldestKey);
        }
        this.tokenCache.set(cacheKey, {
          authInfo: Object.freeze(authInfo) as AuthInfo,
          expiresAt: Date.now() + cacheTtl,
        });
      }

      return authInfo;
    } catch (err) {
      // Log the actual rejection reason so JWKS fetch failures, audience
      // mismatches, and expiration errors are distinguishable in logs.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[JwtAuthProvider] Token rejected: ${msg}`);
      return null;
    }
  }

  /**
   * Hash a token for cache key (avoids storing raw tokens in memory)
   */
  private async hashToken(token: string): Promise<string> {
    const data = new TextEncoder().encode(token);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash)).map((b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
  }

  getResourceMetadata(): ProtectedResourceMetadata {
    return {
      resource: this.options.resource,
      resource_metadata_url: this.resourceMetadataUrl,
      authorization_servers: this.options.authorizationServers,
      scopes_supported: this.options.scopesSupported,
      bearer_methods_supported: ["header"],
    };
  }

  /**
   * Extract scopes from JWT payload.
   * Supports: "scope" claim (space-separated string) and "scp" claim (array).
   */
  private extractScopes(payload: Record<string, unknown>): string[] {
    if (typeof payload.scope === "string") {
      return payload.scope.split(" ").filter(Boolean);
    }
    if (Array.isArray(payload.scp)) {
      return payload.scp.filter((s): s is string => typeof s === "string");
    }
    return [];
  }
}
