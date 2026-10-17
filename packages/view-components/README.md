# @mcpview/components

Optional presentation runtime and light-first component kit for MCP Apps. It gives provider-owned
viewers a shared visual grammar without moving their data, semantics, or rendering authority into
the host.

The intended unit is a small recorded view: one run, artifact, requirement, metric, or other bounded
object. A provider may export several whole-view resources; it should not turn one viewer into a
dashboard that contains every provider capability. In a composed host such as the Digital Thread
Whiteboard, `chip`, `row`, and `card` densities project the same semantic object while the
whole-view App remains the exact viewer opened for that object.

## Install

```bash
# Deno (JSR)
deno add jsr:@mcpview/components

# Node (npm)
npm i @mcpview/components
```

## Package boundary

- `@mcpview/contracts` is dependency-free and owns serializable contracts.
- `@mcpview/view` owns the MCP App lifecycle and transport.
- `@mcpview/components` is optional. Apps that do not want the kit do not import it.
- Providers resolve references and validate values, units, limits, verdicts, and provenance. The
  components display those values and never infer them.
- The host composes and opens recorded views. It does not become a native CAD, Modelica, FEA, or
  SysML renderer.

The package root is renderer-neutral and carries no MCP Apps runtime: `@mcpview/view` and
`@modelcontextprotocol/ext-apps` are reached only through the `/surface` entry, which owns the App
lifecycle. The responsive layout decision and its hooks live in the `/layout` entry, which takes the
host context as a value and loads no App runtime. The embedded webfonts are reached only through the
`/fonts` entry. Preact is an optional peer and is loaded only through the Preact subpaths and
`/layout`, whose hooks are Preact:

```ts
import { defineComponentRegistry, installMcpViewTheme } from "@mcpview/components";
import {
  ArtifactRow,
  BadgeGroup,
  Card,
  CodeBlock,
  CollectionCard,
  DrillHint,
  ElementBody,
  ElementIdent,
  ElementLimit,
  ElementProvenance,
  ElementReading,
  InlineCode,
  IntervalPlot,
  LimitGauge,
  NoticeGroup,
  PathBar,
  renderStatusMessage,
  Row,
  SemanticElement,
  SemanticList,
  SeriesChart,
  Skeleton,
  Slot3D,
  Sparkline,
  StaleBanner,
  TextInput,
  TreeList,
  TypeBadge,
} from "@mcpview/components/preact";
```

## Presentation vocabulary

Primitives:

- `Card`, `Badge`, `BadgeGroup`, `Button`, `Toolbar`, `Stack`, `Row`, `TextInput`, `InlineCode`,
  `CodeBlock`, `Skeleton`
- `Metric`, `MetricGrid`, `KeyValueList`, `DataTable`
- `Message`, `StateMessage`, `EmptyState`, `CrossSelection`, `NoticeGroup`

Reusable structures:

- `PathBar` for local navigation inside one bounded view; a path of one item renders nothing. New
  optional props: `maxVisible` (inline capacity before leading items collapse; default three),
  `collapsedLabel` (accessible name of the collapsed disclosure), `backLabel` (leading step-out
  control), and `PathBarItem.detail` (recorded state of a kept level, revealed in the collapsed
  disclosure).
- `LimitGauge` for caller-supplied readings, bounds, labels, and tone
- `ArtifactRow` for immutable artifact identity and literal verification status
- `DrillHint` for one available drill-down, in direction `"in-view"` or `"to-model"`. Without a
  callback the hint degrades to plain text so a host that cannot follow it never advertises a step
  that does not exist.
- `TypeBadge` names what kind of view one level is (`"list"`, `"chart"`, or `"record"`); the caller
  supplies all wording.
- `StaleBanner` marks surrounding values as recorded earlier without hiding or replacing them. Tone
  defaults to `"warning"`; `"danger"` promotes the ARIA role to `alert`.
