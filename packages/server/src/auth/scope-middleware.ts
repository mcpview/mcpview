/**
 * Scope enforcement middleware.
 *
 * Verifies that the authenticated user has the required scopes
 * for the tool being called. Placed after the auth middleware.
 *
 * @module lib/server/auth/scope-middleware
 */

import type { AuthInfo } from "./types.ts";
import { AuthError } from "./middleware.ts";
import type { Middleware, MiddlewareContext } from "../middleware/types.ts";

/**
 * Source of the scopes required for one tool call.
 *
 * A map preserves the original public helper API. A resolver lets McpApp bind
 * authorization to the exact tool definition captured for an in-flight call,
 * including tools registered or replaced after startup.
 */
type ToolScopesSource =
  | ReadonlyMap<string, readonly string[]>
  | ((ctx: MiddlewareContext) => readonly string[] | undefined);

/**
 * Create a scope enforcement middleware.
 *
 * Checks `requiredScopes` for the called tool against `ctx.authInfo.scopes`.
 * STDIO calls (no HTTP request) pass through without auth. An HTTP call for a
 * scoped tool fails closed when no authInfo is available.
 * If the tool has no requiredScopes, the middleware passes through.
 *
 * @param toolScopes - Map of tool name to required scopes, or a per-call resolver
 */
export function createScopeMiddleware(
  toolScopes: ToolScopesSource,
): Middleware {
  // deno-lint-ignore require-await
  return async (ctx, next) => {
    const requiredScopes = typeof toolScopes === "function"
      ? toolScopes(ctx)
      : toolScopes.get(ctx.toolName);

    // No scopes required for this tool
    if (!requiredScopes?.length) return next();

    // No auth configured: STDIO (no request) is fine, HTTP without authInfo is a misconfiguration
    const authInfo = ctx.authInfo as AuthInfo | undefined;
    if (!authInfo) {
      if (!ctx.request) return next(); // STDIO: local transport, no auth needed
      // HTTP request with required scopes but no authInfo = auth middleware is missing
      throw new Error(
        `[ScopeMiddleware] Tool "${ctx.toolName}" requires scopes [${
          requiredScopes.join(", ")
        }] ` +
          "but no authInfo found on HTTP request. Ensure auth middleware is configured in the pipeline.",
      );
    }

    const hasAll = requiredScopes.every((s) => authInfo.scopes.includes(s));
    if (!hasAll) {
      const missingScopes = requiredScopes.filter((s) =>
        !authInfo.scopes.includes(s)
      );
      // Used by 403 responses to advertise protected resource metadata in
      // WWW-Authenticate; auth middleware populates it for HTTP requests.
      const metadataUrl = (ctx.resourceMetadataUrl as string | undefined) ?? "";
      throw new AuthError("insufficient_scope", metadataUrl, missingScopes);
    }

    return next();
  };
}
