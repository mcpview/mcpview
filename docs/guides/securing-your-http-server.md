# Securing your HTTP server

MCP over **STDIO** needs no auth — it is a local pipe. **HTTP mode is different:
anyone who can reach the port can call every tool.** This guide covers the
static and OIDC auth modes `@casys/mcp-server` ships and how to pick one.

> **Bind to loopback unless you mean to expose it.** `startHttp({ hostname })`
> controls the bind address, and reaching the port is what grants access. Bind
> to `127.0.0.1` for local / same-host use, and only expose a non-loopback
> interface (e.g. `0.0.0.0`, which is required inside Docker) once auth is
> configured.

## Which mode?

|            | Shared static allowlist                   | Identity-aware static credentials            | OAuth 2.0 / JWT (OIDC)                         |
| ---------- | ----------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| What it is | several secrets with one shared authority | one configured identity and scopes per token | tokens issued by an IdP and validated via JWKS |
| Best for   | Docker/VPN/LAN, service-to-service, CI    | a small set of known callers without an IdP  | external access, larger teams, SSO             |
| Identity   | one shared `subject` and scope set        | configured `subject` and scopes per token    | signed `subject`, scopes, and expiry           |
| Lifecycle  | manual provisioning and rotation          | manual provisioning and rotation             | issuer-managed lifecycle                       |

Rule of thumb: **no IdP in the picture → use one of the static forms.** Choose
identity-aware credentials only when audit trails, caller-bound state, or
different tool scopes must distinguish the provisioned tokens. If you need
issuer-managed identity, expiry, revocation policy, or SSO, use OIDC.

All three configurations validate the standard `Authorization: Bearer <token>`
header, and none applies to STDIO.

## Shared-authority static allowlist

```typescript
import { createStaticTokenAuthProvider, McpApp } from "@casys/mcp-server";

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: {
    provider: createStaticTokenAuthProvider(
      (Deno.env.get("MCP_AUTH_TOKENS") ?? "").split(",").filter(Boolean),
      { resource: "https://my-mcp.example.com" },
    ),
  },
});

// requireAuth: true fails fast at startup if no auth provider is configured.
await app.startHttp({ port: 7654, hostname: "0.0.0.0", requireAuth: true });
```

Generate high-entropy tokens (e.g. `openssl rand -base64 32`), keep them in env
or a secrets manager (never in source), and rotate them. Every valid token maps
to the same frozen identity and scopes: this authenticates membership in one
authority group, but it does not distinguish the tokens. Clients send
`Authorization: Bearer <token>`.

Keep this form for existing `MCP_AUTH_TOKENS`-style allowlists. Its semantics do
not change when more tokens are added.

## Identity-aware static credentials

When the resource server provisions one token per person or integration, pass
credential objects instead:

```typescript
import { createStaticTokenAuthProvider, McpApp } from "@casys/mcp-server";

const provider = createStaticTokenAuthProvider(
  [
    {
      token: Deno.env.get("MCP_ALICE_TOKEN")!,
      subject: "alice",
      scopes: ["erp:read"],
    },
    {
      token: Deno.env.get("MCP_AUTOMATION_TOKEN")!,
      subject: "automation",
      scopes: ["erp:read", "erp:write"],
    },
  ],
  { resource: "https://my-mcp.example.com" },
);

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: { provider },
});
await app.startHttp({ port: 7654, requireAuth: true });
```

Each token returns its own frozen `AuthInfo`; the union of credential scopes is
advertised as `scopes_supported` unless an explicit superset is supplied. Token
and subject whitespace is normalized; empty, reserved, or control-character
subjects and duplicate token mappings fail fast. Raw tokens are never copied
into auth claims, metadata, logs, or validation errors. Reusing a subject across
two different tokens is allowed intentionally for credential rotation.

Do not combine credential objects with the shared `subject` or `scopes` options,
and do not mix strings and objects in one list. These cases are ambiguous and
are rejected at construction.

## OAuth 2.0 / JWT (OIDC)

For per-user identity, expiry, and SSO, validate JWTs against your provider's
JWKS endpoint:

```typescript
import { createOIDCAuthProvider, McpApp } from "@casys/mcp-server";

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  auth: {
    provider: createOIDCAuthProvider({
      issuer: "https://my-tenant.example.com",
      audience: "mcp-my-server",
      resource: "https://my-mcp.example.com",
    }),
  },
});
await app.startHttp({ port: 7654, requireAuth: true });
```

Preset factories exist for common providers: `createAuth0AuthProvider`,
`createGoogleAuthProvider`, `createGitHubAuthProvider`. The token's `subject`
and `scopes` come from its signed claims.

## `requireAuth`

`startHttp({ requireAuth: true })` refuses to start when no auth provider is
configured. Use it in production so a misconfiguration fails loudly at startup
instead of silently exposing every tool.

## Per-tool scopes (optional)

If different callers should reach different tools, gate each tool by scope with
`createScopeMiddleware(new Map([["dangerous_tool", ["admin"]]]))`. The caller's
scopes come from the `AuthInfo` the provider returns:

- with a **shared static allowlist**, `scopes` applies equally to every token;
- with **identity-aware static credentials**, `scopes` is set on each entry;
- with **JWTs**, scopes are signed claims from your IdP.

Note this is authorization **at the MCP layer**, separate from any backend's own
permission model. If your tools call a backend that already has per-user
permissions, prefer enforcing there (per-user credentials) over rebuilding roles
here.

## Combining modes

`McpApp` takes a single `auth.provider`. To accept, say, both a static token and
JWTs, implement a small composite `AuthProvider` whose `verifyToken` tries each
underlying provider in turn — the `AuthProvider` base class is public for
exactly this kind of extension.
