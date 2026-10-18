# mcp-compose — MCP Apps UI Orchestrator

## Vision

Lightweight Deno library for composing and synchronizing multiple MCP Apps UIs into composite
dashboards. The missing layer between isolated MCP server UIs.

**Core value proposition:** "Your MCP servers already have UIs. mcp-compose makes them talk to each
other."

## What This Is

A layered library whose composition core is dependency-free and deterministic:

1. **Collects** UI resources from MCP tool responses (`_meta.ui.resourceUri`)
2. **Composes** them into layouts (split, tabs, grid, stack)
3. **Synchronizes** cross-UI events via declarative sync rules
4. **Generates** self-contained HTML dashboards with an event bus
5. **Optionally hosts** a local interactive dashboard through an explicit runtime adapter with
   reviewed per-panel MCP capabilities

## What This Is NOT

- Not a general gateway or arbitrary MCP proxy
- Not a tracing/observability system
- Not an auth layer
- Not a general-purpose MCP client. The optional runtime owns only the narrow connections needed to
  compose and locally host an explicit dashboard.
- Not PML (no procedural memory, no learning, no capability loading)

## Product Boundary

This spec describes the composition primitive. It does not define a no-code or end-user dashboard
builder. Orchestration authoring is assumed to happen upstream in developer, agent, or product-layer
code.

## Architecture

```
┌─────────────────────────────────────────────┐
│              mcp-compose                     │
│                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │ Collector │→ │ Composer  │→ │ Renderer │  │
│  │           │  │           │  │          │  │
│  │ Inspects  │  │ Builds    │  │ Outputs  │  │
│  │ _meta.ui  │  │ composite │  │ HTML +   │  │
│  │ from MCP  │  │ descriptor│  │ EventBus │  │
│  │ responses │  │ + sync    │  │          │  │
│  └──────────┘  └───────────┘  └──────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │         Declarative Sync Rules       │    │
│  │  { from, event, to, action }         │    │
│  │  Cross-UI event routing via          │    │
│  │  postMessage (JSON-RPC 2.0)          │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## Modules

### 1. `core/` — Composition semantics

`core` is the source of truth for the composition model. It owns:

- `types/` — `UiLayout`, `UiSyncRule`, `UiOrchestration`, resource and descriptor types
- `collector/` — extraction and accumulation of `_meta.ui.resourceUri`
- `sync/` — sync rule validation and resolution
- `composer/` — `buildCompositeUi(...)`
- `renderer/` — HTML and event-bus generation

This layer stays deterministic, side-effect free, and dependency-free.

### 2. `sdk/` — External shape adapters

`sdk` owns adaptation only:

- `createMcpSdkCollector()` for SDK-shaped `CallToolResult` values
- `uiMeta()` for typed `_meta.ui` construction
- `validateComposition()` for tool-definition-level semantic checks

`sdk` does not own composition semantics or rendering logic.

### 3. `host/` — Pure host integration contracts

`host` owns the pure renderer, event bus, and static HTML server. It never opens an MCP connection
or derives an upstream UI route.

### 4. `runtime/` — Live composition and local host

`runtime` owns manifest/template loading, MCP connections, and the explicit loopback local host. It
resolves MCP App documents through `resources/read`, not a server-specific `/ui` URL. A browser slot
is bound to its source server, original resource URI, and manifest-owned `appCallable` tools.

## AX (Agent Experience) Design Principles

This library is designed to be used BY agents, not just humans:

1. **Fast fail early**: Invalid sync rules, bad resource URIs → immediate clear errors, not runtime
   surprises.
2. **Deterministic outputs**: Same inputs → same outputs. No hidden heuristics.
3. **Machine-readable errors**: Structured error objects with codes, not just string messages.
4. **Explicit over implicit**: No magic defaults that change behavior. Everything is declared.
5. **Composable primitives**: Each function does one thing. Collector → Composer → Renderer. Agents
   can use each step independently.
6. **Documentation co-located**: Each module has its own README with I/O contract.
7. **Test-first invariants**: Every sync rule behavior has a test.
8. **Narrow contracts**: Minimal required inputs, maximal type safety.

## File Structure

```
lib/mcp-compose/
├── deno.json              # Deno config, tasks, exports
├── mod.ts                 # Main entry point (re-exports)
├── SPEC.md                # This file
├── PRD.md                 # Product boundary and ownership
├── README.md              # Usage docs
├── src/
│   ├── core/              # Composition semantics (pure, no I/O)
│   │   ├── types/
│   │   ├── collector/
│   │   ├── sync/
│   │   └── composer/
│   ├── sdk/               # External shape adapters + compose events
│   │   ├── mcp-sdk.ts
│   │   ├── ui-meta-builder.ts
│   │   ├── composition-validator.ts
│   │   └── compose-events.ts
│   ├── host/              # Pure host contracts + renderer
│   │   ├── types.ts
│   │   └── renderer/
│   ├── runtime/           # Dashboard composition from manifests + templates
│   │   ├── types.ts
│   │   ├── manifest.ts
│   │   ├── template.ts
│   │   ├── cluster.ts
│   │   ├── compose.ts
│   │   └── host-dashboard.ts
│   ├── architecture_test.ts
│   ├── edge-cases_test.ts
│   ├── full-pipeline_test.ts
│   └── test-fixtures/
└── docs/
    ├── plans/
    └── decision-records/
