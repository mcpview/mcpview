/**
 * Runtime adapter — selector
 *
 * Auto-detects the host runtime and forwards to the Deno or Node adapter.
 * This is the module every consumer imports. It replaces the previous
 * build-time file swap (runtime.ts <- runtime.node.ts), which only ever
 * applied to mcp-server's own npm build and never to JSR consumers that
 * bundle the Deno source for Node (e.g. @casys/mcp-erpnext via esbuild),
 * whose bundle therefore embedded `Deno.*` calls and crashed under Node
 * with "ReferenceError: Deno is not defined".
 *
 * A *dynamic* import is used on purpose so the inactive adapter is never
 * evaluated: under Deno, runtime.node.ts — and its top-level `node:http` /
 * `node:fs/promises` / `node:buffer` imports — never executes, which keeps
 * capability-restricted targets like Deno Deploy (the canonical cloud
 * target, where node:http's raw-TCP `createServer` is unsupported) safe at
 * load time. Platforms and bundlers that statically analyze
 * constant-specifier dynamic imports may still fetch or include the
 * inactive module, but they never run it. Under Node, the Deno adapter is
 * likewise never evaluated.
 *
 * @see types.ts for the RuntimePort contract
 * @see runtime.deno.ts / runtime.node.ts for the implementations
 * @module lib/server/runtime
 */

import type { RuntimePort } from "./types.ts";

// Re-export types so consumers import from a single module
export type { FetchHandler, ServeHandle, ServeOptions } from "./types.ts";

// Structural detection: a bare `globalThis.Deno = {}` shim (seen in some Node
// test setups and bundlers) must NOT be mistaken for a real Deno runtime, so
// probe a concrete field (`Deno.version.deno`) rather than mere existence.
const isDeno = typeof (globalThis as {
  Deno?: { version?: { deno?: string } };
}).Deno?.version?.deno === "string";

const impl: RuntimePort = isDeno
  ? await import("./runtime.deno.ts")
  : await import("./runtime.node.ts");

export const env = impl.env;
export const readTextFile = impl.readTextFile;
export const writeTextFile = impl.writeTextFile;
export const mkdir = impl.mkdir;
export const remove = impl.remove;
export const readDir = impl.readDir;
export const serve = impl.serve;
export const unrefTimer = impl.unrefTimer;
