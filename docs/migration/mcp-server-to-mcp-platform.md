# Migrate from `@casys/mcp-server` to `@casys/mcp-platform`

> **Note:** renamed back in 0.29.0. The framework is again `@casys/mcp-server`;
> `@casys/mcp-platform` 0.28.2 is now the deprecated alias re-exporting it. This
> guide documents the 0.28.0 move and is kept for history — to migrate today,
> apply the steps in reverse (install `@casys/mcp-server`, remove
> `@casys/mcp-platform`, swap the import specifier). There are no API changes in
> either direction.

The framework implementation moved to `@casys/mcp-platform` in 0.28.0.
`@casys/mcp-server` 0.27.1 became a deprecated compatibility package that
re-exports the platform API. This is a package-name migration, not an
application rewrite.

Existing imports can keep running through the alias while you migrate. New
projects should depend on `@casys/mcp-platform` directly.

## npm

Add the canonical package before removing the alias so the framework remains a
direct dependency throughout the lockfile update:

```bash
npm install @casys/mcp-platform
npm uninstall @casys/mcp-server
```

Then replace package imports:

```diff
-import { McpApp } from "@casys/mcp-server";
+import { McpApp } from "@casys/mcp-platform";
```

The npm alias itself depends on a compatible platform release and carries a
deprecation notice. Do not infer platform versions from the alias version: the
workspace packages are versioned independently.

## Deno and JSR

For a dependency recorded in `deno.json`:

```bash
deno add jsr:@casys/mcp-platform
deno remove @casys/mcp-server
```

Keep the bare import after `deno add`:

```typescript
import { McpApp } from "@casys/mcp-platform";
```

If source files use inline JSR specifiers instead of a `deno.json` import,
change them directly:

```diff
-import { McpApp } from "jsr:@casys/mcp-server";
+import { McpApp } from "jsr:@casys/mcp-platform";
```

## What stays compatible

The rename does not require changes to tool registration, middleware, auth,
concurrency, or observability APIs. The alias is guarded by an export-parity
test and contains no independent framework implementation.

Operational identifiers deliberately keep their established names:

- the default auth configuration file remains `mcp-server.yaml`;
- `MCP_AUTH_*` environment variables remain unchanged;
- Prometheus metrics keep the default `mcp_server_` prefix.

Renaming those identifiers would break deployments, dashboards, or alerts and is
not part of this package migration.

The current HTTP contract is also unchanged by the rename: it is stateless, uses
`POST /mcp`, creates no `Mcp-Session-Id`, and returns 405 for `GET /mcp`. SSE
remains available as a response stream for operations such as
`subscriptions/listen`; it is not the former GET/SSE session transport.

`ConcurrentMCPServer` is a separate, deprecated symbol alias for `McpApp`. It
still works from `@casys/mcp-platform`, but is documented for removal in v1.0;
prefer `McpApp` in newly touched code.

## Alias support boundary

- `@casys/mcp-server` remains usable as the currently published transition
  alias, so migration does not have to be atomic across every consumer.
- Framework implementation, documentation, and release history now continue
  under `@casys/mcp-platform`.
- The alias has no separate feature surface. Test and report framework issues
  against the platform package.
- This repository does not declare a removal version for the package alias.
  Deprecation means “migrate when practical,” not “existing imports stop now.”

After migrating, run the consumer's normal type-check and tests, then check for
remaining source imports:

```bash
rg '(@casys/mcp-server|jsr:@casys/mcp-server)'
```

See the [framework documentation](../../packages/server/README.md) for the
canonical API and the [alias README](../../packages/platform/README.md) for the
compatibility package boundary.
