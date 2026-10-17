/** Tests for the transport-neutral MRTR retry admission policy. */

import { assertEquals } from "@std/assert";
import { guardMrtrRetry } from "./retry-guard.ts";
import type { MrtrReplayStore } from "./replay-store.ts";
import { importStateKey, sealRequestState } from "./request-state.ts";

const KEY_HEX =
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const BINDINGS = {
  principal: "user-abc",
  method: "tools/call",
  paramsDigest: "deadbeef".repeat(8),
} as const;
const NONCE = "aabbccddeeff0011223344556677aabb";
const FUTURE_EXPIRY = 9_999_999_999;

async function signedState(
  options: {
    readonly bindings?: typeof BINDINGS;
    readonly exp?: number;
  } = {},
): Promise<{ key: CryptoKey; state: string }> {
  const key = await importStateKey(KEY_HEX);
  const bindings = options.bindings ?? BINDINGS;
  const state = await sealRequestState({
    sub: bindings.principal,
    method: bindings.method,
    paramsDigest: bindings.paramsDigest,
    exp: options.exp ?? FUTURE_EXPIRY,
    nonce: NONCE,
  }, key);
  return { key, state };
}

function input(
  overrides: Partial<Parameters<typeof guardMrtrRetry>[0]> = {},
) {
  return {
    key: null,
    replayStore: null,
    bindings: BINDINGS,
    ...overrides,
  };
}

Deno.test("guardMrtrRetry - accepts a first leg without retry fields", async () => {
  assertEquals(await guardMrtrRetry(input()), { kind: "accepted" });
});

Deno.test("guardMrtrRetry - accepts unprotected state but marks it unverified", async () => {
  assertEquals(
    await guardMrtrRetry(input({ requestState: "opaque" })),
    { kind: "accepted", retryVerified: false },
  );
});

Deno.test("guardMrtrRetry - rejects answers without state when a key is configured", async () => {
  const { key } = await signedState();
  assertEquals(
    await guardMrtrRetry(input({
      key,
      inputResponses: { answer: { action: "accept" } },
    })),
    { kind: "missing_state" },
  );
});

Deno.test("guardMrtrRetry - admits a signed state only after atomic consumption", async () => {
  const { key, state } = await signedState();
  let seen: [string, number] | undefined;
  const replayStore: MrtrReplayStore = {
    consume: (nonce, expiry) => {
      seen = [nonce, expiry];
      return true;
    },
  };

  assertEquals(
    await guardMrtrRetry(input({
      key,
      replayStore,
      requestState: state,
      inputResponses: { answer: { action: "accept" } },
    })),
    { kind: "accepted", retryVerified: true },
  );
  assertEquals(seen, [NONCE, FUTURE_EXPIRY]);
});

Deno.test("guardMrtrRetry - reports every integrity or binding failure as invalid state", async () => {
  const { key, state } = await signedState();
  const cases = [
    { state: `${state}x`, bindings: BINDINGS, reason: "tampered" },
    {
      state,
      bindings: { ...BINDINGS, principal: "other-user" },
      reason: "wrong_principal",
    },
    {
      state,
      bindings: { ...BINDINGS, method: "resources/read" },
      reason: "wrong_method",
    },
    {
      state,
      bindings: { ...BINDINGS, paramsDigest: "cafe".repeat(16) },
      reason: "wrong_params",
    },
  ] as const;

  for (const testCase of cases) {
    assertEquals(
      await guardMrtrRetry(input({
        key,
        requestState: testCase.state,
        bindings: testCase.bindings,
      })),
      { kind: "invalid_state", reason: testCase.reason },
    );
  }
});

Deno.test("guardMrtrRetry - reports an expired signed state as invalid", async () => {
  const { key, state } = await signedState({ exp: 0 });
  assertEquals(
    await guardMrtrRetry(input({ key, requestState: state })),
    { kind: "invalid_state", reason: "expired" },
  );
});

Deno.test("guardMrtrRetry - reports a missing replay store for a valid signed state", async () => {
  const { key, state } = await signedState();
  assertEquals(
    await guardMrtrRetry(input({ key, requestState: state })),
    { kind: "replay_store_unavailable", reason: "missing" },
  );
});

Deno.test("guardMrtrRetry - fails closed when replay consumption throws or violates its boolean contract", async () => {
  const { key, state } = await signedState();
  const brokenStores: MrtrReplayStore[] = [
    {
      consume: () => {
        throw new Error("unavailable");
      },
    },
    // Deliberately malformed third-party store; the guard must not coerce it.
    { consume: () => "true" as unknown as boolean },
  ];

  for (const replayStore of brokenStores) {
    assertEquals(
      await guardMrtrRetry(input({ key, requestState: state, replayStore })),
      { kind: "replay_store_unavailable", reason: "consume_failed" },
    );
  }
});

Deno.test("guardMrtrRetry - preserves a store's replay decision", async () => {
  const { key, state } = await signedState();
  assertEquals(
    await guardMrtrRetry(input({
      key,
      requestState: state,
      replayStore: { consume: () => false },
    })),
    { kind: "replayed" },
  );
});
