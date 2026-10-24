# Changelog

All notable changes to `@mcpview/components` (published as `@casys/mcp-view-components` up to 0.9.2)
will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING:** Node consumers now require Node.js 20 or newer, following the SDK v2 and MCP Apps v2
  runtime used by `@mcpview/view`. Result-viewer scaffolds now bundle
  `@modelcontextprotocol/ext-apps@^2.0.3`, the split SDK packages
  `@modelcontextprotocol/client@^2.3.1` and `@modelcontextprotocol/core@^2.3.1`, and Zod 4.2 or
  newer. Custom scaffold import maps must replace the former `@modelcontextprotocol/sdk` entries
  with those split package imports.

## [0.11.0] - 2026-10-18

### Changed

- The result-viewer scaffold pins `@mcpview/view@0.10.1` and `@mcpview/components@0.11.0`.

- **`IntervalPlot` shared columns** — labels, interval tracks, and readings align across rows,
  including at narrow widths, so each row uses the same plotting area.
- **`SeriesChart` evidence** — optional `legend` (default `true`) shows caller-supplied series
  labels with line or square swatches when there are at least two series. Optional `yTicks` accepts
  finite positions within the inclusive y bounds and caller-formatted labels. Default visuals now
  include that multi-series legend, `8px` bars and a `10rem` plot; override the dimensions with
  `--mcp-view-series-chart-bar-width` and `--mcp-view-series-chart-height`. Series tones also accept
  `"accent"` and `"brand"` without extending other components' `PresentationTone`.
- **`Sparkline` block variant** — `variant="block"` displays the caller-supplied label and summary
  with a full-width, `2.5rem`-high plot. The default remains `variant="inline"`; both variants also
  accept the plot-specific `"accent"` and `"brand"` tones.
- Document whole-view composition with a `PathBar`, one card-density `SemanticElement`, and numeric
  evidence inside `ElementBody` or `ElementSection` to provide space at the surface frame.

## [0.10.0] - 2026-10-17

### Changed

- Renamed from `@casys/mcp-view-components` to `@mcpview/components`. The whole family moves to the
  `@mcpview` scope on JSR and npm (repository `mcpview/mcpview`, site https://mcpview.dev,
  maintained by Casys). Same code and same API: only the dependency and import name change. Version
  numbers continue from 0.9.2, and `@casys/mcp-view-components@0.10.0` stays published as a
  deprecated alias with the same entry points (`.`, `./preact`, `./preact/components`, `./scaffold`,
  `./surface`, `./layout`, `./fonts`).
- Depends on `@mcpview/view@^0.10.0` and `@mcpview/contracts@^0.2.0`. The result-viewer scaffold now
  generates projects that import `@mcpview/view` and `@mcpview/components`, pinned to the releases
  it was built against.
- Wire identifiers (`io.casys.mcp.view-components/v1`, `io.casys.mcp.surface/v1`) are unchanged.
- See the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## [0.9.2] - 2026-09-18

### Changed

- Track `@casys/mcp-view@0.9.5` in the packaged dependency range and generated-viewer pins. No code
  changes.

## [0.9.1] - 2026-09-18

### Fixed

- Update npm `repository` metadata to the renamed `Casys-AI/mcp-platform` repository. No code
  changes.

## [0.9.0] - 2026-09-05

### Added

- Re-export the `SurfaceLabel` type from `/preact` so viewer adapters do not need a local alias.
- `error` and `notice` `title`/`message` accept `SurfaceLabel` callbacks, resolved on each visible
  status render so a provider interface dictionary can follow a host locale change without
  re-running result or session projection I/O. Literal strings and `code` stay unchanged.
- `createTranslator` selectors expose `.locale(hostLocale?)`, returning the dictionary actually
  selected (exact registered locale, matched language parent, or canonical default).
- Optional `documentLanguage` on `startSurfaceApp` sets `document.documentElement.lang` at boot and
  on host locale changes. Pass `messages.locale`; omit the option to leave the document language
  untouched. Independent of remount policy.

### Fixed

