# @mcpview/contracts

Dependency-free contracts for MCP App resources, composition, and recorded viewer sessions.

The package is safe to import from MCP servers, hosts, agents, and browser Apps. Its public module
graph has no DOM, MCP Apps runtime, MCP SDK, React, or Preact dependency.

## Install

```bash
# Deno (JSR)
deno add jsr:@mcpview/contracts

# Node (npm)
npm i @mcpview/contracts
```

```ts
import {
  defineViewAppManifest,
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "@mcpview/contracts";

export const manifest = defineViewAppManifest({
  schemaVersion: VIEW_APP_MANIFEST_SCHEMA,
  app: { id: "io.casys.cad.results", title: "CAD results", version: "1.0.0" },
  resources: [{
    uri: "ui://mcp-cad/results-viewer",
    ownership: "whole-view",
    resultSchemas: ["io.casys.cad.execution/1.0"],
    acceptedActions: [VIEWER_SESSION_APPLY_ACTION],
    sessionSchemas: ["io.casys.thread.cad-viewer-session/1.0"],
  }],
});
```

`viewer.session.apply` and `sessionSchemas` are an inseparable resource-level declaration. The
payload stays opaque to the host and is validated by the owning App. Component catalogs are optional
for `whole-view` resources and required only for `component-catalog` resources.

Schema identities must end in an exact numeric version such as `/1.0` or `/1.2.3`; mutable aliases
(`latest`, `stable`, `v1`) and version ranges are rejected. Every manifest array, including nested
JSON arrays in component props, must be dense and carry no additional own properties.
