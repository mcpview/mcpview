/**
 * Public API contract tests for mod.ts
 *
 * Guards the deprecated re-exports from accidental removal during cleanup.
 * When `ConcurrentMCPServer` and `ConcurrentServerOptions` are dropped in
 * v1.0, this file will fail to compile — that's the signal to delete it.
 *
 * @module lib/server/mod_test
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  buildClientIdMetadataDocument,
  CallbackServer,
  CimdConfigError,
  ConcurrentMCPServer,
  FileTokenStore,
  isCimdConfig,
  McpApp,
  MemoryTokenStore,
  OAuthClientProviderImpl,
  prepareOAuthProvider,
} from "../mod.ts";

Deno.test("retro-compat: ConcurrentMCPServer is the same class as McpApp", () => {
  // Strict identity — both names point to the exact same constructor.
  assertStrictEquals(ConcurrentMCPServer, McpApp);

  // instanceof passes in both directions.
  const app = new ConcurrentMCPServer({ name: "test", version: "1.0.0" });
  assert(app instanceof McpApp);
  assert(app instanceof ConcurrentMCPServer);
});

Deno.test("McpApp.name: public readonly field mirrors options.name (0.16.1)", () => {
  // 0.16.1 exposed `name` as a public readonly property. Prior to this,
  // consumers (including the compose test stubs) had to either reach into
  // private `options.name` or keep a separate reference to the server name
  // for log prefixes and tracing. The field must:
  //   1. Be readable on the instance (not static)
  //   2. Match `options.name` exactly
  //   3. Survive re-reads (immutable between calls, though readonly is
  //      a compile-time-only guarantee in JS — we just verify the value)
  const app = new McpApp({ name: "my-test-server", version: "1.0.0" });
  assertEquals(app.name, "my-test-server");
  // Second read confirms stability.
  assertEquals(app.name, "my-test-server");
});

Deno.test("public API: client-auth and CIMD helpers are exported from root mod", () => {
  assertEquals(typeof prepareOAuthProvider, "function");
  assertEquals(typeof OAuthClientProviderImpl, "function");
  assertEquals(typeof CallbackServer, "function");
  assertEquals(typeof MemoryTokenStore, "function");
  assertEquals(typeof FileTokenStore, "function");
  assertEquals(typeof buildClientIdMetadataDocument, "function");
  assertEquals(typeof isCimdConfig, "function");
  assertEquals(typeof CimdConfigError, "function");
});