- `themeUpdates: "in-place"` compares non-theme host-context fields structurally, so a host that
  resends a complete JSON snapshot with new object identities but the same values no longer remounts
  (and no longer resets a CAD camera). Only `theme` is exempted; locale, dimensions, surface
  selection, styles and other fields still remount when their values change. Default remount
  behavior is unchanged.
- Thrown tool-result and viewer-session projections keep an internal rejection-title key and
  retranslate `Result rejected` / `Session rejected` when the host locale changes. Provider-supplied
  titles, messages and codes stay literal.

## [0.8.0] - 2026-09-05

### Added

- `FocusedView` makes one visualization the primary surface and keeps technical details in a closed
  disclosure. Critical status remains outside it. `Disclosure` provides native keyboard semantics
  and both use the existing light/dark tokens without adding window shadows.
- Renderer-neutral `createTranslator` supports typed, contributable message dictionaries, exact
  locale and language fallbacks, and plain-text interpolation. Shared interface messages ship in
  English and French; providers retain ownership of their wording and all domain data.
- Surface Apps translate their generic states using the host locale, including visible loading and
  empty states after a locale change. Label callbacks and the `messages` option accept provider
  customizations; projection helpers receive the presentation locale without changing validation.
- Opt-in `themeUpdates: "in-place"` preserves mounted renderers that already follow theme tokens. It
  skips only theme-only remounts; locale, dimensions and surface selection still use the normal
  lifecycle. Existing Apps keep their default remount behavior.

### Fixed

- The result-viewer scaffold keeps numeric values unformatted until rendering and uses the host
  locale for readings and artifact sizes instead of forcing English formatting.

## [0.7.1] - 2026-09-04

### Fixed

- **`useCoarsePointer` reads `matchMedia` synchronously before the first paint.** The hook started
  at `false` and corrected itself in `useEffect`, so a narrow phone without host
  `deviceCapabilities` first painted `panel` (stacked rows) and then `mobile` (touch table) — two
  structures, not two densities. Ported from mcp-erpnext's first-paint fix so a viewer importing
  `/layout` does not regress.
- **`useContainerWidth` measures the content box in `useLayoutEffect` before the paint.** A
  `ResizeObserver` entry arrives after paint and `isNarrow(null)` is false, so a narrow container
  flashed `wide` for one frame; `getBoundingClientRect` also includes the shell's 1px borders and
  would flash the other way when the observer corrected it. The initial read now matches
  `contentRect` (clientWidth minus paddings). Ported from mcp-erpnext so a viewer importing
  `/layout` does not regress.

## [0.7.0] - 2026-09-04

### Added

- `startSurfaceApp()`/`startPreactSurfaceApp()` take `surfaceFor(data)`: a returned surface composes
  that result as is, consulting neither the host selection nor the registry default, so a recorded
  session that replaces the whole read model can compose itself; `undefined` keeps the host flow. A
  malformed owned surface stays on the route as `Surface invalid` and names its owner.
- `onTeardown` on the same options: runs once when the host tears the App down or `dispose()` runs,
  before the surface is disposed, for what the App holds outside its surface (a bridge to the parent
  page); a throw is absorbed through `onError`.
- The result-viewer scaffold pins `@casys/mcp-view` 0.9.3.
- A complete `tool-input` notification returns the App to `loading` like a partial one does: a host
  that does not stream arguments sends only the complete form, and the previous result was staying
  on screen until the new one arrived.

