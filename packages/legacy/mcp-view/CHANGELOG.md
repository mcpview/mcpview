# Changelog

All notable changes to `@casys/mcp-view` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-10-24

### Changed

- Follows `@mcpview/view` 0.11.0: both the JSR and npm publications now depend on
  `@mcpview/view@^0.11.0`. Still a deprecated alias that re-exports the new package unchanged; see
  `packages/view/CHANGELOG.md` for what 0.11.0 brings.
- Re-exports `./context`; the new lower bound includes that entry point and the MCP SDK v2
  migration.

## [0.10.0] - 2026-10-17

### Changed

- **Deprecated alias.** Renamed from `@casys/mcp-view` to `@mcpview/view`: the whole family moved to
  the `@mcpview` scope. This package now re-exports `@mcpview/view` unchanged, with the same API and
  the same export sub-paths (`.`, `./contracts`, `./react`). Its npm publication is marked
  deprecated ("Moved to @mcpview/view"). The last release with code under this name is 0.9.5; its
  history is in the `@mcpview/view` changelog (`packages/view/CHANGELOG.md`).
- Both the JSR and npm publications depend on `@mcpview/view@^0.10.0`; the npm build derives that
  range from the Deno manifest so the two registries cannot drift apart. Compatible patches of the
  new package are adopted without another alias release.
- The export-name parity test (`mod_test.ts`) fails whenever the new package gains, drops, or
  renames an export or an entry point, and the npm publication smoke installs the declared lower
  bound as well as the newest compatible release.

### Documentation

- Added the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md):
  the package-name mapping and the import replacement. The rename is a package-name migration, not
  an API migration.
