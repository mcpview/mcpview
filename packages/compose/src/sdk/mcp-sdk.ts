/**
 * MCP SDK adapter — wraps the collector for use with `@modelcontextprotocol/client` tool call results.
 *
 * This adapter provides a convenience wrapper around the collector that accepts
 * the shape of tool call results from the official MCP SDK. It uses generic interfaces
 * to avoid importing the SDK directly (zero-dependency constraint).
 *
 * @module sdk/mcp-sdk
 */

import type { CollectedUiResource } from "../core/types/resources.ts";
import { createCollector } from "../core/collector/collector.ts";
import type { UiCollector } from "../core/collector/collector.ts";

/**
 * Minimal shape of an MCP SDK `CallToolResult`.
 *
 * This is a structural subset of `@modelcontextprotocol/client`'s `CallToolResult`.
 * Any object matching this shape will be accepted — no need to import the SDK.
 *
 * @example
 * ```typescript
 * // This matches the shape of @modelcontextprotocol/client CallToolResult
 * const result: McpSdkCallToolResult = {
 *   content: [{ type: "text", text: "OK" }],
 *   _meta: { ui: { resourceUri: "ui://pg/table/1" } },
 * };
 * ```
 */
export interface McpSdkCallToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * MCP SDK-aware collector that wraps the core collector with SDK-typed inputs.
 *
 * @example
 * ```typescript
 * const collector = createMcpSdkCollector();
 * collector.collectFromSdk("postgres:query", sdkResult, { query: "SELECT *" });
 * const resources = collector.getResources();
 * ```
 */
export interface McpSdkCollector {
  /**
   * Collect a UI resource from an MCP SDK `CallToolResult`.
   *
   * Delegates to the core collector's `collect` method. If the result
   * has `isError: true`, it is skipped (error results don't produce UIs).
   *
   * @param toolName - Name of the tool that produced this result
   * @param result - MCP SDK CallToolResult (or any structurally compatible object)
   * @param context - Optional context data for the UI
   * @returns Collected resource, or `null` if no UI metadata or if result is an error
   */
  collectFromSdk(
    toolName: string,
    result: McpSdkCallToolResult,
    context?: Record<string, unknown>,
  ): CollectedUiResource | null;

  /** Get all collected resources in slot order. */
  getResources(): CollectedUiResource[];

  /** Reset collected resources. */
  clear(): void;

  /** Access the underlying core collector. */
  readonly inner: UiCollector;
}

/**
 * Create an MCP SDK-aware collector.
 *
 * Wraps the core `UiCollector` with an interface that accepts
 * `@modelcontextprotocol/client` `CallToolResult` objects directly.
 * Error results (`isError: true`) are automatically skipped.
 *
 * @returns A new `McpSdkCollector` instance
 *
 * @example
 * ```typescript
 * import { createMcpSdkCollector } from "@mcpview/compose/sdk";
 *
 * const collector = createMcpSdkCollector();
 *
 * // Collect from SDK tool call results
 * for (const [toolName, result] of toolCallResults) {
 *   collector.collectFromSdk(toolName, result, { workflowId: "wf-1" });
 * }
 *
 * // Use collected resources in the standard pipeline
 * const resources = collector.getResources();
 * ```
 */
export function createMcpSdkCollector(): McpSdkCollector {
  const inner = createCollector();

  return {
    collectFromSdk(
      toolName: string,
      result: McpSdkCallToolResult,
      context?: Record<string, unknown>,
    ): CollectedUiResource | null {
      if (result.isError) {
        return null;
      }
      return inner.collect(toolName, result, context);
    },

    getResources(): CollectedUiResource[] {
      return inner.getResources();
    },

    clear(): void {
      inner.clear();
    },

    get inner(): UiCollector {
      return inner;
    },
  };
}