- **`@casys/mcp-view-components/layout`** entry (`layout.ts`) — the responsive viewer layout ERPNext
  proved in production, extracted with no App lifecycle: the entry takes the host context as a value
  (`LayoutHostHints`, structurally satisfied by `McpViewHostContext`) and a module graph test pins
  that it reaches Preact and neither `@modelcontextprotocol/ext-apps`, `@casys/mcp-view`'s App, nor
  `/surface`.
  - Pure decision — `resolveViewerLayout({ width, touch, forced })` returns one of three treatments,
    `"wide" | "panel" | "mobile"` (`VIEWER_LAYOUTS`): two contexts under one `NARROW_BREAKPOINT`
    (480px), not a width scale. Under the breakpoint a finger without hover picks `mobile`, anything
    else `panel`; an unknown width (`null`, unmeasured) reads as wide.
    `layoutWidth(hints, measured)` prefers the host's declared `containerDimensions.width`, then
    `maxWidth`, then the measured width. One deliberate delta from ERPNext: a declared width that is
    not a positive finite number is no declaration at all and falls through (ERPNext read `width: 0`
    as a narrow width), the same guard `viewerBoundsStyle` already applied to heights.
    `touchInput(hints, coarse)` follows the host's `deviceCapabilities` (`touch && hover !== true`)
    and only falls back to the browser's coarse-pointer query when the host says nothing.
    `layoutFromSearch(search)` reads `?layout=` for reviewing a treatment without the matching
    device. `viewerBoundsStyle` bounds a root on the host's declared `height`, else `maxHeight`,
    else not at all.
  - Preact hooks — `useContainerWidth()` (a `ResizeObserver` on the ref'd element, `null` until
    measured), `useCoarsePointer()` (`matchMedia("(pointer: coarse)")` with change tracking) and
    `useViewerLayout(hints, { forced? })`, which composes them into
    `{ ref, width, layout, boundsStyle }`. When `forced` is omitted the page query string is
    consulted; pass `null` to ignore the URL.
  - Published on npm as `./layout` (`esm/layout.js`, `script/layout.js`, `layout.d.ts`).

### Removed

- `validateSession`, `mapSessionToData` and `onInvalidSession` on `startPreactSurfaceApp`,
  deprecated in 0.6.0: `viewerSession: { validate, toState, onInvalid }` is the one form. With them
  go the `SURFACE_APP_SESSION_CONFLICT` and `SURFACE_APP_SESSION_INCOMPLETE` codes of
  `SurfaceAppError`, which only that pair could raise. Passing one of the old options is now a type
  error.

## [0.6.0] - 2026-09-02

### Added

- **`ElementSection`** — one titled group inside an `ElementBody` (`.mcp-view-element-section`, a
  `role="group"` named by `aria-label` like `SemanticList`, never a landmark; mono uppercase title).
  A datasheet body is sections, not one list: each fact belongs to exactly one, and the section
  names what its facts are.
- **`KeyValueList` `layout`** — `"inspector"` (default, unchanged: mono key, value flush right,
  hairline between rows) or `"facts"` (`data-layout="facts"`: one aligned label column, each value
  read right after its label, no hairlines). Existing callers render exactly as before.

- **`@casys/mcp-view-components/surface`** entry (`surface.ts`) — owns the MCP Apps runtime. The
  package root stays renderer-neutral and reaches `@casys/mcp-view` only through a type edge; a
  module graph test (`entries_test.ts`) pins that `@modelcontextprotocol/ext-apps` and the App
  lifecycle are absent from the root and present in `/surface`.
- **`startSurfaceApp`** (`/surface`) — the renderer-neutral result-driven App lifecycle every
  consumer viewer had rewritten by hand: projection and session subscription registered before
  connect, loading status as the initial view, one `fromToolResult` projection per tool result (sync
  or async, with `host.readServerResource`), `SurfaceDisplayState` (`loading` / `empty` / `error` /
  `notice` / `result`), host-selected or default surface, host context re-applied on every
  `hostcontextchanged` including the ones replayed from the handshake, remount only while a result
  is displayed and the context object moved, overtaken-mount guard, a navigation chain so a remount
  never reads the router mid-transition, `"Surface required"` for component-only registries without
  a host surface, a throwing projection turned into a `Result rejected` error status, and a failed
  mount or malformed host selection kept on the surface route as `Surface failed` /
  `Surface invalid` instead of a blank page. Statuses are rendered by the caller's
  `renderStatus(status)`; `SurfaceStatus` carries `kind`, `title`, `message`, `tone`, `busy` and the
  caller's optional `code`. Returns a `SurfaceAppHandle` (`show`, `dispose`). Accepts an optional
  `SurfaceAppRuntime` seam so the lifecycle is testable without ext-apps.
