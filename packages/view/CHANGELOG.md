# Changelog

All notable changes to `@mcpview/view` (published as `@casys/mcp-view` up to 0.9.5) will be
documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Experimental `@mcpview/view/context` keeps one acknowledged, bounded context basket per App, with
  serialized writes, root-generation fencing, explicit reconciliation groups and visible retry
  state. Policies choose the wire schema, limits and compact/reference/query projections, keeping
  domain data and tool ownership in the consuming App. Pointer previews expose desired selection
  immediately while the click arbiter delays host writes by 500 ms; a double-click within the window
  cancels the preview without a transport write. Per-item selection states distinguish confirmed,
  adding and removing feedback.
- The context example uses the existing App connection and illustrates the 3/8/query selection
  tiers. This implements a local library contract, not the production-host conformance or
  cross-iframe supersession acceptance gates of proposed ADR 0006.

### Changed

- **BREAKING:** Migrate to MCP SDK v2 and ext-apps 2.x. Node consumers require Node 20+. Import MCP
  types from `@modelcontextprotocol/client` and schemas from `@modelcontextprotocol/core` instead of
  SDK v1 subpaths. Custom handlers on the underlying `app` use the v2 method-name and
  request-context APIs; the iframe wire protocol remains compatible.
- **BREAKING:** View tool schemas require Standard JSON Schema support (`~standard.jsonSchema`),
  supplied by Zod 4.2+. Preserve loose argument records for tools without an explicit input schema.
- Accept any JSON value in tool-result `structuredContent`, while keeping `readStructuredContent()`
  and `readResultData()` record-only and preventing text fallback for present non-record data.

## [0.10.1] - 2026-10-18

### Added

- ADR 0006, the active-context contract: a view shares references with the model, never payloads,
  and a large selection becomes a query element with graduated selection tiers. Documentation only;
  the package code is unchanged from 0.10.0.

## [0.10.0] - 2026-10-17

### Changed

