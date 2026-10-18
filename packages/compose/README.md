# mcp-compose

Lightweight Deno library for composing and synchronizing multiple MCP Apps UIs into composite
dashboards.

**Your MCP servers already have UIs. mcp-compose makes them talk to each other.**

## Positioning

`mcp-compose` is a composition primitive for developers, integrators, and agents. It consumes
explicit orchestration plus MCP tool results and renders a composite UI. It does not provide an
end-user or no-code dashboard builder; intent-first authoring belongs in a higher product layer
built on top of this library.

## Static composition and interactive local hosting

The core pipeline and `renderComposite()` remain deterministic, pure composition primitives. They
can produce a static iframe layout without connecting a browser back to MCP.

When an MCP App needs its initial tool result, `resources/read`, or an App-initiated tool call, use
the explicit runtime host:

```ts
import { composeAndServeDashboard } from "@mcpview/compose/runtime";

const dashboard = await composeAndServeDashboard({ manifests, template });
console.log(dashboard.url);
// dashboard.shutdown() closes the local listeners and MCP cluster.
```

It is a loopback-only host for one local dashboard, not a general MCP proxy. It resolves App
resources with MCP `resources/read`; it never assumes an upstream server-specific `/ui` route. See
the [runtime contract](./src/runtime/contract.md) and
[ADR 0004](./docs/decision-records/0004-local-multi-app-host-runtime.md) for the security and
deployment boundary.

## Why mcp-compose?

MCP Apps (SEP-1865) let each MCP server expose its own UI via `_meta.ui.resourceUri`. But when an
agent calls 3 tools and gets 3 separate UIs, they sit in isolation — no shared state, no event
routing, no coordinated layout.

**mcp-compose** bridges that gap:

| Without mcp-compose                        | With mcp-compose                             |
| ------------------------------------------ | -------------------------------------------- |
| 3 separate iframes, no communication       | Single dashboard with layout + event routing |
| Manual postMessage wiring per tool pair    | Declarative sync rules (`from/event/to`)     |
| Each UI builds its own host handshake      | Automatic MCP Apps protocol compliance       |
| Agent must manually track UI relationships | Pipeline: collect -> compose -> render       |

**For agents:** the pipeline is three pure function calls with zero ambient knowledge required.
**For integrators:** you can render a working composite dashboard without hand-writing host HTML or
`postMessage` plumbing.

## Install

```bash
# Deno (JSR)
deno add jsr:@mcpview/compose

# Node (npm)
npm i @mcpview/compose
```

```typescript
import { buildCompositeUi, createCollector, renderComposite } from "@mcpview/compose";
```

## Quick Start

A complete, runnable example — from MCP tool results to rendered HTML:

```typescript
import {
  buildCompositeUi,
  createCollector,
  renderComposite,
  validateSyncRules,
} from "@mcpview/compose";

// 1. Collect UI resources from MCP tool results
const collector = createCollector();

// Simulate MCP tool call results with _meta.ui.resourceUri
const pgResult = {
  content: [{ type: "text", text: "Query executed" }],
  _meta: { ui: { resourceUri: "ui://postgres/table/sales-q1" } },
};
const vizResult = {
  content: [{ type: "text", text: "Chart rendered" }],
  _meta: { ui: { resourceUri: "ui://viz/chart/bar-sales" } },
};

collector.collect("postgres:query", pgResult, { query: "SELECT * FROM sales" });
collector.collect("viz:render", vizResult);

const resources = collector.getResources();
// resources.length === 2, slots [0, 1]

// 2. (Optional) Validate sync rules before composing
const orchestration = {
  layout: "split" as const,
  sync: [
    { from: "postgres:query", event: "filter", to: "viz:render", action: "update" },
  ],
  sharedContext: ["query"],
};

const validation = validateSyncRules(
  orchestration.sync,
  resources.map((r) => r.source),
);
// validation.valid === true

// 3. Build a composite descriptor
const descriptor = buildCompositeUi(resources, orchestration);
// descriptor.sync[0] === { from: 0, event: "filter", to: 1, action: "update" }
// descriptor.sharedContext === { query: "SELECT * FROM sales" }

// 4. Render to self-contained HTML
const html = renderComposite(descriptor);
// html is a complete HTML document with layout CSS, event bus JS, and iframes
```

