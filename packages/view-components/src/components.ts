/** Renderer-neutral component catalog and surface runtime for MCP Apps. */

import type { AppContext } from "@mcpview/view";
import {
  type AdvertisedComponentCatalog,
  CASYS_COMPONENT_CATALOG_CAPABILITY_KEY,
  type ComponentSurface,
  type ComponentSurfaceLayout,
  type JsonValue,
  readSurfaceContext,
  type SurfaceGap,
  type ViewComponentDescriptor,
  type ViewComponentEventPorts,
} from "@mcpview/contracts";

export {
  CASYS_COMPONENT_CATALOG_CAPABILITY_KEY,
  CASYS_SURFACE_CONTEXT_KEY,
  readSurfaceContext,
} from "@mcpview/contracts";
export type {
  AdvertisedComponentCatalog,
  ComponentSurface,
  ComponentSurfaceItem,
  ComponentSurfaceLayout,
  JsonValue,
  SurfaceContext,
  SurfaceGap,
  SurfaceLayoutType,
  ViewComponentDescriptor,
  ViewComponentEventPorts,
} from "@mcpview/contracts";

export type McpViewHostContext = AppContext<unknown>["hostContext"];

export type ComponentCleanup = () => void | Promise<void>;

export interface ViewComponentMountContext<TData, TAppContext> {
  readonly data: TData;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly instanceId: string;
  readonly appContext: TAppContext;
  readonly hostContext: McpViewHostContext;
}

export interface ViewComponentDefinition<TData = unknown, TAppContext = unknown> {
  readonly descriptor: ViewComponentDescriptor;
  mount(
    target: HTMLElement,
    context: ViewComponentMountContext<TData, TAppContext>,
  ): void | ComponentCleanup | Promise<void | ComponentCleanup>;
}

export interface ViewComponentRegistry<TData = unknown, TAppContext = unknown> {
  readonly components: Readonly<
    Record<string, ViewComponentDefinition<TData, TAppContext>>
  >;
  /** Omit for component-only Apps that are meaningful only inside a host composition. */
  readonly defaultSurface?: ComponentSurface;
}

export interface MountedComponentSurface {
  readonly surface: ComponentSurface;
  dispose(): Promise<void>;
}

export interface MountComponentSurfaceOptions<TData, TAppContext> {
  readonly root: HTMLElement;
  readonly registry: ViewComponentRegistry<TData, TAppContext>;
  readonly data: TData;
  readonly appContext: TAppContext;
  readonly hostContext: McpViewHostContext;
  /** Explicit surface wins; otherwise the negotiated or default surface is used. */
  readonly surface?: ComponentSurface;
}

export function defineViewComponent<TData = unknown, TAppContext = unknown>(
  definition: ViewComponentDefinition<TData, TAppContext>,
): ViewComponentDefinition<TData, TAppContext> {
  const descriptor = normalizedDescriptor(definition.descriptor);
  if (typeof definition.mount !== "function") {
    throw new TypeError("View component must declare a mount function");
  }
  return Object.freeze({ ...definition, descriptor });
}

export function defineComponentRegistry<TData = unknown, TAppContext = unknown>(
  registry: ViewComponentRegistry<TData, TAppContext>,
): ViewComponentRegistry<TData, TAppContext> {
  const entries = Object.entries(registry.components ?? {});
  if (entries.length === 0) {
    throw new TypeError("Component registry must declare at least one component");
  }
  for (const [id, component] of entries) {
    validateComponentId(id, "Component registry key");
    validateDescriptor(component.descriptor);
    if (typeof component.mount !== "function") {
      throw new TypeError(`Component ${JSON.stringify(id)} must declare a mount function`);
    }
  }
  const surface = registry.defaultSurface === undefined
    ? undefined
    : defineComponentSurface(registry.defaultSurface);
  if (surface) {
    validateSurfaceComponents(surface, new Set(entries.map(([id]) => id)));
  }
  Object.freeze(registry.components);
  return Object.freeze({
    ...registry,
    ...(surface ? { defaultSurface: surface } : {}),
  });
}

