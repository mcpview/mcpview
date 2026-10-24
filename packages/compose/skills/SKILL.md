# @mcpview/compose — Reference Skill

**Registry:** `jsr:@mcpview/compose`\
**Purpose:** Lightweight UI composition library for assembling MCP tool results into multi-panel
dashboards.

No runtime dependencies beyond optional MCP SDK integration.

---

## Installation

```sh
deno add jsr:@mcpview/compose
```

---

## Three-stage pipeline

```
Collector  →  Composer  →  Renderer
```

1. **Collector** — inspects MCP tool results for `_meta.ui.resourceUri`, accumulates
   `CollectedUiResource[]`
2. **Composer** — assembles resources + optional orchestration into a `CompositeUiDescriptor`
3. **Renderer** — turns the descriptor into a self-contained HTML document with sandboxed iframes

---

## Quick example

```typescript
import { buildCompositeUi, createCollector } from "@mcpview/compose/core";
import { renderComposite } from "@mcpview/compose/host";

// Stage 1 — collect
const collector = createCollector();
collector.collect("postgres:query", toolResult1);
collector.collect("viz:render", toolResult2);
const resources = collector.getResources();

// Stage 2 — compose
const descriptor = buildCompositeUi(resources, {
  layout: "split",
  sync: [
    { from: "postgres:query", event: "filter", to: "viz:render", action: "update" },
  ],
});

// Stage 3 — render
const html = renderComposite(descriptor);
// html is a complete, self-contained HTML document
```

---

## Subpath exports

| Subpath            | Contents                                                                  |
| ------------------ | ------------------------------------------------------------------------- |
| `@mcpview/compose` | Root re-exports (same as `/core` + `uiMeta` from `/sdk`)                  |
| `/core`            | Types, `createCollector`, `buildCompositeUi`, `validateSyncRules`         |
| `/sdk`             | `createMcpSdkCollector`, `uiMeta`, `composeEvents`, `validateComposition` |
| `/host`            | `renderComposite`, `serveDashboard`                                       |
| `/runtime`         | `composeDashboard`, `composeDashboardFromFiles`                           |
| `/deploy`          | Deploy types (`DeployRequest`, `DeployResult`, etc.)                      |

---

## Key types

```typescript
// A single UI resource collected from one tool call
interface CollectedUiResource {
  source: string; // tool name, e.g. "postgres:query"
  resourceUri: string; // e.g. "ui://pg/table/1"
  slot: number; // auto-incremented index (0-based)
  context?: Record<string, unknown>;
}

// Output of buildCompositeUi — input to renderComposite
interface CompositeUiDescriptor {
  type: "composite";
  resourceUri: string; // auto-generated ui://mcp-compose/workflow/<uuid>
  layout: UiLayout;
  children: CollectedUiResource[];
  sync: ResolvedSyncRule[]; // slot indices, not tool names
  sharedContext?: Record<string, unknown>;
}

// Sync rule — use tool names here (resolved to slots by buildCompositeUi)
interface UiSyncRule {
  from: string; // source tool name
  event: string; // e.g. "filter", "change"
  to: string; // target tool name, or "*" for broadcast
  action: string; // e.g. "update", "refresh"
}

// Layout — preset string or areas grid object
type UiLayout = "split" | "tabs" | "grid" | "stack" | UiLayoutAreas;

interface UiLayoutAreas {
  areas: string[][]; // 2D grid of source IDs (tool names)
  columns?: number[]; // column proportions
  rows?: number[]; // row proportions
  gap?: "none" | "compact" | "normal" | "spacious";
}
```

---

## UiCollector interface

Created via `createCollector()` from `/core`.

```typescript
interface UiCollector {
  collect(
    toolName: string,
    result: unknown,
    context?: Record<string, unknown>,
  ): CollectedUiResource | null;
  getResources(): CollectedUiResource[];
  clear(): void;
}
```

- `collect` returns `null` if the result has no `_meta.ui.resourceUri`
- `getResources()` returns a snapshot (copy) in slot order
- Slots are auto-incremented — first call gets slot 0, second gets slot 1, etc.

---