## Pipeline

```
Collector  ->  Composer  ->  Renderer
(collect)     (build)       (render)
```

Each step is a pure function. Use them independently or together.

## Layouts

| Layout  | Description                   |
| ------- | ----------------------------- |
| `split` | Side-by-side panels (flexbox) |
| `tabs`  | Tabbed interface with tab bar |
| `grid`  | Auto-fit grid for dashboards  |
| `stack` | Vertical stack (default)      |

## Sync Rules

Declarative event routing between UIs:

```typescript
const orchestration = {
  layout: "split",
  sync: [
    // When postgres:query emits "filter", update viz:render
    { from: "postgres:query", event: "filter", to: "viz:render", action: "update" },

    // Broadcast to all UIs when date changes
    { from: "date:picker", event: "change", to: "*", action: "refresh" },
  ],
  // Extract and share context across all UIs
  sharedContext: ["workflowId", "userId"],
};
```

Stable component IDs may be used in routes, including when the same tool is instantiated more than
once. A repeated tool name without explicit IDs is rejected instead of silently routing to the last
panel.

## Component surfaces

A componentized MCP App advertises small domain components and may expose a standalone default
surface. Component-only Apps omit the default and require Compose to select and arrange components
explicitly:

```yaml
sources:
  - id: thermal
    manifest: mcp-modelica
    surface:
      layout: { type: grid, columns: 2, gap: sm }
      components:
        - { id: status, component: modelica.execution-status }
        - { id: metrics, component: modelica.metrics }
    calls:
      - tool: modelica_simulate
```

The viewer advertises `io.casys.mcp.view-components/v1` during `ui/initialize`. Compose sends the
requested surface under `io.casys.mcp.surface/v1`; without an explicit request, the viewer's
standalone default is used when one exists, otherwise resolution returns `surface-required`. Unknown
keys resolve explicitly instead of silently disappearing. Legacy Apps continue unchanged.
`ui/compose/event` remains the cross-view event plane.

Components may also advertise event ports. A host can declare one stable policy and let Compose
resolve it against the components active in the current session:

```json
{
  "orchestration": {
    "layout": "split",
    "portSync": [{
      "event": "semantic.selection.changed",
      "action": "semantic.selection.apply"
    }]
  }
}
```

`portSync` is dynamic in topology, not in meaning. It routes only when the source surface currently
contains a component declaring the event and the target surface contains a distinct component
declaring the action. The payload is forwarded unchanged; Compose performs no identifier mapping.
Explicit `sync` rules remain available for named one-off routes.

For preflight, put the same `emits` / `accepts` names in the tool's `_meta.ui` or Compose manifest.
`validateComposition(tools, sync, portSync)` can then prove that at least one distinct source/target
pair exists before the Apps are opened. The runtime component catalog confirms the actual mounted
surface during `ui/initialize`.

See [`ADR 0005`](docs/decision-records/0005-component-surfaces-and-a2ui-boundary.md) for the
contract and A2UI boundary.

## Validation

Validate sync rules before composition:

```typescript
import { validateSyncRules } from "@mcpview/compose";

const result = validateSyncRules(
  [{ from: "a", event: "click", to: "unknown", action: "update" }],
  ["a", "b"],
);
// result.valid === false
// result.issues[0].code === "ORPHAN_SYNC_REFERENCE"
```

For a dynamic port policy, validate the pre-open tool manifests as well:

```ts
const result = validateComposition(tools, [], [{
  event: "semantic.selection.changed",
  action: "semantic.selection.apply",
}]);
```

## Collector API

```typescript
import { createCollector } from "@mcpview/compose";

const collector = createCollector();

// Collect from MCP tool results (auto-extracts _meta.ui.resourceUri)
const resource = collector.collect("tool:name", mcpToolResult, optionalContext);
// Returns CollectedUiResource | null

collector.getResources(); // All collected resources in slot order
collector.clear(); // Reset
```

## MCP SDK Adapter

For projects using `@modelcontextprotocol/sdk`:

