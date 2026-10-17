# mcpview

[![JSR](https://jsr.io/badges/@mcpview/server)](https://jsr.io/@mcpview/server)
[![npm](https://img.shields.io/npm/v/@mcpview/server)](https://www.npmjs.com/package/@mcpview/server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**MCP server framework and MCP Apps view toolkit for Deno and Node.**

Maintained by Casys. Site: [mcpview.dev](https://mcpview.dev).

The official SDK gives you the protocol. mcpview gives you the server framework
around it: composable middleware, OAuth2 auth, concurrency control, and
observability — plus a view toolkit for interactive MCP Apps and multi-server
composition, all in TypeScript. Learn more at
[mcpview.dev](https://mcpview.dev).

The repository contains **six packages** under the `@mcpview` scope: one
canonical framework and five companion packages. The production-ready claim
applies to `@mcpview/server`; the companion packages are currently experimental
and may change before 1.0. The former `@casys/mcp-*` names stay published as
deprecated aliases (see [Coming from `@casys`](#coming-from-casys)).

```
rate-limit → auth → custom middleware → scope-check → validation → backpressure → handler
```

---

## Packages

| Package                                            | Status           | Description                                                                             |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| [`@mcpview/server`](packages/server/)              | **Production**   | Canonical server framework: middleware, auth, STDIO, stateless HTTP, and observability. |
| [`@mcpview/compose`](packages/compose/)            | **Experimental** | Collect, synchronize, and host multiple MCP Apps in one composed dashboard.             |
| [`@mcpview/bridge`](packages/bridge/)              | **Experimental** | Bridge MCP Apps and selected private-network tool calls across hosts and relays.        |
| [`@mcpview/contracts`](packages/view-contracts/)   | **Experimental** | Dependency-free App/resource, composition, and recorded-session contracts.              |
| [`@mcpview/view`](packages/view/)                  | **Experimental** | Browser-side MCP Apps lifecycle, routing, results, events, and tool calls.              |
| [`@mcpview/components`](packages/view-components/) | **Experimental** | Optional presentation runtime, theme, Preact kit, and Deno/JSR scaffold.                |

Package folders keep their historical names (`packages/view-contracts` publishes
`@mcpview/contracts`, `packages/view-components` publishes
`@mcpview/components`).

## Which package should I use?

Most MCP server projects need only `@mcpview/server`.

| You want to…                                                     | Use                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Build and run an MCP server                                      | `@mcpview/server`                                                                    |
| Share manifests and recorded-view contracts across runtimes      | `@mcpview/contracts`                                                                 |
| Build the browser runtime inside one MCP App                     | `@mcpview/view`                                                                      |
| Add the optional theme, components, Preact bindings, or scaffold | `@mcpview/components` together with `@mcpview/view`                                  |
| Combine several MCP Apps into one coordinated dashboard          | `@mcpview/compose`                                                                   |
| Reach messaging hosts or a Casys private-network relay           | `@mcpview/bridge`                                                                    |
| Keep an existing `@casys/mcp-*` application running              | The aliases still work; [migrate](docs/migration/casys-to-mcpview.md) when practical |

## Coming from `@casys`

The family moved from the `@casys` scope to `@mcpview` (JSR and npm). Only the
package names changed; APIs and operational identifiers did not. The old names
stay published as deprecated aliases that re-export the new packages, with the
same export sub-paths:

| Old name                     | New name              |
| ---------------------------- | --------------------- |
| `@casys/mcp-server`          | `@mcpview/server`     |
| `@casys/mcp-platform`        | `@mcpview/server`     |
| `@casys/mcp-view`            | `@mcpview/view`       |
| `@casys/mcp-view-components` | `@mcpview/components` |
| `@casys/mcp-view-contracts`  | `@mcpview/contracts`  |
| `@casys/mcp-compose`         | `@mcpview/compose`    |
| `@casys/mcp-bridge`          | `@mcpview/bridge`     |

See the [migration guide](docs/migration/casys-to-mcpview.md) and
[ADR 0003](docs/decision-records/0003-mcpview-brand.md).

---

## Quick Start

```bash
# npm
npm install @mcpview/server

# Deno
deno add jsr:@mcpview/server
```

Coming from `@casys/mcp-server` or `@casys/mcp-platform`? Both names keep
working as deprecated aliases — see the
[migration guide](docs/migration/casys-to-mcpview.md).

### STDIO Server

```typescript
import { McpApp } from "@mcpview/server";

const server = new McpApp({ name: "my-server", version: "1.0.0" });

server.registerTool(
  {
    name: "greet",
    description: "Greet a user",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
  ({ name }) => `Hello, ${name}!`,
);

await server.start();
```

### Stateless HTTP Server with Auth

```typescript
import { createAuth0AuthProvider, McpApp } from "@mcpview/server";

const server = new McpApp({
  name: "my-api",
  version: "1.0.0",
  transport: "stateless",
  maxConcurrent: 10,
  backpressureStrategy: "queue",
  validateSchema: true,
  rateLimit: { maxRequests: 100, windowMs: 60_000 },
  auth: {
    provider: createAuth0AuthProvider({
      domain: "my-tenant.auth0.com",
      audience: "https://my-mcp.example.com",
      resource: "https://my-mcp.example.com",
    }),
  },
});

await server.startHttp({ port: 3000 });
```

HTTP uses the current stateless transport: JSON-RPC requests go to `POST /mcp`,
no `Mcp-Session-Id` is created or required, and `GET /mcp` returns 405. SSE is
used only for response streams such as `subscriptions/listen`; it is not the
legacy GET/SSE session channel.

---

Prefer a **static bearer token** for same-network deployments (Docker/VPN/LAN) —
no IdP required:

```typescript
import { createStaticTokenAuthProvider, McpApp } from "@mcpview/server";

const app = new McpApp({
  name: "my-api",
  version: "1.0.0",
  auth: {
    provider: createStaticTokenAuthProvider(
      (Deno.env.get("MCP_AUTH_TOKENS") ?? "").split(",").filter(Boolean),
      { resource: "https://my-mcp.example.com" },
    ),
  },
});
await app.startHttp({ port: 3000, requireAuth: true });
```

See **[Securing your HTTP server](docs/guides/securing-your-http-server.md)**
for choosing between static tokens and OAuth/OIDC, `requireAuth`, and per-tool
scopes.

## Why mcpview?

|                          |  Official SDK   |           @mcpview/server           |
| ------------------------ | :-------------: | :---------------------------------: |
| MCP protocol compliance  |       Yes       |                 Yes                 |
| Composable middleware    |        —        |     Onion model (like Hono/Koa)     |
| OAuth2 / JWT auth        |        —        |    4 OIDC presets + YAML config     |
| Concurrency control      |        —        |      3 backpressure strategies      |
| Rate limiting            |        —        |     Sliding window, per-client      |
| Schema validation        |        —        |          JSON Schema (ajv)          |
| Stateless HTTP           | Building blocks |     `POST /mcp`, no session IDs     |
| Change subscriptions     | Building blocks | `subscriptions/listen` SSE response |
| OpenTelemetry tracing    |        —        |    Automatic spans per tool call    |
| Prometheus metrics       |        —        |         `/metrics` endpoint         |
| MCP Apps (UI resources)  |     Manual      |   `registerResource()` + `ui://`    |
| Multi-server composition |        —        |         `@mcpview/compose`          |

---

## Overview

### @mcpview/server — The Framework

The core of the family. Build MCP servers with the same developer experience as
Hono or Koa — register tools, plug in middleware, start serving.

**Highlights:**

- **Middleware pipeline** — rate-limit, auth, validation, backpressure, all
  composable
- **4 OAuth2 presets** — Google, Auth0, GitHub Actions, generic OIDC
- **Two serving modes** — STDIO for local/CLI clients and stateless HTTP for
  remote clients
- **Explicit change streams** — `subscriptions/listen` returns an SSE stream;
  there is no legacy GET/SSE session transport
- **Observability** — OpenTelemetry spans + Prometheus metrics out of the box
- **MCP Apps** — serve interactive UIs as MCP resources

[Full documentation and API reference](packages/server/README.md)

### `@casys/*` — Deprecated Aliases

> _Deprecated — existing imports work, but new code should use the `@mcpview`
> packages._

The seven former `@casys/mcp-*` names (`mcp-server`, `mcp-platform`, `mcp-view`,
`mcp-view-components`, `mcp-view-contracts`, `mcp-compose`, `mcp-bridge`)
contain no implementation of their own. Each re-exports its `@mcpview/*` target
with the same export sub-paths, so consumers can migrate the package name
without combining that change with an application rewrite.

[Migration guide](docs/migration/casys-to-mcpview.md)

### MCP Apps Packages

> _Experimental — APIs may change._

- [`@mcpview/contracts`](packages/view-contracts/) owns portable,
  dependency-free manifests and session contracts.
- [`@mcpview/view`](packages/view/) owns the browser-side MCP App lifecycle,
  routing, results, and events.
- [`@mcpview/components`](packages/view-components/) is the optional
  presentation layer and scaffold; Apps that do not want it do not import it.

### @mcpview/compose — Multi-Server Composition

> _Experimental — API may change._

Orchestrate multiple MCP Apps UIs into composite dashboards. Define layouts,
sync rules between panels, and let the composition engine handle the event
routing.

[Documentation](packages/compose/README.md)

### @mcpview/bridge — Host And Network Bridge

> _Experimental — API may change._

Deliver MCP Apps interactive UIs through messaging platforms, and route selected
private-network tool calls through Casys-owned relays. Telegram Mini Apps and
LINE LIFF are the UI bridge adapters; `adapters/network` contains the outbound
WebSocket tunnel primitives used by SaaS-to-local runtimes.

For direct publication of a local `@mcpview/server` to ChatGPT, Codex, or the
Responses API, use OpenAI's official `tunnel-client` around the MCP server
rather than reimplementing OpenAI's hosted tunnel protocol in this package.

[Documentation](packages/bridge/README.md)

---

## Development

Deno workspace — cross-package imports resolve automatically. The root
`deno.json` declares the workspace but intentionally has no tasks; run tasks in
each package.

```bash
# From the repository root: run every package test suite
# (the six packages, then the seven deprecated aliases in packages/legacy/)
for pkg in view-contracts server view view-components compose bridge \
  legacy/mcp-server legacy/mcp-platform legacy/mcp-view-contracts legacy/mcp-view \
  legacy/mcp-view-components legacy/mcp-compose legacy/mcp-bridge; do
  (cd "packages/$pkg" && deno task test) || exit 1
done

# Or run one package from the repository root
(cd packages/server && deno task test)
```

## License

MIT — maintained by Casys. See [mcpview.dev](https://mcpview.dev).
