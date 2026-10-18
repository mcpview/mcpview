# ADR 0003: The Family Moves to the mcpview Brand

Date: 2026-10-17 Status: Accepted Scope: monorepo (all packages)

Replaces the earlier draft of this ADR ("Framework Name Returns to
@casys/mcp-server"), which was never released.

## Context

In September 2026 the framework was renamed from `@casys/mcp-server` to
`@casys/mcp-platform` (framework 0.28.0–0.28.1; the old name continued as a
deprecated alias, 0.27.1–0.27.2). The rename did not hold. "MCP Platform" is a
category name already sold by enterprise gateway vendors (Credal, Stacklok, …):
it describes their product class, not a server framework library, and invites
confusion about what the package is.

The first reaction was to go back to `@casys/mcp-server` (a draft 0.29.0, with
`@casys/mcp-platform` 0.28.2 as the alias, and a repository renamed
`superWorldSavior/mcp-server`). That would have been the second rename in a
month, and it left the underlying problems in place:

- The `@casys` scope ties generic libraries to a company. The family has two
  audiences, MCP server authors and MCP Apps view authors, and neither needs to
  adopt a vendor name.
- `mcp-server` and `mcp-platform` are descriptive names. Nobody can own them,
  they collide with every other project that uses the same words, and the family
  has no identity of its own across JSR, npm, GitHub, and a domain.
- A separate brand scope for the generic libraries was already the stated next
  move; doing it after another rename would cost consumers a third migration.

## Decision

1. **The family is branded mcpview.** The publication scope is `@mcpview` on
   both JSR and npm. The GitHub organisation and repository are
   [`mcpview/mcpview`](https://github.com/mcpview/mcpview), and the site is
   [mcpview.dev](https://mcpview.dev). The tagline is "MCP server framework and
   MCP Apps view toolkit for Deno and Node", and the packages are "Maintained by
   Casys".
2. **Package mapping.** Folders under `packages/*` do not change; package names
   do.

   | Folder                     | Old name                     | New name              | Version |
   | -------------------------- | ---------------------------- | --------------------- | ------- |
   | `packages/server`          | `@casys/mcp-server`          | `@mcpview/server`     | 0.29.0  |
   | `packages/view`            | `@casys/mcp-view`            | `@mcpview/view`       | 0.10.0  |
   | `packages/view-components` | `@casys/mcp-view-components` | `@mcpview/components` | 0.10.0  |
   | `packages/view-contracts`  | `@casys/mcp-view-contracts`  | `@mcpview/contracts`  | 0.2.0   |
   | `packages/compose`         | `@casys/mcp-compose`         | `@mcpview/compose`    | 0.10.0  |
   | `packages/bridge`          | `@casys/mcp-bridge`          | `@mcpview/bridge`     | 0.4.0   |

3. **Seven deprecated aliases**, republished only when their target's minor
   version moves (see Consequences), live in
   `packages/legacy/<old-name-without-scope>/`. Each re-exports its target with
   `export * from "@mcpview/<x>"`, declares the same export sub-paths as the
   target, ships an npm build marked `deprecated: "Moved to @mcpview/<x>"`, and
   is guarded by an export-key parity test per sub-path.

   | Alias                        | Target                | Version |
   | ---------------------------- | --------------------- | ------- |
   | `@casys/mcp-server`          | `@mcpview/server`     | 0.28.0  |
   | `@casys/mcp-platform`        | `@mcpview/server`     | 0.29.0  |
   | `@casys/mcp-view`            | `@mcpview/view`       | 0.10.0  |
   | `@casys/mcp-view-components` | `@mcpview/components` | 0.10.0  |
   | `@casys/mcp-view-contracts`  | `@mcpview/contracts`  | 0.2.0   |
   | `@casys/mcp-compose`         | `@mcpview/compose`    | 0.10.0  |
   | `@casys/mcp-bridge`          | `@mcpview/bridge`     | 0.4.0   |

   `@casys/mcp-platform` stops being the framework's umbrella name and becomes
   an alias of `@mcpview/server`, like the others.
4. **Versions continue.** Nothing restarts at 0.1.0. Each package takes the next
   minor of its last published version (the framework takes 0.29.0, above both
   the 0.27.x line published as `@casys/mcp-server` and the 0.28.x line
   published as `@casys/mcp-platform`), so upgrade ordering stays unambiguous.
5. **The intermediate step is abandoned.** The planned return to
   `@casys/mcp-server` 0.29.0 with the `superWorldSavior/mcp-server` repository
   is dropped; neither was released, and the move goes straight to mcpview.

What does not change:

- No API or runtime change: this is a package-name move. Class and API names
  (`McpApp`, the deprecated `ConcurrentMCPServer` alias, `createMcpApp`, …) are
  untouched, and imports under the old names keep working through the aliases.
- Operational identifiers keep their established names: the `mcp-server.yaml`
  configuration file, the `MCP_AUTH_*` environment variables, and the Prometheus
  `mcp_server_` metric prefix. Wire identifiers such as
  `io.casys.mcp.view-components/v1` and `ui://mcp-compose/...` also stay: they
  are protocol surface, not package names.
- Release mechanics are unchanged: independent per-package versions,
  `<pkg>-v<version>` tags, JSR and npm publication from `publish.yml`. The alias
  tags use the old name without the scope (`mcp-server-v0.28.0`).
- Other Casys products keep the `@casys` scope.

## Consequences

Positive:

- The family gets an identity of its own, separate from Casys, with a name that
  is distinctive and available on every surface it needs (JSR scope, npm
  organisation, GitHub organisation, domain).
- "MCP Platform" goes back to being what it is, a category name, instead of the
  name of a library.
- One migration instead of two. Consumers who already moved to
  `@casys/mcp-platform` 0.28.x and those still on `@casys/mcp-server` reach the
  same place, and neither has to touch an application's code beyond import names
  (see `docs/migration/casys-to-mcpview.md`).

Negative (the cost):

- A rename for every consumer, mitigated by the aliases and by the absence of
  any API change. The accumulated visibility of `@casys/mcp-server` (41
  published versions, a JSR score of 100) stays with the old name; the new names
  start from zero.
- Seven thin packages to keep honest. The parity tests and the lower-bound smoke
  in `publish.yml` exist so that they stay accurate without per-release
  attention; an alias only needs a new release when its target's minor moves.
- Registry bookkeeping outside this repository, in order: create the GitHub
  organisation `mcpview` and transfer the repository; create the JSR scope
  `@mcpview` and the six packages, then link each to `mcpview/mcpview` (JSR's
  OIDC publishing checks the linked repository); link the seven old `@casys`
  packages to the same repository; create the npm organisation `mcpview` and a
  publish token for the `NPM_TOKEN` secret; set `npm deprecate` on the older
  versions of the old names; archive the old packages on JSR.
- A wide metadata sweep inside the repo (workspace, CI jobs and their dependency
  order, build scripts, docs, skills), done once and covered by the existing
  suites plus the alias parity tests.

## References

- `docs/migration/casys-to-mcpview.md` — the package mapping, the aliases, and
  the import replacement.
- `docs/decision-records/0002-view-layer-positioning.md` — the packaging table
  under the new names.
- Root `AGENTS.md` / `CLAUDE.md` — package map and release process.
