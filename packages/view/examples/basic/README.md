# view-basic

End-to-end integration demo for `@mcpview/view`.

Exercises the real handshake + router path with two views (list, detail) and SPA navigation via
`ctx.navigate(...)` — the pattern that replaces `app.sendMessage("show details for X")` (which would
pollute the chat thread and trigger Claude's "the app is trying to speak for you" warning).

## Build

```bash
deno run --allow-all packages/view/examples/basic/build.ts
```

If your Deno cache was populated by a different user (hardlink EPERM during esbuild), override
`DENO_DIR`:

```bash
DENO_DIR=/tmp/deno-cache deno run --allow-all \
  packages/view/examples/basic/build.ts
```

Produces `dist/index.html`: a self-contained HTML file with CSS and the bundled JS inlined. No
external fetches, ready to be served as a `ui://` MCP resource.

Current output size: ~490 KB (JS 418 KB minified — dominated by transitive `zod` + full MCP SDK).
Above the initial 200 KB aspiration; see Blockers below.

## Open

Open `dist/index.html` directly in a browser. You will see:

- A banner "Local-only mode: no MCP host detected" (expected — the demo detects the absence of a
  parent frame and falls back to a local-only driver that runs the same view definitions without the
  ext-apps transport layer).
- A list of 3 mock invoices. Click any row (or focus + Enter) → detail view mounts, **same page,
  same tab, no chat message**.
- Back button → list view remounts with state preserved.

When hosted inside an MCP Apps-compatible client (Claude, Cursor, etc.), the same bundle takes the
`createMcpApp` path: real `ui/initialize` handshake, real `ctx.callTool` available to views.

## Files

- `src/main.ts` — entry, boots `createMcpApp` or local fallback.
- `src/list-view.ts` — `defineView` for list (3 mock invoices).
- `src/detail-view.ts` — `defineView` for detail (Back button).
- `src/state.ts` — shared `AppState` type.
- `src/styles.css` — inlined into the final HTML.
- `build.ts` — esbuild + deno loader, ESM bundle, inline to `dist/index.html`.

## Blockers / Notes

- **Bundle size**: `@modelcontextprotocol/ext-apps` pulls in the full `@modelcontextprotocol/sdk` +
  `zod@4`. Tree-shaking can't drop much because App/PostMessageTransport reference SDK schemas.
  Future: push ext-apps upstream for a browser-only sub-entry without server SDK, or rewrite the
  transport without SDK schema validation.
- **No Node builtins** were pulled in at runtime — the SDK path to `PostMessageTransport` stays
  DOM-only, as the spec requires.
- **No `import.meta.url` blockers** encountered: the SDK honours its own bundling rule (see
  `src/spec.md` §"Bundling rules").
