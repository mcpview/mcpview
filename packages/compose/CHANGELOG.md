# Changelog

All notable changes to `@mcpview/compose` (published as `@casys/mcp-compose` up to 0.9.1) will be
documented in this file.

## [Unreleased]

### Fixed

- Stop advertising `message.text` in the Compose host's initialization response: Compose has no
  conversation/model delivery path. Direct `ui/message` requests now return JSON-RPC error `-32601`
  instead of logging the payload and acknowledging `{}`, so a viewer cannot mistake a console log
  for a delivered message. Viewers should treat the missing `message` capability as unsupported,
  following view ADR 0005's "No false success" rule.

## [0.10.0] - 2026-10-17

### Changed

- Renamed from `@casys/mcp-compose` to `@mcpview/compose`. The whole family moves to the `@mcpview`
  scope on JSR and npm (repository `mcpview/mcpview`, site https://mcpview.dev, maintained by
  Casys). Same code and same API: only the dependency and import name change. Version numbers
  continue from 0.9.1, and `@casys/mcp-compose@0.10.0` stays published as a deprecated alias with
  the same `.`, `./core`, `./sdk`, `./host`, `./runtime`, and `./deploy` entry points.
- The example servers import `@mcpview/server`, and the MCP client identity Compose announces when
  it connects to a panel server (`clientInfo.name`, and the stateless client info) is now
  `@mcpview/compose`.
- Wire identifiers (`ui://mcp-compose/...`, `io.casys.mcp.*`) are unchanged.
- See the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## [0.9.1] - 2026-09-19

### Changed

- Point the example servers and npm repository metadata at the canonical `@casys/mcp-platform`
  package and renamed `Casys-AI/mcp-platform` repository. Existing `@casys/mcp-server` imports
  remain supported by the deprecated compatibility alias; this patch does not remove or narrow that
  compatibility path.

### Fixed

- Correct the README integration example to import `composeEvents` and `uiMeta` from
  `@casys/mcp-compose/sdk`, where those helpers are actually exported. Neither the canonical
  framework package nor its `@casys/mcp-server` compatibility alias owns the Compose SDK surface.

## [0.9.0] - 2026-08-31

### Added

- Add component event-port catalogs and `portSync` policies. Hosts can keep one stable composition
  policy while Compose connects only distinct active surfaces that advertise both ends, with
  preflight against tool manifests and no payload or identifier transformation.
- Add an explicit JSON template parser and `.json` loading path for canonical agent-authored
  composition manifests; existing YAML dashboards remain compatible.

### Fixed

- Include the licence, README, and changelog in the npm tarball and fail the publish workflow when
  any of those release files is missing.

## [0.8.1] - 2026-08-01

### Added

- Add explicit small-component surface negotiation between a Compose host and componentized MCP
  Apps, with safe layout, stable instance identities, default standalone surfaces, and explicit
  unknown-component failures.
- Support component-only Apps with no standalone default and report `surface-required` when a host
  omits the selection.

### Changed

- Keep `ui/compose/event` as the separate viewer-to-viewer event plane while adding component-only
  catalogs.

## [0.7.1] - 2026-07-31

### Fixed

- **Nested App framing.** Reviewed `frameAncestors` now propagate to every child MCP App response as
  well as the parent dashboard, so an embedded dashboard works through the complete product-shell
  iframe chain. Invalid CSP sources remain excluded.

## [0.7.0] - 2026-07-31

### Added

- **Reviewed dashboard embedding.** `composeAndServeDashboard()` and `serveComposedDashboard()`
  accept `frameAncestors` when a local product shell needs to mount the live dashboard in-place.
  Values are restricted to validated HTTP(S) origins; the default remains `frame-ancestors 'none'`
  so standalone dashboards are not embeddable accidentally.

## [0.6.0] - 2026-07-31

### Added

- **Local MCP Apps dashboard host.** `composeAndServeDashboard()` resolves each declared App through
  MCP `resources/read`, serves panels on distinct loopback origins, completes the Apps handshake,
  and delivers the initiating tool result.
- **Capability-bounded panel proxy.** Each panel may call only the tools explicitly marked
  `appCallable` in its manifest. Resource URIs and child CSP metadata are narrowed before rendering.
- **Stateless 2026-07-28 transport support.** HTTP manifests can opt into the stateless wire
  contract without initialize, session identifiers, SSE, or guessed `/ui` routes.

