# ADR 0004: Local Multi-App Host Runtime

Date: 2026-07-31\
Status: Accepted

## Context

`mcp-compose` can collect `_meta.ui.resourceUri` values and arrange the resulting views, but a
rendered dashboard must also behave as an MCP Apps host:

- resolve `ui://` resources through MCP `resources/read`, rather than assuming a server-specific
  HTTP `/ui` route;
- communicate with both stateless MCP `2026-07-28` servers and legacy session-based Streamable HTTP
  servers while the dashboard is open;
- relay an App's allowed `tools/call` and `resources/read` requests to its own source server;
- send the initial complete `CallToolResult` after the App's initialization handshake;
- retain Compose's multi-iframe `ui/compose/event` routing.

The existing `@mcpview/bridge` resource server solves a related problem for a single App embedded in
an external platform. Its injected browser client owns `postMessage`, which is incompatible with
Compose acting as the parent of multiple App iframes.

## Decision

Add a **local multi-App host runtime** to `mcp-compose`.

The pure `core/` pipeline remains unchanged. The new runtime/host adapter is responsible only for
the local dashboard it starts; it is not a general network gateway, authentication product, or
remote relay.

```text
MCP App iframe (slot N)
  -> postMessage -> Compose parent event bus
  -> POST /api/slots/N/mcp -> protocol-aware connection for source N
  -> tools/call or resources/read -> source MCP server

Compose HTTP host
  GET /ui/N -> source connection.resources/read(original ui:// URI)
```

### Transport policy

Compose is **stateless-first** for HTTP. It probes `server/discover` using the `2026-07-28`
per-request metadata and headers. A server that returns unsupported-version or method-not-found is
then reached through the legacy initialized Streamable HTTP client. This follows the protocol's
published compatibility flow and lets the Console (legacy) and current `@mcpview/server` instances
(stateless) coexist.

The public SDK available during this work does not yet expose the stateless client transport, so
Compose owns a narrow wire adapter for that specified mode. It is not a generic JSON-RPC shortcut:
every stateless request carries the required protocol version, client info, client capabilities and
request-mirroring headers.

### Boundaries

- `@mcpview/compose` owns local dashboard lifecycle, per-slot routing, initial result delivery, and
  cross-iframe events.
- `@mcpview/bridge` remains the home for external-platform adapters, WebSocket bridging,
  authentication, and remote/tunnel deployment concerns.
- `@mcpview/view` remains the browser-side view library.
- Digital Thread supplies explicit manifests and templates; it does not duplicate host plumbing.

### Security invariants

1. An iframe is bound to its source slot and cannot choose another MCP server.
2. Only tools declared for that source in the explicit manifest may be called.
3. A resource read is limited to the resource URI collected for that slot unless an explicit future
   allowlist extends it.
4. `serverTools` and `serverResources` are advertised only when their routes are installed.
5. The first local host binds to loopback. Exposure, authentication, and remote relay are separate
   decisions.
6. Resource CSP and iframe permissions are preserved or tightened; never silently broadened.

## Consequences

- `composeDashboard({ keepAlive: true })` becomes meaningful for interactive dashboards, but the
  preferred public convenience API is a single compose-and-serve lifecycle handle.
- The runtime uses the official Streamable HTTP client for legacy servers and a narrow, spec-defined
  stateless adapter for `2026-07-28`; neither route relies on a server-specific `/ui` endpoint.
- The rendered iframe URLs become local host routes (`/ui/<slot>`), not upstream `/ui?...` guesses.
- Initial results retain `content`, `structuredContent`, `isError`, and `_meta`; truncating them to
  text would break normal MCP App hydration.
- The existing renderer stays usable as a pure static renderer. Interactive hosting is an explicit
  opt-in path.

## Delivery order

1. Stateless-first / legacy-compatible cluster with `callTool` and `readResource`.
2. Local host routes and parent event-bus bridge, with slot allowlists.
3. Automated proof using an MCP fixture exposing only `resources/read`.
4. Real Console integration, then SysON panels and declared Compose events.
5. Diataxis documentation: tutorial, how-to, reference, and this explanation/ADR.
