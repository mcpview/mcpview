/**
 * Unit tests for RateLimiter
 *
 * Tests the sliding window rate limiter for per-client request throttling.
 */

import { assert, assertEquals } from "@std/assert";
import { RateLimiter } from "./rate-limiter.ts";

Deno.test("RateLimiter - checkLimit returns true when under limit", () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

  const result = limiter.checkLimit("client-1");

  assertEquals(result, true);
  assertEquals(limiter.getCurrentCount("client-1"), 1);
});

Deno.test("RateLimiter - checkLimit returns false when limit reached", () => {
  const limiter = new RateLimiter({ maxRequests: 3, windowMs: 1000 });

  // Consume all slots
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);

  // Should now be rate limited
  assertEquals(limiter.checkLimit("client-1"), false);
  assertEquals(limiter.getCurrentCount("client-1"), 3);
});

Deno.test("RateLimiter - resets after window expires", async () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 50 });

  // Exhaust the limit
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), false);

  // Wait for window to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Should be allowed again
  assertEquals(limiter.checkLimit("client-1"), true);
});

Deno.test("RateLimiter - different keys have independent limits", () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

  // Exhaust limit for client-1
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), false);

  // client-2 should still be allowed
  assertEquals(limiter.checkLimit("client-2"), true);
  assertEquals(limiter.checkLimit("client-2"), true);
  assertEquals(limiter.checkLimit("client-2"), false);
});

Deno.test("RateLimiter - getCurrentCount returns valid request count", () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

  assertEquals(limiter.getCurrentCount("client-1"), 0);

  limiter.checkLimit("client-1");
  assertEquals(limiter.getCurrentCount("client-1"), 1);

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  assertEquals(limiter.getCurrentCount("client-1"), 3);
});

Deno.test("RateLimiter - getRemainingRequests returns correct value", () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

  assertEquals(limiter.getRemainingRequests("client-1"), 5);

  limiter.checkLimit("client-1");
  assertEquals(limiter.getRemainingRequests("client-1"), 4);

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  assertEquals(limiter.getRemainingRequests("client-1"), 2);

  // Exhaust remaining
  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  assertEquals(limiter.getRemainingRequests("client-1"), 0);

  // Should not go negative
  limiter.checkLimit("client-1"); // This is rejected
  assertEquals(limiter.getRemainingRequests("client-1"), 0);
});

Deno.test("RateLimiter - getTimeUntilSlot returns 0 when slot available", () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

  assertEquals(limiter.getTimeUntilSlot("client-1"), 0);

  limiter.checkLimit("client-1");
  assertEquals(limiter.getTimeUntilSlot("client-1"), 0);
});

Deno.test("RateLimiter - getTimeUntilSlot returns positive when at limit", () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");

  const timeUntilSlot = limiter.getTimeUntilSlot("client-1");

  // Should be positive and less than window
  assert(timeUntilSlot > 0);
  assert(timeUntilSlot <= 1000);
});

Deno.test("RateLimiter - clear removes history for specific key", () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  limiter.checkLimit("client-2");

  assertEquals(limiter.getCurrentCount("client-1"), 2);
  assertEquals(limiter.getCurrentCount("client-2"), 1);

  limiter.clear("client-1");

  assertEquals(limiter.getCurrentCount("client-1"), 0);
  assertEquals(limiter.getCurrentCount("client-2"), 1);
});

Deno.test("RateLimiter - clearAll removes all history", () => {
  const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  limiter.checkLimit("client-2");
  limiter.checkLimit("client-3");

  limiter.clearAll();

  assertEquals(limiter.getCurrentCount("client-1"), 0);
  assertEquals(limiter.getCurrentCount("client-2"), 0);
  assertEquals(limiter.getCurrentCount("client-3"), 0);
});

Deno.test("RateLimiter - getMetrics returns correct counts", () => {
  const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000 });

  let metrics = limiter.getMetrics();
  assertEquals(metrics.keys, 0);
  assertEquals(metrics.totalRequests, 0);

  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");
  limiter.checkLimit("client-2");

  metrics = limiter.getMetrics();
  assertEquals(metrics.keys, 2);
  assertEquals(metrics.totalRequests, 3);
});

Deno.test("RateLimiter - waitForSlot waits until slot available", async () => {
  const limiter = new RateLimiter({ maxRequests: 1, windowMs: 50 });

  // Consume the only slot
  limiter.checkLimit("client-1");

  const startTime = Date.now();

  // This should wait until the window expires
  await limiter.waitForSlot("client-1");

  const elapsed = Date.now() - startTime;

  // Should have waited at least some time for backoff
  assert(elapsed >= 50, `Expected elapsed >= 50ms, got ${elapsed}ms`);
});

Deno.test("RateLimiter - waitForSlot returns immediately when slot available", async () => {
  const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });

  const startTime = Date.now();

  await limiter.waitForSlot("client-1");

  const elapsed = Date.now() - startTime;

  // Should return almost immediately (less than 50ms)
  assert(elapsed < 50, `Expected elapsed < 50ms, got ${elapsed}ms`);
});

Deno.test("RateLimiter - sliding window cleans old timestamps", async () => {
  const limiter = new RateLimiter({ maxRequests: 3, windowMs: 50 });

  // Make initial requests
  limiter.checkLimit("client-1");
  limiter.checkLimit("client-1");

  // Wait for them to expire
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Make new requests - old ones should be cleaned
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), true);
  assertEquals(limiter.checkLimit("client-1"), false);

  // Count should be 3 (only the new requests within window)
  assertEquals(limiter.getCurrentCount("client-1"), 3);
});
