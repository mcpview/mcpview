/**
 * `@mcpview/contracts` — dependency-free MCP App resource contracts.
 *
 * This entry point is safe in servers, hosts, agents, and App bundles. It has
 * no DOM, MCP Apps runtime, SDK, React, or Preact dependency.
 *
 * @module
 */

export {
  defineViewAppManifest,
  parseViewAppManifestJson,
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "./src/app-manifest.ts";
export type {
  ViewAppManifest,
  ViewAppManifestResource,
  ViewAppResourceOwnership,
} from "./src/app-manifest.ts";

export {
  CASYS_COMPONENT_CATALOG_CAPABILITY_KEY,
  CASYS_SURFACE_CONTEXT_KEY,
  defineSemanticSelection,
  parseSemanticSelection,
  readSurfaceContext,
  SEMANTIC_SELECTION_APPLY_ACTION,
  SEMANTIC_SELECTION_CHANGED_EVENT,
  SEMANTIC_SELECTION_EVENT_PORTS,
  SEMANTIC_SELECTION_SCHEMA,
  validateSemanticSelection,
} from "./src/composition-contracts.ts";
export type {
  AdvertisedComponentCatalog,
  ComponentSurface,
  ComponentSurfaceItem,
  ComponentSurfaceLayout,
  ComposedSemanticRef,
  JsonValue,
  SemanticSelection,
  SemanticSelectionInput,
  SemanticSelectionMode,
  SurfaceContext,
  SurfaceGap,
  SurfaceLayoutType,
  ViewComponentDescriptor,
  ViewComponentEventPorts,
} from "./src/composition-contracts.ts";
