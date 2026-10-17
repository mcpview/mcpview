/**
 * Request Queue with Concurrency Control and Backpressure
 *
 * Limits the number of concurrent requests to prevent resource exhaustion
 * and implements backpressure strategies when at capacity.
 *
 * @module lib/server/request-queue
 */

import type { QueueMetrics, QueueOptions } from "../types.ts";

/**
 * RequestQueue manages concurrent request execution with backpressure
 *
 * Features:
 * - Limits max concurrent requests (default: 10)
 * - Multiple backpressure strategies: sleep, queue, reject
 * - Metrics for monitoring (inFlight, queued)
 * - Graceful degradation under load
 *
 * @example
 * ```typescript
 * const queue = new RequestQueue({
 *   maxConcurrent: 5,
 *   strategy: 'queue',
 *   sleepMs: 10
 * });
 *
 * await queue.acquire();
 * try {
 *   // Execute request
 * } finally {
 *   queue.release();
 * }
 * ```
 */
export class RequestQueue {
  private inFlight = 0;
  private maxConcurrent: number;
  private strategy: "sleep" | "queue" | "reject";
  private sleepMs: number;
  private waitQueue: Array<() => void> = [];

  constructor(options: QueueOptions) {
    this.maxConcurrent = options.maxConcurrent;
    this.strategy = options.strategy;
    this.sleepMs = options.sleepMs;
  }

  /**
   * Acquire a slot for request execution
   * Blocks until a slot is available based on backpressure strategy
   *
   * @throws {Error} If strategy is 'reject' and queue is at capacity
   */
  async acquire(): Promise<void> {
    if (this.strategy === "reject") {
      // Fail fast - reject immediately if at capacity
      if (this.inFlight >= this.maxConcurrent) {
        throw new Error(
          `Server at capacity (${this.maxConcurrent} concurrent requests)`,
        );
      }
      this.inFlight++;
      return;
    }

    if (this.strategy === "queue") {
      // Queue-based backpressure - wait in FIFO queue.
      // Claim the slot BEFORE awaiting to prevent TOCTOU race:
      // without this, two waiters woken back-to-back could both see
      // inFlight < maxConcurrent and both increment past the limit.
      if (this.inFlight >= this.maxConcurrent) {
        await new Promise<void>((resolve) => {
          this.waitQueue.push(resolve);
        });
        // Slot was pre-claimed by release() before waking us
      } else {
        this.inFlight++;
      }
      return;
    }

    // Sleep-based backpressure (default) - busy-wait with sleep.
    // The check + increment is safe here because JS is single-threaded
    // for synchronous code: after the while loop exits, no other code
    // runs before inFlight++ (no await between check and increment).
    while (this.inFlight >= this.maxConcurrent) {
      await new Promise((resolve) => setTimeout(resolve, this.sleepMs));
    }
    this.inFlight++;
  }

  /**
   * Release a slot after request completion
   * Notifies next waiting request if using queue strategy
   */
  release(): void {
    if (this.strategy === "queue" && this.waitQueue.length > 0) {
      // Transfer the slot directly to the next waiter without decrementing.
      // This prevents the TOCTOU race: the waiter wakes up with
      // the slot already claimed (inFlight unchanged).
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.inFlight--;
    }
  }

  /**
   * Get current queue metrics for monitoring
   */
  getMetrics(): QueueMetrics {
    return {
      inFlight: this.inFlight,
      queued: this.waitQueue.length,
    };
  }

  /**
   * Check if queue is at capacity
   */
  isAtCapacity(): boolean {
    return this.inFlight >= this.maxConcurrent;
  }

  /**
   * Get current in-flight request count
   */
  getInFlight(): number {
    return this.inFlight;
  }

  /**
   * Get current queued request count
   */
  getQueued(): number {
    return this.waitQueue.length;
  }
}
