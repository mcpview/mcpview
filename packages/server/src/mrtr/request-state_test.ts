/**
 * Tests for the requestState seal/verify pair (Track B, spec 2026-07-28 MRTR).
 *
 * Each test targets a distinct rejection path so the suite is also
 * documentation of every security-relevant check and its expected error code.
 *
 * No server is needed — the functions are pure async.
 */

import { assertEquals } from "@std/assert";
import {
  exportStateKey,
  generateStateKey,
  importStateKey,
  paramsDigest,
  sealRequestState,
  verifyRequestState,
} from "./request-state.ts";
import type { RequestStatePayload } from "./request-state.ts";

// ── Shared test fixtures ──────────────────────────────────────────────────────

/** A fixed 32-byte key expressed as hex (for deterministic tests). */
const TEST_KEY_HEX =
  "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";

/** A valid payload that should pass all checks when everything is correct. */
function makePayload(
  overrides: Partial<RequestStatePayload> = {},
): RequestStatePayload {
  return {
    sub: "user-abc",
    method: "tools/call",
    paramsDigest: "deadbeef".repeat(8), // 64 hex chars (32 bytes)
    exp: 9_999_999_999, // far future
    nonce: "aabbccddeeff0011223344556677aabb",
    ...overrides,
  };
}

/** The `nowSecs` value we inject so `exp > now` holds for `makePayload()`. */
const NOW = 1_000_000_000;

// ── importStateKey ────────────────────────────────────────────────────────────

Deno.test("importStateKey — accepts valid 64-char lowercase hex", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  assertEquals(key.type, "secret");
  assertEquals(key.algorithm.name, "HMAC");
});

Deno.test("importStateKey — rejects uppercase hex", async () => {
  const upper = TEST_KEY_HEX.toUpperCase();
  let threw = false;
  try {
    await importStateKey(upper);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("importStateKey — rejects 63-char string (too short)", async () => {
  let threw = false;
  try {
    await importStateKey(TEST_KEY_HEX.slice(0, -1));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ── generateStateKey / exportStateKey roundtrip ───────────────────────────────

Deno.test("generateStateKey + exportStateKey — 64-char hex roundtrip", async () => {
  const key = await generateStateKey();
  const hex = await exportStateKey(key);
  assertEquals(hex.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(hex), true);
  // Re-import to confirm the exported key is usable
  const reimported = await importStateKey(hex);
  assertEquals(reimported.algorithm.name, "HMAC");
});

// ── paramsDigest ──────────────────────────────────────────────────────────────

Deno.test("paramsDigest — deterministic across key insertion orders", async () => {
  const a = await paramsDigest({ arguments: { x: 1 }, name: "echo" });
  const b = await paramsDigest({ name: "echo", arguments: { x: 1 } });
  // Canonical JSON sorts keys, so both representations hash identically.
  assertEquals(a, b);
});

Deno.test("paramsDigest — different params produce different digests", async () => {
  const a = await paramsDigest({ name: "echo", arguments: {} });
  const b = await paramsDigest({ name: "exec", arguments: {} });
  assertEquals(a === b, false);
});

Deno.test("paramsDigest — null value", async () => {
  const d = await paramsDigest(null);
  assertEquals(typeof d, "string");
  assertEquals(d.length, 64); // 32-byte SHA-256 → 64 hex chars
});

// ── Happy-path seal + verify ──────────────────────────────────────────────────

Deno.test("seal + verify — happy path", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload();
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.payload.sub, payload.sub);
    assertEquals(result.payload.method, payload.method);
    assertEquals(result.payload.paramsDigest, payload.paramsDigest);
    assertEquals(result.payload.nonce, payload.nonce);
  }
});

Deno.test("seal + verify — token contains exactly one dot separator", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const token = await sealRequestState(makePayload(), key);
  const parts = token.split(".");
  assertEquals(parts.length, 2);
  // Both segments must be non-empty base64url
  assertEquals(parts[0].length > 0, true);
  assertEquals(parts[1].length > 0, true);
});

// ── Rejection: tampered ───────────────────────────────────────────────────────

Deno.test("verify — rejects token with wrong structure (no dot)", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const result = await verifyRequestState("nodothere", key, {
    principal: "user-abc",
    method: "tools/call",
    paramsDigest: "x",
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "tampered");
});

Deno.test("verify — rejects token with empty payload segment", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const result = await verifyRequestState(".signature", key, {
    principal: "user-abc",
    method: "tools/call",
    paramsDigest: "x",
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "tampered");
});

Deno.test("verify — rejects token with flipped bit in payload", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload();
  const token = await sealRequestState(payload, key);

  // Flip one character in the payload segment
  const [b64uJson, b64uHmac] = token.split(".");
  const tampered = b64uJson.slice(0, -1) +
    (b64uJson.slice(-1) === "A" ? "B" : "A") +
    "." + b64uHmac;

  const result = await verifyRequestState(tampered, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "tampered");
});

Deno.test("verify — rejects token with truncated HMAC", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const token = await sealRequestState(makePayload(), key);
  const [b64uJson, b64uHmac] = token.split(".");
  const truncated = b64uJson + "." + b64uHmac.slice(0, 10);

  const result = await verifyRequestState(truncated, key, {
    principal: "user-abc",
    method: "tools/call",
    paramsDigest: makePayload().paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "tampered");
});

Deno.test("verify — rejects token signed with a different key", async () => {
  const keyA = await importStateKey(TEST_KEY_HEX);
  const keyB = await generateStateKey();

  const token = await sealRequestState(makePayload(), keyA);
  const result = await verifyRequestState(token, keyB, {
    principal: "user-abc",
    method: "tools/call",
    paramsDigest: makePayload().paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "tampered");
});

// ── Rejection: wrong_principal ────────────────────────────────────────────────

Deno.test("verify — rejects token for different principal", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({ sub: "alice" });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: "bob", // different user
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "wrong_principal");
});

