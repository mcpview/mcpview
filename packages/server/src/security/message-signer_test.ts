/**
 * Tests for MessageSigner — HMAC-SHA256 sign/verify for PostMessage channels.
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  buildHmacPayload,
  bytesToHex,
  hexToBytes,
  MessageSigner,
} from "./message-signer.ts";
import type { SignedMessage } from "./message-signer.ts";

// ── Hex utilities ──────────────────────────────────────────────

Deno.test("bytesToHex - converts bytes to lowercase hex", () => {
  const bytes = new Uint8Array([0x00, 0xff, 0x0a, 0xab]);
  assertEquals(bytesToHex(bytes), "00ff0aab");
});

Deno.test("bytesToHex - empty array", () => {
  assertEquals(bytesToHex(new Uint8Array([])), "");
});

Deno.test("hexToBytes - converts hex to bytes", () => {
  const bytes = hexToBytes("00ff0aab");
  assertEquals(bytes, new Uint8Array([0x00, 0xff, 0x0a, 0xab]));
});

Deno.test("hexToBytes - uppercase hex", () => {
  const bytes = hexToBytes("00FF0AAB");
  assertEquals(bytes, new Uint8Array([0x00, 0xff, 0x0a, 0xab]));
});

Deno.test("hexToBytes - odd length returns null", () => {
  assertEquals(hexToBytes("abc"), null);
});

Deno.test("hexToBytes - non-hex chars returns null", () => {
  assertEquals(hexToBytes("zzzz"), null);
});

Deno.test("hexToBytes - empty string returns null (fails regex)", () => {
  assertEquals(hexToBytes(""), null);
});

Deno.test("hex roundtrip", () => {
  const original = new Uint8Array([1, 2, 3, 255, 128, 0]);
  assertEquals(hexToBytes(bytesToHex(original)), original);
});

// ── buildHmacPayload ──────────────────────────────────────────

Deno.test("buildHmacPayload - request with params", () => {
  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "test" },
  };
  assertEquals(buildHmacPayload(msg, 0), '0:1:tools/call:{"name":"test"}');
});

Deno.test("buildHmacPayload - response with result", () => {
  const msg: SignedMessage = { jsonrpc: "2.0", id: 1, result: { data: 42 } };
  assertEquals(buildHmacPayload(msg, 5), '5:1::{"data":42}');
});

Deno.test("buildHmacPayload - error response", () => {
  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -1, message: "fail" },
  };
  assertEquals(buildHmacPayload(msg, 2), '2:1::{"code":-1,"message":"fail"}');
});

Deno.test("buildHmacPayload - notification (no id)", () => {
  const msg: SignedMessage = { jsonrpc: "2.0", method: "ui/initialize" };
  assertEquals(buildHmacPayload(msg, 0), "0::ui/initialize:{}");
});

Deno.test("buildHmacPayload - string id", () => {
  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: "abc-123",
    method: "test",
    params: {},
  };
  assertEquals(buildHmacPayload(msg, 7), "7:abc-123:test:{}");
});

// ── MessageSigner.generateSecret ───────────────────────────────

Deno.test("MessageSigner.generateSecret - returns 64-char hex string", () => {
  const secret = MessageSigner.generateSecret();
  assertEquals(secret.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(secret), true);
});

Deno.test("MessageSigner.generateSecret - unique per call", () => {
  const a = MessageSigner.generateSecret();
  const b = MessageSigner.generateSecret();
  assertEquals(a !== b, true);
});

// ── MessageSigner ──────────────────────────────────────────────

Deno.test("MessageSigner - roundtrip sign → verify", async () => {
  const secret = MessageSigner.generateSecret();
  const signer = new MessageSigner(secret);
  await signer.init();

  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "test" },
  };
  const signed = await signer.sign(msg);

  assertEquals(typeof signed._hmac, "string");
  assertEquals(signed._seq, 0);
  assertEquals(signed.method, "tools/call");

  // Same signer can verify its own messages (seq increases monotonically)
  const result = await signer.verify(signed);
  assertEquals(result.valid, true);
  assertEquals(result.message.method, "tools/call");
  assertEquals(result.message._hmac, undefined);
  assertEquals(result.message._seq, undefined);
});

Deno.test("MessageSigner - two-party roundtrip", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    params: {},
  };
  const signed = await alice.sign(msg);
  const result = await bob.verify(signed);
  assertEquals(result.valid, true);
  assertEquals(result.message.method, "ping");
});

Deno.test("MessageSigner - tampered payload rejected", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "test",
    params: { x: 1 },
  };
  const signed = await alice.sign(msg);

  // Tamper with params
  signed.params = { x: 999 };
  const result = await bob.verify(signed);
  assertEquals(result.valid, false);
  assertEquals(result.error, "HMAC signature mismatch");
});

Deno.test("MessageSigner - replay rejected (same seq)", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  const msg: SignedMessage = {
    jsonrpc: "2.0",
    id: 1,
    method: "test",
    params: {},
  };
  const signed = await alice.sign(msg);

  // First verify succeeds
  const r1 = await bob.verify(signed);
  assertEquals(r1.valid, true);

  // Replay of same message rejected
  const r2 = await bob.verify(signed);
  assertEquals(r2.valid, false);
  assertEquals(r2.error?.includes("Replay detected"), true);
});

Deno.test("MessageSigner - sequence gap OK", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  // Sign 3 messages, verify only #0 and #2 (skip #1)
  const msg0 = await alice.sign({
    jsonrpc: "2.0",
    id: 1,
    method: "m0",
    params: {},
  });
  await alice.sign({ jsonrpc: "2.0", id: 2, method: "m1", params: {} }); // skip
  const msg2 = await alice.sign({
    jsonrpc: "2.0",
    id: 3,
    method: "m2",
    params: {},
  });

  const r0 = await bob.verify(msg0);
  assertEquals(r0.valid, true);

  // seq=2, lastRecvSeq=0, gap is OK (2 > 0)
  const r2 = await bob.verify(msg2);
  assertEquals(r2.valid, true);
});

Deno.test("MessageSigner - decrement seq rejected", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  const msg0 = await alice.sign({
    jsonrpc: "2.0",
    id: 1,
    method: "a",
    params: {},
  }); // seq=0
  const msg1 = await alice.sign({
    jsonrpc: "2.0",
    id: 2,
    method: "b",
    params: {},
  }); // seq=1

  // Verify seq=1 first
  const r1 = await bob.verify(msg1);
  assertEquals(r1.valid, true);

  // Now seq=0 should be rejected (0 <= lastRecvSeq=1)
  const r0 = await bob.verify(msg0);
  assertEquals(r0.valid, false);
  assertEquals(r0.error?.includes("Replay detected"), true);
});

Deno.test("MessageSigner - wrong secret rejected", async () => {
  const alice = new MessageSigner(MessageSigner.generateSecret());
  const bob = new MessageSigner(MessageSigner.generateSecret()); // different secret
  await alice.init();
  await bob.init();

  const signed = await alice.sign({
    jsonrpc: "2.0",
    id: 1,
    method: "test",
    params: {},
  });
  const result = await bob.verify(signed);
  assertEquals(result.valid, false);
  assertEquals(result.error, "HMAC signature mismatch");
});

Deno.test("MessageSigner - missing _hmac returns error", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await signer.init();

  const result = await signer.verify({ jsonrpc: "2.0", id: 1, method: "test" });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Missing _hmac or _seq field");
});

Deno.test("MessageSigner - invalid _hmac hex returns error", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await signer.init();

  const result = await signer.verify({
    jsonrpc: "2.0",
    id: 1,
    method: "test",
    _hmac: "not-hex!",
    _seq: 0,
  });
  assertEquals(result.valid, false);
  assertEquals(result.error, "Invalid _hmac: not valid hex");
});

Deno.test("MessageSigner - sign before init throws", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await assertRejects(
    () => signer.sign({ jsonrpc: "2.0", method: "test" }),
    Error,
    "Not initialized",
  );
});

Deno.test("MessageSigner - verify before init throws", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await assertRejects(
    () =>
      signer.verify({ jsonrpc: "2.0", method: "test", _hmac: "aa", _seq: 0 }),
    Error,
    "Not initialized",
  );
});

Deno.test("MessageSigner - invalid secret throws on init", async () => {
  const signer = new MessageSigner("not-valid-hex!");
  await assertRejects(
    () => signer.init(),
    Error,
    "Invalid secret",
  );
});

Deno.test("MessageSigner - init is idempotent", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await signer.init();
  await signer.init(); // should not throw
});

Deno.test("MessageSigner - reset clears counters", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await signer.init();

  // Sign two messages (seq 0, 1)
  await signer.sign({ jsonrpc: "2.0", method: "a" });
  const msg1 = await signer.sign({ jsonrpc: "2.0", method: "b" });
  assertEquals(msg1._seq, 1);

  // Reset
  signer.reset();

  // Next sign should start at seq 0 again
  const msg0 = await signer.sign({ jsonrpc: "2.0", method: "c" });
  assertEquals(msg0._seq, 0);
});

Deno.test("MessageSigner - seq increments per message", async () => {
  const signer = new MessageSigner(MessageSigner.generateSecret());
  await signer.init();

  const m0 = await signer.sign({ jsonrpc: "2.0", method: "a" });
  const m1 = await signer.sign({ jsonrpc: "2.0", method: "b" });
  const m2 = await signer.sign({ jsonrpc: "2.0", method: "c" });

  assertEquals(m0._seq, 0);
  assertEquals(m1._seq, 1);
  assertEquals(m2._seq, 2);
});

Deno.test("MessageSigner - response message roundtrip", async () => {
  const secret = MessageSigner.generateSecret();
  const alice = new MessageSigner(secret);
  const bob = new MessageSigner(secret);
  await alice.init();
  await bob.init();

  const response: SignedMessage = {
    jsonrpc: "2.0",
    id: 42,
    result: { content: [{ type: "text", text: "hello" }] },
  };
  const signed = await alice.sign(response);
  const result = await bob.verify(signed);
  assertEquals(result.valid, true);
  assertEquals(
    (result.message.result as Record<string, unknown[]>).content.length,
    1,
  );
});
