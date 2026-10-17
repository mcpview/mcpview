/**
 * Tests for MCP Apps client capability negotiation.
 *
 * Specification: https://github.com/modelcontextprotocol/ext-apps
 * Spec date: 2026-01-26
 *
 * The capability is advertised by clients via the `extensions` field on
 * `ClientCapabilities` (per SDK 1.29 extensions feature). The well-known
 * extension key for MCP Apps is `io.modelcontextprotocol/ui`.
 *
 * @module lib/server/mcp-apps-capability_test
 */

import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  getMcpAppsCapability,
  MCP_APPS_EXTENSION_ID,
  MCP_APPS_PROTOCOL_VERSION,
} from "./types.ts";
import { McpApp } from "./mcp-app.ts";

Deno.test("MCP_APPS_EXTENSION_ID matches the well-known spec value", () => {
  assertStrictEquals(MCP_APPS_EXTENSION_ID, "io.modelcontextprotocol/ui");
});

Deno.test("MCP_APPS_PROTOCOL_VERSION matches the spec date we target", () => {
  assertStrictEquals(MCP_APPS_PROTOCOL_VERSION, "2026-01-26");
});

Deno.test("getMcpAppsCapability — happy path: client advertises mcp-apps with mimeTypes", () => {
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  });
  assertEquals(cap, { mimeTypes: ["text/html;profile=mcp-app"] });
});

Deno.test("getMcpAppsCapability — happy path: empty capability object is valid", () => {
  // Client advertises support but with no mime types listed.
  // Spec allows this — caller decides how to interpret (defensive: assume nothing).
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": {},
    },
  });
  assertEquals(cap, {});
});

Deno.test("getMcpAppsCapability — null clientCapabilities returns undefined", () => {
  assertStrictEquals(getMcpAppsCapability(null), undefined);
});

Deno.test("getMcpAppsCapability — undefined clientCapabilities returns undefined", () => {
  assertStrictEquals(getMcpAppsCapability(undefined), undefined);
});

Deno.test("getMcpAppsCapability — clientCapabilities without extensions returns undefined", () => {
  assertStrictEquals(getMcpAppsCapability({}), undefined);
});

Deno.test("getMcpAppsCapability — extensions without the mcp-apps key returns undefined", () => {
  const cap = getMcpAppsCapability({
    extensions: {
      "io.example/other-extension": { foo: "bar" },
    },
  });
  assertStrictEquals(cap, undefined);
});

Deno.test("getMcpAppsCapability — non-object extension value returns undefined", () => {
  // Defensive: malformed client data must not crash downstream consumers.
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": "not an object" as unknown as Record<
        string,
        unknown
      >,
    },
  });
  assertStrictEquals(cap, undefined);
});

Deno.test("getMcpAppsCapability — null extension value returns undefined", () => {
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": null as unknown as Record<string, unknown>,
    },
  });
  assertStrictEquals(cap, undefined);
});

Deno.test("getMcpAppsCapability — mimeTypes wrong type is filtered out", () => {
  // Client sent mimeTypes as a number — we drop it but keep the capability
  // object so the caller still knows the client advertised support.
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: 42 as unknown as string[],
      },
    },
  });
  assertEquals(cap, {});
});

Deno.test("getMcpAppsCapability — mimeTypes array with non-string entries is filtered", () => {
  const cap = getMcpAppsCapability({
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app", 42, null, "image/svg+xml"],
      } as unknown as Record<string, unknown>,
    },
  });
  assertEquals(cap, {
    mimeTypes: ["text/html;profile=mcp-app", "image/svg+xml"],
  });
});

Deno.test("getMcpAppsCapability — output is deterministic for same input", () => {
  const input = {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  };
  const a = getMcpAppsCapability(input);
  const b = getMcpAppsCapability(input);
  assertEquals(a, b);
});

// ============================================================================
// McpApp instance method — wiring test
// ============================================================================
//
// We don't simulate a full MCP initialize handshake here (heavy setup for
// little marginal value). Instead we verify the boundary that matters most:
// before any client has connected, the method returns undefined and does not
// throw. This catches the most likely future regression — the SDK renaming
// or removing `getClientCapabilities()` on its Server class.

Deno.test("McpApp.getClientMcpAppsCapability — returns undefined before any client initialize", () => {
  const app = new McpApp({ name: "test", version: "1.0.0" });
  const cap = app.getClientMcpAppsCapability();
  assertStrictEquals(cap, undefined);
});
