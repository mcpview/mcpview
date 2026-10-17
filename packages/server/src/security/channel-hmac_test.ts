/**
 * Tests for channel-hmac — inline HMAC script and HTML injection.
 */

import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { MessageSigner } from "./message-signer.ts";
import { generateHmacScript, injectChannelAuth } from "./channel-hmac.ts";

// ── generateHmacScript ─────────────────────────────────────────

Deno.test("generateHmacScript - contains script tag", () => {
  const script = generateHmacScript("a".repeat(64));
  assertStringIncludes(script, "<script data-mcp-channel-auth>");
  assertStringIncludes(script, "</script>");
});

Deno.test("generateHmacScript - embeds the secret", () => {
  const secret = "deadbeef".repeat(8);
  const script = generateHmacScript(secret);
  assertStringIncludes(script, secret);
});

Deno.test("generateHmacScript - contains signing functions", () => {
  const script = generateHmacScript("a".repeat(64));
  assertStringIncludes(script, "hexToBytes");
  assertStringIncludes(script, "bytesToHex");
  assertStringIncludes(script, "buildPayload");
  assertStringIncludes(script, "signMessage");
  assertStringIncludes(script, "crypto.subtle.importKey");
});

Deno.test("generateHmacScript - monkey-patches postMessage", () => {
  const script = generateHmacScript("a".repeat(64));
  assertStringIncludes(script, "window.parent.postMessage");
  assertStringIncludes(script, "realPostMessage");
});

Deno.test("generateHmacScript - only signs, does not verify", () => {
  const script = generateHmacScript("a".repeat(64));
  // Key imported with ['sign'] only, not ['sign', 'verify']
  assertStringIncludes(script, "['sign']");
  assertEquals(script.includes("['sign', 'verify']"), false);
});

// ── injectChannelAuth ──────────────────────────────────────────

Deno.test("injectChannelAuth - injects before </head>", () => {
  const html =
    "<html><head><title>Test</title></head><body>Hello</body></html>";
  const secret = MessageSigner.generateSecret();
  const result = injectChannelAuth(html, secret);

  assertStringIncludes(result, "<script data-mcp-channel-auth>");
  assertStringIncludes(result, "</head>");
  // Script should be before </head>
  const scriptIdx = result.indexOf("<script data-mcp-channel-auth>");
  const headCloseIdx = result.indexOf("</head>");
  assertEquals(scriptIdx < headCloseIdx, true);
});

Deno.test("injectChannelAuth - prepends when no </head>", () => {
  const html = "<body>Hello</body>";
  const secret = MessageSigner.generateSecret();
  const result = injectChannelAuth(html, secret);

  assertStringIncludes(result, "<script data-mcp-channel-auth>");
  // Script should come before original content
  const scriptIdx = result.indexOf("<script data-mcp-channel-auth>");
  const bodyIdx = result.indexOf("<body>");
  assertEquals(scriptIdx < bodyIdx, true);
});

Deno.test("injectChannelAuth - preserves original content", () => {
  const html =
    '<html><head><meta charset="UTF-8"></head><body><p>Content</p></body></html>';
  const result = injectChannelAuth(html, MessageSigner.generateSecret());
  assertStringIncludes(result, '<meta charset="UTF-8">');
  assertStringIncludes(result, "<p>Content</p>");
});

Deno.test("injectChannelAuth - rejects invalid secret (wrong length)", () => {
  assertThrows(
    () => injectChannelAuth("<head></head>", "abcd"),
    Error,
    "Invalid secret",
  );
});

Deno.test("injectChannelAuth - rejects invalid secret (non-hex chars)", () => {
  assertThrows(
    () => injectChannelAuth("<head></head>", "z".repeat(64)),
    Error,
    "Invalid secret",
  );
});

Deno.test("injectChannelAuth - rejects uppercase hex", () => {
  assertThrows(
    () => injectChannelAuth("<head></head>", "ABCDEF".repeat(10) + "abcd"),
    Error,
    "Invalid secret",
  );
});