```

## Dependencies

`core/` has no runtime dependencies. The optional runtime uses the official MCP SDK for legacy
initialized Streamable HTTP and a narrow wire adapter for the stateless `2026-07-28` protocol. It
does not introduce a generic proxy or browser-accessible server client.

## MCP Apps Protocol Compliance

The event bus implements:

- `ui/initialize` — handshake with host capabilities
- `ui/notifications/initialized` — gate for initial result delivery
- `ui/compose/event` — dedicated cross-UI event routing (mcp-compose protocol)
- `ui/notifications/tool-result` — complete initiating result after initialization
- `tools/call` / `tools/list` — slot-local manifest-granted App tools only
- `resources/read` / `resources/list` — the slot's original App resource only

All messages follow JSON-RPC 2.0.

`ui/message` is unsupported: Compose has no conversation/model delivery path and must not advertise
`message` or `message.text`. Direct requests return JSON-RPC error `-32601` (method not found),
never a delivery acknowledgement; notifications without an `id` receive no response. See the
[three-channel ADR's "No false success" rule](../view/docs/decision-records/0005-three-view-channels.md).

Component catalogs may advertise `events.emits` and `events.accepts`. An orchestration `portSync`
policy connects matching declarations across distinct active surfaces at runtime. This is a
host-selected policy, not name-based implicit wiring; payloads remain opaque and unchanged.

## Current Status

Implemented today:

- canonical `core / sdk / host / runtime` structure
- collector, sync, composer, and renderer pipeline
- `composeEvents()` SDK with dedicated `ui/compose/event` protocol
- `uiMeta()` builder for declaring emits/accepts
- runtime: manifest parsing, template YAML, cluster management, HTTP transport
- stateless-first / legacy-compatible MCP HTTP connections
- MCP SDK adaptation helpers
- host contracts + renderer, including an explicit local multi-App host
- strict resource-only MCP App fixture for the `/ui`-free resource path
- test suite with cross-slice pipeline coverage (200+ tests)
- JSR sync/publish automation

Future work remains possible, but it should stay within the primitive/product boundary above.

## Roadmap

### Next — Expand real dashboards

- [ ] Add `emits`/`accepts` to mcp-einvoice tools (via `uiMeta()`)
- [ ] Add `composeEvents()` to mcp-einvoice UIs (invoice-viewer, doclist-viewer)
- [ ] Generate manifest for mcp-einvoice (with `requiredEnv` + `transport`)
- [ ] Add further real multi-server panels and declared Compose events
- [ ] Validate each new source through a resource-only fixture as well as its real MCP endpoint

### Short-term — CLI and user experience

- [ ] CLI `mcp-compose compose` — design dashboards from manifests (no servers needed, agent browses
      available tools/emits/accepts, generates template YAML)
- [ ] CLI `mcp-compose deploy <template.yaml>` — fetch MCPs from JSR, prompt for missing env vars
      (from `requiredEnv`), start servers, serve dashboard
- [ ] Local credential storage (`.env` or keychain, per template)
- [ ] Sync rule auto-discovery from manifests (propose wiring from emits/accepts)
- [ ] Dashboard persistence (save/load templates as YAML)

### Medium-term — Composition and sync

- [ ] Conditional sync (event data matching, e.g., filter by field value)
- [ ] Bidirectional sync rules
- [ ] Sync rule composition (chains: A → B → C)

### Long-term — SDK as intelligent router (Tailscale for MCPs)

The SDK becomes a local daemon that bridges local data sources to online dashboards. Like Tailscale
creates a mesh between machines, the SDK creates a mesh between MCPs and dashboards — regardless of
where data lives.

Architecture:

```
mcp-compose connect
  → SDK starts local MCPs (Docker ERPNext, postgres, etc.)
  → SDK opens outbound WebSocket to cloud relay (no port forwarding needed)
  → Dashboard served at https://dashboard-xxx.casys.dev
  → Tool calls from dashboard → relay → WebSocket → SDK local → MCP → DB
  → Data never leaves the local network (only query results travel)
```

Milestones:

- [ ] `mcp-compose connect` — local daemon that starts MCPs + opens tunnel
- [ ] Cloud relay worker (Deno Deploy) — routes HTTP ↔ WebSocket per session
- [ ] Cloud-native MCPs (SaaS APIs like Iopole) run as Subhosting workers (no tunnel needed, MCP
      runs in the cloud with user credentials)
- [ ] Local-data MCPs (ERPNext Docker, postgres) connect via tunnel
- [ ] Shareable dashboard URLs — one link, data stays local
- [ ] Multi-tenant session management
- [ ] Dashboard hot-reload (template changes without restart)

## Source Reference

Extracted and improved from `packages/pml/src/ui/composite-generator.ts` and
`packages/pml/src/types/ui-orchestration.ts`. The PML versions remain unchanged — this is a clean
extraction with improvements.