- `Slot3D` reserves a bounded area for a provider-owned renderer; without `children` the slot stays
  visibly reserved. The kit renders no geometry.
- `TreeList` for a controlled hierarchy with caller-owned type wording and coverage labels;
  expansion and selection state are fully caller-managed.

Numeric evidence:

- `Sparkline` for the compact shape of one recorded series, readable at chip and row density.
  Requires at least two finite samples already ordered by the caller.
- `SeriesChart` for a multi-series plot on a shared finite scale. Each series requires a `mark`
  field (`"line"` or `"bar"`): `"line"` connects samples with a polyline — an assertion that the
  quantity existed between them; `"bar"` draws each recorded sample as an isolated mark and claims
  nothing about the interval. The optional `onScrub` callback reports the pointer position on the
  shared x scale (`undefined` when the pointer leaves); a series with no recorded point at that
  position is absent from the readout rather than filled. The kit never interpolates, aligns to a
  nearest neighbour, draws a continuity it has not measured, or invents a value — the provider
  declares both the mark shape and which sample a position corresponds to.
- `IntervalPlot` for caller-declared deviation intervals laid out against a shared zero line. The
  scale must contain zero; every bound and label is caller-supplied.

Semantic composition:

- `SemanticElement` with `chip | row | card` density and kit-owned explicit selection
- `SemanticList` for a bounded, optionally scrollable group of row-density semantic objects
- `CollectionCard` composing `Card` and `SemanticList` into one outer-border collection
- required `ElementIdent`
- optional `ElementReading` or caller-declared `ElementLimit`, plus `ElementBody`, `ElementVerdict`,
  and `ElementProvenance`
- `ElementSection` for one titled group inside the body

`viewer` is deliberately not a `SemanticElement` density. It is the provider's whole-view App,
usually composed from one `card` plus an optional `PathBar`.

```tsx
<SemanticElement
  reference={{ domain: "cad", kind: "artifact", id: "bracket.step" }}
  density="card"
  tone="warning"
  ident={<ElementIdent marker="STEP" label="Bracket" detail="revision 4" />}
  reading={<ElementReading label="Minimum thickness" value="0.84" unit="mm" />}
  provenance={<ElementProvenance label="SHA-256" value={digest} />}
/>;
```

The semantic reference is structured but never dereferenced by the component. Likewise, `LimitGauge`
never derives whether a value passes a limit, and `ArtifactRow` never claims a digest was verified
unless the caller supplies that recorded status.

Use `ElementLimit` when the record contains only an authored bound. It displays the supplied
operator, value, and unit without inventing a measurement, range, satisfaction state, or verdict.

## System states

Three components express a view's readiness without hiding or fabricating content.

`Skeleton` is a frame-first loading placeholder: it draws the structure before values arrive so
layout does not shift on load. The caller supplies an accessible label and an optional line count
(default three).

`StaleBanner` keeps dated values visible while flagging that the snapshot is not current. The caller
formats the message, including the recorded instant. The banner never refetches or replaces a value
with a gap.

`DrillHint` without a callback degrades to plain text. A host that cannot follow a drill-down step
omits `onActivate`; the hint stays visible but renders no affordance. Providers declare every
available next step without advertising actions the host cannot execute.

`NoticeGroup` gathers short notices under a single severity heading. It renders nothing when there
are no items and no `omittedLabel`, so the caller never has to guard the call site. Truncation is
stated by the caller via `omittedLabel`: the group displays only the items it was handed and never
counts what it was not given.

## Imperative bridge

`renderStatusMessage(detail, options?)` renders a `StateMessage` into a real DOM node and returns
it. `defineView` must return a native element, so every viewer built on it previously wrote its own
Preact-to-DOM bridge; those bridges drifted in tone, ARIA role, and class. `renderStatusMessage` is
that bridge, made canonical. Without `container` it returns the rendered `.mcp-view-state` element,
so what you mount carries the class, the tone and the alert role; `className` lands on that same
node. Pass `container` to render into a node you already own, which is then what comes back. It
lives in the pure presentation module `@mcpview/components/preact/components` and does not import
`@mcpview/view`, so it is reachable from any entry that does not need the surface lifecycle.