Deno.test("verify — empty principal matches empty sub", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({ sub: "" });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: "",
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, true);
});

// ── Rejection: expired ────────────────────────────────────────────────────────

Deno.test("verify — rejects expired token (exp in the past)", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const pastExp = NOW - 1;
  const payload = makePayload({ exp: pastExp });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "expired");
});

Deno.test("verify — rejects token at exact expiry second (exp === now, not >=)", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  // exp === nowSecs means the token has exactly expired (the spec says exp <= now → reject)
  const payload = makePayload({ exp: NOW });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "expired");
});

Deno.test("verify — accepts token one second before expiry", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({ exp: NOW + 1 });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, true);
});

// ── Rejection: wrong_method ───────────────────────────────────────────────────

Deno.test("verify — rejects token replayed on a different method", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({ method: "tools/call" });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: "resources/read", // different method
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "wrong_method");
});

// ── Rejection: wrong_params ───────────────────────────────────────────────────

Deno.test("verify — rejects token replayed with different arguments", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const origDigest = await paramsDigest({
    name: "echo",
    arguments: { msg: "hello" },
  });
  const otherDigest = await paramsDigest({
    name: "exec",
    arguments: { cmd: "rm -rf /" },
  });

  const payload = makePayload({ paramsDigest: origDigest });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: payload.method,
    paramsDigest: otherDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "wrong_params");
});

// ── Ordering: rejection reasons fire in priority order ────────────────────────
//
// When multiple claims are wrong, the check order (tampered → wrong_principal →
// expired → wrong_method → wrong_params) determines which reason surfaces. We
// cannot observe the post-tamper ordering because a tampered token fails the
// HMAC before field decoding. But we CAN check that principal beats expiry.

Deno.test("verify — wrong_principal fires before expired", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({
    sub: "alice",
    exp: NOW - 10, // also expired
  });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: "bob",
    method: payload.method,
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "wrong_principal");
});

Deno.test("verify — expired fires before wrong_method", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const payload = makePayload({
    exp: NOW - 1, // expired
    method: "tools/call",
  });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: "resources/read", // also wrong method
    paramsDigest: payload.paramsDigest,
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "expired");
});

Deno.test("verify — wrong_method fires before wrong_params", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const wrongDigest = await paramsDigest({ name: "other" });
  const payload = makePayload({
    method: "tools/call",
    paramsDigest: wrongDigest,
  });
  const token = await sealRequestState(payload, key);

  const result = await verifyRequestState(token, key, {
    principal: payload.sub,
    method: "resources/read", // wrong method
    paramsDigest: await paramsDigest({ uri: "ui://x/y" }), // also wrong params
    nowSecs: NOW,
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "wrong_method");
});

// ── Nonce uniqueness property ─────────────────────────────────────────────────
// Two seals of the same payload with different nonces produce different tokens.

Deno.test("seal — different nonces produce different tokens for the same payload", async () => {
  const key = await importStateKey(TEST_KEY_HEX);
  const base = makePayload();
  const t1 = await sealRequestState({
    ...base,
    nonce: "aabbcc001122334455667788aabbccdd",
  }, key);
  const t2 = await sealRequestState({
    ...base,
    nonce: "00112233445566778899aabbccddeeff",
  }, key);
  assertEquals(t1 === t2, false);
});
