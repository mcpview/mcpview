/**
 * Authentication middleware and utilities.
 *
 * Provides Bearer token extraction, 401/403 response factories,
 * and the auth middleware for the pipeline.
 *
 * @module lib/server/auth/middleware
 */

import type { AuthProvider } from "./provider.ts";
import type { AuthInfo } from "./types.ts";
import type { Middleware } from "../middleware/types.ts";
import { isOtelEnabled, recordAuthEvent } from "../observability/otel.ts";

// ── Auth error codes ────────────────────────────────────────────────────────
//
// Both codes moved OUT of the JSON-RPC reserved range (`-32768`..`-32000`) for
// spec 2026-07-28, which is stricter than earlier readings of it suggested:
//
//   * `-32002` — "Implementations of this protocol version **MUST NOT** emit
//     these codes", because 2025-11-25 and earlier used it for resource-not-found
//     (now `-32602`). Keeping it for 403 was a conformance violation, not a
//     grandfathered liberty. Two prior reviews, including one of this file, read
//     the allocation policy as permitting it. It does not.
//   * `-32001` — inside `-32000`..`-32019`, where "new implementations
//     **SHOULD NOT** use codes from this sub-range at all" and receivers "**MUST
//     NOT** assume any specific meaning".
//
// The spec's own guidance for codes it does not define: "**SHOULD** be allocated
// outside the JSON-RPC reserved range". Hence `-31401` / `-31403`, mnemonic for
// the HTTP statuses they accompany.
//
// BREAKING for anything matching on the old numbers — see the changelog.

/** 401 Unauthorized: no token, or an invalid one. */
export const JSONRPC_UNAUTHORIZED = -31401;

/** 403 Forbidden: authenticated, but missing a required scope. */
export const JSONRPC_FORBIDDEN = -31403;

function escapeAuthenticateParam(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Authentication error with structured information
 * for generating proper HTTP error responses.
 */
export class AuthError extends Error {
  constructor(
    public readonly code:
      | "missing_token"
      | "invalid_token"
      | "insufficient_scope",
    public readonly resourceMetadataUrl: string,
    public readonly requiredScopes?: string[],
  ) {
    super(
      code === "missing_token"
        ? "Authorization header with Bearer token required"
        : code === "invalid_token"
        ? "Invalid or expired token"
        : `Insufficient scope: requires ${requiredScopes?.join(", ")}`,
    );
    this.name = "AuthError";
  }
}

/**
 * Extract Bearer token from Authorization header.
 *
 * @param request - HTTP Request
 * @returns Token string or null if not present/invalid format
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Create a 401 Unauthorized response with WWW-Authenticate header.
 *
 * @param resourceMetadataUrl - URL to the Protected Resource Metadata endpoint
 * @param error - OAuth error code
 * @param errorDescription - Human-readable error description
 */
export function createUnauthorizedResponse(
  resourceMetadataUrl: string,
  error?: string,
  errorDescription?: string,
): Response {
  const parts = [
    `Bearer resource_metadata="${
      escapeAuthenticateParam(resourceMetadataUrl)
    }"`,
  ];
  if (error) parts.push(`error="${escapeAuthenticateParam(error)}"`);
  if (errorDescription) {
    parts.push(
      `error_description="${escapeAuthenticateParam(errorDescription)}"`,
    );
  }

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSONRPC_UNAUTHORIZED,
        message: errorDescription ?? "Unauthorized",
      },
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": parts.join(", "),
      },
    },
  );
}

/**
 * Create a 403 Forbidden response for insufficient scopes.
 *
 * @param requiredScopes - Scopes that were required but missing
 * @param resourceMetadataUrl - URL to the Protected Resource Metadata endpoint
 */
export function createForbiddenResponse(
  requiredScopes: string[],
  resourceMetadataUrl: string,
): Response {
  const requiredScopesDescription = requiredScopes.join(", ");
  const parts = [
    `Bearer resource_metadata="${
      escapeAuthenticateParam(resourceMetadataUrl)
    }"`,
    `error="insufficient_scope"`,
    `error_description="${escapeAuthenticateParam(requiredScopesDescription)}"`,
  ];

  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: JSONRPC_FORBIDDEN,
        message: `Forbidden: requires scopes ${requiredScopes.join(", ")}`,
      },
    }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": parts.join(", "),
      },
    },
  );
}

export function freezeAuthInfo(authInfo: AuthInfo): AuthInfo {
  const scopes = Object.freeze([...authInfo.scopes]) as unknown as string[];
  const frozen: AuthInfo = {
    ...authInfo,
    scopes,
    ...(authInfo.claims
      ? {
        claims: deepFreezeJson(structuredClone(authInfo.claims)) as Record<
          string,
          unknown
        >,
      }
      : {}),
  };

  return Object.freeze(frozen);
}

function deepFreezeJson<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const nested of Object.values(value)) {
    deepFreezeJson(nested);
  }
  return Object.freeze(value);
}

/**
 * Create an authentication middleware for the MCP pipeline.
 *
 * Extracts the Bearer token from the HTTP request, validates it
 * via the AuthProvider, and injects `authInfo` into the context.
 *
 * For STDIO transport (no `ctx.request`), the middleware is skipped
 * since STDIO is a local transport with no auth needed.
 *
 * @param provider - AuthProvider implementation
 */
export function createAuthMiddleware(provider: AuthProvider): Middleware {
  return async (ctx, next) => {
    // STDIO transport: no request, skip auth
    if (!ctx.request) {
      return next();
    }

    // 0.15.0+: provider's getResourceMetadata() always returns a valid
    // absolute URL in resource_metadata_url (type system guarantees it).
    // No derivation needed at the middleware level anymore.
    const metadataUrl = provider.getResourceMetadata().resource_metadata_url;

    // Already authenticated by the HTTP-level gate (verifyHttpAuth).
    // Skip the redundant verifyToken call to avoid JWKS race conditions
    // when concurrent requests arrive on a cold cache.
    if (ctx.authInfo) {
      ctx.resourceMetadataUrl = metadataUrl;
      return next();
    }

    const token = extractBearerToken(ctx.request);
    if (!token) {
      if (isOtelEnabled()) {
        recordAuthEvent("reject", {
          reason: "missing_token",
          tool: ctx.toolName ?? "",
        });
      }
      throw new AuthError("missing_token", metadataUrl);
    }

    const authInfo = await provider.verifyToken(token);
    if (!authInfo) {
      if (isOtelEnabled()) {
        recordAuthEvent("reject", {
          reason: "invalid_token",
          tool: ctx.toolName ?? "",
        });
      }
      throw new AuthError("invalid_token", metadataUrl);
    }

    if (isOtelEnabled()) {
      recordAuthEvent("verify", {
        subject: authInfo.subject ?? "",
        tool: ctx.toolName ?? "",
      });
    }

    // Deep-freeze authInfo to prevent mutation by downstream middlewares
    ctx.authInfo = freezeAuthInfo(authInfo);

    // Propagate resourceMetadataUrl for downstream middlewares (scope-middleware)
    ctx.resourceMetadataUrl = metadataUrl;

    return next();
  };
}
