/**
 * AS Metadata Proxy for DCR compatibility discovery.
 *
 * Creates a Web Standard request handler that serves an RFC 8414
 * Authorization Server Metadata document enriched with
 * `registration_endpoint` (RFC 7591). This is a compatibility path for
 * MCP clients and IdPs that still rely on Dynamic Client Registration
 * (DCR), which is now optional (`MAY`) in the 2025-11-25 MCP spec.
 *
 * For new OAuth client integrations, prefer the spec-preferred Client ID
 * Metadata Documents (CIMD) on the client side. See
 * `src/client-auth/client-id-metadata.ts`.
 *
 * **Issuer field note (RFC 8414 §3.2)**:
 * The `issuer` field in the served metadata will be the upstream IdP's
 * issuer, not the URL where this handler is served. This intentionally
 * violates RFC 8414 §3.2 (`issuer` MUST match the AS URL) because
 * overriding `issuer` would cause JWT `iss` claim mismatches — the IdP
 * still issues tokens with its own `iss`, and clients verify
 * `token.iss === metadata.issuer`. The metadata-URL mismatch is the
 * lesser evil for this compatibility path and is not needed when clients
 * use CIMD or the upstream IdP ships native registration discovery.
 *
 * @module lib/server/auth/as-metadata-proxy
 */

// ─── Types ───────────────────────────────────────────────────────────

/**
 * Options for {@link createAsMetadataHandler}.
 *
 * Provide exactly one of:
 * - `upstreamMetadataUrl` — full URL of the upstream metadata document
 * - `upstreamIssuer` — OIDC issuer (derives `/.well-known/openid-configuration`)
 *
 * Providing both or neither throws at construction time.
 */
export interface AsMetadataProxyOptions {
  /**
   * Full URL of the upstream AS metadata document to proxy.
   *
   * IdP-agnostic — pass the appropriate discovery endpoint:
   * - OIDC providers: `https://idp.example.com/.well-known/openid-configuration`
   * - RFC 8414 AS: `https://as.example.com/.well-known/oauth-authorization-server`
   * - Custom paths: any URL that returns a JSON metadata document
   *
   * Mutually exclusive with `upstreamIssuer`.
   */
  upstreamMetadataUrl?: string;

  /**
   * OIDC issuer URL (e.g., `https://my-tenant.zitadel.cloud`).
   * Convenience shorthand — derives `{upstreamIssuer}/.well-known/openid-configuration`.
   *
   * Mutually exclusive with `upstreamMetadataUrl`.
   */
  upstreamIssuer?: string;

  /**
   * Absolute HTTPS URL of the RFC 7591 DCR endpoint that the MCP server
   * exposes (implemented separately by the consumer — outside lib scope).
   * Injected as `registration_endpoint` in the enriched metadata.
   *
   * Must be a valid absolute HTTP(S) URL (validated at construction time).
   */
  registrationEndpoint: string;

  /**
   * TTL for the upstream metadata cache in milliseconds.
   * @default 86_400_000 (24 hours)
   *
   * Uses stale-while-revalidate: serves cached metadata even after
   * expiry while refreshing in the background.
   */
  cacheTtlMs?: number;

  /**
   * Additional RFC 8414 fields to inject or override in the metadata
   * (beyond `registration_endpoint`). Useful for overriding
   * `scopes_supported`, adding `code_challenge_methods_supported`, etc.
   *
   * **Warning**: avoid overriding `issuer` — see module-level JSDoc
   * for why this causes JWT validation failures.
   */
  extraFields?: Record<string, unknown>;

  /**
   * Custom `fetch` implementation. Defaults to `globalThis.fetch`.
   *
   * Use for dependency injection in tests, or for advanced scenarios
   * like mTLS, custom headers, or retry wrappers.
   */
  fetch?: typeof globalThis.fetch;
}

// ─── Implementation ──────────────────────────────────────────────────

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Validates that a string is a parseable absolute HTTP(S) URL.
 * Throws at construction time for fast failure.
 */
function validateUrl(value: string, label: string): void {
  try {
    const parsed = new URL(value);
    if (!parsed.protocol.startsWith("http")) {
      throw new Error(`expected http(s) scheme`);
    }
  } catch (cause) {
    throw new Error(
      `AsMetadataProxyOptions.${label} is not a valid HTTP(S) URL: "${value}"`,
      { cause },
    );
  }
}

/**
 * Resolves the upstream metadata URL from the flat options.
 * Enforces mutual exclusivity: exactly one of upstreamMetadataUrl
 * or upstreamIssuer must be provided.
 */
