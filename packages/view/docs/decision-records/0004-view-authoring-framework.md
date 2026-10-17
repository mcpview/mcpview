# ADR 0004: Componentized MCP App Authoring Framework

Date: 2026-08-01\
Status: Superseded in package ownership on 2026-08-31; composition model retained

## Context

Casys owns viewers for simulation, CAD, finite-element analysis, SysML, and ERP. They duplicate
protocol lifecycle plumbing, but their useful visual grammar is domain-specific. The earlier
responsive-mode experiment made each viewer choose between several prebuilt whole-page variants; it
did not make the actual UI blocks reusable when several Apps shared one dashboard.

## Decision

The implementation is now split across three packages. A domain MCP may own a complete `whole-view`
resource with no component catalog, or intentionally publish a catalog of meaningful components with
an optional standalone default surface. A Compose host may embed a whole resource or request a safe
surface made only from advertised components. Product-only palettes may omit the default instead of
inventing a standalone page.

| Layer                 | Owns                                                                                           | Must not own                                                |
| --------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `@mcpview/contracts`  | App/resource manifests, serializable composition and session compatibility                     | DOM, renderer, MCP Apps runtime, provider authority         |
| `@mcpview/view`       | Apps lifecycle, routing, structured results, whole-resource sessions, event client             | component/theme exports, dashboard shell, domain schema     |
| `@mcpview/components` | optional registry/mounting, safe primitives, theme, Preact adapter, cleanup; Deno/JSR scaffold | domain renderers, provider authority, host layout policy    |
| Domain viewer         | validation, whole-view or component implementation, local state/actions                        | copied handshake plumbing, host layout policy               |
| `@mcpview/compose`    | multi-App shell, explicit surface requests, stable instance IDs, event routes                  | child DOM inspection, domain rendering, implicit size modes |

The wire value is JSON-only: component key, instance ID, `stack|row|grid` layout, bounded columns,
gap token, optional safe grid area, and component-owned props. It contains no HTML, JavaScript,
selectors, or arbitrary CSS. Unknown component keys resolve explicitly as `unresolved`.

When supplied, the App's `defaultSurface` is its standalone UI. There is no parallel standalone
implementation and no semantic size taxonomy. Standard MCP Apps display modes (`inline`,
`fullscreen`, `pip`) and container dimensions continue to describe the host environment, not which
evidence must exist. Without a default, a missing host selection is an explicit `surface-required`
state.

The shared theme and framework-neutral primitive classes use the compact component language first
proven by the ERPNext BOM palette: restrained cards, dense metrics and tables, semantic badges,
cross-selection state, and container queries. Domain viewers may add specialized CAD, diagram, and
evidence styling without redefining the shared shell.

The scaffold remains a Deno/JSR command because its contract includes Deno filesystem APIs and
`deno fmt`. The npm package exports only the cross-runtime runtime and presentation entry points; it
does not ship a nominal Node scaffold that fails when invoked.

Preact Apps consume those foundations as actual components from
`@mcpview/components/preact/components`, not as independently maintained CSS imitations. The shared
kit covers cards, badges, metrics, key-value facts, data tables, actions, toolbars, empty states,
and system states. Source-owned CSS is reserved for visuals that the kit cannot express, such as a
Three.js viewport or a SysON SVG canvas.

## Events and state

Composition changes presentation only. `ui/compose/event` remains the separately declared
viewer-to-viewer plane. Local navigation, component state, tools, and domain actions remain owned by
the child App. A surface remount must clean up component listeners and renderer resources
deterministically.

`viewer.session.apply` is different: compatibility is declared by the whole resource, and the App
installs its validator before connecting. Valid early actions replay after initialization and update
App-level data; component mounts never own this one-shot subscription.

Each component may advertise event ports in its serializable descriptor. They make the App
inspectable and dynamically connectable, but never create a route on their own. The host supplies an
explicit port policy, and the viewer continues to own the behavior behind each port. The shared
semantic-selection payload is structural and versioned; product-owned domain vocabularies and
recorded cross-domain bindings remain outside this SDK.

## Adoption

Modelica, Build123d, CalculiX, and SysON are reference consumers. Together they prove metrics,
tables, artifacts, Three.js, Preact, diagrams, and solver evidence. The public ERPNext MCP remains a
compatibility baseline; a separate product-specific, read-only ERPNext component palette proves the
component-only Preact path without changing that public server.

## Conformance

Each migrated viewer must prove:

- handlers registered before `connect()` and initiating results preserved;
- ordinary-host fallback to the same default component surface, or an explicit `surface-required`
  state for a component-only App;
- requested surface selection without child DOM inspection;
- unknown component keys rejected explicitly;
- deterministic component teardown;
- rebuilt self-contained HTML with the new catalog key and no old projection capability;
- at least one real tool result exercised through a browser host.

## A2UI boundary

A2UI is a useful reference for agent-authored declarative interfaces. Casys does not reimplement its
widget renderer here. Our intermediate language composes domain components already owned and
rendered by MCP Apps; a future adapter may map compatible A2UI widgets at the boundary.

## Consequences

Agents compose a small vocabulary with stable semantics instead of selecting one of several prebaked
pages or generating raw application code. Specialized viewers remain powerful, while their useful
blocks become reusable in dashboards and in their own standalone composition.