```typescript
import { createMcpSdkCollector } from "@mcpview/compose";

const collector = createMcpSdkCollector();

// Accepts SDK CallToolResult objects directly
// Automatically skips error results (isError: true)
collector.collectFromSdk("postgres:query", sdkCallToolResult, { query: "..." });

// Access the underlying core collector if needed
collector.inner.collect("manual", rawResult);

const resources = collector.getResources();
```

## MCP Server Integration

### Declaring composable tools

Use `uiMeta()` to declare `emits` and `accepts` on your tools:

```typescript
import { uiMeta } from "@mcpview/compose/sdk";

const tools = [
  {
    name: "einvoice_invoice_search",
    ...uiMeta({
      resourceUri: "ui://mcp-einvoice/doclist-viewer",
      emits: ["invoice.selected"],
      accepts: ["filter.apply"],
    }),
  },
];
```

If your server uses `@mcpview/server`, import the helpers from the compose SDK:

```typescript
import { composeEvents, uiMeta } from "@mcpview/compose/sdk";
```

### UI-side events with `composeEvents()`

UIs emit and listen to cross-UI events via a dedicated `ui/compose/event` channel, separate from the
MCP Apps protocol:

```typescript
import { composeEvents } from "@mcpview/compose/sdk";

const events = composeEvents();
events.emit("invoice.selected", { invoiceId: "INV-001" });
events.on("filter.apply", (payload) => applyFilter(payload.data));
events.destroy(); // cleanup
```

## Runtime — Dashboard from templates

The runtime module starts MCP servers, calls tools, and feeds results through the core pipeline to
produce complete dashboards:

```typescript
import { composeDashboardFromFiles } from "@mcpview/compose/runtime";

const result = await composeDashboardFromFiles(
  "./manifests/", // directory of .json manifest files
  "./dashboards/sales.json", // canonical agent-facing JSON manifest
  { customer_id: "CUST-001" }, // runtime args (replaces {{placeholders}})
);
await Deno.writeTextFile("dashboard.html", result.html);
```

The API above keeps the historical static rendering path. For a live local MCP Apps dashboard, load
the same template/manifests and call `composeAndServeDashboard()` instead:

```ts
import { composeAndServeDashboard, loadManifests, loadTemplate } from "@mcpview/compose/runtime";

const manifests = await loadManifests("./manifests");
const template = await loadTemplate("./dashboards/sales.json");
const dashboard = await composeAndServeDashboard(
  { manifests, template },
  { open: true },
);
```

The returned `ComposedDashboardHandle` owns its cluster until `dashboard.shutdown()` is called.
Standalone dashboards deny embedding by default. A trusted local product shell can opt in with an
exact reviewed origin:

```ts
const dashboard = await composeAndServeDashboard(
  { manifests, template },
  { open: false, frameAncestors: ["http://127.0.0.1:60060"] },
);
```

Only valid HTTP(S) origins are admitted to the generated `frame-ancestors` policy.

### Manifest

Each MCP server has a JSON manifest describing its transport and tools. Generated at build time — no
server startup needed for discovery.

```json
{
  "name": "mcp-einvoice",
  "transport": {
    "type": "http",
    "url": "http://localhost:3015",
    "protocol": "auto"
  },
  "tools": [
    {
      "name": "invoice_search",
      "emits": ["invoice.selected"],
      "accepts": ["filter.apply"],
      "appCallable": true
    }
  ]
}
```

Transport: `"stdio"` (cluster starts the process with `--http --port=0`) or `"http"` (connect to an
existing server). HTTP `protocol` defaults to `"auto"`: stateless MCP `2026-07-28` is tried first,
then Compose falls back only for a compatible legacy response to initialized Streamable HTTP. Pin
`"streamable-http"` or `"stateless-2026-07-28"` when the endpoint is known.

`appCallable` is deny-by-default. Set it only for an MCP App method that may be invoked through a
local Compose panel. A panel can read only the original `ui://` resource that created it; it cannot
select another server or resource.

### Template

Dashboard templates are YAML — typically generated by an agent, not written by hand.
`{{placeholders}}` are replaced with runtime args at compose time.

```yaml
name: Sales Dashboard
sources:
  - manifest: mcp-einvoice
    calls:
      - tool: invoice_search
        args: { customer_id: "{{customer_id}}" }
  - manifest: mcp-dataviz
    calls:
      - tool: render_chart
orchestration:
  layout: split
  sync:
    - from: "mcp-einvoice:invoice_search"
      event: invoice.selected
      to: "mcp-dataviz:render_chart"
      action: data.update
  sharedContext:
    - customer_id
```

