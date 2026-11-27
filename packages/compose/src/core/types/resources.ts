import type { ComponentSurface } from "./components.ts";

/**
 * Collected UI resource types.
 *
 * @module types/resources
 */

/**
 * UI resource collected from an MCP tool response.
 *
 * When a tool call returns `_meta.ui.resourceUri`, the collector
 * captures it for later composition into a composite UI.
 *
 * @example
 * ```typescript
 * const resource: CollectedUiResource = {
 *   source: "postgres:query",
 *   resourceUri: "ui://postgres/table/abc123",
 *   context: { query: "SELECT * FROM sales" },
 *   slot: 0,
 * };
 * ```
 */
export interface CollectedUiResource {
  /** Stable instance identity. Unlike `source`, this distinguishes repeated tool calls. */
  componentId?: string;

  /** Tool that produced this UI resource (e.g., `"postgres:query"`). */
  source: string;

  /** URI of the UI resource (from `_meta.ui.resourceUri`). */
  resourceUri: string;

  /** Optional context data for the UI. */
  context?: Record<string, unknown>;

  /** Optional inner surface assembled from components advertised by this App. */
  surface?: ComponentSurface;

  /** Widths offered by this viewer in CSS pixels. An empty list disables resizing. */
  supportedWidths?: readonly number[];

  /** Slot index (0-based execution order). */
  slot: number;
}

/** Whether a Compose width declaration contains only positive whole CSS pixel values. */
export function isSupportedWidths(value: unknown): value is readonly number[] {
  if (!Array.isArray(value)) return false;
  for (const width of value) {
    if (!Number.isSafeInteger(width) || width <= 0) return false;
  }
  return true;
}
