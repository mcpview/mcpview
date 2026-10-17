# ADR 0003: Framework Name Returns to @casys/mcp-server

Date: 2026-10-17 Status: Accepted Scope: monorepo (server, platform)

## Context

In September 2026 the framework was renamed from `@casys/mcp-server` to
`@casys/mcp-platform` (framework 0.28.0–0.28.1 in `packages/platform/`; the old
name continued as a deprecated alias, 0.27.1–0.27.2). The rename has not held:

- "MCP Platform" is a category name already sold by enterprise gateway vendors
  (Credal, Stacklok, …). It describes their product class, not a server
  framework library, and invites confusion about what this package is.
- `@casys/mcp-server` carries the accumulated equity: 41 published versions and
  a JSR score of 100. The `mcp-erpnext` pilot still imports it.
- The new name gained nothing in return: the 0.28.x line is two patch releases
  old, and every consumer reaches the same API under either name.

The repository also needs one public identity. The maintainer wants the
framework repository separated from the Casys-AI GitHub organisation, while
`@casys` remains the publication scope on JSR and npm.

## Decision

1. **`@casys/mcp-server` 0.29.0 is the framework again.** The implementation
   returns to `packages/server/` with its tests, scripts, and npm build, and no
   longer depends on `@casys/mcp-platform`. Its npm publication carries no
   deprecation notice. 0.29.0 is deliberately above both previous lines (alias
   0.27.2, platform 0.28.1) so version ordering stays unambiguous.
2. **`@casys/mcp-platform` 0.28.2 becomes the deprecated alias**: a thin
   `export * from "@casys/mcp-server"` in `packages/platform/`, depending on
   `^0.29.0`, guarded by the same export-parity test the previous alias used,
   with the npm notice "Renamed back to @casys/mcp-server".
3. **The repository is `superWorldSavior/mcp-platform`.** Package metadata,
   READMEs, and documentation links point there. The `@casys` scope stays the
   JSR/npm publication namespace; "Casys MCP Platform" stays the monorepo name.

What does not change:

- No API or runtime change in either direction; both renames are pure
  package-name moves, and imports under either name keep working.
- Operational identifiers keep their established names: the `mcp-server.yaml`
  config file, the `MCP_AUTH_*` environment variables, and the Prometheus
  `mcp_server_` metric prefix. Renaming those would break deployments,
  dashboards, and alerts for no benefit.
- The five companion packages (`compose`, `bridge`, `view-contracts`, `view`,
  `view-components`) keep their names, versions, and boundaries.
- Release mechanics are unchanged: independent per-package versions,
  `<pkg>-v<version>` tags, JSR + npm publication from `publish.yml`.

## Consequences

Positive:

- One canonical framework name that matches what the package is, the pilot's
  imports, and the operational identifiers that never changed.
- The 0.28.x adopters are not stranded: `@casys/mcp-platform` keeps working as
  an alias, exactly as `@casys/mcp-server` did during the interlude.

Negative (the cost):

- A second rename within a month. Consumers who just migrated to 0.28.x see
  another deprecation flip; mitigated by the alias and by zero API change, but
  the churn is real. The next move (a dedicated brand scope and organization for
  the generic libraries) should happen once, with every package at the same
  time.
- Registry bookkeeping outside this repo: remove the npm deprecation from
  `@casys/mcp-server`, deprecate `@casys/mcp-platform`, archive or freeze the
  platform package on JSR after 0.28.2, and check that the JSR repository links
  point to `superWorldSavior/mcp-platform`. The repository keeps its name, so no
  JSR re-linking is needed for this move.
- A wide metadata sweep inside the repo (workspace, CI jobs and their dependency
  order, build scripts, docs, skills). One-off, mechanical, and covered by the
  existing test suites plus the alias parity test.

## References

- `docs/migration/mcp-server-to-mcp-platform.md` — the 0.28.0 migration guide,
  now headed by the renamed-back note.
- Root `AGENTS.md` / `CLAUDE.md` — canonical package map and release process.
