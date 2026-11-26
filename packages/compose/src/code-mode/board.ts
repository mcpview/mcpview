/**
 * Browser-side composition of completed Code Mode results.
 * @module
 */

import { createCollector } from "../core/collector/collector.ts";
import { extractUiMeta } from "../core/collector/extractor.ts";
import { buildCompositeUi } from "../core/composer/composer.ts";
import type { ComponentSurface } from "../core/types/components.ts";
import type { CompositeUiDescriptor } from "../core/types/descriptor.ts";
import type { UiLayout } from "../core/types/layout.ts";

/** MCP App result metadata containing the receipts selected by the program. */
export const SNIPPET_PANELS_META_KEY = "io.mcpview/snippet-panels";

/** A selected provider result. The receipt ID distinguishes calls to the same snippet. */
export interface SnippetPanel {
  readonly id: string;
  readonly provider: string;
  readonly name: string;
  readonly title: string;
  readonly result: Record<string, unknown>;
}

/** An App-owned view for a receipt, with optional renderer data and component selection. */
export interface SnippetPanelView {
  readonly resourceUri: string;
  readonly context?: Record<string, unknown>;
  readonly surface?: ComponentSurface;
}

/** Display options supplied by the board hosting the results. */
export interface SnippetBoardOptions {
  /** A Compose layout or a function of the number of mounted panels. Defaults to stack. */
  readonly layout?: UiLayout | ((count: number) => UiLayout);
  /** Provide a local view adapter or return undefined to use the result's native MCP App URI. */
  readonly resolveView?: (panel: SnippetPanel) => SnippetPanelView | undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPanel(value: unknown): value is SnippetPanel {
  return record(value) &&
    typeof value.id === "string" && value.id.length > 0 &&
    typeof value.provider === "string" && value.provider.length > 0 &&
    typeof value.name === "string" && value.name.length > 0 &&
    typeof value.title === "string" && record(value.result);
}

/**
 * Return selected receipts in display order from the App-only MCP result metadata.
 * Invalid entries and repeated receipt IDs are ignored. Distinct receipts can
 * point to the same snippet and viewer.
 *
 * @example
 * ```ts
 * for (const panel of readSnippetPanels(toolResult)) {
 *   console.log(panel.provider, panel.name, panel.title);
 * }
 * ```
 */
export function readSnippetPanels(result: unknown): SnippetPanel[] {
  if (!record(result) || !record(result._meta)) return [];
  const items = result._meta[SNIPPET_PANELS_META_KEY];
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const panels: SnippetPanel[] = [];
  for (const item of items) {
    if (isPanel(item) && !seen.has(item.id)) {
      panels.push(item);
      seen.add(item.id);
    }
  }
  return panels;
}

/**
 * Build a Compose descriptor from the current execution, without making any provider calls.
 * Each child keeps its receipt in `context.panel` and adapter data in `context.view`.
 * The returned summary is shared as `sharedContext.value` when the execution has a value.
 * A data-only receipt needs a local view adapter to produce a child.
 *
 * @example
 * ```ts
 * const board = composeSnippetBoard(toolResult, {
 *   layout: "split",
 *   resolveView: (panel) => panel.provider === "metrics"
 *     ? { resourceUri: "ui://my-board/metrics" }
 *     : undefined,
 * });
 * ```
 */
export function composeSnippetBoard(
  result: unknown,
  options: SnippetBoardOptions = {},
): CompositeUiDescriptor {
  const summary = record(result) && record(result.structuredContent)
    ? result.structuredContent
    : {};
  const collector = createCollector();
  for (const panel of readSnippetPanels(result)) {
    const view = options.resolveView?.(panel);
    const resourceUri = view?.resourceUri ?? extractUiMeta(panel.result)?.resourceUri;
    if (!resourceUri || !/^ui:\/\/[^\s]+$/.test(resourceUri)) continue;
    collector.collect(
      `${panel.provider}:${panel.name}`,
      { _meta: { ui: { resourceUri } } },
      {
        panel,
        ...(view?.context === undefined ? {} : { view: view.context }),
        ...(Object.hasOwn(summary, "value") ? { value: summary.value } : {}),
      },
      { componentId: panel.id, surface: view?.surface },
    );
  }
  const resources = collector.getResources();
  const layout = typeof options.layout === "function"
    ? options.layout(resources.length)
    : options.layout;
  return buildCompositeUi(resources, { layout: layout ?? "stack", sharedContext: ["value"] });
}
