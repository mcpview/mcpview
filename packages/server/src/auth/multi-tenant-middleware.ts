/**
 * Multi-tenant resolution middleware for MCP servers.
 *
 * Extends the auth pipeline with tenant identification and validation.
 * Consumers provide a {@link TenantResolver} that knows how to map an
 * authenticated request to a tenant identifier — typically by combining
 * the HTTP Host header (subdomain-based tenancy) with a custom JWT claim.
 *
 * The resolved `tenantId` is injected into `ctx.authInfo.tenantId` so
 * downstream middlewares and tool handlers can scope data access.
 *
 * This middleware is **optional**. Single-tenant servers do not need it.
 * When used, it MUST be placed AFTER the auth middleware (which populates
 * `ctx.authInfo`) and BEFORE the scope middleware and tool handlers.
 *
 * @example Pipeline wiring
 * ```typescript
 * server.use(createAuthMiddleware(authProvider));
 * server.use(createMultiTenantMiddleware(new MyTenantResolver(), {
 *   onRejection: (ctx, reason) => auditLog.warn("tenant_reject", { reason }),
 * }));
 * server.use(createScopeMiddleware(toolScopes));
 * ```
 *
 * @module lib/server/auth/multi-tenant-middleware
 */

import type { Middleware, MiddlewareContext } from "../middleware/types.ts";
import type { AuthInfo } from "./types.ts";
import { AuthError } from "./middleware.ts";

/**
 * Result of a tenant resolution attempt.
 *
 * Use `{ ok: true, tenantId }` when the request is valid and the tenant
 * has been identified. Use `{ ok: false, reason }` to reject the request
 * (the reason is passed to `onRejection` for logging but NEVER returned
 * to the client, to avoid leaking tenant topology).
 */
export type TenantResolution =
  | { ok: true; tenantId: string }
  | { ok: false; reason: string };

/**
 * Resolves and validates the tenant for an incoming MCP request.
 *
 * Implementations typically:
 *   1. Read a tenant hint from the request (subdomain, path, header, …)
 *   2. Read the authoritative tenant from `ctx.authInfo.claims`
 *   3. Validate they match
 *   4. Return the tenant identifier, or a rejection reason
 *
 * @example Subdomain + JWT claim matching
 * ```typescript
 * class SubdomainTenantResolver implements TenantResolver {
 *   async resolve(ctx: MiddlewareContext): Promise<TenantResolution> {
 *     const host = ctx.request!.headers.get("host") ?? "";
 *     const subdomain = host.split(".")[0];
 *
 *     const authInfo = ctx.authInfo as AuthInfo;
 *     const claim = authInfo.claims?.["urn:my-app:tenant_id"];
 *
 *     if (typeof claim !== "string") {
 *       return { ok: false, reason: "tenant_id claim missing or not a string" };
 *     }
 *     if (claim !== subdomain) {
 *       return { ok: false, reason: `subdomain=${subdomain} claim=${claim}` };
 *     }
 *     return { ok: true, tenantId: subdomain };
 *   }
 * }
 * ```
 */
export interface TenantResolver {
  /**
   * Resolve the tenant for this request.
   *
   * @param ctx - Middleware context with `ctx.request` and `ctx.authInfo` populated
   * @returns A successful resolution with the tenant id, or a rejection with a reason
   * @throws May throw — throwing is treated identically to returning `{ ok: false }`
   */
  resolve(ctx: MiddlewareContext): Promise<TenantResolution>;
}

/**
 * Options for {@link createMultiTenantMiddleware}.
 */
export interface MultiTenantMiddlewareOptions {
  /**
   * Called whenever a request is rejected — either because the resolver
   * returned `{ ok: false }`, threw an exception, or returned an empty
   * `tenantId`.
   *
   * Typical use: write an audit log entry for compliance / forensics.
   * The `reason` string may contain sensitive details (tenant ids, claim
   * values) — log it server-side but never expose it to clients.
   *
   * Awaited before the client receives the 401 response, so audit writes
   * are guaranteed to land before the error is observable. Keep it fast —
   * slow callbacks delay the rejection.
   *
   * If this hook itself throws, the exception is **caught and logged to
   * stderr** but NOT rethrown — the client still receives the standard
   * generic `invalid_token` AuthError. A crashing audit hook must never
   * change client-visible behaviour, otherwise a buggy audit path becomes
   * an observable oracle for attackers probing tenant topology.
   */
  onRejection?: (
    ctx: MiddlewareContext,
    reason: string,
  ) => void | Promise<void>;
}