- **`SurfaceAppError`** (`/surface`, `/preact`) — a `TypeError` with a stable `code`
  (`SURFACE_APP_PROJECTION_CONFLICT`, `SURFACE_APP_SESSION_CONFLICT`,
  `SURFACE_APP_SESSION_INCOMPLETE`) and a frozen `data.recovery`, thrown for option conflicts;
  `SurfaceAppHandle.show()` after a teardown rejects with `SURFACE_APP_CLOSED`.
- **`viewerSession`** option (`SurfaceViewerSession`: `validate`, `toState`, `onInvalid`) on both
  `startSurfaceApp` and `startPreactSurfaceApp`, projecting a recorded session into the same
  `SurfaceDisplayState` as a tool result.
- **`.mcp-view-surface-shell`** theme class — the default host element of `startSurfaceApp`, styled
  as `.mcp-view-preact-surface`, which the Preact facade keeps as its own default.
- **`@casys/mcp-view-components/fonts`** entry (`fonts.ts`) — `installMcpViewFonts()` installs the
  three variable faces the theme names first (`Space Grotesk` 500–600, `Work Sans` 400–500,
  `JetBrains Mono` 400–600; latin subset, base64 woff2, ~137 KB) once per document, next to
  `installMcpViewTheme()`, so a viewer renders the same inside a host iframe with no network or a
  strict CSP. `MCP_VIEW_FONTS_CSS`, `MCP_VIEW_FONTS_STYLE_ID` and `MCP_VIEW_FONT_FAMILIES` are
  exported; `src/fonts-data.ts` is generated by `deno task fonts:fetch` and drift-checked by
  `deno task fonts:check`. Opt-in: the package root and the theme stay font-free
  (`src/fonts_test.ts` pins that no `@font-face` reaches `MCP_VIEW_THEME_CSS`). The npm build emits
  `./fonts` and the publish smoke imports it in ESM and CJS.
- **Theme tokens** — `--mcp-view-text-secondary`, `-ghost`, `-border-soft`, `-border-strong`,
  `-hover`, `-track`, `-accent-text`, `-brand-text`, `-warning-text`, `-radius-control`, the twelve
  `--mcp-view-size-*` steps (`micro` 10px → `metric` 22px) and the five `--mcp-view-tracking-*`
  values, all mirrored in `MCP_VIEW_THEME_TOKENS`.
- **`.mcp-view-element-readings`** (`data-element-slot="readings"`) — `SemanticElement` wraps its
  reading and limit slots in one strip. `display: contents` in chip and row density, so those
  layouts are unchanged; card density lays the strip out as hairline tiles.
- **Scaffold**: the generated `src/main.ts` imports `startSurfaceApp` from
  `@casys/mcp-view-components/surface` and hands it a `fromToolResult` projection whose closure
  keeps the last recorded result under a dated failure banner; `src/render.ts` gains `renderStatus`
  (`data-kind`, escaped `data-tone`, `aria-busy` on busy notices) and `renderViewer`; `src/model.ts`
  replaces `DisplayState`/`shownResult` with `ViewerData`; numbers format in `en-US` so output does
  not depend on the host locale. No `createMcpApp` call is emitted any more. `build.ts` derives the
  `/surface` module from `MCP_VIEW_COMPONENTS_MODULE` (or takes
  `MCP_VIEW_COMPONENTS_SURFACE_MODULE`), and the generated project is fmt-clean.
- **Release plumbing**: `release.yml` and `scripts/release-tag.ts` know `view-components-v*` tags;
  `deno task changelog:draft` and `deno task release:tag` in the package; the npm publish smoke
  imports `/surface` in ESM and CJS and refuses a tarball that ships `src/testing/`.

### Changed

- The card-density readings strip wraps its tiles as a flex row (`flex: 1 1 9rem`) instead of an
  `auto-fit` grid: a last row with fewer tiles widens them rather than leaving hairline-coloured
  holes beside an orphan reading.
- **BREAKING —** `startPreactSurfaceApp` is now a facade over `startSurfaceApp`: statuses render
  through `renderStatusMessage` (titled `Loading` / `Empty` / `Error`, tones `info` / `neutral` /
  `danger`, `aria-busy` while loading) instead of bare `.mcp-view-message-<kind>` divs;
  `statusClassName` lands on that `StateMessage`; `renderStatus` replaces `renderMessage`; the
  function returns a `SurfaceAppHandle` instead of `void`; `TData` is no longer constrained to
  `ResultData`. The shell keeps the `mcp-view-preact-surface` class.