## Event Bus Protocol

The rendered HTML includes a JavaScript event bus implementing:

- **`ui/initialize`** -- Handshake with host capabilities (MCP Apps SEP-1865)
- **`ui/notifications/initialized`** -- Gate before the full initial tool result is sent
- **`ui/compose/event`** -- Dedicated cross-UI event routing (mcp-compose protocol)
- **`ui/notifications/tool-result`** -- Full initiating result delivered after initialization
- **`tools/call` / `tools/list`** -- Only when the slot has a local route and manifest grant
- **`resources/read` / `resources/list`** -- Only for the resource bound to that slot

All messages use JSON-RPC 2.0 via `postMessage`.

Compose does not deliver messages to a conversation or model, so it does not advertise the `message`
host capability (including `message.text`). Viewers should treat this channel as unsupported. Direct
`ui/message` requests receive JSON-RPC error `-32601` (method not found), never a delivery
acknowledgement; notifications without an `id` receive no response. This follows the
[three-channel ADR's "No false success" rule](../view/docs/decision-records/0005-three-view-channels.md).

## Error Codes

**Core errors (`ErrorCode`):**

| Code                    | Description                            |
| ----------------------- | -------------------------------------- |
| `ORPHAN_SYNC_REFERENCE` | Sync rule references unknown tool name |
| `CIRCULAR_SYNC_RULE`    | Sync rule routes to itself             |
| `INVALID_LAYOUT`        | Invalid layout value                   |
| `MISSING_RESOURCE_URI`  | Missing resourceUri in UI metadata     |
| `NO_UI_METADATA`        | Tool result has no UI metadata         |
| `EMPTY_RESOURCES`       | No resources provided to composer      |

**Runtime errors (`RuntimeErrorCode`):**

| Code                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `MANIFEST_PARSE_ERROR`  | Invalid manifest JSON or structure        |
| `TEMPLATE_PARSE_ERROR`  | Invalid template YAML or structure        |
| `MANIFEST_NOT_FOUND`    | Template references unknown manifest      |
| `PROCESS_START_FAILED`  | MCP server failed to start                |
| `TOOL_CALL_FAILED`      | HTTP tool call returned an error          |
| `TOOL_CALL_TIMEOUT`     | Tool call exceeded timeout                |
| `TOOL_LIST_FAILED`      | MCP tools/list call returned an error     |
| `TOOL_LIST_TIMEOUT`     | MCP tools/list call exceeded timeout      |
| `RESOURCE_READ_FAILED`  | MCP resources/read call returned an error |
| `RESOURCE_READ_TIMEOUT` | MCP resources/read call exceeded timeout  |
| `RESOURCE_LIST_FAILED`  | MCP resources/list call returned an error |
| `RESOURCE_LIST_TIMEOUT` | MCP resources/list call exceeded timeout  |
| `PROCESS_DIED`          | Server process exited unexpectedly        |

## Development

```bash
deno task test      # Run the full test suite
deno task check     # Type check
deno task lint      # Lint
deno task fmt       # Format
```

See also [PRD.md](./PRD.md) and
[`docs/decision-records/0001-orchestration-authoring-boundary.md`](./docs/decision-records/0001-orchestration-authoring-boundary.md)
for the product boundary.

## Design Principles (AX)

This library follows [AX (Agent Experience)](https://github.com/AXDesignPattern) principles:

- **Pure core** -- No I/O, network, filesystem, or runtime client dependency in `core/`
- **Narrow runtime dependency** -- The optional runtime uses the official MCP SDK for legacy
  Streamable HTTP plus a small protocol-defined stateless adapter
- **Deterministic** -- Same inputs produce same outputs (UUID isolated)
- **Machine-readable errors** -- Structured `ErrorCode` + `ValidationIssue`, not string throws
- **Fail-fast** -- Invalid sync rules rejected upfront, no silent fallbacks
- **Composable primitives** -- Each pipeline step works independently
- **Narrow contracts** -- Functions take minimal inputs, maximal type safety
- **Co-located docs** -- JSDoc + @example on every public export

## License

MIT