/**
 * Create a tenant resolution middleware.
 *
 * Pipeline behaviour:
 *
 * - **STDIO transport** (no `ctx.request`) → pass through unchanged. STDIO
 *   is a local trusted transport with no meaningful notion of tenant.
 *
 * - **HTTP without `ctx.authInfo`** → throws a configuration error. This
 *   indicates the auth middleware is missing from the pipeline. Fail fast
 *   rather than silently skipping tenant enforcement.
 *
 * - **HTTP with `ctx.authInfo`** → calls `resolver.resolve(ctx)`:
 *   - On success with a non-empty `tenantId`: copies `authInfo`, injects
 *     `tenantId`, re-freezes, continues.
 *   - On rejection (`ok: false`, thrown, or empty `tenantId`): calls
 *     `onRejection`, then throws {@link AuthError}`("invalid_token")` —
 *     the client sees a generic 401 with no tenant details leaked.
 *
 * @param resolver - Implementation that maps requests to tenant ids
 * @param options - Optional hooks (notably `onRejection` for audit logging)
 */
export function createMultiTenantMiddleware(
  resolver: TenantResolver,
  options: MultiTenantMiddlewareOptions = {},
): Middleware {
  return async (ctx, next) => {
    // STDIO transport: no request, tenant routing does not apply
    if (!ctx.request) {
      return next();
    }

    // Auth middleware MUST have populated authInfo before we run.
    // MiddlewareContext is indexed as `[key: string]: unknown` for extensibility,
    // so every auth-aware middleware in this lib casts to the concrete type —
    // matches the convention in middleware.ts and scope-middleware.ts.
    const authInfo = ctx.authInfo as AuthInfo | undefined;
    if (!authInfo) {
      throw new Error(
        "[MultiTenantMiddleware] ctx.authInfo is not set. Ensure auth " +
          "middleware is placed BEFORE multi-tenant middleware in the pipeline.",
      );
    }

    // Resolve the tenant — any failure path collapses to a generic 401
    let resolution: TenantResolution;
    try {
      resolution = await resolver.resolve(ctx);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw await rejectWithAudit(ctx, reason, options.onRejection);
    }

    if (!resolution.ok) {
      throw await rejectWithAudit(ctx, resolution.reason, options.onRejection);
    }

    // Defense-in-depth: reject empty string tenantId even when the resolver
    // reports success. Some consumers use truthy guards (`if (tenantId)`),
    // and an empty string would slip past them without being noticed.
    if (!resolution.tenantId) {
      throw await rejectWithAudit(
        ctx,
        "resolver returned empty tenantId",
        options.onRejection,
      );
    }

    // Re-freeze authInfo with tenantId injected. Two reasons for the re-freeze:
    //   1. Preserves the immutability guarantee downstream middleware and
    //      tool handlers rely on — they must never observe a mutable tenantId.
    //   2. The original authInfo is already frozen by the auth middleware,
    //      so in-place mutation is impossible anyway. We must spread-copy.
    ctx.authInfo = Object.freeze({
      ...authInfo,
      tenantId: resolution.tenantId,
    });

    return next();
  };
}

/**
 * Run the audit hook (if any) and return a generic `invalid_token` AuthError.
 *
 * The hook is intentionally shielded with try/catch: a crashing audit hook
 * must NEVER change the client-visible response. If the hook throws, the
 * audit is lost (logged to stderr as a last resort) but the client still
 * receives the standard 401 AuthError — preserving the non-leak guarantee.
 *
 * @internal
 */
async function rejectWithAudit(
  ctx: MiddlewareContext,
  reason: string,
  onRejection: MultiTenantMiddlewareOptions["onRejection"],
): Promise<AuthError> {
  if (onRejection) {
    try {
      await onRejection(ctx, reason);
    } catch (hookErr) {
      // Last-resort logging: stderr is the only safe channel here — we must
      // not rethrow (would defeat the non-leak guarantee) and we must not
      // silently drop (would leave no trace of an audit failure).
      console.error(
        "[MultiTenantMiddleware] onRejection hook threw; audit entry lost:",
        hookErr,
      );
    }
  }
  return buildAuthError(ctx);
}

/**
 * Build a generic `invalid_token` AuthError using the resource metadata URL
 * already set by the upstream auth middleware. If the URL is missing (should
 * not happen in a well-formed pipeline), fall back to an empty string — the
 * AuthError still produces a valid 401 response.
 */
function buildAuthError(ctx: MiddlewareContext): AuthError {
  const metadataUrl = (ctx.resourceMetadataUrl as string | undefined) ?? "";
  return new AuthError("invalid_token", metadataUrl);
}