Without `container` it returns the rendered `.mcp-view-state` element; with one it renders into the
node you passed and returns that.

## Viewer layout

`useViewerLayout(hints, options?)` (`/layout` entry) decides one of three treatments for one viewer
root — `"wide" | "panel" | "mobile"` — from the host's word first, the browser's measure as fallback
and an explicit override on top. The three treatments are two contexts under one breakpoint
(`NARROW_BREAKPOINT`, 480px), not a width scale: under it, a finger without hover picks `mobile`,
anything else `panel`; a tablet under a finger but with room keeps `wide`. The hook measures the
element you attach `ref` to, not the window, because an iframe's width says nothing about the
screen's; the host's declared `containerDimensions.width` (then `maxWidth`) outranks that measure
because it describes the room actually granted. `boundsStyle` bounds the root on the host's declared
`height` (else `maxHeight`) instead of `100vh`, and is `undefined` when the host declares none so
the viewer stays intrinsic and lets the host auto-resize.

```tsx
import { useViewerLayout } from "@mcpview/components/layout";

const Viewer = ({ data, context }: PreactSurfaceComponentProps<RunModel>) => {
  const { ref, layout, boundsStyle } = useViewerLayout<HTMLDivElement>(context.hostContext);
  return (
    <div ref={ref} data-layout={layout} style={boundsStyle}>
      {layout === "wide"
        ? <RunTable data={data} />
        : <RunRows data={data} touch={layout === "mobile"} />}
    </div>
  );
};
```

`hints` is any `{ deviceCapabilities?, containerDimensions? }` — the kit's `McpViewHostContext`
satisfies it structurally, so the entry never imports `@mcpview/view`. Touch follows the host's
`deviceCapabilities` (`touch && hover !== true`: a touch-screen laptop driven by a mouse is no
phone) and only falls back to `matchMedia("(pointer: coarse)")` when the host says nothing.
`?layout=mobile` in the page query string forces a treatment for reviewing it without the matching
device; pass `{ forced: null }` to ignore the URL, or `{ forced: "panel" }` to pin one. The decision
itself — `resolveViewerLayout`, `layoutWidth`, `touchInput`, `layoutFromSearch`, `viewerBoundsStyle`
— is exported pure, and the two measuring hooks, `useContainerWidth()` and `useCoarsePointer()`, are
exported on their own.

## Focused viewers and technical details

`FocusedView` keeps one primary visualization or reading prominent and puts optional technical
metadata behind a closed `Disclosure`. Its `status` slot stays outside that disclosure: warnings,
unavailable evidence and literal verification state remain visible. The existing surface supplies
the frame, so the preset adds no card, shadow or application chrome.

```tsx
import { FocusedView } from "@mcpview/components/preact/components";

<FocusedView
  label={labels.geometry}
  hostContext={context.hostContext}
  status={<StateMessage title={recorded.status}>{recorded.message}</StateMessage>}
  primary={<GeometryCanvas geometry={recorded.geometry} />}
  detailsLabel={labels.technicalDetails}
  details={<KeyValueList layout="facts" items={recorded.provenance} />}
/>;
```

The preset calls `useViewerLayout` with the host hints and applies its container ref, `data-layout`
and height bounds. At a narrow desktop width it uses `panel`; under a finger it uses `mobile` with a
larger disclosure target. Pass `layout` only to review a forced treatment. The primary remains
provider-owned; the preset never invents a preview, a status or an evidence value.

Use `Disclosure` on its own for an inline technical section: `label` is supplied by the caller,
`children` hold the detail, and optional `open` / `onToggle(open)` expose its native state. Native
`details` / `summary` provide keyboard behavior and expanded state. Omit `open` to start closed.
`FocusedView` requires a `detailsLabel` whenever it receives `details`; omit both to render no
technical control. Keep consequential state in `status` or `primary`.

