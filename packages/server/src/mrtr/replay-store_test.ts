import { assertEquals, assertThrows } from "@std/assert";
import { MemoryMrtrReplayStore } from "./replay-store.ts";

const NONCE_A = "a".repeat(32);
const NONCE_B = "b".repeat(32);

Deno.test("MemoryMrtrReplayStore consumes a nonce exactly once", () => {
  const store = new MemoryMrtrReplayStore({ nowSecs: () => 100 });

  assertEquals(store.consume(NONCE_A, 200), true);
  assertEquals(store.consume(NONCE_A, 200), false);
});

Deno.test("MemoryMrtrReplayStore admits one concurrent consumer", async () => {
  const store = new MemoryMrtrReplayStore({ nowSecs: () => 100 });

  const results = await Promise.all(
    Array.from(
      { length: 20 },
      () => Promise.resolve(store.consume(NONCE_A, 200)),
    ),
  );

  assertEquals(results.filter(Boolean).length, 1);
  assertEquals(results.filter((result) => !result).length, 19);
});

Deno.test("MemoryMrtrReplayStore releases an expired reservation", () => {
  let now = 100;
  const store = new MemoryMrtrReplayStore({ nowSecs: () => now });

  assertEquals(store.consume(NONCE_A, 110), true);
  now = 110;
  assertEquals(store.consume(NONCE_A, 120), true);
});

Deno.test("MemoryMrtrReplayStore prunes expired entries before failing closed", () => {
  let now = 100;
  const store = new MemoryMrtrReplayStore({
    maxEntries: 1,
    nowSecs: () => now,
  });

  assertEquals(store.consume(NONCE_A, 110), true);
  assertThrows(
    () => store.consume(NONCE_B, 120),
    Error,
    "capacity exceeded",
  );

  now = 110;
  assertEquals(store.consume(NONCE_B, 120), true);
});

Deno.test("MemoryMrtrReplayStore validates trusted-store inputs defensively", () => {
  const store = new MemoryMrtrReplayStore({ nowSecs: () => 100 });

  assertThrows(
    () => store.consume("not-a-nonce", 200),
    Error,
    "32 lowercase hex",
  );
  assertThrows(
    () => store.consume(NONCE_A, 100.5),
    Error,
    "safe-integer Unix timestamp",
  );

  const brokenClock = new MemoryMrtrReplayStore({ nowSecs: () => Number.NaN });
  assertThrows(
    () => brokenClock.consume(NONCE_A, 200),
    Error,
    "clock must return",
  );
});
