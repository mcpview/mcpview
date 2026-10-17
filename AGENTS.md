# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in
this repository.

## Project Overview

This repo is the **Casys MCP Platform** monorepo (7 workspace packages under
`packages/` — `server`, `platform`, `compose`, `bridge`, `view-contracts`,
`view`, `view-components`). Its flagship is `@casys/mcp-server` — a
production-grade framework for building MCP (Model Context Protocol) servers in
TypeScript. Think "Hono for MCP". Built on the official
`@modelcontextprotocol/sdk`, it adds middleware, auth, concurrency control, and
observability.

The seven packages are one canonical framework, one deprecated compatibility
alias (`@casys/mcp-platform`), and five experimental companion packages. Do not
treat the alias as a second implementation: it only re-exports
`@casys/mcp-server`. Each workspace package has its own version and is published
to both JSR and npm.

## Commands

```bash
# The root deno.json declares only the workspace; it has no tasks.
# Run all package tests from the repository root:
for pkg in server platform compose bridge view-contracts view view-components; do
  (cd "packages/$pkg" && deno task test) || exit 1
done

# Run one package suite from the repository root
(cd packages/server && deno task test)

# Run one server test file
(cd packages/server && deno test --allow-net --allow-read --allow-write --allow-env --allow-run --no-check src/<file>_test.ts)

# Targeted server suites
(cd packages/server && deno task test:security) # HTTP security only
(cd packages/server && deno task test:http)     # HTTP + security

# Build the server's npm/Node distribution
# Output: packages/server/dist-node/
(cd packages/server && deno task build:npm)

# Run a package release pre-flight
(cd packages/server && deno task release:check)
```

Package tasks are defined in each `packages/<name>/deno.json`; do not assume a
task exists at the workspace root. Deno's built-in `deno fmt` and `deno lint`
also apply, and most companion packages expose them as package tasks.

## Architecture

The canonical entry point is `packages/server/mod.ts`, which re-exports the
framework's public API. The central class is `McpApp` in
`packages/server/src/mcp-app.ts`. (`ConcurrentMCPServer` remains exported as a
`@deprecated` symbol alias for backwards compatibility — it points to the same
class and will be removed in v1.0.)

### Key modules

- **`packages/server/src/mcp-app.ts`** — Main server class wrapping `McpServer`
  from the official SDK. Handles tool/resource registration, STDIO via
  `start()`, stateless HTTP via `startHttp()`, and the middleware pipeline.
- **`packages/server/src/middleware/`** — Onion-model middleware pipeline (like
  Hono/Koa). Built-in chain:
  `rate-limit → auth → custom → scope-check → validation → backpressure → handler`.
  Types in `types.ts`, runner in `runner.ts`.
- **`packages/server/src/auth/`** — OAuth2/JWT authentication. `JwtAuthProvider`
  does token verification with JWKS caching. Four OIDC presets (`presets.ts`):
  Google, Auth0, GitHub Actions, generic OIDC. YAML + env config loading in
  `config.ts`.
- **`packages/server/src/concurrency/`** — `RequestQueue` (3 backpressure
  strategies: sleep/queue/reject) and `RateLimiter` (sliding window,
  per-client).
- **`packages/server/src/validation/`** — JSON Schema validation via ajv.
- **`packages/server/src/observability/`** — OpenTelemetry tracing (`otel.ts`)
  and Prometheus metrics (`metrics.ts`).
- **`packages/server/src/security/`** — CSP header generation, HMAC channel auth
  for PostMessage (MCP Apps).
- **`packages/server/src/runtime/`** — Runtime abstraction layer. `runtime.ts`
  selects exactly one host adapter at module load; `runtime.deno.ts` uses
  `Deno.serve`, while `runtime.node.ts` uses `node:http`. There is no build-time
  adapter swap.
- **`packages/server/src/client-auth/`** — Client-side OAuth2 flow (callback
  server, token stores).
- **`packages/server/src/ui/`** — MCP Apps viewer discovery and utilities.
- **`packages/server/src/subscriptions/`** — `subscriptions/listen` registry and
  SSE response streams for explicit change notifications.
- **`packages/server/src/mrtr/`** — Multi Round-Trip Request state, replay
  protection, and retry admission.
- **`packages/server/src/tasks/`** — Optional Tasks extension store and
  handlers.
- **`packages/server/src/inspector/`** — MCP Inspector launcher for interactive
  debugging.

### Important patterns

- **Workspace resolution**: Cross-package imports resolve through the members
  declared in the root `deno.json`; there is no required `../mcp-compose/`
  sibling outside this monorepo.
- **Compatibility alias**: `packages/platform/mod.ts` must stay a thin
  `export * from "@casys/mcp-server"`. Its parity test guards the umbrella
  contract; framework changes belong in `packages/server/`.
- **Test convention**: `*_test.ts` files colocated with source. Uses Deno's
  native test runner with `@std/assert`.
- **Node.js compatibility**: `packages/server/scripts/build-node.sh` is a
  backwards-compatible wrapper around the package's dnt build. It emits native
  ESM JavaScript and declarations in `packages/server/dist-node/`; the same
  runtime selector loads the Node adapter. The HTTP layer uses Hono for portable
  routing.
- **Transport contract**: STDIO serves local/CLI clients. HTTP is stateless
  only: JSON-RPC uses `POST /mcp`, no `Mcp-Session-Id` is created or required,
  and `GET /mcp` returns 405. SSE is a response format for flows such as
  `subscriptions/listen`, not the old GET/SSE session transport. Auth applies
  only to HTTP.
- **Publishing**: On push to `main`, `.github/workflows/publish.yml` publishes
  every workspace member to JSR (`npx jsr publish` skips already-published
  versions) and all seven to npm (`server`, `platform`, `compose`, `bridge`,
  `view-contracts`, `view`, and `view-components` via dnt). Each npm job is
  idempotent: it queries `npm view <pkg>@<ver>` before publishing, so repeated
  runs without a version bump exit cleanly instead of masking auth/build/network
  failures behind `|| echo`.

## Release process

Versioning is **independent per package**. Each package owns its own `deno.json`
`version` and `CHANGELOG.md`. `compose` also owns a `src/version.ts` constant
whose drift is asserted by `version_test.ts`; bump those two compose locations
together, but do not align unrelated package versions automatically.

Per-package release flow (run from inside `packages/<pkg>/`):

```bash
# 1. Generate a draft of unreleased entries from conventional commits.
#    Output is meant to be edited — git-cliff gives you the *what*, you write
#    the *why* in the narrative style the existing CHANGELOG entries follow.
deno task changelog:draft

# 2. Edit packages/<pkg>/CHANGELOG.md: promote [Unreleased] → [<version>] and
#    expand bullets with the rationale, trade-offs, and breaking notes.

# 3. Bump version in packages/<pkg>/deno.json. For compose, also bump
#    packages/compose/src/version.ts (drift test will catch a miss).

# 4. Run the package-defined release pre-flight. Its checks vary by package.
deno task release:check

# 5. Create the annotated tag <pkg>-v<version> locally.
deno task release:tag

# 6. Push the tag to trigger .github/workflows/release.yml (creates the
#    GitHub Release with the CHANGELOG section as notes). The actual JSR/npm
#    publish still rides on push to main, separately.
git push origin <pkg>-v<version>
```

Tag format is `<pkg>-v<version>` (for example `server-v0.29.0` or
`compose-v0.9.1`). This is what `release.yml` listens for and what `git-cliff`
filters on via the shared `cliff.toml` at the repo root. **Do not** create
unscoped `vX.Y.Z` tags for individual package releases — those are reserved for
legacy history.
