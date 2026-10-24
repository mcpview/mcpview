# Active context example

Twelve synthetic records demonstrate the optional public entries without a database or external
service. The App owns one controller outside the Preact tree and uses the current `createMcpApp` /
`ctx.app` transport. No second App, SDK migration or conversation fallback is used.

From the repository root:

```bash
deno run -A packages/view/examples/context/build.ts
deno check packages/view/examples/context/src/main.ts
```

The build uses the same esbuild/Deno-loader harness as `examples/basic` and emits the self-contained
`dist/index.html`. Serve that file as a `text/html;profile=mcp-app` resource in an MCP Apps host.
Opening it directly is an unsupported preview: selection stays disabled and rows open local detail.
The example supplies no local host emulator and does not claim real-host validation.

Select 1 or 3 to share compact records; Select 8 shares references; Select 12 shares one query item.
The application policy names `sample_list` with an exact `ids` filter; a consuming server must
implement that tool/filter and retrieve records by their stable IDs. This fixture illustrates the
contract rather than providing a backend. The query retains identifiers in a tool filter rather than
embedding a row set. The policy bounds the original basket at 12 and its serialized snapshot at 8192
bytes. Those are fixture choices, not universal limits.

Pointer single-click previews the desired row selection immediately, with an adding/removing label,
dashed pending treatment and pending chip status. Only the host replacement waits 500 ms by default.
A native second click at 200 ms cancels the preview without sending any replacement before opening
detail. Space selects immediately; Enter and the Details button open detail. Opening detail cancels
only that target's unresolved previews and preserves other rows' deadlines. The App cancels the
whole scope only before changing the root, and disposes the arbiter on unmount. Every first click
has its own 500 ms deadline, including separate sequences on the same row. The browser does not
expose the OS double-click interval. Set the window for the gestures the App supports; a late
double-click does not retract a replacement that has already started.

The chip and debug panel show acknowledged selections. Rows use `selectionState(itemOrId)`
(`selected | adding | removing | none`) for immediate local feedback; `isSelected(item)` continues
to mean confirmed membership. Queued intent and failure are separate; retry resends the latest
desired snapshot. Changing root queues a clear and invalidates old actions. Opening detail and
returning keep the same root/controller. Teardown attempts a clear before the App transport closes;
abrupt iframe removal may prevent delivery.

## API used here

```ts
createActiveContextPolicy(config: ActiveContextPolicyConfig): ActiveContextPolicy;
createActiveContextController(
  host: ActiveContextHost,
  initialScope: string,
  policy: ActiveContextPolicy,
): ActiveContextController;
useActiveContext(controller: ActiveContextController, scopeKey: string): ActiveContextHook;
createClickIntentArbiter(options?: ClickIntentOptions | ClickIntentSchedule): ClickIntentArbiter;
```

`controller.getSnapshot()` reads acknowledged `selections`, queued `desiredSelections`, `supported`,
`pending`, `failed`, `error` and `evictedLabel`. `subscribe(listener)` returns an unsubscribe
function. `actionsForScope(scope)` captures a generation: `select(items, mode = "replace")`,
`toggle(item)`, `previewToggle(item)`, `remove(selection)`, `clear()`,
`reconcileGroup(group, candidates)`, `selectionState(itemOrId)` and `isSelected(item)` are bound to
it. Use `onPreview: () => context.previewToggle(item)` in the click intent alongside
`onSingle: () => context.toggle(item)` for keyboard/assistive activation. `setScope(next)`
invalidates old actions and queues the old root's clear. `retry()` resubmits current desired intent;
`settled()` waits for queued writes. Read the public entry types for all optional projections,
resource limits and reconciliation operations.

`ActiveContextChip` takes `selections`, `labels`, `onClear` and optional `pending`, `failed`,
`evictedLabel`, `onRemove`, `onRetry`, and caller-projected `entries`/`onRemoveGroup`. Install
`MCP_VIEW_CONTEXT_BASKET_CSS` explicitly. The example also installs `MCP_VIEW_THEME_CSS` and the
optional `MCP_VIEW_CONTEXT_SELECTION_CSS`; apply `mcp-view-context-selection` with
`data-context-state` for row/card treatment using shared light/dark tokens.
`contextBasketLabels(locale)` provides English/French wording. Retry checks acceptance before moving
focus to a retained control or, after a successful clear, the next external control.

## Evidence boundary

An ACK confirms acceptance by the host, not model consumption or persistence into later turns. The
example does not test production hosts, host removals or cross-iframe supersession. Those remain
separate acceptance gates in
[proposed ADR 0006](../../docs/decision-records/0006-active-context-contract.md).

The older extraction example informed the package boundary; this example is a fresh integration of
the current public API and existing transport.
