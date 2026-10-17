# ADR 0002: View Layer Positioning — Reference Implementation for Views That Talk to the Model

Date: 2026-10-17 Status: Proposed Scope: view, view-components, view-contracts,
server

Amends the package ownership table of view ADR 0004: `@mcpview/view` also owns
the context, navigation and refresh engines below. Root ADR 0001 predates the
current six-package workspace.

## Context

The MCP Apps ecosystem has, as of October 2026:

- an official SDK (`@modelcontextprotocol/ext-apps` 2.x) that stays deliberately
  thin: transport, host bridge and a few React utility hooks; the specification
  defers state persistence, view-to-view communication and multiple UI
  resources;
- host-side infrastructure (`@mcp-ui/client`, CopilotKit, assistant-ui);
- server-plus-view frameworks (mcp-use, Skybridge, sunpeak, xmcp, FastMCP +
  Prefab); mcp-use 2.10 (2026-10-14) now ships keyed model-context attachments
  with acknowledgement;
- visual kits (`@openai/apps-sdk-ui`).

The ERPNext pilot (github.com/Casys-AI/mcp-erpnext, 3.2.0-beta.1 line) built a
bounded active-context basket and a navigation stack. Measured on 2026-10-17 in
`src/ui/shared`: about 4k lines of `.ts` source (5.4k with `.tsx`) and 5k lines
of tests; the engine code alone is about 2.5k lines, the size of the whole
`@mcpview/view` source (2.6k). It lives in the pilot, wired by hand in eight
viewers, while the platform packages have no context engine and a flat router.

Upstream issues show the infrastructure parts may be standardized later
(ext-apps #500 slots, #558 multiple instances, #417 persistence, #147 hosted
navigation, #674 public host tests); ext-apps 2.0 (2026-09-08) absorbed none of
them.

Host guidelines matter. Claude's MCP Apps design guidelines list "deep
navigation such as drill-ins, breadcrumbs, or multiple views" among patterns to
avoid, while clicking data points inside a visualization is in scope. OpenAI's
inline card rules say "No deep navigation or multiple views within a card". The
pilot does not read the display mode today: its breadcrumb shows inline too.

## Decision

### Positioning

The view layer is **the reference implementation of how an MCP view talks to the
model without spamming it**. It is not another server framework competing with
mcp-use or Skybridge, not a visual kit, not host infrastructure. It is defined
by four deliverables:

1. Written contracts: the three channels (view ADR 0005) and the active context
   snapshot (view ADR 0006), with a model-facing description authors can paste
   into tool descriptions.
2. A host conformance matrix, updated each release: per host (Claude web,
   desktop and mobile, ChatGPT, VS Code, Goose, M365 Copilot, bridged hosts),
   which channels and modalities are announced, what reaches the model, whether
   it survives the next turn, whether teardown is delivered, how replacement is
   scoped, size limits. The official extension matrix is a yes/no per extension
   and ext-apps #674 asks for public host tests; no per-channel matrix was
   found.
3. Tested, framework-neutral engines: context, navigation, refresh. Preact and
   React bindings.
4. A test bench: a generic dev host with capability profiles and a published
   host test double.

Infrastructure needs (slots, instance supersession, persistence) are fed
upstream with pilot data; the library keeps the policy and the UX.

### Priorities

Context first, navigation second. The context engine is aligned with host
guidelines; its edge over mcp-use is the bounded basket, refresh reconciliation
and navigation scoping, and it must be kept by shipping, not assumed. The
navigation stack degrades to a flat view inline and is only defended in
fullscreen.

### Packaging

No new package before 1.0. Pure subpaths, each guarded by a module-graph test
like `view-components/entries_test.ts`:

| Subpath / package                      | Content                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `@mcpview/contracts`                   | active context schema, `NavTarget`, refresh request, viewer tool manifest |
| `@mcpview/view/refresh`                | refresh sequence and viewer lifecycle (view ADR 0002, items 2–3)          |
| `@mcpview/view/context`                | basket engine (view ADR 0006)                                             |
| `@mcpview/view/navigation`             | level stack, jump orchestration, crumbs                                   |
| `@mcpview/view/gesture` (experimental) | click / double-click / keyboard arbitration                               |
| `@mcpview/components` `/interaction`   | context chip, detail toggle, level host, Preact hooks                     |
| `@mcpview/server`                      | viewer navigation middleware; extend the existing `registerViewers`       |

Engines live outside the render tree and expose `subscribe` / `getSnapshot`.

### Sequence

0. Stabilize the pilot's 3.2.x line (the 3.1.0 stable has neither the stack nor
   the eight-viewer context) and fix its known defects: navigation level id
   collision after an A → B → A root change, swallowed connection errors,
   dormant message fallbacks, dead code.
1. Host conformance matrix and test protocol.
2. Contracts drafted; view ADRs 0005 and 0006 stay Proposed.
3. `/refresh` first (no risk), with `mcp-einvoice` (React) as second consumer.
4. `/context`, with `mcp-syson` (SysML, already on the platform runtime) as
   second domain. View ADRs 0005 and 0006 move to Accepted here.
5. `/navigation`, with `mcp-modelica` and a non-ERP example in the repository;
   inline degradation driven by the host display mode.
6. Viewer enrichment moved from tool-result fields to a versioned `_meta` block
   and server middleware, after the matrix confirms hosts relay `_meta` to
   views.
7. Generic dev host and published test double.

### "Reference" is earned, not declared

The family may call itself a reference once: two non-ERP domains run the context
engine in production, two consumers use navigation, the matrix is current, every
public export has an `@example`, and the gesture API is stable (1.0). The
showcase page comes after the matrix, not before.

### Prerequisites

- Tests, lint, format and type-check on the platform's main branch (today only
  publish and release workflows run).
- The pilot tracks the latest platform versions (it still pins
  `@casys/mcp-server` ^0.26.1 and `@casys/mcp-view-components` ^0.7.1).
- Npm distribution kept alongside JSR: MCP Apps adoption is npm-first.
- One public identity for repository and package metadata.
- A name for the concept, decided separately; "focus" is taken by `FocusedView`
  and "context" alone has five meanings in the family.
- `packages/view` publishes `docs/**`: these ADRs reference the pilot by public
  repository, not by local path.

## Consequences

- The platform family gains a second core, its engines about as large as
  `@mcpview/view` today; the extraction is paced by pilots, not by the calendar.
- Scope discipline from view ADR 0002 ("Trigger to promote candidates") still
  applies: no subpath ships without a second consumer.
