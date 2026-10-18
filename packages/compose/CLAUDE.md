# CLAUDE.md — Agent Instructions for mcp-compose

## Project Overview

mcp-compose is a standalone Deno library for composing and synchronizing multiple MCP Apps UIs into
composite dashboards.

Read `SPEC.md` for the full specification. This file provides build context.

## Reference Code

The `_reference/` directory contains the original PML code this lib is extracted from:

- `pml-composite-generator.ts` — the original composite UI builder
- `pml-ui-orchestration-types.ts` — the original type definitions
- `pml-composite-generator_test.ts` — existing tests

**DO NOT copy-paste.** Use as reference for understanding the domain. Rewrite everything from
scratch following the SPEC.md architecture.

## Constraints

1. **Pure core.** No I/O, network, filesystem, or MCP-client dependency in `core/`. The optional
   runtime may use the official SDK for legacy Streamable HTTP and a narrow stateless adapter.
2. **Pure functions in core.** No I/O, no network, no filesystem in `core/` modules. The `sdk/`
   layer may adapt external result shapes. The `runtime/` layer handles all I/O.
3. **Test-first.** Write tests before implementation for each module.
4. **AX principles.** Machine-readable errors, deterministic outputs, explicit defaults, composable
   primitives.
5. **Deno conventions.** Use `mod.ts` for module exports. Use `_test.ts` suffix for test files
   co-located with source.
6. **Product boundary.** The library consumes explicit orchestration. Intent-first or end-user
   dashboard authoring belongs in a higher layer, not in `src/`.

## Build & Test

```bash
deno task test      # Run all tests
deno task check     # Type check
deno task lint      # Lint
deno task fmt       # Format
```

## Architecture

```
src/
  core/           — Composition semantics (pure, no I/O)
    types/        — UiLayout, UiSyncRule, UiOrchestration, resources, descriptor
    collector/    — UI resource extraction from MCP tool results
    sync/         — Sync rule validation and resolution
    composer/     — Composite UI builder (buildCompositeUi)
  sdk/            — External shape adapters + compose events
    mcp-sdk.ts         — MCP SDK CallToolResult adapter
    ui-meta-builder.ts — uiMeta() helper for declaring emits/accepts
    composition-validator.ts — semantic validation (emits/accepts matching)
    compose-events.ts  — UI-side cross-UI event channel (ui/compose/event)
  host/           — Pure host contracts + renderer
    types.ts      — CompositeUiHost, HostConfig interfaces
    renderer/     — HTML/CSS/JS generation with event bus
  runtime/        — Dashboard composition from manifests + templates (I/O layer)
    types.ts      — McpManifest, DashboardTemplate, transports, ComposeRequest
    manifest.ts   — Parse/validate/load manifest JSON files
    template.ts   — Parse YAML templates, validate, inject {{args}}
    cluster.ts    — Start/connect MCP servers, tool calls via HTTP
    compose.ts    — composeDashboard() orchestrator
    host-dashboard.ts — loopback multi-App host and slot allowlists
  deploy/         — Cloud deployment (Deno Deploy API, relay, tunnel)
    types.ts      — DeployTransport, DeployRequest, DeployResult, TunnelConnection
```

## Dependency Rules

- `core/` imports nothing outside core (it is the dependency root)
- `sdk/` imports from `core/` only
- `host/` imports from `core/` and `sdk/` (for COMPOSE_EVENT_METHOD constant)
- `runtime/` imports from `core/`, `host/`, and `sdk/`
- `deploy/` imports from `runtime/`, `core/`, and Deno Deploy API
- No circular dependencies between layers

## Event Bus Protocol

The rendered HTML includes a JavaScript event bus that implements:

- JSON-RPC 2.0 messages via postMessage
- `ui/initialize` handshake (MCP Apps spec — compose acts as host)
- `ui/compose/event` — dedicated cross-UI event routing (compose extension, fills the View↔View gap
  the MCP Apps spec does not cover)
- Broadcast support via `to: "*"` on sync rules

Compose advertises `logging` and the experimental component catalog capability on initialize. It
does not advertise `message` or `message.text`: there is no conversation/model delivery path. Direct
`ui/message` requests return JSON-RPC error `-32601` (method not found); notifications without an
`id` receive no response. Never acknowledge delivery that did not happen (view ADR 0005, rule 4). In
an interactive local slot it additionally advertises `serverTools` and/or `serverResources` only if
the runtime supplied a concrete local route. `serverTools` is restricted to manifest tools marked
`appCallable` and `serverResources` to the collected resource URI. The parent verifies a child
window and its unique loopback origin before relaying either capability.

The legacy `ui/update-model-context` sync routing path was removed in v0.4.0. Cross-UI sync must go
through `ui/compose/event` exclusively. Initial tool results must be delivered only after
`ui/notifications/initialized`, never immediately after `ui/initialize`.

## Quality Bar

- All public functions must have JSDoc with @example
- All sync rule behaviors must have tests
- All error paths must return structured errors (not thrown strings)
- Generated HTML must be valid HTML5
- Event bus must handle malformed messages gracefully
- Runtime errors use RuntimeErrorCode enum
- Server processes are always cleaned up in finally blocks
