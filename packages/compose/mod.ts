/**
 * mcp-compose — MCP Apps UI Orchestrator
 *
 * Lightweight library for composing and synchronizing multiple MCP Apps UIs
 * into composite dashboards.
 *
 * Pipeline: Collector -> Composer -> Renderer
 *
 * @module mcp-compose
 *
 * @example Basic usage
 * ```typescript
 * import { createCollector, buildCompositeUi, renderComposite } from "@mcpview/compose";
 *
 * // 1. Collect UI resources from MCP tool results
 * const collector = createCollector();
 * collector.collect("postgres:query", toolResult1, { query: "SELECT *" });
 * collector.collect("viz:render", toolResult2);
 *
 * // 2. Compose into a descriptor
 * const descriptor = buildCompositeUi(collector.getResources(), {
 *   layout: "split",
 *   sync: [{ from: "postgres:query", event: "filter", to: "viz:render", action: "update" }],
 * });
 *
 * // 3. Render to HTML
 * const html = renderComposite(descriptor);
 * ```
 */

// Core — types, collector, sync, composer, renderer
export type {
  AdvertisedComponentCatalog,
  CollectedUiResource,
  ComponentSurface,
  ComponentSurfaceItem,
  ComponentSurfaceLayout,
  ComponentSurfaceResolution,
  CompositeUiDescriptor,
  JsonValue,
  McpToolResult,
  McpUiCsp,
  McpUiPermissions,
  McpUiResourceMeta,
  McpUiToolMeta,
  ReadyComponentSurface,
  ResolvedSyncRule,
  SurfaceGap,
  SurfaceLayoutType,
  UiLayout,
  UiOrchestration,
  UiPortSyncRule,
  UiSyncRule,
  UnresolvedComponentSurface,
  ValidationIssue,
  ValidationResult,
  ViewComponentDescriptor,
  ViewComponentEventPorts,
} from "./src/core/types/mod.ts";

export { ErrorCode, isValidLayout, UI_LAYOUT_PRESETS } from "./src/core/types/mod.ts";

export { createCollector, extractUiMeta } from "./src/core/collector/mod.ts";
export type { UiCollector } from "./src/core/collector/mod.ts";

export { resolveSyncRules, validateSyncRules } from "./src/core/sync/mod.ts";
export type { ResolutionResult } from "./src/core/sync/mod.ts";

export { buildCompositeUi } from "./src/core/composer/mod.ts";
export { resolveComponentSurface } from "./src/core/components/mod.ts";

export { renderComposite } from "./src/host/renderer/mod.ts";

// SDK — MCP client adapters (optional convenience wrappers)
export { createMcpSdkCollector } from "./src/sdk/mod.ts";
export type { McpSdkCallToolResult, McpSdkCollector } from "./src/sdk/mod.ts";

export { uiMeta } from "./src/sdk/mod.ts";
export type { UiMetaOptions, UiMetaResult, UiMetaUi } from "./src/sdk/mod.ts";

export { validateComposition } from "./src/sdk/mod.ts";
export type {
  CompositionIssue,
  CompositionIssueCode,
  CompositionValidationResult,
} from "./src/sdk/mod.ts";

export { COMPOSE_EVENT_METHOD, composeEvents } from "./src/sdk/mod.ts";
export type {
  ComposeEventHandler,
  ComposeEventPayload,
  ComposeEvents,
  ComposeSource,
  ComposeTarget,
} from "./src/sdk/mod.ts";

// Host — host integration types
export type { CompositeUiHost, HostConfig } from "./src/host/mod.ts";