function resolveMetadataUrl(options: AsMetadataProxyOptions): string {
  const { upstreamMetadataUrl, upstreamIssuer } = options;
  const hasUrl = upstreamMetadataUrl !== undefined;
  const hasIssuer = upstreamIssuer !== undefined;

  if (hasUrl && hasIssuer) {
    throw new Error(
      "AsMetadataProxyOptions: provide either upstreamMetadataUrl or upstreamIssuer, not both",
    );
  }
  if (!hasUrl && !hasIssuer) {
    throw new Error(
      "AsMetadataProxyOptions: one of upstreamMetadataUrl or upstreamIssuer is required",
    );
  }

  if (hasUrl) {
    validateUrl(upstreamMetadataUrl!, "upstreamMetadataUrl");
    return upstreamMetadataUrl!;
  }

  validateUrl(upstreamIssuer!, "upstreamIssuer");
  return `${
    stripTrailingSlash(upstreamIssuer!)
  }/.well-known/openid-configuration`;
}

/**
 * Creates a Web Standard request handler that serves an RFC 8414
 * Authorization Server Metadata document enriched with
 * `registration_endpoint`.
 *
 * The handler is framework-agnostic — mount it in Fresh, Hono, Express
 * (via adapter), or any framework that accepts `(Request) => Response`.
 *
 * @example Explicit metadata URL (any AS)
 * ```typescript
 * const handler = createAsMetadataHandler({
 *   upstreamMetadataUrl: "https://as.example.com/.well-known/oauth-authorization-server",
 *   registrationEndpoint: "https://my-app.example.com/oauth/register",
 * });
 * ```
 *
 * @example OIDC issuer shorthand
 * ```typescript
 * const handler = createAsMetadataHandler({
 *   upstreamIssuer: "https://my-tenant.zitadel.cloud",
 *   registrationEndpoint: "https://my-app.example.com/oauth/register",
 * });
 * ```
 */
export function createAsMetadataHandler(
  options: AsMetadataProxyOptions,
): (req: Request) => Promise<Response> {
  // ── Fail-fast validation at construction time ──
  const metadataUrl = resolveMetadataUrl(options);
  validateUrl(options.registrationEndpoint, "registrationEndpoint");
  if (
    options.cacheTtlMs !== undefined &&
    (options.cacheTtlMs < 0 || !Number.isFinite(options.cacheTtlMs))
  ) {
    throw new Error(
      "AsMetadataProxyOptions.cacheTtlMs must be a non-negative finite number",
    );
  }

  const {
    registrationEndpoint,
    cacheTtlMs = 24 * 60 * 60 * 1000,
    extraFields,
    fetch: fetchFn = globalThis.fetch,
  } = options;

  let cached: { metadata: Record<string, unknown>; fetchedAt: number } | null =
    null;
  let refreshing = false;

  async function fetchUpstream(): Promise<Record<string, unknown>> {
    const res = await fetchFn(metadataUrl, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `AS metadata fetch failed: ${res.status} from ${metadataUrl}`,
      );
    }
    const body = await res.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new Error(
        `AS metadata from ${metadataUrl} is not a JSON object (got ${
          Array.isArray(body) ? "array" : typeof body
        })`,
      );
    }
    if (typeof body.issuer !== "string") {
      throw new Error(
        `AS metadata from ${metadataUrl} is missing required 'issuer' field`,
      );
    }
    return body as Record<string, unknown>;
  }

  async function getMetadata(): Promise<Record<string, unknown>> {
    const now = Date.now();

    // Fresh cache hit
    if (cached && now - cached.fetchedAt < cacheTtlMs) {
      return cached.metadata;
    }

    // Stale-while-revalidate: serve stale, refresh in background
    if (cached) {
      if (!refreshing) {
        refreshing = true;
        fetchUpstream()
          .then((m) => {
            cached = { metadata: m, fetchedAt: Date.now() };
          })
          .catch((e) =>
            console.error("[as-metadata-proxy] background refresh failed:", e)
          )
          .finally(() => {
            refreshing = false;
          });
      }
      return cached.metadata;
    }

    // Cold start: must await
    const metadata = await fetchUpstream();
    cached = { metadata, fetchedAt: now };
    return metadata;
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { "Allow": "GET, HEAD" },
      });
    }
    try {
      const upstream = await getMetadata();
      const enriched = {
        ...upstream,
        ...extraFields,
        registration_endpoint: registrationEndpoint,
      };
      return new Response(JSON.stringify(enriched), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      });
    } catch (err) {
      console.error("[as-metadata-proxy] upstream fetch failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      return new Response(
        JSON.stringify({ error: "as_metadata_unavailable", message: msg }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}