export function defineComponentSurface(surface: ComponentSurface): ComponentSurface {
  validateLayout(surface?.layout);
  if (!Array.isArray(surface?.components) || surface.components.length === 0) {
    throw new TypeError("Component surface must contain at least one component");
  }
  const instanceIds = new Set<string>();
  const components = surface.components.map((item) => {
    validateComponentId(item.id, "Surface component id");
    validateComponentId(item.component, "Surface component key");
    if (instanceIds.has(item.id)) {
      throw new TypeError(`Duplicate surface component id ${JSON.stringify(item.id)}`);
    }
    instanceIds.add(item.id);
    if (item.area !== undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.area)) {
      throw new TypeError(`Invalid surface grid area ${JSON.stringify(item.area)}`);
    }
    if (item.props !== undefined) validateJsonValue(item.props, `props for ${item.id}`);
    return Object.freeze({
      ...item,
      ...(item.props ? { props: Object.freeze({ ...item.props }) } : {}),
    });
  });
  return Object.freeze({
    layout: Object.freeze({ ...surface.layout }),
    components: Object.freeze(components),
  });
}

/** Build the serializable value advertised in `AppConfig.capabilities.experimental`. */
export function componentCatalogCapabilities<TData, TAppContext>(
  registry: ViewComponentRegistry<TData, TAppContext>,
): Record<string, object> {
  return {
    [CASYS_COMPONENT_CATALOG_CAPABILITY_KEY]: advertisedComponentCatalog(registry),
  };
}

export function advertisedComponentCatalog<TData, TAppContext>(
  registry: ViewComponentRegistry<TData, TAppContext>,
): AdvertisedComponentCatalog {
  const components = Object.fromEntries(
    Object.entries(registry.components).map(([id, definition]) => [
      id,
      normalizedDescriptor(definition.descriptor),
    ]),
  );
  return Object.freeze({
    components: Object.freeze(components),
    ...(registry.defaultSurface ? { defaultSurface: registry.defaultSurface } : {}),
  });
}

/** Expose only surface identity/status for CSS and diagnostics, never component internals. */
export function applySurfaceContext(
  hostContext: McpViewHostContext,
  target: { dataset: Record<string, string | undefined> },
): void {
  const surface = readSurfaceContext(hostContext);
  assignDataset(target.dataset, "casysSurfaceInstance", surface?.instanceId);
  assignDataset(target.dataset, "casysSurfaceStatus", surface?.status);
  assignDataset(target.dataset, "casysSurfaceSource", surface?.source);
}

export function activeComponentSurface<TData, TAppContext>(
  registry: ViewComponentRegistry<TData, TAppContext>,
  hostContext: McpViewHostContext,
): ComponentSurface | undefined {
  const context = readSurfaceContext(hostContext);
  return context?.status === "ready" && context.surface
    ? defineComponentSurface(context.surface)
    : registry.defaultSurface;
}

/** Mount one declarative surface and return deterministic aggregate cleanup. */
export async function mountComponentSurface<TData, TAppContext>(
  options: MountComponentSurfaceOptions<TData, TAppContext>,
): Promise<MountedComponentSurface> {
  const selected = options.surface ??
    activeComponentSurface(options.registry, options.hostContext);
  if (!selected) {
    throw new TypeError(
      "Component-only App requires a host-selected surface",
    );
  }
  const surface = defineComponentSurface(selected);
  validateSurfaceComponents(surface, new Set(Object.keys(options.registry.components)));

  const container = document.createElement("div");
  container.className = `mcp-view-surface mcp-view-surface-${surface.layout.type}`;
  container.dataset.surfaceLayout = surface.layout.type;
  applySurfaceLayout(container, surface.layout);

  const cleanups: ComponentCleanup[] = [];
  try {
    for (const item of surface.components) {
      const definition = options.registry.components[item.component];
      const slot = document.createElement("section");
      slot.className = "mcp-view-component";
      slot.dataset.component = item.component;
      slot.dataset.componentId = item.id;
      if (item.area) slot.style.gridArea = item.area;
      container.append(slot);
      const cleanup = await definition.mount(slot, {
        data: options.data,
        props: item.props ?? {},
        instanceId: item.id,
        appContext: options.appContext,
        hostContext: options.hostContext,
      });
      if (typeof cleanup === "function") cleanups.push(cleanup);
    }
  } catch (error) {
    await disposeAll(cleanups);
    throw error;
  }

  options.root.replaceChildren(container);
  let disposed = false;
  return {
    surface,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await disposeAll(cleanups);
      if (container.parentNode === options.root) options.root.replaceChildren();
    },
  };
}

