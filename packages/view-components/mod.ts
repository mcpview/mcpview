/**
 * `@mcpview/components` — optional presentation runtime for small composable viewers.
 *
 * The root stays renderer-neutral and carries no MCP Apps runtime. Import the
 * App lifecycle from `/surface`, Preact bindings from `/preact` or pure Preact
 * presentation primitives from `/preact/components`.
 *
 * @module
 */

export {
  activeComponentSurface,
  advertisedComponentCatalog,
  applySurfaceContext,
  CASYS_COMPONENT_CATALOG_CAPABILITY_KEY,
  CASYS_SURFACE_CONTEXT_KEY,
  componentCatalogCapabilities,
  defineComponentRegistry,
  defineComponentSurface,
  defineViewComponent,
  mountComponentSurface,
  readSurfaceContext,
} from "./src/components.ts";
export type {
  AdvertisedComponentCatalog,
  ComponentCleanup,
  ComponentSurface,
  ComponentSurfaceItem,
  ComponentSurfaceLayout,
  JsonValue,
  McpViewHostContext,
  MountComponentSurfaceOptions,
  MountedComponentSurface,
  SurfaceContext,
  SurfaceGap,
  SurfaceLayoutType,
  ViewComponentDefinition,
  ViewComponentDescriptor,
  ViewComponentEventPorts,
  ViewComponentMountContext,
  ViewComponentRegistry,
} from "./src/components.ts";

export {
  defineCustomComponent,
  defineKeyValueComponent,
  defineMetricGridComponent,
  defineStatusComponent,
} from "./src/component-primitives.ts";
export type {
  ComponentTone,
  KeyValueComponentValue,
  MetricComponentValue,
  StatusComponentValue,
} from "./src/component-primitives.ts";

export {
  installMcpViewTheme,
  MCP_VIEW_THEME_CSS,
  MCP_VIEW_THEME_STYLE_ID,
  MCP_VIEW_THEME_TOKENS,
} from "./src/theme.ts";
export type { McpViewThemeDocument, McpViewThemeToken, McpViewThemeTokens } from "./src/theme.ts";

export {
  createTranslator,
  MCP_VIEW_MESSAGES_EN,
  MCP_VIEW_MESSAGES_FR,
  mcpViewMessages,
} from "./src/i18n.ts";
export type {
  McpViewMessages,
  MessageCatalog,
  MessageValues,
  Translator,
  TranslatorSelector,
} from "./src/i18n.ts";
