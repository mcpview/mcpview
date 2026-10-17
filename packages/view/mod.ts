/**
 * `@mcpview/view` — View-side SDK for MCP Apps
 *
 * Lets MCP App authors build SPAs with internal routing instead of using
 * `ui/message` for every navigation (which pollutes the chat thread and
 * triggers the Claude prompt-injection warning on every click).
 *
 * Thin opinionated wrapper around the `App` class from
 * `@modelcontextprotocol/ext-apps`. Owns three concerns: lifecycle bootstrap,
 * memory-based view routing, capability-gated tool call proxy.
 *
 * @example Basic SPA with list + detail views
 * ```typescript
 * import { createMcpApp, defineView } from "@mcpview/view";
 *
 * const list = defineView({
 *   async onEnter(ctx) {
 *     return await ctx.callTool("list_invoices");
 *   },
 *   render(ctx, data) {
 *     // build UI, wire row clicks to ctx.navigate("detail", { id })
 *   },
 * });
 *
 * const detail = defineView<State, { id: string }, Invoice>({
 *   async onEnter(ctx, { id }) {
 *     const res = await ctx.callTool("get_invoice", { id });
 *     return res.structuredContent as Invoice;
 *   },
 *   render(ctx, invoice) { ... },
 * });
 *
 * const app = await createMcpApp({
 *   info: { name: "InvoiceViewer", version: "1.0.0" },
 *   root: document.getElementById("root")!,
 *   views: { list, detail },
 *   initialView: "list",
 * });
 * ```
 *
 * @module mcp-view
 */

export { createMcpApp, defineView } from "./src/app.ts";
export { MCPViewError } from "./src/errors.ts";
export type { MCPViewErrorCode } from "./src/errors.ts";

export { COMPOSE_EVENT_METHOD, createComposeEventClient } from "./src/compose-events.ts";
export type {
  ComposeEventClient,
  ComposeEventHandler,
  ComposeEventPayload,
  ComposeEventSource,
  ComposeEventTarget,
} from "./src/compose-events.ts";

export { readResultData, readStructuredContent } from "./src/results.ts";
export type { ReadResultDataOptions, ResultData } from "./src/results.ts";

export {
  defineSemanticSelection,
  emitSemanticSelection,
  onSemanticSelection,
  parseSemanticSelection,
  SEMANTIC_SELECTION_APPLY_ACTION,
  SEMANTIC_SELECTION_CHANGED_EVENT,
  SEMANTIC_SELECTION_EVENT_PORTS,
  SEMANTIC_SELECTION_SCHEMA,
} from "./src/semantic-selection.ts";
export type {
  ComposedSemanticRef,
  SemanticSelection,
  SemanticSelectionEventContext,
  SemanticSelectionHandler,
  SemanticSelectionInput,
  SemanticSelectionMode,
} from "./src/semantic-selection.ts";

export { onViewerSession } from "./src/viewer-session.ts";
export type { ViewerSessionDispatcher } from "./src/viewer-session.ts";

export type {
  AppConfig,
  AppContext,
  AppHandle,
  AppLifecycleCallbacks,
  TeardownLifecycleCallback,
  TeardownReason,
  ToolInputLifecycleCallback,
  ToolInputPartialLifecycleCallback,
  ToolResult,
  ToolResultLifecycleCallback,
  ViewDefinition,
  ViewerSessionHandler,
  ViewerSessionSubscription,
  ViewLifecycle,
  ViewMap,
  ViewOutput,
  ViewRenderer,
} from "./src/types.ts";
