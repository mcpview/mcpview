/** Viewer-side helpers for the standard semantic-selection contract. */

import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import {
  type ComposedSemanticRef,
  defineSemanticSelection,
  parseSemanticSelection,
  readSurfaceContext,
  SEMANTIC_SELECTION_APPLY_ACTION,
  SEMANTIC_SELECTION_CHANGED_EVENT,
  SEMANTIC_SELECTION_EVENT_PORTS,
  SEMANTIC_SELECTION_SCHEMA,
  type SemanticSelection,
  type SemanticSelectionInput,
  type SemanticSelectionMode,
  validateSemanticSelection,
} from "@mcpview/contracts";
import {
  COMPOSE_EVENT_METHOD,
  type ComposeEventClient,
  type ComposeEventPayload,
} from "./compose-events.ts";

export {
  defineSemanticSelection,
  parseSemanticSelection,
  SEMANTIC_SELECTION_APPLY_ACTION,
  SEMANTIC_SELECTION_CHANGED_EVENT,
  SEMANTIC_SELECTION_EVENT_PORTS,
  SEMANTIC_SELECTION_SCHEMA,
};
export type {
  ComposedSemanticRef,
  SemanticSelection,
  SemanticSelectionInput,
  SemanticSelectionMode,
};

export interface SemanticSelectionEventContext {
  readonly events?: ComposeEventClient;
  readonly hostContext: McpUiHostContext;
}

export type SemanticSelectionHandler = (
  selection: SemanticSelection,
  payload: ComposeEventPayload,
) => void;

/**
 * Emit a selection only when the host explicitly negotiated Compose events.
 * Returns false for a standalone MCP Apps host instead of leaking an unknown
 * postMessage method into it.
 */
export function emitSemanticSelection(
  context: SemanticSelectionEventContext,
  selection: SemanticSelection,
): boolean {
  const surface = readSurfaceContext(context.hostContext);
  if (!context.events || surface?.eventChannel !== COMPOSE_EVENT_METHOD) return false;
  const validated = validateSemanticSelection(selection);
  context.events.emit(SEMANTIC_SELECTION_CHANGED_EVENT, validated);
  return true;
}

/** Subscribe to canonical selections routed by a composition host. */
export function onSemanticSelection(
  events: ComposeEventClient | undefined,
  handler: SemanticSelectionHandler,
): () => void {
  if (!events) return () => {};
  return events.on(SEMANTIC_SELECTION_APPLY_ACTION, (payload) => {
    const selection = parseSemanticSelection(payload.data);
    if (selection) handler(selection, payload);
  });
}