- `PreactSurfaceAppState` and `PreactSurfaceContext` are aliases of `SurfaceAppState` and
  `SurfaceAppContext`; `/preact` re-exports the `SurfaceAppErrorCode`, `SurfaceAppRuntime`,
  `SurfaceProjection`, `SurfaceStatusTone` and `SurfaceToolResult` types.
- `SurfaceMessageKind` gains `"notice"`; the console prefix of the default `onError` is
  `[mcp-view-components]` instead of `[mcp-view/preact]`.
- **Datasheet theme** — the shared CSS now follows the ERPNext viewer charter instead of nesting
  filled tiles inside bordered cards. `.mcp-view-surface` is the one frame a viewer shows: border,
  radius, panel background and a 2px accent→brand rule; stacked components are separated by a
  hairline (`.mcp-view-surface-stack > .mcp-view-component + .mcp-view-component`, inline-start
  variant for `row`), and a `Card` or card-density `SemanticElement` mounted directly under the
  surface drops its own border. `MetricGrid` and the card-density readings strip are hairline cells
  on a `--mcp-view-border-soft` ground; `KeyValueList` rows are inspector lines (mono key, right
  value, hairline between rows) instead of sunken blocks; `Badge`, ident markers and verdicts are
  chips; labels (`Metric`, `NoticeGroup`, table headers, reading/limit/verdict/provenance labels,
  card eyebrows) share one role: mono, 10px, uppercase, `0.1em` tracking, `--mcp-view-quiet`. Titles
  and large values use the heading face; prose the body face; keys, units, markers, verdicts,
  provenance and identifiers the mono face (`src/theme_test.ts` pins the exact selector list). Type
  reads from the px scale (`--mcp-view-size-*`, floor 10px) instead of `rem`, so a host that
  rescales `rem` cannot squash the datasheet; `InlineCode` keeps `max(10px, 0.92em)`. Values of
  existing tokens moved with the charter: `--mcp-view-muted` `#5c6b76` → `#5b6a74`,
  `--mcp-view-quiet` `#7b8894` → `#687781`, `--mcp-view-radius` `0.5rem` → `8px`,
  `--mcp-view-radius-sm` `0.25rem` → `4px`, `--mcp-view-gap` `0.65rem` → `10px`; the dark palette is
  the charter's (`#13161a` panel, `#e6ecf0` text, `--mcp-view-subtle` `#1d2329` → `#0f1215`,
  `--mcp-view-quiet` `#5d6a74` → `#74818b`). Two layout models changed with it: card-density
  `SemanticElement` is a wrapping flex row (ident, then full-width readings strip, body and
  provenance) instead of a two-column grid, so viewer CSS that positioned slots with `grid-column`
  is inert — delete it, the kit already stacks them; and `.mcp-view-row` is a hairline line, not a
  filled tile. No weight above 600 is used, because the embedded faces stop there. A `stack` surface
  now defaults to `gap: "none"` — the hairlines separate its components, a gap only pushes them
  apart — while `row` and `grid` keep `"md"`; a viewer that passes `gap: "sm"` explicitly should
  drop it. The 0.4.0 roles had never been rendered by a published viewer — every consumer was still
  on 0.2.0.

| 0.5.0                                       | 0.6.0                                                 |
| ------------------------------------------- | ----------------------------------------------------- |
| `renderMessage(message, kind)`              | `renderStatus(status)` with `status.kind` and `.tone` |
| `.mcp-view-message-<kind>` selectors        | `.mcp-view-state[data-tone]` (`StateMessage`)         |
| `await startPreactSurfaceApp(...)` → `void` | `const app = await …` → `SurfaceAppHandle`            |
| `validateSession` + `mapSessionToData`      | `viewerSession: { validate, toState }`                |
| `TData extends ResultData`                  | any `TData`                                           |

### Deprecated

