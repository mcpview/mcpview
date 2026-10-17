/**
 * Middleware pipeline types for McpApp.
 *
 * Provides an onion-model middleware system (similar to Koa/Hono)
 * where each middleware wraps the next, enabling before/after logic.
 *
 * @module lib/server/middleware/types
 */

import type {
  ClientCapabilities,
  Implementation,
} from "@modelcontextprotocol/sdk/types.js";

/**
 * MCP logging severities (RFC 5424 syslog levels), ordered least to most severe.
 *
 * Declared locally rather than imported: the SDK's `LoggingLevel` is tied to the
 * `logging/setLevel` RPC that spec 2026-07-28 removed, and this type now serves a
 * per-request field instead.
 */
export type McpLogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/**
 * Context passed through the middleware pipeline.
 * Each middleware can read and enrich the context.
 */
export interface MiddlewareContext {
  /** Name of the tool being called */
  toolName: string;

  /** Tool arguments */
  args: Record<string, unknown>;

  /** HTTP request (only present for HTTP transport, undefined for STDIO) */
  request?: Request;

  /** Session ID (only present for HTTP transport) */
  sessionId?: string;

  /** Client implementation metadata (stateless HTTP transport, when provided) */
  clientInfo?: Implementation;

  /** Client capabilities metadata (stateless HTTP transport, when provided) */
  clientCapabilities?: ClientCapabilities;

  /** MRTR: answers the client echoed back on a retry (spec 2026-07-28). */
  inputResponses?: Record<string, unknown>;

  /** MRTR: whether the echoed `requestState` passed integrity verification. */
  retryVerified?: boolean;

  /**
   * Log level the client requested **for this request** (spec 2026-07-28).
   *
   * Replaces the removed `logging/setLevel` RPC: there is no server-wide level
   * to mutate any more, so the level travels with the call that wants it. Absent
   * means the client asked for no logging — and the spec is explicit that a
   * server **MUST NOT** emit `notifications/message` in that case.
   */
  logLevel?: McpLogLevel;

  /** Extensible by middlewares (e.g., authInfo added by auth middleware) */
  [key: string]: unknown;
}

/**
 * Result returned by a middleware or the final handler.
 */
export type MiddlewareResult = unknown;

/**
 * Function to invoke the next middleware in the chain.
 */
export type NextFunction = () => Promise<MiddlewareResult>;

/**
 * A middleware function.
 *
 * Receives the context and a `next()` function to call the next middleware.
 * Can short-circuit the pipeline by not calling `next()`.
 *
 * @example
 * ```typescript
 * const loggingMiddleware: Middleware = async (ctx, next) => {
 *   console.log(`Before: ${ctx.toolName}`);
 *   const result = await next();
 *   console.log(`After: ${ctx.toolName}`);
 *   return result;
 * };
 * ```
 */
export type Middleware = (
  ctx: MiddlewareContext,
  next: NextFunction,
) => Promise<MiddlewareResult>;
