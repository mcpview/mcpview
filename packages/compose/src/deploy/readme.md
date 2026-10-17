# deploy

Cloud deployment layer — publish dashboards as shareable links on Deno Deploy.

> **Architectural note (2026-05-09)** — the **network tunnel** primitives currently described below
> (outbound WebSocket from local SDK to relay, session-based routing,
> `TunnelConnection`/`DeployTransport` types) are **not** the long-term home of this code. They will
> be relocated to `@mcpview/bridge/src/adapters/network/` in a future implementation session. After
> migration, this module will only own the dashboard-specific deployment logic (Deno Deploy API
> integration, per-dashboard relay project lifecycle) and **import** the tunnel primitives from
> `@mcpview/bridge`.
>
> Reasoning: the tunnel is a generic bridging primitive (used by erp-platform for SaaS↔on-prem ERPs,
> by future on-prem cases, etc.), not specific to dashboard publishing. See
> `packages/bridge/docs/decision-records/0001-network-tunnel-scope.md` for the full ADR.

## Vision

`mcp-compose deploy` takes a local dashboard composition and publishes it online:

- Deploys a **relay worker** on Deno Deploy (one per dashboard, ephemeral)
- Cloud-native MCPs (SaaS APIs) are deployed alongside via the Deploy API
- Local-data MCPs connect via a **WebSocket tunnel** from the local SDK
- The user gets a **shareable URL** — the relay serves the dashboard and routes tool calls to the
  right MCPs (cloud or local via tunnel)
- On teardown, all Deploy resources are deleted programmatically

## Architecture

```
mcp-compose deploy template.yaml
  │
  ├─ Cloud-native MCPs (no local data needed)
  │   → Deploy API: create project + deployment with env vars
  │   → MCP runs on xxx.deno.dev
  │
  ├─ Local-data MCPs (DB, Docker, local files)
  │   → SDK starts MCP locally
  │   → SDK opens outbound WebSocket to relay
  │   → Relay routes tool calls through tunnel
  │
  └─ Relay worker (one per dashboard)
      → Serves dashboard HTML on a public URL
      → Routes tool calls to cloud MCPs (HTTP) or local MCPs (WebSocket)
      → Session-based routing (one session per deploy)
      → Deleted on teardown

User gets: https://relay-xxx.deno.dev → shareable link
```

## Planned API

- `deployDashboard(request)` — deploy relay + MCPs, return shareable URL
- `teardownDashboard(deploymentId)` — delete all Deploy resources
- `createTunnel(relayUrl, localCluster)` — connect local MCPs to relay via WebSocket

## Transport types

Extends the existing `McpTransport` with a new `"deploy"` type:

```typescript
interface DeployTransport {
  type: "deploy";
  /** JSR package to deploy (e.g., "jsr:@casys/mcp-einvoice"). */
  package: string;
  /** Args for the deployed server. */
  args?: string[];
}
```

The manifest can then declare:

```json
{
  "name": "mcp-einvoice",
  "transport": { "type": "deploy", "package": "jsr:@casys/mcp-einvoice" },
  "requiredEnv": ["IOPOLE_CLIENT_ID", "IOPOLE_CLIENT_SECRET"],
  "tools": [...]
}
```

## Dependencies

- Deno Deploy REST API (`https://api.deno.com/v1/`)
- `DENO_DEPLOY_TOKEN` for authentication
- Organization ID for project creation
- `runtime/` for composing the dashboard before deploying
- `core/` for types

## Design decisions

- **Deploy is opt-in**: The library works fully in local mode. Deploy adds shareability but is not
  required for composition or preview.

- **One relay per dashboard**: Sharing a relay across dashboards would create session routing
  complexity and cross-tenant risks. Each deploy gets its own relay worker — simple, isolated,
  deletable.

- **Outbound-only tunnel**: The local SDK connects TO the relay (outbound WebSocket), not the other
  way around. No port forwarding, no firewall config, no VPN. Like Tailscale — the connection is
  initiated from inside the network, not from outside.

- **Deno Deploy over custom infra**: Deploy provides free-tier hosting, WebSocket support, KV for
  session state, and programmatic project creation via REST API. No servers to manage.

- **Env vars in Deploy, never in HTML**: Credentials are stored in the Deploy project's env vars
  (encrypted at rest). The dashboard HTML never contains credentials — it only contains iframe URLs
  pointing to the relay.
