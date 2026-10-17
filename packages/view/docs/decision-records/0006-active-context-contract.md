# ADR 0006: Active Context Contract

Date: 2026-10-17 Status: Proposed

Builds on view ADR 0005 (the `updateModelContext` channel). "Active context" is the documentation
term for this concept; the public name is pending (root ADR 0002).

## Context

The ERPNext pilot (github.com/Casys-AI/mcp-erpnext) lets the user point at things in a view (a list
row, a chart point, a document, an attachment) and shares a bounded basket of those points with the
model through `ui/update-model-context`. Sources: `src/ui/shared/active-context.ts`,
`active-context-controller.ts`, `click-intent.ts`, `useActiveContext.ts`, `ActiveContextChip.tsx`.
Eight viewers use it on the 3.2.0-beta.1 line; the 3.1.0 stable release limits it to KPI and funnel.

The MCP Apps SDK only provides the raw primitive: each call overwrites the previous context, the
host may defer it, and modalities are announced by the host. Nothing in `@casys/mcp-view` covers it
(view ADR 0001 §3).

Neighbours, as read on 2026-10-17: mcp-use 2.10 (2026-10-14) ships `useModelContext()`, a keyed
attachment collection with `pending` / `error` states, acknowledgement and `superseded` results, and
reconciliation of host-side removals, without an item cap, eviction or navigation scoping; its
`<ModelContext>` component and Skybridge's `data-llm` push one merged snapshot. The OpenAI extension
specification adds a per-revision `updateId` and notifies the view when the user removes an
attachment. To our knowledge no library combines a bounded basket, host acknowledgement,
reconciliation on data refresh and navigation scoping; the gap is narrower than it was in September.

## Decision

### Snapshot (wire contract, in `@casys/mcp-view-contracts`)

- Schema `io.casys.active-context/1.0`; readers also accept the pilot's
  `casys.erpnext/active-context` v2.
- Items `{ id, view, label, value?, ref? }`. `id` is stable within the view; `view` is the
  provenance (level title); `ref` optionally carries a typed reference compatible with
  `io.casys.semantic-selection/1.0` so an agent can act on the item without parsing `id`.
- Bounded: at most 8 items; field bounds 180 / 120 / 240 / 240 code points (pilot values).
- Closed schema: no `prompt`, `instruction` or free-text field addressed to the model. Internal keys
  (reconcile key, scope key, resource bytes) are never serialized.
- Every update sends the whole snapshot. Clearing sends the canonical empty snapshot
  `{ schema, version, items: [] }`; readers treat a payload without `schema` (the pilot sends `{}`)
  as empty.

### Replication (engine, in `@casys/mcp-view/context`)

- One serialized write queue per App instance (iframe). State is committed for display only after
  the host acknowledges; `pending` is shown immediately; a failure stays visible until dismissed or
  retried.
- Scope = identity of the navigation root. Pushing or popping levels keeps the basket; a new root
  increments a generation and queues a clear of the old root. Actions captured under an older
  generation return `"superseded"`. `"superseded"` does not mean "not applied": a write already
  acknowledged remains host truth until the clear lands.
- Results are coded: `"shared" | "cleared" | "unsupported" | "error" | "superseded"`. `"error"`
  carries a cause code (host rejection, invalid snapshot, resource too large, timeout); the pilot
  currently collapses all of them.
- Refresh reconciles items against the reloaded data by explicit group, not by string conventions
  (the pilot's `:row:` suffix becomes `reconcileGroup(groupId)`).
- Host-initiated removal (a user removing an attachment in the host UI) updates the basket when the
  host reports it; the pilot ignores it today.
- Clean-up is best-effort: the engine clears on view unmount and on supersession, and on
  `onTeardown` where the host sends it. claude.ai web does not send `ui/resource-teardown`, so the
  last snapshot may outlive the view there.

### Modality ladder

1. `structuredContent` if the host announces it, else `text` (the JSON snapshot).
2. One local resource at most: a `resource` block only if announced (5 MiB of bytes, about 6.7 MiB
   once base64-encoded); else a text fallback limited to `text/*` or `application/json` and 32 KiB,
   never derived from binary bytes; else metadata only.
3. No `updateModelContext` capability: the view stays in detail mode (click opens detail); it does
   not fall back to `sendMessage` (view ADR 0005 rule 3).

### Policies are parameters

Eviction (`onFull: "evict-oldest" | "reject"`), resource policy (`"latest" | "none"`), gesture
mapping (click, double-click, keyboard) and the undo window are parameters with the pilot values as
defaults. The pilot's "toggle then compensate" gesture changed three times in three weeks: the
gesture subpath (`@casys/mcp-view/gesture`) stays experimental until it stabilizes. The replay
journal also protects newer clicks during a late undo, a refresh during undo and root clears, so a
`reject` policy alone does not remove it.

### Data and host safety

- Labels and values come from business data and are untrusted: strip control characters, mark
  truncation, keep `view` as provenance. "No instruction field" protects the library's wording, not
  the data; a lead created from a public web form can carry injection text.
- Attaching a resource discloses it in the UI before sending (the pilot pushes up to 5 MiB with no
  visible payload indicator).
- Multiple instances: Claude mounts one iframe per tool call and no host API unmounts older ones;
  hosts scope replacement differently (per view, per App instance on ChatGPT, per resource URI on
  Goose). The engine adopts a supersession scheme (server-minted ordering key plus
  `BroadcastChannel` election, as documented by Anthropic) before the library claims reliability;
  today fencing is intra-iframe only.
- The library ships a short model-facing description of the snapshot, to place in tool descriptions
  or server instructions, for hosts where the model pulls widget context on demand.

### Out of scope

- `io.casys.semantic-selection` (view-to-view events through Compose) stays a separate contract;
  `ref` is the bridge.
- Navigation stacks: a separate subpath (`@casys/mcp-view/navigation`), covered by root ADR 0002.

## Consequences

- The pilot keeps working through a legacy schema reader during one minor version.
- The engine must live outside the render tree: `startSurfaceApp` remounts the surface on
  host-context changes, which would drop a basket held in component state.
- Authors keep one hook (`useActiveContext`) and lose the glue each of the pilot's eight viewers
  rewrites around it today (root key, reconcile effects, host-context binding).

## Trigger to accept

- A second, non-ERP domain adopts the engine without library changes beyond parameters. Candidate:
  `mcp-syson`, whose five viewers share one naive `publishSelection` function.
- The host conformance matrix shows, per host, which modality reaches the model, whether updates
  survive the next turn, and whether teardown is delivered.