- Renamed from `@casys/mcp-view` to `@mcpview/view`. The whole family moves to the `@mcpview` scope
  on JSR and npm (repository `mcpview/mcpview`, site https://mcpview.dev, maintained by Casys). Same
  code and same API: only the dependency and import name change. Version numbers continue from
  0.9.5, and `@casys/mcp-view@0.10.0` stays published as a deprecated alias that re-exports this
  package, with the same `.`, `./contracts`, and `./react` entry points.
- Depends on `@mcpview/contracts@^0.2.0` (formerly `@casys/mcp-view-contracts`); the `./contracts`
  sub-path still re-exports it unchanged.
- Wire identifiers such as `io.casys.semantic-selection/1.0` are unchanged, so Apps and hosts built
  against earlier releases keep interoperating.
- See the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## [0.9.5] - 2026-09-18

### Fixed

- Update docs to the renamed `@casys/mcp-platform` framework. No code changes.

## [0.9.4] - 2026-09-18

### Fixed

- Update npm `repository` metadata to the renamed `Casys-AI/mcp-platform` repository. No code
  changes.

## [0.9.3] - 2026-09-04

### Changed

- The README describes the surface Apps of `@casys/mcp-view-components` 0.7.0 through their
  `viewerSession: { validate, toState }` pair. The `validateSession`/`mapSessionToData` pair it
  named is gone from 0.7.0. Documentation only; the runtime is the 0.9.2 one.
- The scaffold command in the README pins `@casys/mcp-view-components` 0.7.0, the version whose
  generated viewer it describes.

## [0.9.2] - 2026-08-31

### Changed

- Point the result-viewer scaffold and documentation at `@casys/mcp-view-components` 0.2.1, which
  adds the v2 typography roles used by the compact provider viewers.

## [0.9.1] - 2026-08-31

### Changed

- Point the documented result-viewer scaffold at the released `@casys/mcp-view-components` 0.2.0
  component kit.

## [0.9.0] - 2026-08-31

### Changed

- Keep the core package renderer-neutral and move the optional component runtime, Preact
  presentation kit, theme, and scaffold to `@casys/mcp-view-components`.
- Move dependency-free viewer manifests and recorded-session contracts to
  `@casys/mcp-view-contracts`, while retaining the core `./contracts` compatibility export.
- Remove the former core `./preact`, `./preact/components`, and `./scaffold` exports so consumers
  that only need MCP App lifecycle and contracts do not install a UI framework.

## [0.8.0] - 2026-08-31

### Added

- Let component descriptors advertise validated Compose event ports and provide a versioned
  semantic-selection contract structurally compatible with Digital Thread references. Standalone
  Apps remain unchanged, while compatible hosts can connect active viewers without MCP-specific
  whiteboard code or inferred cross-domain mappings.
- Add the DOM-free `@casys/mcp-view/contracts` entry point so one versioned set of event names and
  payload validators can be reused by server-side tool metadata and the browser viewer.

### Changed

- Update generated result-viewer projects and current usage examples to pin `@casys/mcp-view`
  `0.8.0`.

## [0.7.1] - 2026-08-01

### Added

- Add `@casys/mcp-view/preact/components`, a presentation-only Preact entry point for native
  applications. It exports the shared component kit and theme without importing the MCP Apps
  lifecycle, iframe transport, surface registry, or postMessage bridge. The existing
  `@casys/mcp-view/preact` entry remains compatible.

## [0.7.0] - 2026-08-01

### Added

- Add a real shared Preact presentation kit under `@casys/mcp-view/preact`: `Card`, `Badge`,
  `MetricGrid`, `KeyValueList`, `DataTable`, `Button`, `Toolbar`, `EmptyState`, and `StateMessage`.
  Domain Apps now import the same accessible components instead of maintaining parallel card,
  metric, table, and state implementations.
- Publish the Preact entry point, component sources, and linked guidance in the JSR artifact;
  exercise npm subpath exports in the package smoke test and ship README, license, and changelog in
  the npm tarball together with the documentation linked from that README.
- Gate releases on Deno's real publish dry-run so missing entry points and slow public types fail
  locally before the JSR workflow runs.

### Changed

- Generalize `definePreactComponent()` over the owning App context. Existing result-driven Preact
  Apps keep their inferred context, while established MCP viewers can adopt the presentation kit
  without replacing their navigation, tool calls, or domain state.
- Restrict table hover and pointer behavior to explicitly interactive rows, and add semantic badge
  tones, keyboard-safe and nested-control-safe table selection, visible focus treatment, compact
  toolbars, and responsive provenance facts.

## [0.6.0] - 2026-08-01

### Added

- Add renderer-neutral structured-result helpers, deterministic teardown, pre-connect tool-result
  lifecycle wiring, small reusable component registries/surfaces, and the optional Compose event
  channel.
- Add safe status, metric-grid, key-value, and custom-component factories. A standalone viewer and a
  composed dashboard now mount the same component definitions.
- Add the optional `@casys/mcp-view/react` adapter while keeping React and ReactDOM as optional npm
  peers and preserving direct Preact/ext-apps consumers.
- Add the optional `@casys/mcp-view/preact` component-surface adapter and keep Preact as an optional
  peer.
- Add the shared ERPNext-derived component theme with stable tokens and classes for cards, metrics,
  badges, tables, selection, cross-view state, and compact container layouts.

### Changed

- Prepare `0.6.0` for the Preact component-surface runtime and shared design language; generated
  scaffolds now pin that version. Remove the unpublished semantic-projection experiment.
- Permit component-only registries without `defaultSurface`; such Apps now report an explicit
  `surface-required` state until a host supplies a composition.

## [0.4.1] - 2026-07-31

### Fixed

- Preserve literal JavaScript and CSS replacement tokens while producing an inline viewer bundle.
  Both the `result-viewer` scaffold and the basic example now use replacement callbacks, so valid
  source containing the dollar-ampersand, dollar-backtick, or dollar-apostrophe replacement tokens
  cannot be interpreted as `String.prototype.replace()` replacement syntax and corrupt the generated
  HTML.
- Generated scaffold projects explicitly exempt their own freshly-published `@casys/mcp-view`
  dependency from Deno's minimum dependency age, while retaining the one-day protection for every
  other dependency.

## [0.4.0] - 2026-07-31

### Added

- **`@casys/mcp-view/scaffold`** — executable vanilla `result-viewer` starter:
  `deno run -A jsr:@casys/mcp-view@0.4.0/scaffold result-viewer <target>`. It emits an autonomous
  browser view with a build path, focused parser/render test, loading/empty/error states, generic
  metrics and URI-based artifacts, host-aware accessible CSS, and no product/domain branding. The
  generated bootstrap configures `onToolResult` before `createMcpApp()` connects, preserving the
  initial tool result through the MCP Apps handshake.

- The scaffold refuses a non-empty target by default and offers `--force` for intentional
  replacement of scaffold files without deleting unrelated target files. Its temporary-directory
  tests cover generation, lifecycle source shape, host-aware CSS, refusal, and explicit force.

- Add npm packaging for `@casys/mcp-view` via `scripts/build-npm.ts` and the repository publish
  workflow. The package now follows the same JSR + npm publishing path as the other workspace
  members.

- **Host tool-notification lifecycle callbacks.** `AppConfig` now accepts `onToolInput`,
  `onToolInputPartial`, and `onToolResult`. `createMcpApp` installs the ext-apps one-shot handlers
  before `connect()`, buffers host notifications until the initial route and `AppHandle` exist, then
  replays them in FIFO order. Async callbacks are serialized; a callback failure is logged without
  preventing later notifications from being delivered.

### Changed

- Bump `@casys/mcp-view` to 0.4.0 and publish the `./scaffold` JSR subpath.

## [0.3.0] - 2026-05-09

Wraps the four interesting additions of `@modelcontextprotocol/ext-apps` 1.7.0 as first-class
`@casys/mcp-view` API. All changes are strictly additive — existing 0.2.x code keeps working
unchanged. Bump is minor to surface the new public surface.

### Added

- **`ctx.sample(args): Promise<SampleResult>`** — wraps `App.createSamplingMessage`. Lets a View ask
  the host to run an LLM inference on its behalf (auto-titles, summaries, suggestions, …) without
  round-tripping through a server-side tool. Capability-gated on `host.capabilities.sampling`;
  throws `MCPViewError("MISSING_SAMPLING_CAPABILITY")` otherwise. `SampleArgs` is a discriminated
  union: `{ prompt }` (sugar — single user message) | `{ messages }` (explicit multi-turn). Common
  fields: `systemPrompt`, `maxTokens` (default `1024`), `temperature`, `modelPreferences`,
  `stopSequences`, `metadata`. Result exposes `text` (concatenation of every `type: "text"` block in
  the response — empty for multimodal/tool-use), `stopReason`, `model`, and `raw` (the full ext-apps
  response for callers that need fidelity).

- **`defineView({ tools })` + `ctx.tools`** — wraps `App.registerTool`. Lets a View expose tools
  that the host (and its agent) can discover and call, inverting the usual MCP flow. Two layers:

  1. **Declarative on `defineView({ tools })`** — tools are auto-registered after `onEnter` and
     removed before the next view's `onEnter`, so each view sees only its own tools while mounted.
  2. **Imperative on `ctx.tools`** — `enable(name)`, `disable(name)`,
     `update(name, { title?, description?, annotations? })`, `remove(name)`. Use this for runtime
     availability ("save when dirty"); flipping `enabled` is cheaper than recreating the view.

  Schema surface is `StandardSchemaV1` (Zod v4, Valibot, ArkType). `update` deliberately does not
  accept schema changes — swap by removing and re-registering on the next view.

  `createMcpApp` auto-advertises `tools.listChanged: true` on the App capabilities when at least one
  view declares tools, merging with any user-supplied capabilities. Without this, ext-apps refuses
  `registerTool` calls.

  Notifications: ext-apps' own `RegisteredAppTool.{enable,disable,update,remove}` and `registerTool`
  each emit `tools/list_changed` internally (gated on the advertised `tools.listChanged`
  capability). The wrapper does not add an extra batched notification on top, so the wire chatter
  matches what ext-apps already produces. `dispose()` calls `unregisterAll()` so a caller that
  reuses the underlying `App` after dispose doesn't see stale view-side tools advertised.

- **`AppConfig.strict?: boolean`** — forwarded to ext-apps `AppOptions.strict`. Throws on detected
  misuse (host-bound methods called before `connect()`, one-shot handlers registered after
  `connect()`) instead of `console.warn`. Default: `false`. Recommended `true` in dev.

- **`AppConfig.allowUnsafeEval?: boolean`** — forwarded to ext-apps `AppOptions.allowUnsafeEval`.
  Default: `false` (strict CSP via `z.config({ jitless: true })`). Set `true` only when the host's
  CSP permits `unsafe-eval` and the JIT path is required.

- **`AppConfig.autoResize?: boolean`** — forwarded to ext-apps `AppOptions.autoResize`. Toggles the
  `ResizeObserver` that reports iframe size changes. Ext-apps default is `true`; set `false` for
  fixed-aspect-ratio embeds.

  When _no_ option is set, `createMcpApp` calls the ext-apps `App` constructor without a third arg
  so ext-apps' own default-parameter assignment runs in full. When _at least one_ option is set, the
  wrapper mirrors ext-apps' defaults for the unset fields — partial opt-ins (e.g. only
  `strict: true`) don't accidentally drop `autoResize`'s default-true behaviour, which would happen
  if we naively passed `{ strict: true }` because ext-apps 1.7.1's constructor uses a
  default-parameter assignment, not a per-field merge.