## [0.5.2] - 2026-05-09

Maintenance release: align with upstream `@modelcontextprotocol/ext-apps` 1.7.x.

### Changed

- **Bump `@modelcontextprotocol/ext-apps` `^1.6.0` → `^1.7.1`** — picks up `App.registerTool()` /
  `sendToolListChanged()` (View-side WebMCP-style tool exposure), `App.createSamplingMessage()`, and
  handshake-ordering guards (warn-or-throw via `AppOptions.strict`). Compose only consumes ext-apps
  **types** (see 0.4.1), so the new runtime defaults — notably `allowUnsafeEval: false` with
  `z.config({ jitless: true })` enforced inside the `App` constructor — do not alter compose host
  behaviour. They do affect `@casys/mcp-view`, which wraps the runtime class; cross-check the view
  changelog if you embed both.

- **Transitive: `zod` `4.3.6` → `4.4.3`** in `deno.lock`. Single zod family preserved (no duplicate
  zod tree). Pulled in via the ext-apps re-resolution.

## [0.5.1] - 2026-04-19

Maintenance release: housekeeping after splitting `view/` into its own workspace package
(`@casys/mcp-view`). The `compose/view` sub-export was preserved as a re-export shim, so existing
`@casys/mcp-compose/view` consumers keep working unchanged.

## [0.5.0] - 2026-04-18

### Added

- **New sub-export `@casys/mcp-compose/view`: a View-side SDK for SPA MCP Apps.** Lets MCP App
  authors build single-page apps with internal routing instead of `sendMessage(ui/message)`, which
  pollutes the chat thread and triggers Claude's prompt-injection warning. Pattern shifts from
  `[click row] → sendMessage("show details X") → chat → warning → new card` to
  `[click row] → ctx.callTool("get_x") → ctx.navigate("detail") → same iframe`.

  Public API (`src/view/`): `createMcpApp({ info, root, views, initialView, … })` bootstraps the
  `ui/initialize` handshake via ext-apps `App`; `defineView({ onEnter?, render, onLeave? })`
  expresses view lifecycle; `AppContext { navigate, callTool, capabilities, state, app }` is passed
  to every hook (`callTool` capability-gated on `host.serverTools`); `AppHandle` exposes router
  controls and `dispose()`.

  Thin wrapper around the ext-apps `App` runtime class — fits the 1-iframe-per-app model perfectly.
  Memory-only routing (no URL / history API: iframes have no address bar). Router serialises
  concurrent `goto()` via promise queue to prevent `onLeave`/`onEnter` interleaving on
  double-clicks. `_currentView` is invalidated between `onLeave` and `onEnter` so a throwing
  `onEnter` cannot corrupt router state. Errors propagate: the router never swallows user-code
  exceptions.

  Non-goals for 0.5.0 (reachable via `ctx.app` escape hatch; first-class wrappers later):
  `sendMessage`, `updateModelContext`, `requestDisplayMode`, `openLink`, `downloadFile`.

  Example: `packages/compose/examples/view-basic/` — vanilla list+detail App bundled via esbuild
  into a self-contained ~490KB `index.html`. (No Vite: `import.meta.url` breaks under Vite SSR.)

  16 new view/ tests cover handshake, router, capabilities gate, concurrent navigation, dispose
  idempotence.

### Known issues

- Bundle weight dominated by `@modelcontextprotocol/sdk` + `zod` pulled transitively through
  ext-apps — not tree-shakeable. Acceptable for single-page MCP Apps; mitigation deferred.

## [0.4.1] - 2026-04-18

Spec-alignment release: stop redefining types that the official `@modelcontextprotocol/ext-apps`
spec already publishes. No behaviour changes.

### Changed

- **Consume `@modelcontextprotocol/ext-apps` types directly** — re-export `McpUiToolMeta`,
  `McpUiResourceMeta`, `McpUiResourceCsp`, `McpUiResourcePermissions` from ext-apps instead of
  redefining them locally. `McpUiCsp` / `McpUiPermissions` kept as `@deprecated` aliases for
  backwards compat. `McpToolResult` stays compose-local (loose structural subset).
  `LATEST_PROTOCOL_VERSION` now re-exported as `MCP_APPS_PROTOCOL_VERSION` from ext-apps so the
  protocol version advertised in `ui/initialize` follows the dependency automatically (was hardcoded
  `'2026-01-26'`).

  Why types-only: ext-apps `App`/`AppBridge` runtime classes target a 1-iframe-per-client model
  incompatible with compose's multi-iframe dashboard architecture. Types-only consumption keeps
  compose Deno-first and avoids pulling Node>=20 runtime deps.