## Theme

`installMcpViewTheme()` installs the shared CSS once. The defaults are light-first and include an
explicit dark mapping (`:root[data-theme="dark"]`, or `prefers-color-scheme` unless the host pins
`data-theme="light"`). The surface is the one frame a viewer shows — border, radius, panel and a 2px
accent→brand rule — and its stacked components are separated by hairlines, so a `stack` surface
defaults to `gap: "none"`. Inside, values sit in hairline cells rather than filled tiles.

Typography has three roles: the heading face for titles and large values, the body face for prose,
and the mono face for labels, keys, units, markers, verdicts, provenance and identifiers. Sizes come
from a px scale (`--mcp-view-size-micro` 10px … `--mcp-view-size-metric` 22px) so a host that
rescales `rem` cannot squash the datasheet. The preferred faces mirror the v2 reference
(`Space Grotesk`, `Work Sans`, `JetBrains Mono`) and fall back to native families; the theme itself
neither embeds fonts nor makes a network font request. Apps can override the stable variables
exported as `MCP_VIEW_THEME_TOKENS`:

```css
:root {
  --mcp-view-accent: #0d7c8a;
  --mcp-view-brand: #8a4fa3;
  --mcp-view-font-heading: "Space Grotesk", "Avenir Next", sans-serif;
  --mcp-view-font-body: "Work Sans", Avenir, sans-serif;
  --mcp-view-font-mono: "JetBrains Mono", "SFMono-Regular", monospace;
  --mcp-view-radius: 8px;
}
```

### Embedded fonts

A viewer bundled into one HTML file and opened inside a host iframe usually has neither network
access nor a CSP that allows font requests, so the preferred faces would silently fall back. The
`/fonts` entry embeds them (three variable faces, latin subset, ~137 KB of base64 woff2, SIL Open
Font License 1.1). It is opt-in: import it only from the viewer bundle that wants it.

```ts
import { installMcpViewTheme } from "@mcpview/components";
import { installMcpViewFonts } from "@mcpview/components/fonts";

installMcpViewFonts();
installMcpViewTheme();
```

`MCP_VIEW_FONT_FAMILIES` lists the families, their weight range and the theme role each serves. The
payload lives in `src/fonts-data.ts`, generated by `deno task fonts:fetch` and drift-checked by
`deno task fonts:check`.

## Surface App

`startSurfaceApp()` (`/surface` entry) runs the whole result-driven App lifecycle for a component
registry: it opens on a loading status, projects every tool result into one `SurfaceDisplayState`,
mounts the host-selected surface (or the registry default), remounts it when the host context
changes, guards overtaken mounts, and converts every failure into a status instead of a blank page.
A viewer supplies its registry, the projection and how a status is rendered; everything else —
`strict`, `theme`, the status labels, `onError`, `viewerSession` — has a documented default.

```ts
import { createTranslator } from "@mcpview/components";
import { startSurfaceApp } from "@mcpview/components/surface";

const messages = createTranslator({
  defaultLocale: "en",
  messages: {
    solvingTitle: "Solving",
    solvingMessage: "The run is still open.",
  },
  translations: {
    fr: {
      solvingTitle: "Résolution",
      solvingMessage: "L’exécution est encore ouverte.",
    },
  },
});

const app = await startSurfaceApp<RunModel>({
  root,
  info: { name: "Run viewer", version: "1.0.0" },
  registry,
  strict: true,
  documentLanguage: messages.locale,
  fromToolResult: async (result, host) => {
    if (result.isError) return { kind: "error", message: toolErrorMessage(result) };
    const model = parseRun(result.structuredContent);
    if (!model) return { kind: "empty" };
    if (model.pending) {
      return {
        kind: "notice",
        title: (locale) => messages(locale)("solvingTitle"),
        message: (locale) => messages(locale)("solvingMessage"),
        busy: true,
      };
    }
    return { kind: "result", result: model };
  },
  renderStatus: (status) => renderMyStatus(status),
});
```

