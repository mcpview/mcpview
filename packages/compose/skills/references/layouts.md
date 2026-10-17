# @mcpview/compose — Layouts & Sync Rules

---

## Layout presets

Pass a string to `orchestration.layout` in `buildCompositeUi`.

| Preset    | Description                            |
| --------- | -------------------------------------- |
| `"split"` | Two panels side-by-side                |
| `"tabs"`  | Tabbed interface (one panel at a time) |
| `"grid"`  | Auto-fit grid (equal-size cells)       |
| `"stack"` | Vertical stack (default)               |

```typescript
const descriptor = buildCompositeUi(resources, { layout: "split" });
const descriptor = buildCompositeUi(resources, { layout: "tabs" });
const descriptor = buildCompositeUi(resources, { layout: "grid" });
const descriptor = buildCompositeUi(resources); // layout defaults to "stack"
```

---

## Areas layout (object form)

Use `UiLayoutAreas` when you need custom proportions or named regions.

```typescript
interface UiLayoutAreas {
  areas: string[][]; // required — 2D grid of source IDs
  columns?: number[]; // proportional column widths
  rows?: number[]; // proportional row heights
  gap?: "none" | "compact" | "normal" | "spacious"; // default: "normal"
}
```

The `areas` array is a 2D grid where each cell contains a **tool name** (the `source` field of a
`CollectedUiResource`). Repeating the same name in adjacent cells spans that panel across multiple
cells.

```typescript
const layout: UiLayoutAreas = {
  areas: [
    ["filter", "list", "detail"],
    ["filter", "chart", "chart"],
  ],
  columns: [1, 2, 2], // filter=1fr, list=2fr, detail=2fr
  rows: [3, 1], // top row taller than bottom
  gap: "normal",
};

const descriptor = buildCompositeUi(resources, { layout });
```

Gap values map to:

- `"none"` → 0px
- `"compact"` → 4px
- `"normal"` → 8px
- `"spacious"` → 16px

Use `isLayoutAreas(layout)` / `isLayoutPreset(layout)` from `/core` to narrow the type at runtime.

---

## Sync rules

Sync rules wire cross-UI events. Written with **tool names** in `UiSyncRule`, resolved to **slot
indices** in `ResolvedSyncRule` by `buildCompositeUi`.

### Shape

```typescript
interface UiSyncRule {
  from: string; // source tool name, e.g. "postgres:query"
  event: string; // event type the source emits, e.g. "filter"
  to: string; // target tool name or "*" for broadcast
  action: string; // action to trigger on the target, e.g. "update"
}
```

### Examples

```typescript
// Single target
{ from: "postgres:query", event: "rowSelected", to: "viz:chart", action: "highlight" }

// Broadcast to all other UIs
{ from: "date-picker", event: "change", to: "*", action: "refresh" }

// Chain: filter table → update chart → update summary
[
  { from: "erp:list",   event: "filter",  to: "erp:chart",   action: "update" },
  { from: "erp:chart",  event: "select",  to: "erp:detail",  action: "load" },
]
```

### Resolution behavior

`buildCompositeUi` calls `resolveSyncRules` internally:

- `from`/`to` tool names are mapped to their slot indices
- Rules where `from` or `to` tool name is not found among collected resources are **silently
  excluded**
- Broadcast rules (`to: "*"`) are kept as-is (resolved `to` remains `"*"`)

If you need to detect bad rules before building, call `validateSyncRules` first.

---

## Validation

```typescript
import { validateSyncRules } from "@mcpview/compose/core";

const resources = collector.getResources();
const knownSources = resources.map((r) => r.source);
const syncRules: UiSyncRule[] = [/* ... */];

const result = validateSyncRules(syncRules, knownSources);
// result.valid: boolean
// result.issues: ValidationIssue[]

if (!result.valid) {
  for (const issue of result.issues) {
    // issue.code: "ORPHAN_SYNC_REFERENCE" | "CIRCULAR_SYNC_RULE"
    // issue.message: human-readable string
    // issue.path: e.g. "sync[0].from", "sync[1]"
    console.error(`[${issue.code}] ${issue.path}: ${issue.message}`);
  }
}

// Only build if valid
if (result.valid) {
  const descriptor = buildCompositeUi(resources, { layout: "split", sync: syncRules });
}
```

### Error codes

| Code                    | Cause                                               |
| ----------------------- | --------------------------------------------------- |
| `ORPHAN_SYNC_REFERENCE` | `from` or `to` tool name not in collected resources |
| `CIRCULAR_SYNC_RULE`    | `from === to` (non-broadcast)                       |

---

## Renderer output

`renderComposite(descriptor)` returns a **complete, self-contained HTML5 document**:

- No external dependencies — all CSS and JS inlined
- One `<iframe>` per child resource
  - `id="ui-{slot}"`
  - `src="{resourceUri}"`
  - `data-slot="{slot}"`
  - `data-source="{toolName}"`
  - `data-area="{area}"` (areas layout only)
- JavaScript event bus using **JSON-RPC 2.0** messaging between iframes
- CSS variables for dark/light theme (`--mcc-bg-primary`, `--mcc-border-color`, etc.)
- Layout CSS generated per `descriptor.layout` value

### Tabs layout behavior

In `"tabs"` layout:

- First tab is active by default
- Tab buttons are labeled with the tool name (`child.source`)
- Tab switching is handled by the inlined JavaScript

### Areas layout behavior

Source IDs in `areas` must match tool names exactly. The renderer maps each `CollectedUiResource` to
its named grid area using `areaMap` (populated by the composer from the areas grid).

---

## Common mistakes

| Wrong                                                                   | Right                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `buildCompositeUi({ resources, layout, sync })`                         | `buildCompositeUi(resources, { layout, sync })`                  |
| `collector.collect(...)` on `McpSdkCollector`                           | `collector.collectFromSdk(...)`                                  |
| Passing `buildCompositeUi` to renderer before calling `renderComposite` | `renderComposite` takes a `CompositeUiDescriptor`, not resources |
| Assuming invalid sync rules throw                                       | Invalid rules are silently excluded — use `validateSyncRules`    |
| Assuming `renderComposite` opens a browser                              | Use `serveDashboard` from `/host` for that                       |
