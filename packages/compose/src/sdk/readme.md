# sdk

MCP SDK adapters — optional convenience wrappers for MCP client SDKs.

## Purpose

Provides three capabilities:

1. **SDK Collector** (`createMcpSdkCollector`) — Wraps the core `UiCollector` with an interface that
   accepts `@modelcontextprotocol/client` `CallToolResult` objects directly. Error results are
   automatically skipped.

2. **`uiMeta()` builder** — Typed helper for declaring `_meta.ui` with PML extensions
   (`emits`/`accepts`) on top of standard SEP-1865 fields (`resourceUri`, `visibility`, `csp`,
   `permissions`, `domain`, `prefersBorder`). Returns an object ready to spread into a tool
   definition.

3. **`validateComposition()`** — Takes tool definitions (with `_meta.ui`) and sync rules, returns
   validation issues: orphan emits, orphan accepts, mismatched events/actions, and structural issues
   (delegated to core validator).

4. **`composeEvents()`** — UI-side helper for cross-UI event routing. Uses a dedicated
   `ui/compose/event` JSON-RPC method via postMessage, separate from the MCP Apps protocol. Works
   alongside the ext-apps `App` class without interfering. Provides `emit()`, `on()`, and
   `destroy()`.

## Design decisions

- **Structural typing over imports**: `composeEvents()` uses duck typing instead of importing
  `@modelcontextprotocol/ext-apps`. This avoids a runtime dependency and lets any
  postMessage-compatible object work.

- **Dedicated `ui/compose/event` method**: MCP Apps uses `ui/update-model-context` for context
  sharing and `ui/notifications/tool-result` for tool results. Piggy-backing compose events on these
  methods would conflate cross-UI routing with standard protocol semantics. A dedicated method keeps
  both protocols independent — no interference, no ambiguity on the receiving end.

- **Zero-dependency**: only imports from `../core/`. Pure functions, no I/O.