The projection may return a promise and may read server resources through `host.readServerResource`.
Without a projection, `validate` (a type guard) is applied to `structuredContent` with a JSON-text
fallback; passing both is refused with `SURFACE_APP_PROJECTION_CONFLICT`.

Every non-result state reaches `renderStatus` as one `SurfaceStatus` — `kind`, `message`, `title?`,
`tone`, `busy` and the caller's optional `code`:

| `kind`             | When                                             | `tone`    | `busy`  |
| ------------------ | ------------------------------------------------ | --------- | ------- |
| `loading`          | before the first result, and on tool input       | `info`    | `true`  |
| `empty`            | `{ kind: "empty" }` or a rejected `validate`     | `neutral` | `false` |
| `error`            | `{ kind: "error" }`, a rejected session          | `danger`  | `false` |
| `notice`           | `{ kind: "notice" }`, defaults `neutral`/`false` | given     | given   |
| `surface-required` | component-only registry without a host selection | `warning` | `false` |

`code` is passed through from a `notice` or `error` state and never invented, so a viewer can key
its own recovery hints on it. A projection that throws becomes a `Result rejected` error status and
wipes the previous result; to keep the last good values under the failure, return a `result` that
carries it — the scaffold does exactly that. A mount that fails or a malformed host selection stays
on the surface route as `Surface failed` or `Surface invalid`, so a corrected selection can recover
in place. All three are reported to `onError` (default `console.error`) and the App keeps running.

`surfaceFor(data)` lets a result own its composition: a returned surface is mounted as is, with
neither the host selection nor the registry default consulted, so a recorded session that replaces
the whole read model composes itself while live results keep following the host. `undefined` keeps
the host flow. It is asked on every mount of that result, remounts included; a malformed owned
surface stays on the route as `Surface invalid` and names its owner. `onTeardown` runs once when the
host tears the App down or `dispose()` runs, before the surface is disposed — the place to close
what the App holds outside its surface, such as a bridge to the parent page. Its throw goes to
`onError`.

The projection and the session subscription are registered before the App connects, so nothing the
host sends during the handshake is lost. The host context is re-applied on every
`hostcontextchanged`, including the notifications the runtime replays from the handshake; the
surface is remounted only while the surface route holds a result (a surface-route failure included)
and the context object actually moved — never while a status is shown or a transition is in flight.
`theme: false` skips the theme install at boot only — primitives still install it when they mount.

For a renderer that already follows the CSS theme tokens, `themeUpdates: "in-place"` keeps that
renderer mounted when only the host theme changes. This preserves local camera or interaction state.
Hosts that resend a complete JSON snapshot with new object identities but the same non-theme values
do not remount: comparison is structural (object key order ignored, array order kept). The default
remains `"remount"`; do not opt in if a component reads theme colors only at mount. Locale,
dimensions, styles, component selection and other value changes still remount normally in either
mode.

Generic loading, empty and failure headings follow the host locale, including `Result rejected` and
`Session rejected` after a locale change while that status is visible. `loadingLabel`, `emptyLabel`
and `surfaceRequiredLabel` also accept `(locale) => string`. `error` and `notice` `title`/`message`
accept the same `SurfaceLabel` callbacks, resolved on each visible status render so a provider
dictionary can follow the host locale without re-running `fromToolResult`, session projection or
resource reads. Literal titles, messages and `code` stay unchanged.
`documentLanguage: messages.locale` sets `document.documentElement.lang` to the selected dictionary
at boot and on locale changes; omit it to leave the document language untouched. The `messages`
option accepts a `createTranslator` catalog for additional languages. Domain values, contract
states, raw provider messages, codes, identifiers, numbers and units remain literal. Tool-result and
session projections receive `host.locale` for interface wording, never for interpreting or
validating domain values.

