# ADR 0003: Ship one vanilla result-viewer scaffold

Date: 2026-07-31 Status: Accepted

Historical package note: the generator moved to the Deno/JSR-only
`jsr:@casys/mcp-view-components/scaffold` subpath in the 2026-08-31 package split (that package is
now `@mcpview/components`, see root ADR 0003). The npm package deliberately excludes it. The 0.4.0
paths below record the original decision, under the package names of the time.

## Context

MCP Apps repeatedly need the same small amount of view-side plumbing: a shell that survives host
themes, a pre-connect `onToolResult` callback, clear loading/empty/error states, and a safe display
of metrics and evidence artifacts. Recopying one product view into another server produces stale
branding and, more seriously, late tool-result handlers that miss the initiating result.

The Modelica results viewer is the concrete signal: its lifecycle and data presentation are useful,
but its run, scenario, engine, and evidence schema are not a reusable public contract.

## Decision

Publish `@casys/mcp-view/scaffold` in 0.4.0 with exactly one generator:

```sh
deno run -A jsr:@casys/mcp-view@0.4.0/scaffold result-viewer <target> [--force]
```

The generated project is vanilla TypeScript and self-contained. It contains an HTML entrypoint,
inline-bundle build script, main/bootstrap, generic model/parser, render helpers, host-aware CSS,
and a focused test. The bootstrap passes `onToolInput` and `onToolResult` into `createMcpApp` so the
SDK registers one-shot handlers before `connect()` and buffers the result until the initial view
exists.

The generic parser handles only a record-shaped `structuredContent`, optional metrics, optional
URI-bearing artifacts, and scalar details. It is a visual baseline, not a schema validator or a
component library.

## Consequences

- New MCP servers can get a correct initial-result lifecycle without copying another product view.
- Consumers still own their data schema, server registration, CSP, and final UI decisions.
- The generator refuses non-empty directories by default; `--force` remains explicit and does not
  delete unrelated files.
- React/Vue templates, a multi-template registry, icons, data fetching, and server scaffolding stay
  out of scope until there is a concrete second signal.
