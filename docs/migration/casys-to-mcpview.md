# Migrate from `@casys/*` to `@mcpview/*`

The MCP server framework and the MCP Apps view toolkit moved from the `@casys`
scope to the **mcpview** brand: scope `@mcpview` on JSR and npm, repository
[`mcpview/mcpview`](https://github.com/mcpview/mcpview), site
[mcpview.dev](https://mcpview.dev). The packages are maintained by Casys.

This is a package-name migration, not an application rewrite. APIs, behavior,
and operational identifiers are unchanged. Version numbers continue instead of
restarting, and every old name stays published as a deprecated alias that
re-exports the new package, so nothing stops working the day you read this.

## Name mapping

| Old name (`@casys/…`)        | New name (`@mcpview/…`) | First version under the new name | Last alias on the old name |
| ---------------------------- | ----------------------- | -------------------------------- | -------------------------- |
| `@casys/mcp-server`          | `@mcpview/server`       | 0.29.0                           | 0.28.0                     |
| `@casys/mcp-platform`        | `@mcpview/server`       | 0.29.0                           | 0.29.0                     |
| `@casys/mcp-view`            | `@mcpview/view`         | 0.10.0                           | 0.10.0                     |
| `@casys/mcp-view-components` | `@mcpview/components`   | 0.10.0                           | 0.10.0                     |
| `@casys/mcp-view-contracts`  | `@mcpview/contracts`    | 0.2.0                            | 0.2.0                      |
| `@casys/mcp-compose`         | `@mcpview/compose`      | 0.10.0                           | 0.10.0                     |
| `@casys/mcp-bridge`          | `@mcpview/bridge`       | 0.4.0                            | 0.4.0                      |

`@casys/mcp-platform` was an alias of the framework; it now maps to
`@mcpview/server`. There is no `@mcpview/platform`.

The versions continue the old lines: `@mcpview/server` 0.29.0 sits above the
last `@casys/mcp-server` release (0.27.2) and the last `@casys/mcp-platform`
framework release (0.28.1), so upgrade ordering stays unambiguous on both
registries. The other packages take the next minor of their last published
version.

Other Casys products keep their names and scope (for example
`@casys/mcp-erpnext` and `@casys/mcp-einvoice`); only the packages above moved.

## The aliases

Each old name has a final release that re-exports its target unchanged. The
aliases declare the same export sub-paths as the target, depend on the target's
current minor (for example `@mcpview/view@^0.10.0`), and are guarded by a parity
test that fails when the target gains, drops, or renames an export. On npm they
carry a deprecation notice ("Moved to @mcpview/…").

| Alias                        | Re-exports            | Sub-paths                                                                                  |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `@casys/mcp-server`          | `@mcpview/server`     | `.`                                                                                        |
| `@casys/mcp-platform`        | `@mcpview/server`     | `.`                                                                                        |
| `@casys/mcp-view`            | `@mcpview/view`       | `.`, `./contracts`, `./react`                                                              |
| `@casys/mcp-view-components` | `@mcpview/components` | `.`, `./preact`, `./preact/components`, `./scaffold`\*, `./surface`, `./layout`, `./fonts` |
| `@casys/mcp-view-contracts`  | `@mcpview/contracts`  | `.`                                                                                        |
| `@casys/mcp-compose`         | `@mcpview/compose`    | `.`, `./core`, `./sdk`, `./host`, `./runtime`, `./deploy`                                  |
| `@casys/mcp-bridge`          | `@mcpview/bridge`     | `.`, `./adapters/network`                                                                  |

\* `./scaffold` is Deno/JSR-only, as in `@mcpview/components`: it exists on JSR
and not in the npm package.

The aliases have no feature surface of their own. Report problems against the
`@mcpview/*` package, and move to it when practical. This repository declares no
removal version for the aliases: deprecation means "migrate when convenient",
not "existing imports stop now".

## npm

Add the new package before removing the old one, so the framework stays a direct
dependency throughout the lockfile update:

```bash
npm install @mcpview/server
npm uninstall @casys/mcp-server @casys/mcp-platform
```

Do the same for each package you use (`@mcpview/view`, `@mcpview/components`,
`@mcpview/contracts`, `@mcpview/compose`, `@mcpview/bridge`). Keep related
packages on the same line: `@mcpview/components` depends on `@mcpview/view`
`^0.10.0` and `@mcpview/contracts` `^0.2.0`.

## Deno and JSR

For dependencies recorded in `deno.json`:

```bash
deno add jsr:@mcpview/server
deno remove @casys/mcp-server @casys/mcp-platform
```

Keep the bare import after `deno add`. Inline specifiers and version pins change
the same way, including scaffold commands:

```diff
-import { McpApp } from "jsr:@casys/mcp-server";
+import { McpApp } from "jsr:@mcpview/server";
```

```diff
-deno run -A jsr:@casys/mcp-view-components@0.9.2/scaffold result-viewer ./my-view
+deno run -A jsr:@mcpview/components@0.10.0/scaffold result-viewer ./my-view
```

## Replace the imports

Imports change by name only, sub-paths included. A mechanical pass over your own
sources (review the diff; it rewrites only the `@casys/mcp-*` names listed
above):

```bash
perl -pi -e '
  s{\@casys/mcp-view-components(?![\w-])}{\@mcpview/components}g;
  s{\@casys/mcp-view-contracts(?![\w-])}{\@mcpview/contracts}g;
  s{\@casys/mcp-view(?![\w-])}{\@mcpview/view}g;
  s{\@casys/mcp-compose(?![\w-])}{\@mcpview/compose}g;
  s{\@casys/mcp-bridge(?![\w-])}{\@mcpview/bridge}g;
  s{\@casys/mcp-(server|platform)(?![\w-])}{\@mcpview/server}g;
' $(git ls-files '*.ts' '*.tsx' '*.js' '*.mjs' '*.json' '*.md' ':!package-lock.json' ':!deno.lock')
```

Then regenerate the lockfile (`npm install` or `deno install`), run the normal
type-check and tests, and look for leftovers:

```bash
rg '@casys/mcp-(server|platform|view|view-components|view-contracts|compose|bridge)\b'
```

If your code imported `@casys/mcp-platform` 0.28.x, the same pass applies; the
platform name is not carried over.

## What does not change

- **API and class names.** `McpApp`, `ConcurrentMCPServer` (the deprecated alias
  of `McpApp`, still slated for removal in v1.0), `createMcpApp`, `defineView`,
  and every other export keep their names.
- **Operational identifiers.** The default auth configuration file stays
  `mcp-server.yaml`, the `MCP_AUTH_*` environment variables are unchanged, and
  Prometheus metrics keep the default `mcp_server_` prefix. Renaming them would
  break deployments, dashboards, and alerts for no benefit.
- **Wire identifiers.** Capability, schema, and URI identifiers such as
  `io.casys.mcp.view-components/v1`, `io.casys.semantic-selection/1.0`, and
  `ui://mcp-compose/...` are part of the protocol surface, not of a package
  name, so Apps and hosts built against earlier releases keep interoperating.
- **HTTP contract.** Stateless `POST /mcp`, no `Mcp-Session-Id`, `GET /mcp`
  returns 405; SSE remains a response format for operations such as
  `subscriptions/listen`.
- **Directory layout and release mechanics.** `packages/*` keeps its folders,
  versions stay independent per package, and tags are `<pkg>-v<version>`.

## Package-internal changes worth knowing

- `@mcpview/components` scaffolds projects that import `@mcpview/view` and
  `@mcpview/components`, pinned to the releases that scaffold was built against.
- `@mcpview/compose` announces itself as `@mcpview/compose` when it connects to
  a panel server, and `@mcpview/bridge` announces `@mcpview/bridge` during
  `ui/initialize`; both were `@casys/mcp-*` strings before.
- npm metadata (`repository`, `homepage`, `bugs`) points at `mcpview/mcpview`
  and `https://mcpview.dev`.

See [ADR 0003](../decision-records/0003-mcpview-brand.md) for the decision and
its reasons, and the per-package changelogs for the rename entries.