`startPreactSurfaceApp()` (`/preact`) is the same App with statuses rendered through
`renderStatusMessage`, plus `statusClassName` for viewer-owned styling hooks; its shell keeps the
`mcp-view-preact-surface` class 0.5 viewers style (the core default is `mcp-view-surface-shell`).
Both return a `SurfaceAppHandle` whose `show(state)` drives the App from outside the MCP lifecycle
and whose `dispose()` tears it down. Option conflicts throw `SurfaceAppError`, a `TypeError` with a
stable `code` (`SURFACE_APP_PROJECTION_CONFLICT`) and a `data.recovery` sentence; `show()` on a
handle the host already tore down rejects with `SURFACE_APP_CLOSED`.

Whole-view recorded sessions are declared in `@mcpview/contracts` and consumed through the core
resource lifecycle. `viewerSession` pairs a `validate` guard with a `toState` projection; the App
subscribes before it connects and the runtime buffers what arrives during the handshake, so a
one-shot session cannot be lost and no individual component claims `viewer.session.apply`. The 0.6
`validateSession`/`mapSessionToData`/`onInvalidSession` options of `startPreactSurfaceApp()` are
gone in 0.7.0; `viewerSession: { validate, toState, onInvalid }` is the one form.

## Common compositions

The kit stays small and non-prescriptive, leaving assembly to the caller. When multiple viewers
build the same assembly from the same primitives, this section is what they should have found first.

### Named quantity section

`Card` + `MetricGrid` carries one named group of measurements. Repeat the pattern for each domain
region; `EmptyState` handles the no-data case without shifting layout.

```tsx
<Card title="Load margins">
  {items.length === 0 ? <EmptyState>No values recorded.</EmptyState> : <MetricGrid items={items} />}
</Card>;
```

### Datasheet body

A card-density `SemanticElement` reads as a datasheet only while every figure has one place. The
readings strip is the headline, so it shows either every measurement or none — a subset picked by
position is not a headline. Its tiles wrap into rows and a short last row widens them, so five
readings are four and one wide, never four and a hole. The body is `ElementSection`s, each naming
what it holds: measurements in a `DataTable` (one row per quantity, the unit in its own column),
documentary facts in a `KeyValueList layout="facts"`, artifacts in an `ArtifactRow`. Labels are
worded for the reader, never raw field names. One fingerprint closes the sheet in
`ElementProvenance`; nothing shown in a section is repeated there.

```tsx
<SemanticElement
  reference={reference}
  density="card"
  ident={<ElementIdent marker="OP" label="Operating point" detail="Admitted result · r150" />}
  reading={observables.length <= READING_STRIP_LIMIT ? observables.map(toReading) : []}
  body={
    <ElementBody>
      {observables.length > READING_STRIP_LIMIT && (
        <ElementSection title="Observables">
          <DataTable
            label="Observables"
            rows={observables}
            columns={QUANTITY_COLUMNS}
            rowKey={rowKey}
          />
        </ElementSection>
      )}
      <ElementSection title="Provenance">
        <KeyValueList layout="facts" items={provenanceFacts} />
        <ArtifactRow label="Admitted result" uri={artifact.id} fingerprint={artifact.fingerprint} />
      </ElementSection>
    </ElementBody>
  }
  provenance={<ElementProvenance label="Projection" value={projectionFingerprint} />}
/>;
```

### Artifact collection

`CollectionCard` + `ArtifactRow` keeps a single outer border for a bounded list of immutable
artifacts. Thread the count through `eyebrow` or `actions`; `EmptyState` fills the list body when
there is nothing to show. `CollectionCard` is available since 0.3.x; the `eyebrow` slot on `Card`
accepts any `ComponentChildren`, so a plain count string requires no extra component.

