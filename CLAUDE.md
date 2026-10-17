# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Project Overview

This is a **monorepo** containing 7 packages that form the Casys MCP Platform:

- **`@casys/mcp-server`** (`packages/server/`) — A production-grade framework
  for building MCP (Model Context Protocol) servers in TypeScript. Think "Hono
  for MCP". Built on the official `@modelcontextprotocol/sdk`, it adds
  middleware, auth, concurrency control, and observability. **Server-side.**
- **`@casys/mcp-platform`** (`packages/platform/`) — Deprecated compatibility
  package containing only a re-export of `@casys/mcp-server`; it is not a second
  framework implementation. **Server-side.**
- **`@casys/mcp-compose`** (`packages/compose/`) — Collects and synchronizes
  multiple MCP Apps and can host them in a composed multi-iframe dashboard. Its
  collector, renderer, and hosting runtime are server-side; its event SDK runs
  inside browser iframes. **Mixed server/browser package.**
- **`@casys/mcp-view`** (`packages/view/`) — View-side SDK for MCP Apps
  (`createMcpApp`, `defineView`): lets authors build SPAs with internal routing
  instead of the `ui/message` anti-pattern. Thin wrapper over
  `@modelcontextprotocol/ext-apps`' `App` class. **Browser-side (iframe).**
- **`@casys/mcp-view-contracts`** (`packages/view-contracts/`) — Strict,
  dependency-free App/resource manifests and composition/session contracts.
  **Runtime-neutral.**
- **`@casys/mcp-view-components`** (`packages/view-components/`) — Optional
  component surfaces, ERPNext-derived roles and theme, Preact bindings, and
  scaffold. **Browser-side (iframe or native Preact).**
- **`@casys/mcp-bridge`** (`packages/bridge/`) — Bridge layer for connecting MCP
  servers to external systems and protocols, with a client script injected into
  MCP Apps. **Mixed server/browser package.**

Only `@casys/mcp-server` is described as production-ready. Compose, bridge, and
the view family are experimental and may change before 1.0. The deprecated
platform package is a transition path for existing consumers.

Server and platform are server runtimes for Deno + Node. Compose and bridge are
also dual-published for Deno + Node but contain explicit browser-side helpers.
View and view-components target browsers via a bundler (esbuild recommended —
see `packages/view/examples/basic/build.ts`), and view-contracts is
runtime-neutral.

All packages are published to both **JSR** (`jsr:@casys/<package>`) and **npm**
(`@casys/<package>`).

## Monorepo Structure

```
mcp-server/                 # repo root (Deno workspace)
├── deno.json                # workspace config, lists all member packages
├── packages/
│   ├── server/              # @casys/mcp-server
│   │   ├── mod.ts
│   │   ├── deno.json
│   │   └── src/
│   ├── platform/            # @casys/mcp-platform (deprecated alias)
│   ├── compose/             # @casys/mcp-compose (server runtime + iframe SDK)
│   │   ├── mod.ts
│   │   ├── deno.json
│   │   └── src/
│   ├── view/                # @casys/mcp-view (browser-side)
│   │   ├── mod.ts
│   │   ├── deno.json        # compilerOptions.lib includes "dom"
│   │   ├── src/
│   │   └── examples/basic/  # vanilla SPA demo + esbuild script
│   ├── view-contracts/      # dependency-free shared contracts
│   ├── view-components/     # optional presentation runtime and Preact kit
│   └── bridge/              # @casys/mcp-bridge (server bridge + injected client)
│       ├── mod.ts
│       ├── deno.json
│       └── src/
└── scripts/
```

## Commands

```bash
# Root deno.json declares the workspace but has no tasks.
# Run all package tests from the repository root:
for pkg in server platform compose bridge view-contracts view view-components; do
  (cd "packages/$pkg" && deno task test) || exit 1
done

# Run tests for one package from the repository root
(cd packages/server && deno task test)
(cd packages/platform && deno task test)

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

### `@casys/mcp-server` (`packages/server/`)

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

### `@casys/mcp-compose` (`packages/compose/`)

Composition primitives for collecting MCP App resources, building descriptors,
validating synchronization rules, rendering dashboards, and optionally hosting
multiple Apps locally. Import the needed package entry point directly (for
example `@casys/mcp-compose/runtime`); the framework does not re-export Compose.
The core, renderer, and runtime execute on Deno/Node. The `/sdk` entry point
mixes runtime-neutral helpers with one browser-only helper: `composeEvents()`
uses `window`, `MessageEvent`, and `postMessage` inside an App iframe.

### `@casys/mcp-view` (`packages/view/`)

View-side SDK for MCP Apps. `createMcpApp({ views, initialView })` +
`defineView` lets authors build SPAs with in-iframe navigation (`ctx.navigate`,
`ctx.callTool`) instead of the `ui/message` anti-pattern that pollutes the chat.
Thin wrapper over `@modelcontextprotocol/ext-apps` `App` class. Browser-only:
`deno.json` sets `compilerOptions.lib` to include `dom`, `dom.iterable`,
`dom.asynciterable`. See ADRs `docs/decision-records/0001` (Deno-first) and
`packages/compose/docs/decision-records/0002`, `0003` (positioning + non-goals).

The component catalog, theme, Preact runtime, and scaffold are not part of this
package. They live in `@casys/mcp-view-components`. The `/contracts` subpath is
only a compatibility re-export of `@casys/mcp-view-contracts`.

### `@casys/mcp-bridge` (`packages/bridge/`)

Bridge layer for connecting MCP servers to external systems and protocols. Its
adapters, relay, and resource server run on the server; `src/client/bridge.js`
is injected into MCP Apps and executes in the browser.

## Important Patterns

- **Deno workspace**: Cross-package imports resolve automatically via the
  workspace defined in the root `deno.json`. No manual path mapping required.
- **Compatibility alias**: `packages/platform/mod.ts` stays a thin
  `export * from "@casys/mcp-server"`; its parity test protects that umbrella
  contract. Framework implementation changes belong in `packages/server/`.
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
- **Publishing**: On push to `main`, CI publishes all 7 packages to JSR (via
  `npx jsr publish`) and npm through package-specific dnt builds. Version for
  each package is in its own `deno.json`.
- **Browser/server split**: `@casys/mcp-view` and `@casys/mcp-view-components`
  are browser-side, while `@casys/mcp-view-contracts` is runtime-neutral.
  Compose and bridge deliberately cross the boundary through isolated iframe
  SDK/client modules; keep DOM globals out of their server runtime paths and out
  of `@casys/mcp-server` and `@casys/mcp-platform`.