### Added (errors)

- `MCPViewError` taxonomy gains three codes: `MISSING_SAMPLING_CAPABILITY`, `INVALID_SAMPLE_ARGS`,
  `UNKNOWN_TOOL`. All follow the existing closed-taxonomy contract (stable `.code`, structured
  `.data`).

### Tests

- 21 new tests across `sample_test.ts` (8) and `tools_test.ts` (12) plus one compile-time smoke test
  for the new `AppConfig` options. Total now 51 (up from 30).

## [0.2.1] - 2026-05-09

Maintenance release: align with upstream `@modelcontextprotocol/ext-apps` 1.7.x.

### Changed

- **Bump `@modelcontextprotocol/ext-apps` `^1.6.0` → `^1.7.1`.** Picks up `App.registerTool()` /
  `sendToolListChanged()` (View-side WebMCP-style tool exposure), `App.createSamplingMessage()`
  (sampling support via stock SDK types), and handshake-ordering guards (warn-or-throw via
  `AppOptions.strict`).

- **Default behaviour change inherited from ext-apps 1.7.0: `allowUnsafeEval: false`.** The ext-apps
  `App` constructor now sets `z.config({ jitless: true })` by default so Views run under strict CSP
  without `unsafe-eval`. `@casys/mcp-view` wraps the runtime `App` class, so this default propagates
  to consumers. Authors who need the JIT path (e.g. for hot loops using libraries that compile
  expressions at runtime) can pass `{ allowUnsafeEval: true }` through to `App` — but the
  recommended posture is to keep the default and let strict CSP catch unsafe code paths.