```tsx
<CollectionCard
  label="Build artifacts"
  title="Artifacts"
  eyebrow={artifacts.length > 0 ? `${artifacts.length} items` : undefined}
>
  {artifacts.length === 0
    ? <EmptyState>No artifacts recorded.</EmptyState>
    : artifacts.map((a) => (
      <ArtifactRow
        key={a.uri}
        label={a.label}
        uri={a.uri}
        verification={a.verification}
      />
    ))}
</CollectionCard>;
```

## Contributing interface translations

English is the default and reference language. French is an optional existing translation;
additional languages are contributions, not a prerequisite for building or improving a viewer.

`createTranslator` is a small renderer-neutral dictionary helper from the package root. Keep stable
keys in a complete base dictionary, and add language dictionaries as partial overrides. Select the
translator from the current host locale when rendering, so the same recorded result can change its
interface language without changing its data.

```ts
import { createTranslator } from "@mcpview/components";

const en = {
  technicalDetails: "Technical details",
  revisionLabel: "Revision {revision}",
};
const fr: Partial<Record<keyof typeof en, string>> = {
  technicalDetails: "Détails techniques",
  revisionLabel: "Révision {revision}",
};
const messages = createTranslator({ defaultLocale: "en", messages: en, translations: { fr } });
const t = messages(context.hostContext.locale);
t("technicalDetails");
t("revisionLabel", { revision: 17 });
messages.locale("fr-CA"); // "fr" — the dictionary actually selected
```

Lookup falls back **per key** through the exact locale, its language parents, then the base
dictionary: with an English base, `fr-CA` → `fr` → English. A missing entry in a partial dictionary
does not hide the base text. An absent or invalid host locale uses the configured default locale;
there is no global mutable locale. `messages.locale(hostLocale)` uses that same chain and returns
the exact registered locale, the matched parent, or the canonical default — pass it as
`documentLanguage` so `document.documentElement.lang` names the selected dictionary. Keep
interpolation names such as `{revision}` intact. Render returned messages as text, never as HTML.

Translate interface labels and helper text only. Preserve authored names, payload values, units,
identifiers, digests, server messages and literal contract states such as `documentary`,
`unverified`, `unresolved` or `TRACE GAP`. Use `Intl.NumberFormat` and `Intl.DateTimeFormat` with
the host locale for presentation; formatting must not convert units or overwrite the stored
evidence.

For a new locale contribution, use this short PR checklist:

- Name the locale tag and the dictionary being extended (shared interface or a particular MCP).
- Keep existing keys stable; add any new key to the base dictionary first.
- List deliberately missing translations and preserve every interpolation placeholder.
- Include one small example showing a translated label and fallback for an untranslated key.
- Check the changed wording in a narrow viewer, including accessible labels and technical details.
- Confirm that authored data and contract states retain their original bytes and meaning.

The kit exports its English and French interface dictionaries as `MCP_VIEW_MESSAGES_EN` and
`MCP_VIEW_MESSAGES_FR`. MCPs keep their domain-specific interface dictionaries beside their viewers;
they can reuse the same helper without importing a new localization runtime.

## Result-viewer scaffold (Deno/JSR only)

The project generator intentionally uses Deno filesystem APIs and `deno fmt`. The generated
`src/main.ts` is a component registry plus one `fromToolResult` projection handed to
`startSurfaceApp()` from `@mcpview/components/surface`; it hand-rolls no App lifecycle. Its
`build.ts` accepts `MCP_VIEW_MODULE` and `MCP_VIEW_COMPONENTS_MODULE` overrides (the `mod.ts` of a
local checkout); the `/surface` entry is derived from the latter unless
`MCP_VIEW_COMPONENTS_SURFACE_MODULE` names it. Run the generator from JSR:

```sh
deno run -A jsr:@mcpview/components@0.10.0/scaffold result-viewer ./result-viewer
```

The npm package contains only the runtime and presentation entry points. It does not export or ship
`@mcpview/components/scaffold`; Node ESM imports and CommonJS requires of that subpath are expected
to fail with `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a Deno-only module.
