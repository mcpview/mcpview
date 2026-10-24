# runtime contract

## Inputs

- `McpManifest` JSON files: transport metadata, reviewed tool declarations, and optional per-tool
  `appCallable` grants.
- `DashboardTemplate` YAML files: sources, tool calls, orchestration, and `{{placeholder}}`
  arguments.
- `ComposeRequest`: parsed template, manifest map, arguments, and optional `keepAlive` for a later
  interactive host.

## Outputs

- `ComposeResult`: descriptor, static HTML, warnings, and immutable panel provenance. When
  `keepAlive` is set it also owns a live `McpCluster`.
- `ComposedDashboardHandle`: loopback URL, originating result, and idempotent `shutdown()` from
  `composeAndServeDashboard()` or `serveComposedDashboard()`.
- `McpCluster` / `McpConnection`: `callTool`, `readResource`, `listTools`, `listResources`,
  lifecycle, and UI-base compatibility helpers.

## Invariants

- Runtime is the only layer with I/O: file reads, process lifecycle, MCP connections, and the local
  HTTP host.
- Core remains the source of composition semantics; runtime only captures the source provenance
  needed to host a collected slot.
- `auto` HTTP transport is stateless-first (`2026-07-28`) and falls back to legacy initialized
  Streamable HTTP only for compatible fallback responses.
- The SDK-backed connection owns a fresh client and session, with no shared response cache. Closing
  it terminates the session before closing the client; repeated closes are harmless.
- List operations return one server page and preserve `nextCursor`; resource reads always reach
  their source even when the server supplies cache hints.
- Tool definitions from explicitly fetched pages retain SDK output-schema validation. They are
  isolated from caller mutation, replaced by a fresh first-page listing, and invalidated by
  tool-list change notifications or connection closure, including replies already in flight.
- Local SDK timeouts keep Compose's operation-specific timeout codes. Remote protocol errors keep
  operation-failure codes and their original cause; `isError` tool results remain results.
- An interactive resource is obtained through MCP `resources/read`; no path derives or assumes a
  source-server `/ui` endpoint.
- A panel is permanently bound to its source server, original `ui://` URI, initial complete tool
  result, and manifest-owned App tool allowlist.
- Omitted `appCallable` means deny. The local proxy never forwards arbitrary tools, methods,
  resources, source servers, or pagination cursors.
- Every host listener is loopback-only. The parent and each child iframe have distinct loopback
  origins so a `WindowProxy` cannot survive navigation into a different origin with the same
  capability.
- The initial result is delivered only after the App initialization notification, and keeps the full
  MCP result shape.
- A non-interactive composition stops its cluster in `finally`; an interactive dashboard closes
  every listener and cluster connection in `shutdown()`.
- Manifests and templates are validated before a cluster starts. Failed tool calls are warnings
  unless the lifecycle itself cannot be established.