- `validateSession`, `mapSessionToData` and `onInvalidSession` on `startPreactSurfaceApp`: use
  `viewerSession`. Mixing the two forms is refused. Removed in 0.7.0.

## [0.5.0] - 2026-09-01

### Added

- **`NoticeGroup`** (`NoticeGroupProps`) — gathers short notices under a single severity heading
  (`src/preact/components.tsx`). Renders nothing when `items` is empty and no `omittedLabel` is
  supplied, so the caller never has to guard the call site. Truncation is stated by the caller via
  `omittedLabel`: the group displays only the notices it was handed and never counts what it was not
  given. Accepts an optional `PresentationTone` (default `"neutral"`).

- **`renderStatusMessage`** — imperative bridge that renders a `StateMessage` into a real DOM node
  and returns it (`src/preact/components.tsx`). `defineView` must return a native element, so every
  viewer built on it previously wrote its own Preact-to-DOM bridge; those bridges drifted in tone,
  ARIA role, and class. Without `container` (`StatusMessageMount`) it returns the rendered
  `.mcp-view-state` element itself, so the node a caller mounts carries the class, the tone and the
  alert role — a bare wrapper would hand `defineView` a root that no viewer stylesheet and no
  assistive technology can see. `className` lands on that same node. With a `container` it renders
  inside the node the caller already owns and returns it. Lives in the pure presentation module
  (`preact/components` entry) and does not import `@casys/mcp-view`, so it is reachable from any
  entry that does not need the surface lifecycle.

## [0.4.0] - 2026-09-01

### Added

- **`Skeleton`** — frame-first loading placeholder (`src/preact/components.tsx`). Draws the
  structure of a recorded view before its values arrive so layout does not shift on load. Caller
  supplies an accessible `label` and an optional `lines` count (default three). Throws `RangeError`
  for non-positive `lines`.

- **`DrillHint`** — affordance for one available drill-down in direction `"in-view"` or
  `"to-model"`. Without `onActivate` the component renders plain text and no glyph, so a host that
  cannot follow a step never advertises an action that does not exist. `actionLabel` is required
  together with the callback and never accepted without it.

- **`TypeBadge`** — inline badge that names what kind of view one level is (`"list"`, `"chart"`, or
  `"record"`). The caller supplies all wording; the kit does not translate or invent labels.

- **`StaleBanner`** — marks surrounding values as recorded earlier without hiding or replacing them.
  Accepts a caller-formatted `message`, an optional `PresentationTone` (default `"warning"`), and an
  optional `action` callback. Promotes its ARIA role to `alert` when tone is `"danger"`.

- **`Slot3D`** — reserved area for a provider-owned 3D renderer. Without `children` the slot stays
  visibly reserved with a placeholder mark. The kit renders no geometry.

- **`TreeList`** — controlled hierarchy with caller-owned type wording and per-node coverage labels.
  Expansion (`expandedIds`) and selection (`selectedId`) are fully caller-managed; omit `onSelect`
  for a read-only tree. Node `coverageLabel` is displayed verbatim — the kit counts nothing.

- **Plots module** (`src/preact/plots.tsx`, new) — three pure numeric-evidence marks:

  - **`Sparkline`** — compact polyline for one recorded series, readable at chip and row density.
    Requires at least two finite samples already ordered by the caller.
  - **`SeriesChart`** — multi-series plot on a shared finite scale with an optional declared cursor
    readout. The chart never resamples, interpolates a missing point, formats a number, picks a
    unit, derives an extremum, or owns pointer state.
  - **`IntervalPlot`** — caller-declared deviation intervals laid out against a shared zero line.
    The scale must contain zero; every bound and label is caller-supplied.

- **`PathBarItem.detail`** — optional recorded state for a kept level, revealed only inside the
  collapsed disclosure.

- **`PATH_BAR_DEFAULT_MAX_VISIBLE`** — exported constant (`3`) for the default inline capacity of
  `PathBar`.

- New optional `PathBar` props: `maxVisible` (inline capacity before leading items collapse),
  `collapsedLabel` (accessible name of the collapsed disclosure), and `backLabel` (accessible name
  of the leading step-out control; renders a button only when the current item has a predecessor).

