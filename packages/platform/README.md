# @casys/mcp-platform (deprecated alias)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Deprecated:** the framework was renamed back to
> [`@casys/mcp-server`](https://github.com/superWorldSavior/mcp-platform/blob/main/packages/server/README.md)
> in 0.29.0. This package re-exports it unchanged so existing 0.28.x imports keep working. New code
> should install `@casys/mcp-server` directly.

No immediate migration is required: the alias exposes the same API and keeps existing applications
working. When you are ready, switch the dependency and import name; no framework API rewrite is
needed.

## Migrate from npm

```bash
npm install @casys/mcp-server
npm uninstall @casys/mcp-platform
```

## Migrate from Deno / JSR

```bash
deno add jsr:@casys/mcp-server
deno remove @casys/mcp-platform
```

Then update only the package specifier:

```typescript
// Still supported through the compatibility alias:
import { McpApp } from "@casys/mcp-platform";

// Canonical package:
import { McpApp } from "@casys/mcp-server";
```