## [0.4.0] - 2026-04-08

Cleanup release: removes dead code, fixes version drift, and tightens the MCP Apps host role compose
plays for embedded apps (stops advertising capabilities it doesn't implement, drops a legacy sync
path that was bending the spec). No new features.

### Removed

- **Dead code: `src/core/renderer/`** — the renderer was moved from `core/` to `host/` in an earlier
  refactor (the renderer generates HTML, which violates `core/`'s "no I/O" rule), but the old
  `core/renderer/` directory was left behind orphaned. The two `html-generator.ts` files had
  diverged and the two `renderer_test.ts` files were mirrored duplicates. Removed the core side
  entirely (contract.md, readme.md, mod.ts, html-generator.ts, renderer_test.ts, css/, js/). Zero
  loss of coverage — the 20 tests in the removed file were symmetric duplicates of the host side.

- **`hostContext.sharedContext` field in `ui/initialize` response** — write-only data. Verified by
  grep that nothing in the compose codebase (stubs, SDK, runtime event bus) reads
  `hostContext.sharedContext`; consumers extract `sharedContext` from the `ui/compose/event` message
  params instead. Also fixes a spec drift issue (`McpUiHostContext` in the official ext-apps spec
  doesn't define `sharedContext`, and injecting compose-specific data into an otherwise-standard
  shape could break embedded apps that use strict validators).

- **Legacy `ui/update-model-context` sync routing** — the handler was originally written before
  `ui/compose/event` existed, and it bent the spec by using `ui/update-model-context` (whose
  documented intent is "inject content into the LLM's context for the next turn") as a broadcast
  channel for cross-UI sync. The `composeEvents()` SDK from `@casys/mcp-compose/sdk` has been the
  documented migration path for a while. This release removes the legacy handler, the
  `sendToolResult` helper it depended on, and the `ui/notifications/tool-result` forwarding logic.
  Cross-UI sync now routes exclusively through `ui/compose/event`.

- **`hostCapabilities.openLinks`** — was advertised but no handler existed for `ui/open-link`
  requests. Embedded apps calling `app.openLink(url)` would have hung or errored silently. Removed
  from the advertised capabilities until a real handler is added.

- **`hostCapabilities.updateModelContext`** — same cleanup as above: advertised but the handler was
  routing the method as a sync broadcast rather than injecting into LLM context. Not its documented
  purpose.

### Fixed

- **`hostInfo.version` was hardcoded to `'0.1.0'`** in the `ui/initialize` response for the last two
  minor versions (package had been at 0.3.0 for a while). Embedded apps were being told they're
  talking to compose 0.1.0 regardless of the actual package version. Now reads from a new
  `COMPOSE_VERSION` constant in `src/version.ts`, kept in sync with `deno.json` by a drift test
  (`src/version_test.ts`) that fails CI if the two files disagree.

- **`scripts/build-npm.ts` hardcoded `version: "0.3.0"`** in the dnt build config — matched
  `deno.json` today but was guaranteed to drift on the next bump. Now reads from `deno.json` via
  `JSON.parse(
  readTextFile(...))` at build time and fails fast if the version is missing. Mirrors
  the same fix from `@casys/mcp-server`'s `scripts/build-node.sh` landed in server v0.14.0.

### Breaking changes

Two behaviors changed that may affect consumers on 0.3.x:

1. **`ui/update-model-context` no longer routes sync events.** Consumers who were using raw
   `ui/update-model-context` postMessage calls as a cross-UI broadcast channel (an undocumented
   bending of the spec) will now hit the event bus's "Unknown method" warning. **Migration:** use
   `composeEvents().emit(event, data)` from `@casys/mcp-compose/sdk` instead. Consumers who were
   already using `composeEvents()` are unaffected.

2. **`hostCapabilities.openLinks` and `updateModelContext` are no longer advertised on
   `ui/initialize`.** Consumers who were checking these capabilities via `hostCapabilities`
   introspection will see them absent. This is a correctness fix — neither was actually implemented,
   so any consumer relying on them was already broken in practice.
