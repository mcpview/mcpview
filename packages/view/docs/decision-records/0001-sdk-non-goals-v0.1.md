# ADR 0001: View SDK Non-Goals (v0.1.0)

Date: 2026-04-18 Status: Accepted

## Context

`@mcpview/view` v0.1.0 is the initial release of the View-side SDK for MCP Apps. It ships three
primitives: `navigate`, `callTool`, `capabilities`.

This package was extracted from @mcpview/compose; see
packages/compose/docs/decision-records/0002-positioning-vs-ext-apps.md for the rationale of the
split.

The MVP was intentionally minimal to solve one concrete pain point: MCP App authors using
`sendMessage` (`ui/message`) for every in-App navigation, which pollutes the chat thread and
triggers the Claude prompt-injection warning on every click.

The code was first shipped as `@casys/mcp-compose/view` in compose v0.5.0 but relocated to its own
package `@casys/mcp-view` before any JSR publish succeeded (see compose ADR 0002 addendum for the
rationale — JSR banned the `/// <reference lib="dom" />` directives compose used to let View sources
type-check, and putting `lib: dom` on compose globally would invite server-code bugs). This ADR
carries over unchanged from the original `0003-view-sdk-non-goals-v0.5.md` authored under compose.

Several natural features were **deferred**. This ADR records what and why, so the v0.2+ roadmap does
not drift into scope creep and so authors reading the SDK know what's intentionally missing (vs just
not yet built).

## Deferred features

### 1. `ctx.sendMessage(text, { disclosure })` wrapper

Accessible via `ctx.app.sendMessage(...)` (escape hatch).

**Deferred rationale:** `sendMessage` has legitimate uses (asking the model to reason about a
structured action) but encourages the anti-pattern this SDK exists to replace. Shipping it in the
MVP would make migration from `sendMessage` to `callTool` + `navigate` feel optional instead of the
intended default. The v0.2 wrapper will require an explicit `disclosure` prop whose string gets
rendered in the UI before the message is sent — no silent chat injection possible through the SDK.

### 2. `ctx.requestDisplayMode(mode)`

Accessible via `ctx.app.requestDisplayMode(...)`.

**Deferred rationale:** einvoice and erpnext already get fullscreen working natively on Claude; the
feature is not blocking real use cases. When compose's own dashboard host implements the counterpart
handler (see `roadmap-after-v0.14.0.md` item 1b), the View-side wrapper will land in the same
release.

### 3. `ctx.updateModelContext(payload)`

Accessible via `ctx.app.updateModelContext(...)`.

**Deferred rationale:** semantically overlaps with `callTool` for most use cases. Needs a clear
mental model for authors ("when do I use which?") before promoting to first-class SDK API.

### 4. URL-based routing / history API integration

Not planned.

**Rationale:** MCP App iframes have no meaningful address bar or history context. Memory-only
routing is the right abstraction.

### 5. React / Vue / Svelte bindings

Planned as separate packages: `@casys/mcp-view-react`, `@casys/mcp-view-vue`,
`@casys/mcp-view-svelte`.

**Deferred rationale:** the vanilla core is the contract; framework adapters are thin wrappers that
can ship independently without touching the core API.

### 6. Type-level view map inference (`keyof V` on `navigate` / `currentView`)

Currently typed as `string`. Upgrading to `keyof V` would let typos in view names fail at compile
time.

**Deferred rationale:** requires adding a second generic parameter to `AppHandle` / `AppContext`
(`<S, V extends ViewMap<S>>`). Non-trivial refactor and a breaking change for early adopters.
Target: v0.2 or v1.0 with a single coordinated break.

### 7. Automatic `ontoolresult` → view refresh wiring

Authors opt in via `ctx.app.addEventListener("toolresult", ...)`.

**Rationale:** different views want different refresh semantics; a blanket "refresh on any tool
result" creates more bugs than it solves.

## Decision

v0.1.0 ships the three primitives above, and nothing else. Every deferred feature has a known path
to v0.2+ that is non-breaking (optional fields on existing types).

## Consequences

- Authors migrating from `sendMessage` keep access to it via `ctx.app`; no behavior is _removed_,
  only _not promoted_.
- The public API surface stays small and teachable. Readme / examples can cover the full SDK in <20
  lines of code.
- v0.2 planning has a clean list of candidates, each with existing rationale captured here.

## References

- Spec: `packages/view/src/spec.md` §"Non-goals"
- Original ship commit (as compose sub-export): 504eb45
  (`feat(compose): 0.5.0 — view/ SDK for SPA MCP Apps`)
- Split commit: introduced `@casys/mcp-view` as a dedicated workspace member (see compose ADR 0002
  addendum).
- einvoice anti-pattern example:
  `mcp-einvoice/packages/mcp/src/ui/doclist-viewer/src/DoclistContent.tsx:313`
