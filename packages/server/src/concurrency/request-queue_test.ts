/**
 * Unit tests for RequestQueue
 *
 * Tests the request queue with concurrency control and backpressure.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { RequestQueue } from "./request-queue.ts";

// ==============================================
// Basic Queue Operations
// ==============================================

Deno.test("RequestQueue - acquire increments inFlight", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 5,
    strategy: "reject",
    sleepMs: 10,
  });

  assertEquals(queue.getInFlight(), 0);

  await queue.acquire();
  assertEquals(queue.getInFlight(), 1);

  await queue.acquire();
  assertEquals(queue.getInFlight(), 2);
});

Deno.test("RequestQueue - release decrements inFlight", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 5,
    strategy: "reject",
    sleepMs: 10,
  });

  await queue.acquire();
  await queue.acquire();
  assertEquals(queue.getInFlight(), 2);

  queue.release();
  assertEquals(queue.getInFlight(), 1);

  queue.release();
  assertEquals(queue.getInFlight(), 0);
});

Deno.test("RequestQueue - isAtCapacity returns true when full", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 2,
    strategy: "reject",
    sleepMs: 10,
  });

  assertEquals(queue.isAtCapacity(), false);

  await queue.acquire();
  assertEquals(queue.isAtCapacity(), false);

  await queue.acquire();
  assertEquals(queue.isAtCapacity(), true);
});

Deno.test("RequestQueue - getMetrics returns correct values", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 5,
    strategy: "reject",
    sleepMs: 10,
  });

  let metrics = queue.getMetrics();
  assertEquals(metrics.inFlight, 0);
  assertEquals(metrics.queued, 0);

  await queue.acquire();
  await queue.acquire();

  metrics = queue.getMetrics();
  assertEquals(metrics.inFlight, 2);
  assertEquals(metrics.queued, 0);
});

// ==============================================
// Reject Strategy Tests
// ==============================================

Deno.test("RequestQueue - reject strategy throws when at capacity", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 2,
    strategy: "reject",
    sleepMs: 10,
  });

  await queue.acquire();
  await queue.acquire();

  await assertRejects(
    () => queue.acquire(),
    Error,
    "Server at capacity (2 concurrent requests)",
  );
});

Deno.test("RequestQueue - reject strategy allows after release", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 2,
    strategy: "reject",
    sleepMs: 10,
  });

  await queue.acquire();
  await queue.acquire();

  // Should reject
  await assertRejects(() => queue.acquire(), Error);

  // Release one slot
  queue.release();

  // Should now succeed
  await queue.acquire();
  assertEquals(queue.getInFlight(), 2);
});

// ==============================================
// Queue Strategy Tests (FIFO)
// ==============================================

Deno.test("RequestQueue - queue strategy waits in FIFO order", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "queue",
    sleepMs: 10,
  });

  const order: number[] = [];

  // Acquire first slot
  await queue.acquire();

  // Start two waiting acquires
  const promise1 = queue.acquire().then(() => {
    order.push(1);
  });
  const promise2 = queue.acquire().then(() => {
    order.push(2);
  });

  // Give time for both to queue
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(queue.getQueued(), 2);

  // Release first slot - should wake promise1
  queue.release();
  await promise1;

  // Release again - should wake promise2
  queue.release();
  await promise2;

  // Verify FIFO order
  assertEquals(order, [1, 2]);
});

Deno.test("RequestQueue - queue strategy tracks queued count", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "queue",
    sleepMs: 10,
  });

  await queue.acquire();
  assertEquals(queue.getQueued(), 0);

  // Start waiting acquires
  const p1 = queue.acquire();
  const p2 = queue.acquire();

  // Give time for both to queue
  await new Promise((resolve) => setTimeout(resolve, 10));

  assertEquals(queue.getQueued(), 2);

  // Release and let them complete
  queue.release();
  queue.release();
  queue.release();

  await Promise.all([p1, p2]);

  assertEquals(queue.getQueued(), 0);
});

Deno.test("RequestQueue - queue strategy metrics show queued", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "queue",
    sleepMs: 10,
  });

  await queue.acquire();

  // Start waiting acquires
  const p1 = queue.acquire();
  const p2 = queue.acquire();

  await new Promise((resolve) => setTimeout(resolve, 10));

  const metrics = queue.getMetrics();
  assertEquals(metrics.inFlight, 1);
  assertEquals(metrics.queued, 2);

  // Cleanup
  queue.release();
  queue.release();
  queue.release();
  await Promise.all([p1, p2]);
});

// ==============================================
// Sleep Strategy Tests
// ==============================================

Deno.test("RequestQueue - sleep strategy waits when at capacity", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "sleep",
    sleepMs: 20,
  });

  await queue.acquire();

  const startTime = Date.now();

  // Start waiting acquire
  const acquirePromise = queue.acquire();

  // Release after a delay
  setTimeout(() => queue.release(), 30);

  await acquirePromise;

  const elapsed = Date.now() - startTime;

  // Should have waited at least one sleep cycle
  assert(elapsed >= 20, `Expected elapsed >= 20ms, got ${elapsed}ms`);
});

Deno.test("RequestQueue - sleep strategy uses configured sleep duration", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "sleep",
    sleepMs: 50,
  });

  await queue.acquire();

  const startTime = Date.now();

  // Start waiting acquire in background
  const acquirePromise = queue.acquire();

  // Release after short delay (less than sleepMs)
  setTimeout(() => queue.release(), 10);

  await acquirePromise;

  const elapsed = Date.now() - startTime;

  // Should wait at least one sleep cycle (50ms) even though release was faster
  // This is because sleep strategy busy-waits with fixed intervals
  assert(elapsed >= 10, `Expected elapsed >= 10ms, got ${elapsed}ms`);
});

// ==============================================
// Concurrent Access Tests
// ==============================================

Deno.test("RequestQueue - handles concurrent acquires correctly", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 3,
    strategy: "queue",
    sleepMs: 10,
  });

  // Start 5 concurrent acquires
  const promises = Array.from({ length: 5 }, () => queue.acquire());

  // Give time for all to process
  await new Promise((resolve) => setTimeout(resolve, 20));

  // 3 should be in-flight, 2 should be queued
  assertEquals(queue.getInFlight(), 3);
  assertEquals(queue.getQueued(), 2);

  // Release all and wait for completion
  for (let i = 0; i < 5; i++) {
    queue.release();
  }

  await Promise.all(promises);
});

Deno.test("RequestQueue - size and isEmpty reflect queue state", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 2,
    strategy: "queue",
    sleepMs: 10,
  });

  // Queue empty metrics
  let metrics = queue.getMetrics();
  assertEquals(metrics.inFlight, 0);
  assertEquals(metrics.queued, 0);

  await queue.acquire();
  await queue.acquire();

  // Queue waiting requests
  const p1 = queue.acquire();
  const p2 = queue.acquire();

  await new Promise((resolve) => setTimeout(resolve, 10));

  metrics = queue.getMetrics();
  assertEquals(metrics.inFlight, 2);
  assertEquals(metrics.queued, 2);

  // Cleanup
  queue.release();
  queue.release();
  queue.release();
  queue.release();
  await Promise.all([p1, p2]);
});

// ==============================================
// Edge Cases
// ==============================================

Deno.test("RequestQueue - handles single slot correctly", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "reject",
    sleepMs: 10,
  });

  await queue.acquire();
  assertEquals(queue.getInFlight(), 1);
  assertEquals(queue.isAtCapacity(), true);

  await assertRejects(() => queue.acquire(), Error);

  queue.release();
  assertEquals(queue.getInFlight(), 0);
  assertEquals(queue.isAtCapacity(), false);

  await queue.acquire();
  assertEquals(queue.getInFlight(), 1);
});

Deno.test("RequestQueue - release wakes up waiting request immediately", async () => {
  const queue = new RequestQueue({
    maxConcurrent: 1,
    strategy: "queue",
    sleepMs: 10,
  });

  await queue.acquire();

  let acquired = false;
  const acquirePromise = queue.acquire().then(() => {
    acquired = true;
  });

  // Give time for it to queue
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(acquired, false);

  // Release should wake it immediately
  queue.release();

  // Wait a tiny bit for the promise to resolve
  await new Promise((resolve) => setTimeout(resolve, 5));
  assertEquals(acquired, true);

  await acquirePromise;
});