function applySurfaceLayout(
  target: HTMLElement,
  layout: ComponentSurfaceLayout,
): void {
  const gaps: Record<SurfaceGap, string> = {
    none: "0",
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
  };
  target.style.display = "grid";
  // Stacked components are separated by the theme's hairlines; rows and grids keep a gap.
  target.style.gap = gaps[layout.gap ?? (layout.type === "stack" ? "none" : "md")];
  target.style.minWidth = "0";
  if (layout.type === "row") {
    target.style.gridAutoFlow = "column";
    target.style.gridAutoColumns = "minmax(0, 1fr)";
  } else if (layout.type === "grid") {
    target.style.gridTemplateColumns = `repeat(${layout.columns ?? 2}, minmax(0, 1fr))`;
  } else {
    target.style.gridTemplateColumns = "minmax(0, 1fr)";
  }
}

function validateLayout(layout: ComponentSurfaceLayout | undefined): void {
  if (!layout || !["stack", "row", "grid"].includes(layout.type)) {
    throw new TypeError("Surface layout type must be stack, row, or grid");
  }
  if (
    layout.columns !== undefined &&
    (!Number.isInteger(layout.columns) || layout.columns < 1 || layout.columns > 12)
  ) {
    throw new TypeError("Surface grid columns must be an integer from 1 to 12");
  }
  if (layout.type !== "grid" && layout.columns !== undefined) {
    throw new TypeError("Surface columns are valid only for grid layouts");
  }
  if (layout.gap !== undefined && !["none", "xs", "sm", "md", "lg"].includes(layout.gap)) {
    throw new TypeError("Surface gap must be none, xs, sm, md, or lg");
  }
}

function validateSurfaceComponents(
  surface: ComponentSurface,
  known: ReadonlySet<string>,
): void {
  const missing = [
    ...new Set(
      surface.components
        .map((item) => item.component)
        .filter((component) => !known.has(component)),
    ),
  ];
  if (missing.length > 0) {
    throw new TypeError(`Unknown surface components: ${missing.join(", ")}`);
  }
}

function validateDescriptor(descriptor: ViewComponentDescriptor): void {
  if (!descriptor || typeof descriptor.title !== "string" || !descriptor.title.trim()) {
    throw new TypeError("View component descriptor must have a non-empty title");
  }
  if (descriptor.description !== undefined && typeof descriptor.description !== "string") {
    throw new TypeError("View component description must be a string");
  }
  validateEventPorts(descriptor.events);
}

function normalizedDescriptor(descriptor: ViewComponentDescriptor): ViewComponentDescriptor {
  validateDescriptor(descriptor);
  const events = descriptor.events === undefined ? undefined : Object.freeze({
    ...(descriptor.events.emits ? { emits: Object.freeze([...descriptor.events.emits]) } : {}),
    ...(descriptor.events.accepts
      ? { accepts: Object.freeze([...descriptor.events.accepts]) }
      : {}),
  });
  return Object.freeze({
    title: descriptor.title,
    ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
    ...(events ? { events } : {}),
  });
}

function validateEventPorts(ports: ViewComponentEventPorts | undefined): void {
  if (ports === undefined) return;
  if (!ports || typeof ports !== "object" || Array.isArray(ports)) {
    throw new TypeError("View component events must be an object");
  }
  validateEventNames(ports.emits, "emits");
  validateEventNames(ports.accepts, "accepts");
}

function validateEventNames(names: readonly string[] | undefined, field: string): void {
  if (names === undefined) return;
  if (!Array.isArray(names)) {
    throw new TypeError(`View component ${field} must be an array`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string" || !name.trim()) {
      throw new TypeError(`View component ${field} names must be non-empty strings`);
    }
    if (seen.has(name)) {
      throw new TypeError(`Duplicate View component ${field} name ${JSON.stringify(name)}`);
    }
    seen.add(name);
  }
}

function validateComponentId(value: string, label: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new TypeError(`${label} is invalid: ${JSON.stringify(value)}`);
  }
}

function validateJsonValue(value: unknown, label: string): void {
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateJsonValue(entry, label);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) validateJsonValue(entry, label);
    return;
  }
  throw new TypeError(`${label} must contain only JSON values`);
}

async function disposeAll(cleanups: readonly ComponentCleanup[]): Promise<void> {
  const errors: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Component cleanup failed");
}

function assignDataset(
  dataset: Record<string, string | undefined>,
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) delete dataset[key];
  else dataset[key] = value;
}
