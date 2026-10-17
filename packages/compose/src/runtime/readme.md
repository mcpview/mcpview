# runtime

Dashboard composition from manifests, templates, and live MCP servers. This is the only
`mcp-compose` layer with I/O: it starts or connects servers, calls tools, reads MCP resources, and
can serve a local interactive MCP Apps host. The composition semantics remain in `core/`.

## API

- `composeDashboard(request)` — validate → start/connect → call → collect → compose → render. It is
  compatible with the historical static renderer.
- `composeDashboardFromFiles(manifestDir, templatePath, args)` — file-loading convenience wrapper
  for the static composition path.
- `composeAndServeDashboard(request, options?)` — preferred interactive path: composes, keeps the
  cluster alive, and returns a loopback host handle.
- `serveComposedDashboard(result, options?)` — serve a result previously made with
  `composeDashboard({ keepAlive: true })`.
- `createCluster`, `startServer`, and `connectHttp` — connection lifecycle.
- `parseManifest` / `loadManifests`, `parseTemplate` / `loadTemplate`, `injectArgs`, and
  `validateTemplate` — file and contract helpers.

Use `composeAndServeDashboard()` when an App must receive its initial tool result or call back to
its MCP server. `renderComposite()` and the HTML on a plain `ComposeResult` remain useful for a
static layout, but do not create an MCP resource bridge.

```ts
import { composeAndServeDashboard, loadManifests, loadTemplate } from "@mcpview/compose/runtime";

const manifests = await loadManifests("./manifests");
const template = await loadTemplate("./dashboards/operations.yaml");
const dashboard = await composeAndServeDashboard(
  { manifests, template },
  {
    open: true,
    // Optional: allow one reviewed local shell to embed this dashboard.
    frameAncestors: ["http://127.0.0.1:60060"],
  },
);

console.log(dashboard.url);
// Call dashboard.shutdown() when the local dashboard is no longer needed.
```

## Transport compatibility

`http` and started `stdio` manifests use an MCP HTTP endpoint. The default `transport.protocol` is
`"auto"`: Compose first probes the stateless `2026-07-28` protocol, then falls back only for an
unsupported-version or method-not-found response to the official initialized Streamable HTTP client.

Set a protocol explicitly when it is known:

```json
{
  "transport": {
    "type": "http",
    "url": "http://127.0.0.1:3020",
    "protocol": "streamable-http"
  }
}
```

The stateless adapter carries the required version, client metadata, and request-mirroring headers
for every request. The legacy path remains an MCP client session, not a guessed HTTP shortcut.

## Interactive host contract

The local host never assumes that an MCP server exposes `/ui`. For each collected `ui://` URI it
calls `resources/read`, serves the returned HTML on a dedicated loopback child origin, and gives the
parent dashboard a separate loopback origin. The parent event bus verifies both the iframe window
and its origin before forwarding requests.

The child may use only these capability-gated MCP methods:

- `tools/call` and `tools/list` for tools explicitly marked `appCallable` in that source manifest;
- `resources/read` and `resources/list` for the exact `ui://` resource that created the slot.

`appCallable` is deny-by-default. It is a browser-capability grant, not a claim that a tool is safe
for every client:

```json
{
  "name": "console_refresh",
  "description": "Refresh read-only observations.",
  "appCallable": true
}
```

The complete initiating `CallToolResult` is delivered exactly once after the App sends
`ui/notifications/initialized`; this preserves `content`, `structuredContent`, `isError`, and
`_meta`.

The serving API binds only to `127.0.0.1`; it intentionally has no hostname override. Remote
exposure, authentication, and tunnels belong to a separate deployment adapter. The dashboard
document denies framing by default. `frameAncestors` accepts validated HTTP(S) origins only and
exists for explicit local product shells, not broad wildcard embedding. The reviewed origins are
also propagated to each child App response because CSP evaluates every ancestor in a nested iframe
chain, not only the immediate dashboard parent.

## Design decisions

- **Static manifests** describe the reviewed source/tool surface without relying on unrestricted
  browser discovery.
- **Templates are YAML** because agents can generate and humans can review layouts and
  `{{placeholder}}` arguments.
- **Parallel source startup, sequential calls per source** preserve possible intra-source
  dependencies while avoiding unrelated startup latency.
- **No implicit retry** keeps retry policy with the caller.

## AX design

- Every transport failure has a machine-readable `RuntimeErrorCode`.
- A non-interactive composition always stops its cluster in `finally`; an interactive handle stops
  it in `shutdown()`.
- Tool calls without a UI and failed optional calls become explicit warnings.
- The static renderer remains deterministic; interactive hosting is explicit.
