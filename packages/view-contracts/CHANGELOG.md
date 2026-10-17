# Changelog

All notable changes to `@mcpview/contracts` (published as `@casys/mcp-view-contracts` up to 0.1.1)
will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-17

### Changed

- Renamed from `@casys/mcp-view-contracts` to `@mcpview/contracts`. The whole family moves to the
  `@mcpview` scope on JSR and npm (repository `mcpview/mcpview`, site https://mcpview.dev,
  maintained by Casys). Same code and same API: only the dependency and import name change. The
  version moves to the next minor, and `@casys/mcp-view-contracts@0.2.0` stays published as a
  deprecated alias that re-exports this package.
- Schema and capability identifiers (`io.casys.*`) are unchanged: they are part of the wire
  contract, not of the package name.
- See the
  [migration guide](https://github.com/mcpview/mcpview/blob/main/docs/migration/casys-to-mcpview.md).

## [0.1.1] - 2026-09-18

### Fixed

- Update npm `repository` metadata to the renamed `Casys-AI/mcp-platform` repository. No code
  changes.

## [0.1.0] - 2026-08-31

### Added

- Initial release: dependency-free App/resource manifests and composition/session contracts, split
  out of `@casys/mcp-view`.