- **`SeriesChart.onScrub`** — optional `(x: number | undefined) => void` callback. Reports the
  pointer position on the shared x scale; `undefined` signals that the pointer has left the chart.
  The chart resolves no sample at that position. A series with no recorded point at the scrubbed x
  is absent from the accompanying `SeriesChartCursor.readouts` rather than filled with an
  interpolated or nearest-neighbour value: determining which recorded sample corresponds to a
  position — or that none does — remains the provider's decision, as only the provider knows its
  sampling strategy (a fixed-step series has a different notion of proximity than an adaptive trace
  whose step size varies with the signal).

- **`SeriesMark`** — exported string union `"line" | "bar"` that every `SeriesChartSeries` must now
  declare via the required `mark` field:

  - `"line"` draws a polyline through the samples. Using `"line"` is an assertion that the measured
    quantity existed between the recorded points — valid when the series is sampled densely enough
    that the intervals carry meaning.
  - `"bar"` draws one vertical mark per recorded sample. When the scale contains zero the bar is
    anchored on the baseline; otherwise it sits on the scale floor. `"bar"` makes no claim about the
    interval between samples.

  The chart never deduces the mark from sample spacing: the provider declares it because the
  provider knows its sampling strategy.

### Changed

- **BREAKING — `@casys/mcp-view-components/preact/components` no longer re-exports theme symbols.**
  `installMcpViewTheme`, `MCP_VIEW_THEME_CSS`, `MCP_VIEW_THEME_STYLE_ID`, `MCP_VIEW_THEME_TOKENS`,
  `McpViewThemeDocument`, `McpViewThemeToken`, and `McpViewThemeTokens` are removed from the
  `./preact/components` barrel and remain available from the package root
  `@casys/mcp-view-components` only.

  **Why:** the barrel unconditionally re-exported the theme sheet; `deno bundle` did not elide it.
  An entry importing only `Card` produced 53.8 KB; it produces 11.0 KB after this change. The theme
  is an explicit installation step (`installMcpViewTheme()`) and must cost an explicit import.

  **Migration:** move theme imports to the root entry point:

  ```ts
  // before
  import { installMcpViewTheme } from "@casys/mcp-view-components/preact/components";
  // after
  import { installMcpViewTheme } from "@casys/mcp-view-components";
  ```

  A test in `preact_components_test.ts` now asserts that the barrel has no module edge to
  `src/theme.ts`. No known consumer imported theme symbols from this barrel; the migration is
  mechanical.

- **BREAKING — `SeriesChartSeries.mark` is now required.** Every series must declare a `mark` field
  of type `SeriesMark` (`"line"` or `"bar"`). The field was absent before; adding it is the
  migration.

  **Migration:** add `mark: "line"` to restore the previous polyline rendering — but verify that a
  line is justified for that series before doing so. Connecting two samples is an assertion that the
  quantity existed between them; if the sampling is sparse or the intervals carry no meaning,
  `"bar"` is the correct mark.

- **BREAKING — `PathBar` return type is now `JSX.Element | null`.** A path with fewer than two items
  returns `null`: the first level has nothing to leave, so no navigation is rendered.

  **Migration — what callers must do:**

  1. **TypeScript strict mode.** Any site that assigned the return value to a `JSX.Element` variable
     or prop without `| null` now produces a type error. Widen the annotation or wrap the call:
     `{items.length > 1 && <PathBar … />}`.

  2. **Layout that relied on the `<nav>` being present for a single-item path.** The previous
     behaviour rendered a one-crumb bar that the browser included in flow (height, border, gap). A
     caller whose outer layout reserved that space unconditionally — via a fixed height, a flex gap,
     or a border that depended on the element existing — must now guard the surrounding container on
     the path length or use a `min-height` that stays consistent when the bar is absent.

  3. **Consumers upgrading from 0.1.x or 0.2.x.** This breaking change lands in the same upgrade
     that introduces several new minor features. Callers jumping multiple minors in one step should
     audit every `PathBar` call site in a single pass before shipping.

- `PathBar` validates `maxVisible` at call time and throws `RangeError` for non-positive or
  non-integer values, consistent with the existing item-id and `currentId` guards.
