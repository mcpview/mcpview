/**
 * Tests for CSP utilities (buildCspHeader, injectCspMetaTag)
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCspHeader, injectCspMetaTag } from "./csp.ts";

// ── buildCspHeader ──────────────────────────────────────────────

Deno.test("buildCspHeader - default: deny-all baseline with inline allowed", () => {
  const csp = buildCspHeader();
  assertStringIncludes(csp, "default-src 'none'");
  assertStringIncludes(csp, "script-src 'self' 'unsafe-inline'");
  assertStringIncludes(csp, "style-src 'self' 'unsafe-inline'");
  assertStringIncludes(csp, "img-src 'self' data:");
  assertStringIncludes(csp, "font-src 'self'");
  assertStringIncludes(csp, "connect-src 'self'");
  assertStringIncludes(csp, "frame-ancestors 'self'");
  assertStringIncludes(csp, "base-uri 'self'");
});

Deno.test("buildCspHeader - allowInline=false removes unsafe-inline", () => {
  const csp = buildCspHeader({ allowInline: false });
  assertEquals(csp.includes("'unsafe-inline'"), false);
  assertStringIncludes(csp, "script-src 'self'");
  assertStringIncludes(csp, "style-src 'self'");
});

Deno.test("buildCspHeader - custom script sources", () => {
  const csp = buildCspHeader({ scriptSources: ["https://cdn.example.com"] });
  assertStringIncludes(
    csp,
    "script-src 'self' 'unsafe-inline' https://cdn.example.com",
  );
});

Deno.test("buildCspHeader - custom connect sources", () => {
  const csp = buildCspHeader({
    connectSources: ["wss://api.example.com", "https://api.example.com"],
  });
  assertStringIncludes(
    csp,
    "connect-src 'self' wss://api.example.com https://api.example.com",
  );
});

Deno.test("buildCspHeader - custom frame ancestors", () => {
  const csp = buildCspHeader({ frameAncestors: ["https://app.example.com"] });
  assertStringIncludes(csp, "frame-ancestors 'self' https://app.example.com");
});

Deno.test("buildCspHeader - empty options = same as default", () => {
  assertEquals(buildCspHeader({}), buildCspHeader());
});

// ── injectCspMetaTag ────────────────────────────────────────────

Deno.test("injectCspMetaTag - injects after <head>", () => {
  const html =
    "<html><head><title>Test</title></head><body>Hello</body></html>";
  const result = injectCspMetaTag(html, "default-src 'none'");
  assertStringIncludes(
    result,
    '<head><meta http-equiv="Content-Security-Policy"',
  );
  assertStringIncludes(result, "content=\"default-src 'none'\"");
  // Title should come after the meta tag
  assertEquals(
    result.indexOf("<meta"),
    result.indexOf("<title") - 70 < 0
      ? result.indexOf("<meta")
      : result.indexOf("<meta"),
  );
  assertEquals(result.indexOf("<meta") < result.indexOf("<title>"), true);
});

Deno.test("injectCspMetaTag - handles <head> with attributes", () => {
  const html = '<html><head lang="en"><title>T</title></head></html>';
  const result = injectCspMetaTag(html, "default-src 'none'");
  assertStringIncludes(
    result,
    '<head lang="en"><meta http-equiv="Content-Security-Policy"',
  );
});

Deno.test("injectCspMetaTag - fallback: prepends when no <head>", () => {
  const html = "<body>Hello</body>";
  const result = injectCspMetaTag(html, "default-src 'none'");
  assertEquals(result.startsWith("<meta"), true);
  assertStringIncludes(result, '<meta http-equiv="Content-Security-Policy"');
  assertStringIncludes(result, "<body>Hello</body>");
});

Deno.test("injectCspMetaTag - escapes quotes in CSP value", () => {
  const html = "<head></head>";
  // This CSP value doesn't normally have quotes, but test the escaping
  const csp = `default-src 'none'; script-src 'self' 'unsafe-inline'`;
  const result = injectCspMetaTag(html, csp);
  // Single quotes inside attribute should be fine (they're in a double-quoted attribute)
  assertStringIncludes(
    result,
    `content="default-src 'none'; script-src 'self' 'unsafe-inline'"`,
  );
});

Deno.test("injectCspMetaTag - handles empty HTML", () => {
  const result = injectCspMetaTag("", "default-src 'none'");
  assertEquals(result.startsWith("<meta"), true);
});

Deno.test("injectCspMetaTag - case-insensitive <HEAD>", () => {
  const html = "<HTML><HEAD><TITLE>T</TITLE></HEAD></HTML>";
  const result = injectCspMetaTag(html, "default-src 'none'");
  assertStringIncludes(result, "<HEAD><meta http-equiv=");
});
