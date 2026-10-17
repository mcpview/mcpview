/**
 * Rate Limiter
 *
 * Sliding window rate limiter for per-client request throttling.
 * Prevents server overload by limiting requests per time window.
 *
 * @module lib/server/rate-limiter
 */

/**
 * Sliding window rate limiter
 *
 * Features:
 * - Per-key rate limiting (client ID, IP, etc.)
 * - Sliding window for smooth rate enforcement
 * - Automatic cleanup of old timestamps
 * - Backoff waiting when limit exceeded
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000 });
 *
 * if (await limiter.checkLimit("client-123")) {
 *   // Execute request
 * } else {
 *   // Rate limited
 * }
 * ```
 */
export class RateLimiter {
  private requestCounts = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private operationsSinceLastPurge = 0;
  private static readonly PURGE_EVERY_N_OPS = 1000;

  constructor(options: { maxRequests: number; windowMs: number }) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
  }

  /**
   * Check if request is allowed for the given key
   *
   * @param key - Identifier (client ID, IP, etc.)
   * @returns true if allowed, false if rate limited
   */
  checkLimit(key: string): boolean {
    const now = Date.now();
    const requests = this.requestCounts.get(key) || [];

    // Remove old requests outside the sliding window
    const validRequests = requests.filter((time) => now - time < this.windowMs);

    if (validRequests.length === 0) {
      // No active requests for this key — remove from map to prevent unbounded growth
      this.requestCounts.delete(key);
    }

    if (validRequests.length >= this.maxRequests) {
      // Update with cleaned list
      this.requestCounts.set(key, validRequests);
      return false;
    }

    // Add current request timestamp
    validRequests.push(now);
    this.requestCounts.set(key, validRequests);

    // Periodic full purge to catch keys that haven't been checked recently
    this.operationsSinceLastPurge++;
    if (this.operationsSinceLastPurge >= RateLimiter.PURGE_EVERY_N_OPS) {
      this.purgeExpiredKeys();
    }

    return true;
  }

  /**
   * Remove all keys with no active requests in the current window.
   * Called automatically every PURGE_EVERY_N_OPS operations.
   */
  purgeExpiredKeys(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, requests] of this.requestCounts) {
      const active = requests.filter((time) => now - time < this.windowMs);
      if (active.length === 0) {
        this.requestCounts.delete(key);
        purged++;
      } else {
        this.requestCounts.set(key, active);
      }
    }
    this.operationsSinceLastPurge = 0;
    return purged;
  }

  /**
   * Wait until request slot is available (with exponential backoff)
   *
   * @param key - Identifier (client ID, IP, etc.)
   * @throws Error if max wait time exceeded (defaults to windowMs)
   */
  async waitForSlot(key: string): Promise<void> {
    let retries = 0;
    const baseDelay = 100;
    const maxWaitMs = this.windowMs;
    const startTime = Date.now();

    while (!this.checkLimit(key)) {
      if (Date.now() - startTime >= maxWaitMs) {
        throw new Error(
          `Rate limit wait timeout: waited ${maxWaitMs}ms for key "${key}"`,
        );
      }
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, cap at 1000ms
      const delay = Math.min(baseDelay * Math.pow(2, retries), 1000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      retries++;
    }
  }

  /**
   * Get current request count for a key
   */
  getCurrentCount(key: string): number {
    const now = Date.now();
    const requests = this.requestCounts.get(key) || [];
    return requests.filter((time) => now - time < this.windowMs).length;
  }

  /**
   * Get remaining requests for a key
   */
  getRemainingRequests(key: string): number {
    return Math.max(0, this.maxRequests - this.getCurrentCount(key));
  }

  /**
   * Get time until next slot is available (in ms)
   * Returns 0 if a slot is available now
   */
  getTimeUntilSlot(key: string): number {
    const now = Date.now();
    const requests = this.requestCounts.get(key) || [];
    const validRequests = requests.filter((time) => now - time < this.windowMs);

    if (validRequests.length < this.maxRequests) {
      return 0;
    }

    // Find oldest request in window - when it expires, a slot opens
    const oldest = Math.min(...validRequests);
    return Math.max(0, oldest + this.windowMs - now);
  }

  /**
   * Clear rate limit history for a key
   */
  clear(key: string): void {
    this.requestCounts.delete(key);
  }

  /**
   * Clear all rate limit history
   */
  clearAll(): void {
    this.requestCounts.clear();
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics(): { keys: number; totalRequests: number } {
    let totalRequests = 0;
    const now = Date.now();

    for (const requests of this.requestCounts.values()) {
      totalRequests += requests.filter((time) =>
        now - time < this.windowMs
      ).length;
    }

    return {
      keys: this.requestCounts.size,
      totalRequests,
    };
  }
}
