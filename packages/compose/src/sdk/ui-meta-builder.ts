/**
 * uiMeta() builder — typed helper for declaring `_meta.ui` with PML extensions.
 *
 * Builds the full `_meta` object ready to spread into an MCP tool definition.
 * Supports standard SEP-1865 fields (resourceUri, visibility, csp, permissions,
 * domain, prefersBorder) plus PML extensions (emits, accepts) for cross-UI
 * event routing.
 *
 * @module sdk/ui-meta-builder
 */

import type { McpUiResourceCsp, McpUiResourcePermissions } from "../core/types/mcp-apps.ts";

/**
 * UI metadata fields for `_meta.ui`, combining SEP-1865 standard fields
 * with PML composition extensions.
 */
export interface UiMetaUi {
  /** URI of the UI resource. */
  resourceUri: string;

  /** Visibility settings: `"model"` (LLM), `"app"` (user). */
  visibility?: Array<"model" | "app">;

  /** Content Security Policy configuration. */
  csp?: McpUiResourceCsp;

  /** Permission capabilities the UI may request. */
  permissions?: McpUiResourcePermissions;

  /** Domain hint for the UI resource. */
  domain?: string;

  /** Whether the UI prefers a visible border/frame. */
  prefersBorder?: boolean;

  /** Event types this UI emits (PML extension). */
  emits?: string[];

  /** Event types this UI accepts (PML extension). */
  accepts?: string[];
}

/**
 * Options for the `uiMeta()` builder.
 *
 * @example
 * ```typescript
 * const opts: UiMetaOptions = {
 *   resourceUri: "ui://erp/customers",
 *   emits: ["rowSelected"],
 *   accepts: ["setFilter"],
 *   visibility: ["model", "app"],
 * };
 * ```
 */
export interface UiMetaOptions {
  /** URI of the UI resource (required). */
  resourceUri: string;

  /** Visibility settings. */
  visibility?: Array<"model" | "app">;

  /** Content Security Policy configuration. */
  csp?: McpUiResourceCsp;

  /** Permission capabilities. */
  permissions?: McpUiResourcePermissions;

  /** Domain hint. */
  domain?: string;

  /** Whether the UI prefers a visible border. */
  prefersBorder?: boolean;

  /** Event types this UI emits (PML extension). */
  emits?: string[];

  /** Event types this UI accepts (PML extension). */
  accepts?: string[];
}

/**
 * Return type of `uiMeta()` — ready to spread into a tool definition.
 */
export interface UiMetaResult {
  _meta: { ui: UiMetaUi };
}

/**
 * Build a typed `_meta` object for an MCP tool definition.
 *
 * Combines standard SEP-1865 UI metadata with PML composition extensions
 * (emits/accepts). Only defined fields are included in the output —
 * undefined optional fields are omitted entirely.
 *
 * @param options - UI metadata options
 * @returns Object with `_meta.ui` ready to spread into a tool definition
 *
 * @example
 * ```typescript
 * import { uiMeta } from "@mcpview/compose";
 *
 * const tool = {
 *   name: "erp:customers",
 *   ...uiMeta({
 *     resourceUri: "ui://erp/customers",
 *     emits: ["rowSelected", "filterChanged"],
 *     accepts: ["setFilter", "highlightRow"],
 *     visibility: ["model", "app"],
 *   }),
 * };
 * ```
 */
export function uiMeta(options: UiMetaOptions): UiMetaResult {
  const ui: UiMetaUi = { resourceUri: options.resourceUri };

  if (options.visibility !== undefined) ui.visibility = options.visibility;
  if (options.csp !== undefined) ui.csp = options.csp;
  if (options.permissions !== undefined) ui.permissions = options.permissions;
  if (options.domain !== undefined) ui.domain = options.domain;
  if (options.prefersBorder !== undefined) ui.prefersBorder = options.prefersBorder;
  if (options.emits !== undefined) ui.emits = options.emits;
  if (options.accepts !== undefined) ui.accepts = options.accepts;

  return { _meta: { ui } };
}
