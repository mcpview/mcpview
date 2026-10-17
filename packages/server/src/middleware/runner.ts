/**
 * Middleware pipeline runner.
 *
 * Composes an array of middlewares into a single callable function
 * using the onion model: each middleware wraps the next.
 *
 * @module lib/server/middleware/runner
 */

import type {
  Middleware,
  MiddlewareContext,
  MiddlewareResult,
} from "./types.ts";

/**
 * Create a middleware runner that composes middlewares + a final handler.
 *
 * Execution order (onion model):
 * ```
 * m1-before → m2-before → handler → m2-after → m1-after
 * ```
 *
 * @param middlewares - Array of middleware functions to execute in order
 * @param handler - Final handler (the tool execution)
 * @returns A function that runs the full pipeline for a given context
 *
 * @example
 * ```typescript
 * const run = createMiddlewareRunner(
 *   [rateLimitMiddleware, validationMiddleware],
 *   async (ctx) => toolHandler(ctx.args),
 * );
 * const result = await run({ toolName: "my_tool", args: { x: 1 } });
 * ```
 */
export function createMiddlewareRunner(
  middlewares: Middleware[],
  handler: (ctx: MiddlewareContext) => Promise<MiddlewareResult>,
): (ctx: MiddlewareContext) => Promise<MiddlewareResult> {
  return (ctx: MiddlewareContext) => {
    let index = 0;
    let handlerCalled = false;

    // deno-lint-ignore require-await
    const next = async (): Promise<MiddlewareResult> => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        return middleware(ctx, next);
      }
      if (handlerCalled) {
        throw new Error(
          "[MiddlewareRunner] next() called after pipeline already completed. " +
            "A middleware may be calling next() multiple times.",
        );
      }
      handlerCalled = true;
      return handler(ctx);
    };

    return next();
  };
}
