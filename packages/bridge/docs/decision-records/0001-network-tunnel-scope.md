# ADR 0001: Network tunnel primitives belong in mcp-bridge

Date: 2026-05-09 Status: Accepted

## Context

Until now, `@mcpview/bridge` has been positioned as a **UI bridge** — it serves
MCP Apps `ui://` resources inside hosts that don't render them natively
(Telegram Mini Apps, LINE LIFF). The README, the package description, and the
directory layout (`adapters/telegram/`, `adapters/line/`) reinforce this scope.

Independently, `@mcpview/compose/src/deploy/` ships a **design document**
(readme + contract + types, no impl) for publishing dashboards on Deno Deploy,
which includes a **WebSocket tunnel** for local-data MCPs:

> _"Local-data MCPs (DB, Docker, local files) → SDK starts MCP locally → SDK
> opens outbound WebSocket to relay → Relay routes tool calls through tunnel."_

A new, unrelated project (`erp-platform`, a multi-tenant SaaS that talks to
ERPNext/Dolibarr instances running **on the customer's premises**) needs the
same primitive: an outbound WebSocket from a local agent to a SaaS relay,
routing MCP `tools/call` through the tunnel.

The question: where does this **network tunnel** primitive belong?

## Options considered

### A. New sibling package `@casys/mcp-tunnel`

Pros: strict SRP, decouples "tunnel" from "UI bridging" packaging.

Cons: **duplicates ~1600 LOC of WebSocket + JSON-RPC + session/router plumbing
already living in `mcp-bridge/src/core/`** (battle-tested, ~120 tests). Two
packages would each carry their own copy of the same machinery.

### B. Inside `@mcpview/compose/src/deploy/`

Pros: design already there, types defined.

Cons: `mcp-compose` is a **dashboard composition** library. The tunnel is a
primitive used by `compose/deploy` for one specific use case (publishing a
composed dashboard with local-data MCPs), but the primitive itself is more
general. Locking it inside `compose/deploy/` means every other consumer
(erp-platform, future on-prem cases) would have to import all of `mcp-compose`
to reach it.

### C. Inside `@mcpview/server` core

Pros: it's a transport-level concern.

Cons: the tunnel has two sides (relay server + local agent), with
auth/session/routing surface. That's more than a transport — it's a mini-product
on top of the transport.

### D. Inside `@mcpview/bridge`, as a new `adapters/network/` sibling

Pros:

- **Semantic correctness**: `bridge` literally means "passing traffic between
  two environments that can't talk directly". Telegram bridge, LINE bridge,
  on-prem bridge are three instances of the same concept. The current package
  name is a _generic_ bridging concept; the Telegram/LINE specialization is just
  what shipped first.
- **Code reuse**: `bridge/src/core/` already implements the exact primitives a
  network tunnel needs (WebSocket transport, JSON-RPC protocol builders,
  MessageRouter, session abstraction with auth handler, BridgeClient). Targeted
  reuse, no duplication.
- **Modular extension**: `adapters/network/` sits next to `adapters/telegram/`,
  `adapters/line/`. Same shape, same pattern. Adding more bridging adapters
  (Slack, Discord, IRC, custom RPC) does not destabilize the package.

Cons:

- The `mcp-bridge` external positioning has to evolve from "UI bridging" to "MCP
  bridging (UI **and** network)". This is a documentation / README change, not
  an architectural one.
- Some users that import `mcp-bridge` expecting only Telegram/LINE surface might
  be surprised by the network-tunnel exports — but exports are tree-shakeable,
  so there is no runtime cost.

## Decision

**D — `@mcpview/bridge`, with a new `src/adapters/network/` sub-module.**

The `core/` primitives (WebSocketTransport, MessageRouter, protocol builders,
BridgeSession, auth handler) are reused as-is. The network adapter sits next to
`adapters/telegram/` and `adapters/line/` and ships its own client (run by the
customer-side agent) and server (run by the SaaS relay).

The package description / README will evolve to describe `mcp-bridge` as a
generic bridging layer, with sub-modules per host platform — the host being
either a messaging app (Telegram/LINE) or a network endpoint (SaaS relay).

## Consequences

### `mcp-compose/src/deploy/` becomes a consumer, not an owner

The tunnel types (`TunnelConnection`, `DeployTransport`) currently in
`mcp-compose/src/deploy/types.ts` are **structurally relocated** to
`mcp-bridge/src/adapters/network/types.ts`. `mcp-compose/deploy/` imports them
from there, and the deploy module narrows its responsibility to:

- the Deno Deploy publishing logic (creating relay project, deploying cloud-side
  MCPs)
- the dashboard-specific HTML wiring

The "tunnel" is no longer something `mcp-compose` _owns_. It's something it
_uses_.

### Action items (deferred, separate sessions)

- Implement `mcp-bridge/src/adapters/network/{client,server,auth,types}.ts` with
  first-class support for: outbound WS from local agent, multi-tenant routing on
  relay side, agent registration handshake, secret rotation, reconnect,
  backpressure, replay/idempotence on `tools/call`.
- Migrate types from `mcp-compose/src/deploy/types.ts` (the bits that describe
  the tunnel, **not** the deploy-specific request/result).
- Update `mcp-compose/src/deploy/readme.md` and `contract.md` to point at
  `@mcpview/bridge`'s network adapter instead of describing the tunnel inline.
- Update `mcp-bridge/README.md` to describe the new generalized scope.

### What this ADR does NOT decide

- The on-the-wire protocol of the network tunnel (MCP-over-WebSocket framing,
  agent registration handshake schema, replay token format). These are the
  subject of a follow-up ADR or design doc when impl starts.
- Whether the `mcp-compose/deploy/` design (Deno Deploy-based ephemeral relay)
  is still the right shape for `erp-platform`'s permanent multi-tenant routing
  needs. Likely it is not — `erp-platform` will ship its own integration of the
  bridge's network server inside its Fresh app rather than spawning per-call
  workers.

## Trail of reasoning

Three independent sources converged on the same conclusion:

1. **Erwan (project owner)**: pointed out that semantically a _bridge_ and a
   _tunnel_ recover the same concept ("passing traffic between environments that
   can't talk directly"), and that "displaying in Telegram, displaying in
   Claude.ai, displaying in LINE — same fight".
2. **Claude (assistant)**: confirmed by reading the actual code that
   `bridge/core/` is generic JSON-RPC + WebSocket plumbing, not
   Telegram-specific. The Telegram/LINE adapters are thin specializations on top
   of generic primitives.
3. **Codex (independent review)**: initially recommended a new
   `@casys/mcp-tunnel` package on SRP grounds, before the semantic + code-reuse
   arguments were laid out. The revision is consistent with Codex's own caveat
   that "compose/deploy can become the first consumer/reference" — i.e. the
   primitive belongs upstream of compose, which now applies to bridge as well.
