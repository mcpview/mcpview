# Changelog

All notable changes to `@casys/mcp-server` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.28.0] - 2026-10-17

### Changed

- **Deprecated alias.** Renamed from `@casys/mcp-server` to `@mcpview/server`: the whole family
  moved to the `@mcpview` scope. This package now re-exports `@mcpview/server` unchanged, with the
  same API and the same export sub-paths (`.`). Its npm publication is marked deprecated ("Moved to
  @mcpview/server"). The last release of the framework under this name is 0.27.2; its history is in
  the `@mcpview/server` changelog (`packages/server/CHANGELOG.md`).
- Both the JSR and npm publications depend on `@mcpview/server@^0.29.0`; the npm build derives that
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
