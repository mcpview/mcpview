# ADR 0005: The Three Channels of a View

Date: 2026-10-17 Status: Proposed

Answers the open question of view ADR 0001 §3 and view ADR 0002 #6 ("when do I use `callTool` vs
`updateModelContext` vs `sendMessage`?"). "Root ADR 0002" below is
`docs/decision-records/0002-view-layer-positioning.md` at the monorepo root.

## Context

An MCP App view exchanges with the server and the model through three channels: `tools/call`
(`callServerTool`), `ui/update-model-context` and `ui/message`. The view has other host methods
(`openLink`, `downloadFile`, `requestDisplayMode`, resource reads); they do not carry information to
the model and are out of scope here.

View ADR 0001 deferred a first-class `updateModelContext` until authors had "a clear mental model";
view ADR 0002 restated it as documentation debt. Nothing has filled that gap since.

The ERPNext pilot (github.com/Casys-AI/mcp-erpnext, 3.1.0 betas then 3.2.0-beta.1:
`src/ui/shared/active-context*.ts`, `nav-jump.ts`, `host-message.ts`) has used the three channels in
eight viewers since late August 2026. Its live paths give the model below. Two dormant paths of the
pilot (`activateContextWithFallback` and `drill-down.ts`) contradict rule 3 and are slated for
removal.

The MCP Apps specification (2026-01-26) fixes who reads what in a tool result: `content` is the
"text representation for model context and text-only hosts", `structuredContent` is "optimized for
UI rendering (not added to model context)", and `_meta` is "not intended for model context". Hosts
do not all follow it: OpenAI documents `structuredContent` as surfaced to the model and only `_meta`
as hidden; Claude Code hands the model the `structuredContent` JSON instead of the text.

## Decision

### The channels

| Channel              | Nature                                                                 | Reaches the model                                   | Use for                                                                | Never for                                             |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| `callTool`           | View-initiated read or write; the result returns to the view           | No (the model may later call the same tool itself)  | In-view navigation, refresh, explicit user actions (submit, move card) | Telling the model something                           |
| `updateModelContext` | Passive replication of view state; each call replaces the previous one | On a later turn, as the host decides (push or pull) | What the user is pointing at: the active context (view ADR 0006)       | Instructions, prompts, anything phrased to the model  |
| `sendMessage`        | An explicit conversational turn, visible in the thread                 | Immediately, as a user message                      | A user gesture that explicitly asks the model to act or reason         | In-view navigation; anything the user did not ask for |

A fourth, pull-mode channel exists in the ext-apps SDK and the draft specification: tools provided
by the view (`App.registerTool`), which the model calls to read view state. It is the natural
complement of `updateModelContext` on hosts where the model fetches widget context on demand. It is
not decided here; the host conformance matrix (root ADR 0002) must first show which hosts call it.

### Rules

1. **Ordering.** A `sendMessage` issued from a view whose active context changed waits for the host
   acknowledgement of the latest `updateModelContext`. Otherwise the model answers a turn built on
   stale context. Pilot: the `runConversation` barrier in `active-context-controller.ts`.
2. **Disclosure.** `sendMessage` from the SDK requires a `disclosure` string rendered before sending
   (view ADR 0001 §1). No silent chat injection through the SDK.
3. **No silent substitution.** The SDK wrappers to be built for context and message return
   `"unsupported"` when the host does not announce the channel, and never replace it with another
   channel behind the author's back. The one allowed degradation is explicit and visible: a
   navigation jump that cannot run in the view (no `serverTools`, or tool absent from the server
   manifest) may be offered as a question to the model, marked as such in the UI (pilot: `›` in-view
   jump versus `~` question). The existing `callServerToolGated` throws
   `MCPViewError(MISSING_SERVER_TOOLS_CAPABILITY)` instead; aligning it on a coded result is a
   breaking change, decided separately.
4. **No false success.** A host that acknowledges `ui/message` without delivering it must not
   announce `message`. Today the Compose host announces `message.text` and only logs it
   (`packages/compose/src/host/renderer/js/event-bus.ts`); fix the announcement or the delivery.
5. **Viewer enrichment stays out of the model's way.** A tool result's `content` text holds the
   business payload only; refresh requests, navigation jumps, the viewer tool manifest and `_meta`
   are not repeated there. The pilot does this since 2026-10-17 (`src/tools/model-visible.ts`): a
   12-month profit and loss text drops from about 4.4 KB to 0.3 KB. The enrichment still sits in
   `structuredContent`, which some hosts show to the model; the portable target is a versioned
   `_meta` block, after the host matrix confirms that hosts relay `_meta` to views.

### Capability ladder

Modalities are announced in the ext-apps SDK types (`McpUiSupportedContentBlockModalities`, since
1.0) and in the draft specification; the 2026-01-26 specification text does not list them. ChatGPT
has been reported to announce `updateModelContext: {}` and `message: {}` with no modality.

| Channel              | Required host capability                                           | Modality choice                                                             |
| -------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `callTool`           | `serverTools`, and the tool listed in the server's viewer manifest | n/a                                                                         |
| `updateModelContext` | `updateModelContext`                                               | `structuredContent` if announced, else `text`; `resource` only if announced |
| `sendMessage`        | `message`                                                          | text only                                                                   |

An empty modality object is treated as `text` only; this default is to be confirmed per host.

## Consequences

- Unblocks the SDK wrappers of view ADR 0002 #4 (`sendMessage` with disclosure) and #6
  (`updateModelContext`), provided they enforce rules 1–3 in code, not only in docs.
- The contract states what the view guarantees, not what the model does with it. Claude web lets the
  model fetch widget context through an internal step (anthropics/claude-ai-mcp issue #102, opened
  2026-03-18, answered 2026-04-24; the only public trace is that answer); ChatGPT users report
  acknowledged-but-lost updates (OpenAI developer forum, April and June 2026, no fix confirmed). The
  host conformance matrix measures the model side.
- `structuredContent`-first for `updateModelContext` is a pilot choice; the official pattern uses
  `text` (markdown with frontmatter). The matrix must confirm per host which modality reaches the
  model.

## Trigger to accept

- The host conformance matrix covers at least Claude (web, desktop), ChatGPT and VS Code for the
  three channels.
- A second consumer outside ERPNext uses `updateModelContext` through the SDK wrapper.
