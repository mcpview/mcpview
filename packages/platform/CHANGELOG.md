# Changelog

All notable changes to `@casys/mcp-platform` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.28.2] - 2026-10-17

### Changed

- **Deprecated alias:** the framework was renamed back to `@casys/mcp-server@^0.29.0`. This package
  now re-exports it unchanged, and its npm publication is marked deprecated ("Renamed back to
  @casys/mcp-server"). Framework history continues in the `@casys/mcp-server` changelog.
- Both JSR and npm publications depend on `@casys/mcp-server@^0.29.0`, with the npm build deriving
  that range from the Deno package manifest so the two registries cannot drift apart. The package
  remains a pure re-export, and compatible framework patches are adopted without another alias
  release.
- The npm publication smoke type-checks a strict NodeNext consumer through the deprecated package
  name as well as importing it at runtime, against both the newest compatible framework release and
  the declared `0.29.0` lower bound. This protects value and type re-exports without silently
  raising the alias floor.

### Documentation

- Added explicit npm and Deno migration steps back to `@casys/mcp-server`. The rename is a
  package-name migration, not an API migration.

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
