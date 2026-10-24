/**
 * MCP Apps specification types (SEP-1865 / spec 2026-01-26).
 *
 * Types from the MCP Apps protocol, sourced directly from
 * `@modelcontextprotocol/ext-apps` to stay in lock-step with the official spec.
 * Compose consumes these types only — no runtime dependency on the ext-apps
 * `App` or `AppBridge` classes (those target a 1-iframe-per-client model
 * incompatible with compose's multi-iframe routing).
 *
 * Legacy aliases (`McpUiCsp`, `McpUiPermissions`) are preserved for backwards
 * compatibility and map to the official names (`McpUiResourceCsp`,
 * `McpUiResourcePermissions`). Prefer the official names in new code.
 *
 * @module types/mcp-apps
 */

import type {
  McpUiResourceCsp,
  McpUiResourceMeta,
  McpUiResourcePermissions,
  McpUiToolMeta,
} from "@modelcontextprotocol/ext-apps";

export type { McpUiResourceCsp, McpUiResourceMeta, McpUiResourcePermissions, McpUiToolMeta };

/**
 * @deprecated Renamed upstream to `McpUiResourceCsp`. Import the new name from
 * `@modelcontextprotocol/ext-apps` or this module. Alias kept for backwards
 * compatibility and will be removed in a future major version.
 */
export type McpUiCsp = McpUiResourceCsp;

/**
 * @deprecated Renamed upstream to `McpUiResourcePermissions`. Import the new
 * name from `@modelcontextprotocol/ext-apps` or this module. Alias kept for
 * backwards compatibility and will be removed in a future major version.
 */
export type McpUiPermissions = McpUiResourcePermissions;

/**
 * Shape of an MCP tool call result that may contain UI metadata.
 *
 * Structural subset used by the compose collector to extract `_meta.ui`
 * without pulling the full `@modelcontextprotocol/client` `CallToolResult` type.
 * Kept compose-local on purpose: the collector is intentionally loose
 * (`content?: unknown[]`) to accept any SDK shape.
 *
 * @example
 * ```typescript
 * const result: McpToolResult = {
 *   content: [{ type: "text", text: "Query executed" }],
 *   _meta: {
 *     ui: { resourceUri: "ui://postgres/table/abc123" },
 *   },
 * };
 * ```
 */
export interface McpToolResult {
  content?: unknown[];
  _meta?: {
    ui?: McpUiToolMeta;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