### Notes

- Transitive: `zod` `4.3.6` → `4.4.3` in `deno.lock`. Single zod family preserved.

## [0.2.0] - 2026-04-18

AX (Agent Experience) compliance pass — three violations fixed against the 8 AX principles.

### Added

- **AX #3 — Machine-readable errors.** New `MCPViewError` class (`src/errors.ts`) with a stable
  `.code` from a closed taxonomy: `INVALID_CONFIG_ROOT`, `INVALID_CONFIG_VIEWS`,
  `INVALID_CONFIG_INITIAL_VIEW`, `ORPHAN_INITIAL_VIEW`, `MISSING_RENDER`,
  `MISSING_SERVER_TOOLS_CAPABILITY`, `HANDSHAKE_NO_CAPABILITIES`, `NO_PARENT_WINDOW`,
  `UNKNOWN_VIEW`, `ROUTER_NOT_INITIALIZED`. `.data` carries structured context (e.g.
  `{ initialView, registered }`) agents can parse without scraping the message.

- **AX #4 — Explicit over implicit.** `AppConfig` gains `autoTheme?: boolean` (default `true`).
  Previously the theme/CSS/font auto-apply was silent and opt-out required bypassing `createMcpApp`
  entirely. The default is now visible in the signature and documented. `ctx.hostContext` stays live
  either way — only the side-effects (`applyDocumentTheme`, `applyHostStyleVariables`,
  `applyHostFonts`) are gated by the flag.

