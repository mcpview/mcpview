# ADR 0001: Deno-First Monorepo Positioning

Date: 2026-04-18 Status: Accepted Scope: monorepo (server, compose, view,
bridge)

## Context

The mcpview monorepo (published as `@casys/*` when this was written,
`@mcpview/*` since ADR 0003) publishes its packages to both **JSR**
(`jsr:@mcpview/*`) and **npm** (`@mcpview/*`). The primary runtime target is
Deno 2.x (plus Deno Deploy for cloud). A Node compatibility path exists via a
build step (`scripts/build-node.sh`).

Several runtime targets were considered during early development:

- Cloudflare Workers / WinterCG — the `@modelcontextprotocol/sdk` transitively
  imports CJS-only packages (`ajv`, `json-schema-traverse`) that don't run
  natively on the Workers runtime.
- Browser — compose renders HTML but the server framework itself has no reason
  to run in a browser.
- Node-primary — the npm ecosystem is larger but Deno's first-class TS, JSR
  integration, and zero-config permissions model fit the platform better.

## Decision

The monorepo publishes **4 packages** (`@mcpview/server`, `@mcpview/compose`,
`@mcpview/view`, `@mcpview/bridge`) and is **Deno-first**:

1. All development, tests, and type-checking run under Deno
   (`deno task
   test`, `deno task check`, `deno fmt`, `deno lint`).
2. Source code uses Deno conventions (`mod.ts`, `_test.ts`, `jsr:` and `npm:`
   specifiers, no bundler required for dev).
3. Node compatibility is generated: `build-node.sh` copies sources to
   `dist-node/`, swaps the runtime adapter (`runtime.ts` → `runtime.node.ts`),
   and remaps imports.
4. Deno Deploy is the canonical cloud target. Other serverless runtimes
   (Workers, AWS Lambda, Vercel Edge) are not supported and not planned.
5. Browser is not a target at the framework level. The only code that ships
   browser-side is `@mcpview/view` for inside-iframe usage — explicitly bundled
   by consumers via esbuild.

## Consequences

Positive:

- TypeScript type-checks natively, no tsc/transform step during dev.
- JSR provides first-class dependency resolution for Deno consumers.
- `deno.json` is the single source of truth for versions, tasks, imports.
- Deno Deploy integration is trivial (no build step in prod for Deno path).

Negative:

- Contributors unfamiliar with Deno need a short onboarding. Mitigation:
  CLAUDE.md + per-package CLAUDE.md document the workflow.
- Some npm packages don't tree-shake or play nicely with Deno's resolver.
  Encountered case: Vite SSR rebinds `import.meta.url` in ways that break viewer
  HTML resolution; workaround is to pass paths via config instead of
  `new URL('./x.html', import.meta.url)`. Documented at einvoice-platform commit
  7e8c0c1.
- Dual publishing (JSR + npm) requires the build-node step to stay green.
  Covered by CI; drifts have happened (e.g., SDK version mismatch fixed in
  f6c094f) and are caught by integration tests.

## Non-decisions (explicitly not settled here)

- Whether to publish a CLI tool (`create-mcpview-app`) under JSR only, npm only,
  or both. Leaning both, tracked separately.
- Whether individual packages can opt out of Node support (e.g., if compose
  ships pure Deno Deploy features). Not urgent; revisit per-package when needed.

## References

- Root `CLAUDE.md` — commands and conventions.
- `scripts/build-node.sh` — the Node compilation path.
- einvoice learning: commit 7e8c0c1 (Vite SSR + import.meta.url pitfall).
