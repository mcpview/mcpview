/**
 * Backpressure middleware.
 *
 * Controls concurrent execution using RequestQueue.
 * Acquires a slot before calling next(), releases after.
 *
 * @module lib/server/middleware/backpressure
 */

import type { RequestQueue } from "../concurrency/request-queue.ts";
import type { Middleware } from "./types.ts";

/**
 * Create a backpressure middleware.
 *
 * Wraps the downstream pipeline in acquire/release:
 * ```
 * acquire() → next() → release()
 * ```
 *
 * The slot is always released, even if an error occurs.
 *
 * @param queue - RequestQueue instance with configured concurrency limits
 */
export function createBackpressureMiddleware(
  queue: RequestQueue,
): Middleware {
  return async (_ctx, next) => {
    await queue.acquire();
    try {
      return await next();
    } finally {
      queue.release();
    }
  };
}
