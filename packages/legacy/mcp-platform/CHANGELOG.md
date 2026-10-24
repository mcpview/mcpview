# Changelog

All notable changes to `@casys/mcp-platform` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.30.0] - 2026-10-24

### Changed

- Follows `@mcpview/server` 0.30.0: both the JSR and npm publications now depend on
  `@mcpview/server@^0.30.0`. Still a deprecated alias that re-exports the new package unchanged; see
  `packages/server/CHANGELOG.md` for what 0.30.0 brings.

## [0.29.0] - 2026-10-17

### Changed

- **Deprecated alias.** Renamed from `@casys/mcp-platform` to `@mcpview/server`: the whole family
  moved to the `@mcpview` scope. This package now re-exports `@mcpview/server` unchanged, with the
  same API and the same single `.` entry point. Its npm publication is marked deprecated ("Moved to
  @mcpview/server"). The last release carrying the framework under this name is 0.28.1; the
  framework history continues in the `@mcpview/server` changelog (`packages/server/CHANGELOG.md`).
- Both the JSR and npm publications depend on `@mcpview/server@^0.29.0`; the npm build derives that
  range from the Deno manifest so the two registries cannot drift apart. Compatible patches of the
  framework are adopted without another alias release.
- The export-name parity test (`mod_test.ts`) fails whenever the framework gains, drops, or renames
  an export. The npm publication smoke type-checks a strict NodeNext consumer through the deprecated
  package name, against both the newest compatible framework release and the declared `0.29.0` lower
  bound, so the alias floor cannot be raised silently.

### Documentation

- Added the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md):
  the package-name mapping and the import replacement. The rename is a package-name migration, not
  an API migration.

## [0.28.1] - 2026-09-19

### Fixed

- The release pre-flight now type-checks and runs `api-surface_test.ts`. That test exercises the
  covered Tasks, MRTR, and subscription entry points through the public `mod.ts`, guarding those
  exports against becoming unreachable to published-package consumers.

### Documentation

- Clarified that `startHttp()` is stateless Streamable HTTP: it accepts MCP requests over `POST`,
  does not create session IDs, and does not expose the legacy SSE `GET` stream. The OpenTelemetry
  example now reflects the same contract instead of showing a session attribute the transport does
  not emit.
- Added a short guide to the companion packages and linked the complete `@casys/mcp-server` to
  `@casys/mcp-platform` migration. These are release and documentation corrections only; the
  framework API and runtime are unchanged.

## [0.28.0] - 2026-09-18

### Changed

- **Package renamed: the framework is now `@casys/mcp-platform`.** Same code, same API —
  `packages/server/` moved to `packages/platform/` following the repository rename. Earlier entries
  in the framework changelog preserve the history released as `@casys/mcp-server`.
- `@casys/mcp-server` continues as a deprecated alias re-exporting this package, so existing imports
  keep working unchanged. (`0.1.0` first published the platform name as a one-line umbrella; this
  release moves the framework itself here.)

## [0.1.0] - 2026-09-18

### Added

- First release of the `@casys/mcp-platform` name as an umbrella that re-exported
  `@casys/mcp-server@^0.27.0`. It introduced no API or runtime of its own, so existing framework
  imports and behavior remained unchanged. The framework itself moved under this package in
  `0.28.0`.

The framework history before the 0.28.0 rename (0.27.x and earlier, released as `@casys/mcp-server`)
is preserved in the `@casys/mcp-server` changelog, where it continues from 0.29.0.
