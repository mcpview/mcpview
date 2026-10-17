# `@mcpview/view`

Browser-side core runtime for MCP Apps. It creates the ext-apps connection, applies host styles,
provides memory-only view routing, handles result and teardown lifecycle, capability-gates calls to
the originating MCP server, and exposes the optional Compose event channel.

## Install

```bash
# Deno (JSR)
deno add jsr:@mcpview/view

# Node (npm)
npm i @mcpview/view
```

```ts
import { createMcpApp, defineView } from "@mcpview/view";

const app = await createMcpApp({
  info: { name: "Engineering Viewer", version: "0.1.0" },
  root: document.getElementById("root")!,
  views: {
    home: defineView({ render: () => "<h1>Ready</h1>" }),
  },
  initialView: "home",
});
```

The root export has no component kit, theme, React, or Preact export. React remains an optional
adapter subpath for existing component trees:

```tsx
import { readStructuredContent } from "@mcpview/view";
import { defineReactView } from "@mcpview/view/react";

const detail = defineReactView<State, { id: string }, Invoice>({
  async onEnter(ctx, { id }) {
    return readStructuredContent<Invoice>(await ctx.callTool("invoice_get", { id }));
  },
  component: ({ ctx, data }) => (
    <InvoiceViewer
      invoice={data}
      onBack={() => ctx.navigate("list")}
    />
  ),
});
```

React and ReactDOM are optional npm peers and are never loaded by the main export.

## Package boundaries

- `@mcpview/contracts` owns the dependency-free App/resource manifest, composition, semantic
  selection, and recorded-session compatibility contracts. The compatibility subpath
  `@mcpview/view/contracts` re-exports it.
- `@mcpview/components` owns component catalogs, surface mounting, generic presentation roles, the
  ERPNext-inspired theme, Preact bindings, and the Deno/JSR result-viewer scaffold.
- `@mcpview/view` owns only the iframe lifecycle, routing, results, events, tools, sampling, and
  optional React adapter.

Domain rendering stays in the owning MCP App. The generic component package deliberately contains no
CAD, Modelica, FEA, SysML, ERP, or other domain viewer.

## App-owned resource manifests

Server-side code should import the standalone contracts package:

```ts
import {
  defineViewAppManifest,
  VIEW_APP_MANIFEST_SCHEMA,
  VIEWER_SESSION_APPLY_ACTION,
} from "@mcpview/contracts";

export const manifest = defineViewAppManifest({
  schemaVersion: VIEW_APP_MANIFEST_SCHEMA,
  app: { id: "io.casys.mcp-example.results", title: "Example results", version: "1.0.0" },
  resources: [{
    uri: "ui://mcp-example/results-viewer",
    ownership: "whole-view",
    resultSchemas: ["io.casys.example.result/1.0"],
    acceptedActions: [VIEWER_SESSION_APPLY_ACTION],
    sessionSchemas: ["io.casys.thread.example-viewer-session/1.0"],
  }],
});
```

A `whole-view` resource is valid without a component catalog. `viewer.session.apply` and
`sessionSchemas` are an inseparable resource-level declaration; compatibility is never inferred from
whichever components happen to be mounted.

## Recorded viewer sessions

Declare `viewerSession` on `createMcpApp()`. The runtime calls `onViewerSession()` before
`connect()`, buffers valid early actions until the initial route and handle exist, and serializes
delivery. The host forwards an opaque payload; the owning App validates the versioned envelope
before interpreting it:

```ts
const app = await createMcpApp<State, ExampleViewerSession>({
  // ...info, root, views, initialView
  viewerSession: {
    validate: isExampleViewerSession,
    async onSession(session, _payload, app) {
      app.ctx.state.currentSession = session;
      await app.navigate("result", session);
    },
  },
});
```

The subscription belongs to the App resource and is disposed with it; mounted components never own
it. Disposal is synchronous: it unsubscribes, drops queued sessions, and revokes both `app.navigate`
and `app.ctx.navigate` on the session callback facade. It does not wait for or cancel arbitrary
callback code already in flight; that code may finish, but it cannot navigate late through the
revoked facade. The underlying router remains independently fail-closed after App disposal.

The surface Apps of `@mcpview/components` (`/surface`, `/preact`) take the same flow as a
`viewerSession: { validate, toState }` pair and keep the projected state across remounts.

## Host tool notifications

Pass `onToolInput`, `onToolInputPartial`, or `onToolResult` directly to `createMcpApp`. Each
callback receives the host notification and a complete `AppHandle`.

```ts
const app = await createMcpApp({
  // ...info, root, views, initialView
  async onToolResult(result, app) {
    if (result.isError) return;
    await app.navigate("summary", result.structuredContent);
  },
});
```

The callbacks are installed before `App.connect()`. Events received during the handshake or initial
route are buffered and replayed in arrival order after the handle exists. Async callbacks are
serialized; one failure does not stop later notifications.

Use `readStructuredContent()` for the normal data path or `readResultData()` when a legacy JSON text
fallback is explicitly requested. Neither helper prefers model-facing text over `structuredContent`.

For an executable two-view core bundle, see [`examples/basic`](./examples/basic/README.md). Run the
componentized result-viewer generator from JSR with
`deno run -A jsr:@mcpview/components@0.10.0/scaffold result-viewer <target>`. The Deno-only scaffold
is deliberately absent from the npm package.