- **AX #8 — Test-first invariants.** 10 new tests (5 in `errors_test.ts` covering the `MCPViewError`
  surface — `.code`, `.data` frozen, `instanceof Error`, factory; 5 in `app_test.ts` asserting each
  error path produces the expected `.code`).

### Removed

- **Breaking — `MissingServerToolsCapabilityError` class.** Replaced by `MCPViewError` with
  `code: "MISSING_SERVER_TOOLS_CAPABILITY"`. 0.1.x was too fresh for external consumers, so the
  break is judged acceptable.

## [0.1.1] - 2026-04-18

### Added

- **Auto-apply host theme + CSS variables + fonts** after the `ui/initialize` handshake. Strictly
  additive — no new public surface, only an automatic side-effect inside `createMcpApp`:
  1. Snapshot `app.getHostContext()` (theme, styles, locale, timezone, displayMode, toolInfo, …).
  2. Apply via ext-apps helpers: `applyDocumentTheme(ctx.theme)`,
     `applyHostStyleVariables(ctx.styles.variables)`, `applyHostFonts(ctx.styles.css.fonts)`.
  3. Listen for `ui/notifications/host-context-changed` via `addEventListener` (not
     `onhostcontextchanged`, so user handlers on `ctx.app.onhostcontextchanged` are preserved) and
     re-apply partial updates.
  4. Unwire the listener on `dispose()` so the `App` instance can be safely reused.

  Quick win identified in ADR 0002 §1.

- **`AppContext.hostContext: McpUiHostContext` getter** — live reference that updates on
  host-context-changed. Handy for reading non-styling fields like `locale`, `timezone`,
  `displayMode` without going through `ctx.app`.

### Fixed

- **Add `LICENSE` file and `license` field to `deno.json`** so JSR publish stops complaining.

## [0.1.0] - 2026-04-18

Initial release as a dedicated workspace package, split out of `@casys/mcp-compose/view` (compose
0.5.0).

### Why split

The View-side SDK initially shipped inside `@casys/mcp-compose` did not pass JSR publish: JSR
rejected the `/// <reference lib="dom" />` directives the sources used to make `HTMLElement` /
`Node` resolve. Two alternatives were considered and rejected:

- Adding `lib: ["dom"]` to compose/deno.json — gives `host/`, `runtime/`, `deploy/` modules access
  to DOM globals, inviting `document.getElementById` bugs that crash under Deno Deploy.
- Local DOM-type shims under `view/` — signals "misfiled code".

Chosen: promote `view/` to a dedicated workspace member. Package topology now mirrors runtime
reality — 3 server packages + 1 browser package:

```
@casys/mcp-server   (server)
@casys/mcp-compose  (server, multi-iframe host + composition)
@casys/mcp-view     (browser, single-iframe SPA SDK)  ← this package
@casys/mcp-bridge   (server)
```

### Public API (frozen surface inherited from compose 0.5.0)

- `createMcpApp({ info, root, views, initialView, … })` — bootstrap + `ui/initialize` handshake via
  the ext-apps `App` class.
- `defineView({ onEnter?, render, onLeave? })` — view lifecycle contract.
- `AppContext { navigate, callTool, capabilities, state, app }` — passed to every hook. `callTool`
  is capability-gated on `host.serverTools`.
- `AppHandle { ctx, currentView, navigate, dispose }`.

### Guarantees

- Memory-only routing (no URL / history API — iframes have no address bar).
- Router serialises concurrent `goto()` via promise queue (prevents `onLeave`/`onEnter` interleaving
  on double-clicks).
- `_currentView` invalidated between `onLeave` and `onEnter` so a throwing `onEnter` cannot corrupt
  router state.
- `dispose()` drains the navigation queue before closing transport.
- Errors propagate: the router never swallows user-code exceptions.
