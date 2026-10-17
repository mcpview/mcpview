# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is the **mcpview** monorepo — an MCP server framework and an MCP Apps view
toolkit for Deno and Node, maintained by Casys (site
[mcpview.dev](https://mcpview.dev), repository `mcpview/mcpview`). It holds 6
packages published under the `@mcpview` scope, plus 7 deprecated `@casys/*`
aliases in `packages/legacy/`:

- **`@mcpview/server`** (`packages/server/`) — A production-grade framework for
  building MCP (Model Context Protocol) servers in TypeScript. Think "Hono for
  MCP". Built on the official `@modelcontextprotocol/sdk`, it adds middleware,
  auth, concurrency control, and observability. **Server-side.**
- **`@mcpview/compose`** (`packages/compose/`) — Collects and synchronizes
  multiple MCP Apps and can host them in a composed multi-iframe dashboard. Its
  collector, renderer, and hosting runtime are server-side; its event SDK runs
  inside browser iframes. **Mixed server/browser package.**
- **`@mcpview/view`** (`packages/view/`) — View-side SDK for MCP Apps
  (`createMcpApp`, `defineView`): lets authors build SPAs with internal routing
  instead of the `ui/message` anti-pattern. Thin wrapper over
  `@modelcontextprotocol/ext-apps`' `App` class. **Browser-side (iframe).**
- **`@mcpview/contracts`** (`packages/view-contracts/`) — Strict,
  dependency-free App/resource manifests and composition/session contracts.
  **Runtime-neutral.**
- **`@mcpview/components`** (`packages/view-components/`) — Optional component
  surfaces, ERPNext-derived roles and theme, Preact bindings, and scaffold.
  **Browser-side (iframe or native Preact).**
- **`@mcpview/bridge`** (`packages/bridge/`) — Bridge layer for connecting MCP
  servers to external systems and protocols, with a client script injected into
  MCP Apps. **Mixed server/browser package.**

Only `@mcpview/server` is described as production-ready. Compose, bridge, and
the view family are experimental and may change before 1.0. The seven `@casys/*`
aliases (`@casys/mcp-server`, `@casys/mcp-platform`, `@casys/mcp-view`,
`@casys/mcp-view-components`, `@casys/mcp-view-contracts`, `@casys/mcp-compose`,
`@casys/mcp-bridge`) are a transition path for existing consumers: each only
re-exports its `@mcpview/*` target, with the same export sub-paths
(`@casys/mcp-platform` re-exports `@mcpview/server`).

Server is a server runtime for Deno + Node. Compose and bridge are also
dual-published for Deno + Node but contain explicit browser-side helpers. View
and view-components target browsers via a bundler (esbuild recommended — see
`packages/view/examples/basic/build.ts`), and view-contracts is runtime-neutral.

All packages are published to both **JSR** (`jsr:@mcpview/<package>`) and
**npm** (`@mcpview/<package>`); the aliases are published as `@casys/mcp-*`.
Folders under `packages/` keep their historical names (`view-components`
publishes `@mcpview/components`, `view-contracts` publishes
`@mcpview/contracts`). Operational identifiers (`mcp-server.yaml`, `MCP_AUTH_*`,
the Prometheus `mcp_server_` prefix, class and API names, `io.casys.*` wire
identifiers) are unchanged. See ADR 0003
(`docs/decision-records/0003-mcpview-brand.md`) and the
[migration guide](docs/migration/casys-to-mcpview.md).

## Monorepo Structure

```
mcpview/                    # repo root (Deno workspace)
├── deno.json                # workspace config, lists all member packages
├── packages/
│   ├── server/              # @mcpview/server
│   │   ├── mod.ts
│   │   ├── deno.json
│   │   └── src/
│   ├── compose/             # @mcpview/compose (server runtime + iframe SDK)
│   │   ├── mod.ts
│   │   ├── deno.json
│   │   └── src/
│   ├── view/                # @mcpview/view (browser-side)
│   │   ├── mod.ts
│   │   ├── deno.json        # compilerOptions.lib includes "dom"
│   │   ├── src/
│   │   └── examples/basic/  # vanilla SPA demo + esbuild script
│   ├── view-contracts/      # @mcpview/contracts (dependency-free shared contracts)
│   ├── view-components/     # @mcpview/components (presentation runtime and Preact kit)
│   ├── bridge/              # @mcpview/bridge (server bridge + injected client)
│   │   ├── mod.ts
│   │   ├── deno.json
│   │   └── src/
│   └── legacy/              # deprecated @casys/* aliases, one folder per old name
│       ├── mcp-server/      # @casys/mcp-server   -> @mcpview/server
│       ├── mcp-platform/    # @casys/mcp-platform -> @mcpview/server
│       ├── mcp-view/        # ... and mcp-view-components, mcp-view-contracts,
│       └── ...              #     mcp-compose, mcp-bridge
└── scripts/                 # release-tag, alias npm build and verification
```

## Commands

```bash
# Root deno.json declares the workspace but has no tasks.
# Run all package tests from the repository root (six packages, then aliases):
for pkg in view-contracts server view view-components compose bridge \
  legacy/mcp-server legacy/mcp-platform legacy/mcp-view-contracts legacy/mcp-view \
  legacy/mcp-view-components legacy/mcp-compose legacy/mcp-bridge; do
  (cd "packages/$pkg" && deno task test) || exit 1
done

# Run tests for one package from the repository root
(cd packages/server && deno task test)
(cd packages/legacy/mcp-platform && deno task test)

# Run a single test file within a package
(cd packages/server && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --no-check src/<file>_test.ts)

# Targeted test suites (packages/server)
(cd packages/server && deno task test:security) # HTTP security tests only
(cd packages/server && deno task test:http)     # HTTP + security tests

# Build Node.js distribution for server (output: packages/server/dist-node/)
(cd packages/server && deno task build:npm)

# Run one package's release pre-flight
(cd packages/server && deno task release:check)
```

Tasks live in each package's `deno.json`; never assume the same task exists at
the repository root. Deno's built-in `deno fmt` and `deno lint` also apply, and
most companion packages expose them as package tasks.

## Architecture

### `@mcpview/server` (`packages/server/`)

Entry point is `packages/server/mod.ts` which re-exports the entire public API.
The central class is `McpApp` in `packages/server/src/mcp-app.ts`.
(`ConcurrentMCPServer` remains exported as a `@deprecated` alias for backwards
compatibility — it points to the same class and will be removed in v1.0.)

#### Key modules

- **`src/mcp-app.ts`** — Main server class wrapping `McpServer` from the
  official SDK. Handles tool/resource registration, STDIO via `start()`,
  stateless HTTP via `startHttp()`, and orchestrates the middleware pipeline.
- **`src/middleware/`** — Onion-model middleware pipeline (like Hono/Koa).
  Built-in chain:
  `rate-limit → auth → custom → scope-check → validation → backpressure → handler`.
  Types in `types.ts`, runner in `runner.ts`.
- **`src/auth/`** — OAuth2/JWT authentication. `JwtAuthProvider` does token
  verification with JWKS caching. Four OIDC presets (`presets.ts`): Google,
  Auth0, GitHub Actions, generic OIDC. YAML + env config loading in `config.ts`.
- **`src/concurrency/`** — `RequestQueue` (3 backpressure strategies:
  sleep/queue/reject) and `RateLimiter` (sliding window, per-client).
- **`src/validation/`** — JSON Schema validation via ajv.
- **`src/observability/`** — OpenTelemetry tracing (`otel.ts`) and Prometheus
  metrics (`metrics.ts`).
- **`src/security/`** — CSP header generation, HMAC channel auth for PostMessage
  (MCP Apps).
- **`src/runtime/`** — Runtime abstraction layer. `runtime.ts` selects exactly
  one adapter at module load; `runtime.deno.ts` uses `Deno.serve` and
  `runtime.node.ts` uses `node:http`. The Node build does not swap source files.
- **`src/client-auth/`** — Client-side OAuth2 flow (callback server, token
  stores).
- **`src/ui/`** — MCP Apps viewer discovery and utilities.
- **`src/subscriptions/`** — `subscriptions/listen` registry and SSE response
  streams for explicit change notifications.
- **`src/mrtr/`** — Multi Round-Trip Request state, replay protection, and retry
  admission.
- **`src/tasks/`** — Optional Tasks extension store and handlers.
- **`src/inspector/`** — MCP Inspector launcher for interactive debugging.

### `@mcpview/compose` (`packages/compose/`)

Composition primitives for collecting MCP App resources, building descriptors,
validating synchronization rules, rendering dashboards, and optionally hosting
multiple Apps locally. Import the needed package entry point directly (for
example `@mcpview/compose/runtime`); the framework does not re-export Compose.
The core, renderer, and runtime execute on Deno/Node. The `/sdk` entry point
mixes runtime-neutral helpers with one browser-only helper: `composeEvents()`
uses `window`, `MessageEvent`, and `postMessage` inside an App iframe.

### `@mcpview/view` (`packages/view/`)

View-side SDK for MCP Apps. `createMcpApp({ views, initialView })` +
`defineView` lets authors build SPAs with in-iframe navigation (`ctx.navigate`,
`ctx.callTool`) instead of the `ui/message` anti-pattern that pollutes the chat.
Thin wrapper over `@modelcontextprotocol/ext-apps` `App` class. Browser-only:
`deno.json` sets `compilerOptions.lib` to include `dom`, `dom.iterable`,
`dom.asynciterable`. See ADRs `docs/decision-records/0001` (Deno-first) and
`packages/compose/docs/decision-records/0002`, `0003` (positioning + non-goals).

The component catalog, theme, Preact runtime, and scaffold are not part of this
package. They live in `@mcpview/components`. The `/contracts` subpath is only a
compatibility re-export of `@mcpview/contracts`.

### `@mcpview/bridge` (`packages/bridge/`)

Bridge layer for connecting MCP servers to external systems and protocols. Its
adapters, relay, and resource server run on the server; `src/client/bridge.js`
is injected into MCP Apps and executes in the browser.

## Important Patterns

- **Deno workspace**: Cross-package imports resolve automatically via the
  workspace defined in the root `deno.json`. No manual path mapping required.
- **Compatibility aliases**: each `packages/legacy/mcp-*/` entry file stays a
  thin `export * from "@mcpview/<x>"` with the same export sub-paths as its
  target (`mcp-platform` and `mcp-server` both re-export `@mcpview/server`). The
  per-alias `mod_test.ts` parity test (helpers in `scripts/alias-parity.ts`)
  protects that contract; implementation changes belong in the `@mcpview/*`
  package. `scripts/build-alias-npm.ts` builds the deprecated npm package and
  `scripts/verify-alias-npm.ts` smoke-tests it in CI.
- **Test convention**: `*_test.ts` files colocated with source. Uses Deno's
  native test runner with `@std/assert`.
- **Node.js compatibility**: `packages/server/scripts/build-node.sh` is a
  backwards-compatible wrapper around the package's dnt build. The build emits
  native ESM JavaScript and declarations in `packages/server/dist-node/` and
  preserves the runtime selector. The HTTP layer uses Hono for portable routing.
- **Transport contract**: STDIO serves local/CLI clients. HTTP is stateless
  only: JSON-RPC uses `POST /mcp`, no `Mcp-Session-Id` is created or required,
  and `GET /mcp` returns 405. SSE is a response format for flows such as
  `subscriptions/listen`, not the old GET/SSE session transport. Auth applies
  only to HTTP.
- **Publishing**: On push to `main`, CI publishes the 6 `@mcpview/*` packages
  and then the 7 aliases, in dependency order (contracts, server, view,
  components, compose, bridge, aliases): npm through package-specific dnt builds
  (aliases through `scripts/build-alias-npm.ts`) and JSR one package per step
  via `deno publish`. Version for each package is in its own `deno.json`.
  Published npm versions are immutable and each alias is smoke-tested against
  its target's newest compatible release and declared lower bound.
- **Release tags**: `<pkg>-v<version>` for the 6 packages (`server-v0.29.0`),
  and the old name without the scope for the aliases (`mcp-server-v0.28.0`).
- **Browser/server split**: `@mcpview/view` and `@mcpview/components` are
  browser-side, while `@mcpview/contracts` is runtime-neutral. Compose and
  bridge deliberately cross the boundary through isolated iframe SDK/client
  modules; keep DOM globals out of their server runtime paths and out of
  `@mcpview/server` and the `@casys/mcp-server` / `@casys/mcp-platform` aliases.
