# Casys MCP Platform

[![JSR](https://jsr.io/badges/@casys/mcp-server)](https://jsr.io/@casys/mcp-server)
[![npm](https://img.shields.io/npm/v/@casys/mcp-server)](https://www.npmjs.com/package/@casys/mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**MCP server framework for Deno and Node**, with companion packages for Apps,
composition, and bridges.

The official SDK gives you the protocol. Casys MCP Platform gives you the server
framework around it: composable middleware, OAuth2 auth, concurrency control,
and observability — plus companion packages for interactive UIs and multi-server
composition, all in TypeScript.

The repository contains **seven workspace packages**: one canonical framework,
one deprecated compatibility alias, and five companion packages. The
production-ready claim applies to `@casys/mcp-server`; the companion packages
are currently experimental and may change before 1.0.

```
rate-limit → auth → custom middleware → scope-check → validation → backpressure → handler
```

---

## Packages

| Package                                                   | Status               | Description                                                                               |
| --------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| [`@casys/mcp-server`](packages/server/)                   | **Production**       | Canonical server framework: middleware, auth, STDIO, stateless HTTP, and observability.   |
| [`@casys/mcp-platform`](packages/platform/)               | **Deprecated alias** | Thin compatibility re-export of `@casys/mcp-server`; it is not a separate implementation. |
| [`@casys/mcp-compose`](packages/compose/)                 | **Experimental**     | Collect, synchronize, and host multiple MCP Apps in one composed dashboard.               |
| [`@casys/mcp-bridge`](packages/bridge/)                   | **Experimental**     | Bridge MCP Apps and selected private-network tool calls across hosts and relays.          |
| [`@casys/mcp-view-contracts`](packages/view-contracts/)   | **Experimental**     | Dependency-free App/resource, composition, and recorded-session contracts.                |
| [`@casys/mcp-view`](packages/view/)                       | **Experimental**     | Browser-side MCP Apps lifecycle, routing, results, events, and tool calls.                |
| [`@casys/mcp-view-components`](packages/view-components/) | **Experimental**     | Optional presentation runtime, theme, Preact kit, and Deno/JSR scaffold.                  |

## Which package should I use?

Most MCP server projects need only `@casys/mcp-server`.

| You want to…                                                     | Use                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Build and run an MCP server                                      | `@casys/mcp-server`                                                                                                 |
| Keep an existing `@casys/mcp-platform` application running       | The alias still works; [migrate to the canonical name](docs/migration/mcp-server-to-mcp-platform.md) when practical |
| Share manifests and recorded-view contracts across runtimes      | `@casys/mcp-view-contracts`                                                                                         |
| Build the browser runtime inside one MCP App                     | `@casys/mcp-view`                                                                                                   |
| Add the optional theme, components, Preact bindings, or scaffold | `@casys/mcp-view-components` together with `@casys/mcp-view`                                                        |
| Combine several MCP Apps into one coordinated dashboard          | `@casys/mcp-compose`                                                                                                |
| Reach messaging hosts or a Casys private-network relay           | `@casys/mcp-bridge`                                                                                                 |

---

## Quick Start

```bash
# npm
npm install @casys/mcp-server

# Deno
deno add jsr:@casys/mcp-server
```

Coming from `@casys/mcp-platform` (0.28.x)? The framework was renamed back to
`@casys/mcp-server` in 0.29.0 — see the
[package migration guide](docs/migration/mcp-server-to-mcp-platform.md).

### STDIO Server

```typescript
import { McpApp } from "@casys/mcp-server";

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
import { createAuth0AuthProvider, McpApp } from "@casys/mcp-server";

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
import { createStaticTokenAuthProvider, McpApp } from "@casys/mcp-server";

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

## Why Casys MCP Platform?

|                          |  Official SDK   |          @casys/mcp-server          |
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
| Multi-server composition |        —        |        `@casys/mcp-compose`         |

---

## Platform Overview

### @casys/mcp-server — The Framework

The core of the platform. Build MCP servers with the same developer experience
as Hono or Koa — register tools, plug in middleware, start serving.

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

### @casys/mcp-platform — Compatibility Alias

> _Deprecated — existing imports work, but new code should use the canonical
> package._

This package contains no independent framework implementation. It re-exports the
public API of `@casys/mcp-server` so consumers can migrate the package name
without combining that change with an application rewrite.

[Migration guide](docs/migration/mcp-server-to-mcp-platform.md)

### MCP Apps Packages

> _Experimental — APIs may change._

- [`@casys/mcp-view-contracts`](packages/view-contracts/) owns portable,
  dependency-free manifests and session contracts.
- [`@casys/mcp-view`](packages/view/) owns the browser-side MCP App lifecycle,
  routing, results, and events.
- [`@casys/mcp-view-components`](packages/view-components/) is the optional
  presentation layer and scaffold; Apps that do not want it do not import it.

### @casys/mcp-compose — Multi-Server Composition

> _Experimental — API may change._

Orchestrate multiple MCP Apps UIs into composite dashboards. Define layouts,
sync rules between panels, and let the composition engine handle the event
routing.

[Documentation](packages/compose/README.md)

### @casys/mcp-bridge — Host And Network Bridge

> _Experimental — API may change._

Deliver MCP Apps interactive UIs through messaging platforms, and route selected
private-network tool calls through Casys-owned relays. Telegram Mini Apps and
LINE LIFF are the UI bridge adapters; `adapters/network` contains the outbound
WebSocket tunnel primitives used by SaaS-to-local runtimes.

For direct publication of a local `@casys/mcp-server` to ChatGPT, Codex, or the
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
for pkg in server platform compose bridge view-contracts view view-components; do
  (cd "packages/$pkg" && deno task test) || exit 1
done

# Or run one package from the repository root
(cd packages/server && deno task test)
```

## License

MIT
