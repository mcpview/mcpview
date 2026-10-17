# Changelog

All notable changes to `@mcpview/bridge` (published as `@casys/mcp-bridge` up to
0.3.1) will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-10-17

### Changed

- Renamed from `@casys/mcp-bridge` to `@mcpview/bridge`. The whole family moves
  to the `@mcpview` scope on JSR and npm (repository `mcpview/mcpview`, site
  https://mcpview.dev, maintained by Casys). Same code and same API: only the
  dependency and import name change. Version numbers continue from 0.3.1, and
  `@casys/mcp-bridge@0.4.0` stays published as a deprecated alias with the same
  `.` and `./adapters/network` entry points.
- The default bridge identity announced during `ui/initialize` is now
  `@mcpview/bridge`.
- Wire identifiers (`mcp-bridge-ready`, `mcp-bridge-auth-error`) are unchanged.
- See the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## [0.3.1] - 2026-09-19

### Changed

- Refresh the companion-package documentation and npm repository metadata for
  the canonical `@casys/mcp-platform` name and renamed `Casys-AI/mcp-platform`
  repository. Existing `@casys/mcp-server` consumers remain supported through
  the deprecated compatibility alias.

### Fixed

- Include `README.md`, `LICENSE`, and `CHANGELOG.md` in the generated npm
  package so the published tarball carries its usage guidance, licence, and
  release history alongside the runtime files.

## [0.3.0] - 2026-05-19

### Added

- **New submodule `@casys/mcp-bridge/adapters/network`.** Outbound WebSocket
  tunnel primitives: agents inside a customer LAN dial a SaaS relay and serve
  `tool.call` over the resulting socket. Three pieces: `NetworkRelay`
  (server-side registry + routing), `NetworkTunnelClient` (agent-side handler
  with reconnect loop) and `WebSocketNetworkTransport` (concrete WS transport
  supporting bearer header / custom headers; query bearer accepted at the bridge
  but redacted from all error output, see below).
- **`NETWORK_PROTOCOL_VERSION = 1` constant** on the wire contract.
  `agent.hello` and `agent.ready` frames carry `protocolVersion`; mismatched or
  missing values close with WS code 4002 "protocol version mismatch". Lets
  future incompatible changes be rejected deterministically.
- **`NetworkRelayError` class** with `code`/`context`/`recovery` fields (AX #4 —
  structured machine-readable errors). Five codes: `NO_TUNNEL_AGENT`,
  `TUNNEL_AGENT_BUSY`, `TUNNEL_AGENT_DISCONNECTED`, `TUNNEL_REQUEST_CANCELLED`,
  `TUNNEL_REQUEST_TIMEOUT`. Replaces the previous plain `Error("CODE message")`
  strings that callers had to grep on.
- **Per-agent `AbortSignal` end-to-end.** `RegisteredNetworkAgent.send` now
  accepts `{ signal }`; on relay timeout the controller aborts and a
  cancellation frame is sent over the socket so the local agent can drop its
  in-flight work. The agent slot stays "busy" until the send path actually
  settles, so a timed-out call cannot leak a concurrent slot.
- **`NetworkTunnelReconnectOptions`** on `NetworkTunnelClient`. Bounded
  exponential backoff (default initial 1s, cap 60s, ±20% jitter), re-hello on
  each connect. Terminal close codes (4001 auth / 4002 protocol / 4004 no config
  / 4009 wrong mode) stop the loop and surface a structured error via
  `onTerminalError`. Recoverable codes (1006-style) retry.

### Changed

- **`NetworkRelay` default `concurrencyStrategy` is now `"reject"`**
  (one-call-at-a-time per agent). The previous default was `"parallel"` which a
  review surfaced as unsafe — a slow handler could leak concurrent slots and
  break the relay's per-agent isolation guarantee. Callers that need parallel
  mode must opt in explicitly via `concurrencyStrategy: "parallel"`. **This is a
  breaking change for consumers that relied on the parallel default; valid under
  pre-1.0 semver.**
- **Pending in-flight calls are now rejected on socket close AND on
  `unregisterAgent`.** Previously a close mid-call left the awaiting caller
  hanging on a never-resolving promise. Now both paths reject with structured
  `TUNNEL_AGENT_DISCONNECTED` / `TUNNEL_REQUEST_CANCELLED`.
- **Test-only `allowInsecureNetworkAgentHelloForTests` helper** moved from the
  public exports (`adapters/network/mod.ts` and root `src/mod.ts`) into a
  non-published `_test-fixtures.ts` fixture file. Production consumers could
  previously build a relay that accepted any `agent.hello` — that surface is
  removed.

### Security

- **Query bearer tokens are now redacted from WS error strings.** The transport
  supports `auth.via: "query"` for environments where headers can't be injected;
  when this fails (connect refused, close before open) the URL — including any
  `access_token`/`token` parameter — was previously interpolated into the error
  message and propagated to caller logs. A new `redactUrl(url, queryParam?)`
  helper replaces bearer values with `***` before interpolation. Default-strip
  set: `access_token`, `token`; consumers can pass a custom `queryParam`.

### Fixed

- **`scripts/build-npm.ts` no longer hardcodes the package version.** The script
  now reads `version` from `packages/bridge/deno.json` (single source of truth —
  same pattern as `packages/compose/scripts/build-npm.ts`). Previously every npm
  publish would have shipped `0.2.0` regardless of the value in `deno.json`.
  Pure build-time fix; no runtime impact.

### Migration notes

- Consumers that explicitly relied on `concurrencyStrategy: "parallel"` being
  the default must add it to their `NetworkRelay` options now. Recommended: keep
  the new `"reject"` default; only opt back into parallel if you have specific
  reason (and document it).
- Consumers that imported `allowInsecureNetworkAgentHelloForTests` from
  `@casys/mcp-bridge` or `@casys/mcp-bridge/adapters/network` must import the
  helper directly from `@casys/mcp-bridge/adapters/network/_test-fixtures.ts`
  (test-only; not part of the public API surface).
- The new `protocolVersion` field is REQUIRED on `agent.hello` and
  `agent.ready`. The bundled `NetworkTunnelClient` sets it automatically; custom
  clients must set it to `NETWORK_PROTOCOL_VERSION`.

## [0.2.0] - 2026-03-XX

Initial workspace release. The package was imported into the monorepo from a
standalone repository (`packages/bridge` was added via `git subtree`), and the
standalone CI was retired in favour of the central
`.github/workflows/publish.yml`.

Detailed history before the workspace import is preserved in the upstream
repository's git history. Future bumps will use scoped conventional commits
(`feat(bridge):`, `fix(bridge):`) so subsequent entries can be machine-extracted
via `git-cliff`.

### Public API surface (frozen)

`@casys/mcp-bridge` ships protocol utilities for bridging MCP Apps interactive
UIs to messaging platforms (Telegram Mini Apps, LINE LIFF). Server-side helpers
run under Deno; the npm package exposes the runtime-agnostic client and protocol
utilities (the resource server piece needs Deno because it uses `Deno.serve` /
`Deno.readTextFile`).

See `README.md` and `docs/` for usage.
