/**
 * Rate limiting middleware.
 *
 * Extracted from McpApp's inline rate limit logic.
 *
 * @module lib/server/middleware/rate-limit
 */

import type { RateLimiter } from "../concurrency/rate-limiter.ts";
import type { RateLimitOptions } from "../types.ts";
import type { Middleware } from "./types.ts";

/**
 * Create a rate limiting middleware.
 *
 * Behavior depends on `options.onLimitExceeded`:
 * - `'reject'`: throws immediately when limit is exceeded
 * - `'wait'` (default): waits with backoff until a slot is available
 *
 * @param limiter - RateLimiter instance
 * @param options - Rate limit configuration
 */
export function createRateLimitMiddleware(
  limiter: RateLimiter,
  options: RateLimitOptions,
): Middleware {
  return async (ctx, next) => {
    const key =
      options.keyExtractor?.({ toolName: ctx.toolName, args: ctx.args }) ??
        "default";

    if (options.onLimitExceeded === "reject") {
      if (!limiter.checkLimit(key)) {
        const waitTime = limiter.getTimeUntilSlot(key);
        throw new Error(
          `Rate limit exceeded. Retry after ${Math.ceil(waitTime / 1000)}s`,
        );
      }
    } else {
      await limiter.waitForSlot(key);
    }

    return next();
  };
}