## McpSdkCollector

Use when working with `CallToolResult` from `@modelcontextprotocol/client` 2.x or structurally
compatible results from existing clients. The collector does not import or instantiate a client.

Import from `/sdk`:

```typescript
import { createMcpSdkCollector } from "@mcpview/compose/sdk";

const collector = createMcpSdkCollector();

// NOTE: method is collectFromSdk(), NOT collect()
collector.collectFromSdk("postgres:query", sdkResult, { query: "SELECT *" });
collector.collectFromSdk("viz:render", sdkResult2);

const resources = collector.getResources();
```

```typescript
interface McpSdkCollector {
  collectFromSdk(
    toolName: string,
    result: McpSdkCallToolResult,
    context?: Record<string, unknown>,
  ): CollectedUiResource | null;
  getResources(): CollectedUiResource[];
  clear(): void;
  readonly inner: UiCollector; // access the underlying core collector
}
```

Key difference from `UiCollector`:

- Method is `collectFromSdk`, not `collect`
- Automatically skips results where `isError: true`
- Accepts the MCP SDK `CallToolResult` shape (structural duck-typing, no SDK import needed)

---

## buildCompositeUi signature

```typescript
function buildCompositeUi(
  resources: CollectedUiResource[],
  orchestration?: UiOrchestration,
): CompositeUiDescriptor;
```

The second argument is `orchestration?` — an optional object with:

```typescript
interface UiOrchestration {
  layout?: UiLayout; // default: "stack"
  sync?: UiSyncRule[]; // tool-name-based sync rules
  sharedContext?: string[]; // keys to extract from resource contexts
}
```

**Do not** pass `{ resources, layout, sync }` — resources is the first positional argument.

Sync rules in `orchestration.sync` use **tool names** (resolved to slot indices internally). Invalid
rules are silently excluded — call `validateSyncRules` beforehand for upfront error detection.

---

## Validation

Validation is **explicit, not automatic**. Call `validateSyncRules` before `buildCompositeUi` if you
want to surface issues:

```typescript
import { validateSyncRules } from "@mcpview/compose/core";

const resources = collector.getResources();
const knownSources = resources.map((r) => r.source);

const result = validateSyncRules(syncRules, knownSources);
if (!result.valid) {
  for (const issue of result.issues) {
    console.error(issue.code, issue.message, issue.path);
  }
}
```

`validateSyncRules(rules, knownSources)` checks for:

- Orphan references — tool names not in `knownSources`
- Circular routes — `from === to` (non-broadcast)

Returns `{ valid: boolean, issues: ValidationIssue[] }`.

---

## uiMeta helper

Use `uiMeta()` from `/sdk` to declare `_meta.ui` in an MCP tool definition:

```typescript
import { uiMeta } from "@mcpview/compose/sdk";

const tool = {
  name: "erp:customers",
  ...uiMeta({
    resourceUri: "ui://erp/customers",
    emits: ["rowSelected", "filterChanged"],
    accepts: ["setFilter", "highlightRow"],
    visibility: ["model", "app"],
  }),
};
// Produces: { name: "erp:customers", _meta: { ui: { resourceUri: "...", emits: [...], ... } } }
```

Only defined fields are included in the output — undefined optional fields are omitted.

---

## Serve locally

```typescript
import { serveDashboard } from "@mcpview/compose/host";

const handle = await serveDashboard(html, { port: 3000, open: true });
console.log(handle.url); // http://localhost:3000
// Later:
await handle.shutdown();
```

Default port is `0` (OS picks a free port). Default `open: true` launches the browser.

---

## Full pipeline from files (runtime)

```typescript
import { composeDashboardFromFiles } from "@mcpview/compose/runtime";

const result = await composeDashboardFromFiles({
  templatePath: "./dashboard.yaml",
  manifestPaths: ["./mcp-servers.yaml"],
  args: { env: "prod" },
});
// result.html — complete HTML
// result.descriptor — CompositeUiDescriptor
```

---

## References

- [`references/api.md`](./references/api.md) — Full API by subpath
- [`references/layouts.md`](./references/layouts.md) — Layout modes and sync rules detail
