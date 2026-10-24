/**
 * Package version constant — single source of truth for runtime code.
 *
 * This constant is imported by code that needs to know the compose package
 * version at runtime (e.g., the event bus generator embeds it in the
 * `hostInfo.version` field of `ui/initialize` responses so embedded apps
 * can see which host version they're talking to).
 *
 * **MUST be kept in sync with `packages/compose/deno.json`.** The
 * `version_test.ts` file asserts this at test time and will fail CI if
 * the two drift.
 *
 * When bumping the package version, update BOTH:
 * 1. `packages/compose/deno.json` → `version` field
 * 2. This file → `COMPOSE_VERSION` constant
 *
 * @module lib/version
 */

/** @mcpview/compose package version. */
export const COMPOSE_VERSION = "0.11.0" as const;

/**
 * MCP Apps protocol version targeted by compose.
 *
 * Re-exported from `@modelcontextprotocol/ext-apps` so a single source of
 * truth drives the `protocolVersion` field advertised in the `ui/initialize`
 * handshake. Bumping the ext-apps dependency automatically propagates the
 * new protocol version here.
 */
export { LATEST_PROTOCOL_VERSION as MCP_APPS_PROTOCOL_VERSION } from "@modelcontextprotocol/ext-apps";
