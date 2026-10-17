/**
 * Runtime Port — platform-agnostic contract
 *
 * Defines the interface that both Deno (runtime.ts) and Node.js (runtime.node.ts)
 * must implement. This is the only file consumers need to understand the API shape.
 *
 * Pattern: each runtime file exports module-level functions that satisfy this port.
 * The build script swaps runtime.ts → runtime.node.ts for Node.js distribution.
 *
 * @module lib/server/runtime-types
 */

// ─── Environment ─────────────────────────────────────────

/**
 * Get an environment variable.
 * Returns undefined if not set (never throws).
 */
export type EnvFn = (key: string) => string | undefined;

// ─── File System ─────────────────────────────────────────

/**
 * Read a UTF-8 text file.
 * Returns null if the file does not exist (no throw on ENOENT/NotFound).
 * Throws on other errors (permission denied, etc.).
 */
export type ReadTextFileFn = (path: string) => Promise<string | null>;

/** Write a UTF-8 text file. */
export type WriteTextFileFn = (
  path: string,
  content: string,
  opts?: { mode?: number },
) => Promise<void>;

/** Create a directory. */
export type MkdirFn = (
  path: string,
  opts?: { recursive?: boolean; mode?: number },
) => Promise<void>;

/**
 * Remove a file or empty directory.
 * Does nothing if the path does not exist.
 */
export type RemoveFn = (path: string) => Promise<void>;

/**
 * Read directory entry names.
 * Returns [] if the directory does not exist.
 */
export type ReadDirFn = (path: string) => Promise<string[]>;

// ─── HTTP Server ─────────────────────────────────────────

/** Fetch-style request handler (Web standard) */
export type FetchHandler = (req: Request) => Response | Promise<Response>;

/** Options for starting an HTTP server */
export interface ServeOptions {
  port: number;
  hostname?: string;
  onListen?: (info: { hostname: string; port: number }) => void;
  /** Optional bind/startup error channel. */
  onError?: (err: Error) => void;
  /** Maximum request body size in bytes (optional, adapter-specific). */
  maxBodyBytes?: number | null;
}

/** Handle returned by serve(), used to shut down the server */
export interface ServeHandle {
  shutdown(): Promise<void>;
}

/**
 * Start an HTTP server with a fetch-style handler.
 *
 * Deno: wraps Deno.serve()
 * Node.js: wraps node:http.createServer() with Request/Response adapter
 */
export type ServeFn = (
  options: ServeOptions,
  handler: FetchHandler,
) => ServeHandle;

// ─── Timers ──────────────────────────────────────────────

/**
 * Unref a timer so it doesn't prevent process exit.
 *
 * Deno: Deno.unrefTimer(id)
 * Node.js: timer.unref() on the Timeout object
 */
export type UnrefTimerFn = (id: number) => void;

// ─── Port interface ──────────────────────────────────────

/**
 * Complete runtime port contract.
 *
 * Both runtime.ts (Deno) and runtime.node.ts (Node.js) must export
 * functions matching these signatures. Use `satisfies RuntimePort`
 * at the bottom of each implementation to enforce at compile time.
 *
 * @example
 * ```typescript
 * // At the bottom of runtime.ts / runtime.node.ts:
 * export const _port = {
 *   env,
 *   readTextFile,
 *   writeTextFile,
 *   mkdir,
 *   remove,
 *   readDir,
 *   serve,
 *   unrefTimer,
 * } satisfies RuntimePort;
 * ```
 */
export interface RuntimePort {
  env: EnvFn;
  readTextFile: ReadTextFileFn;
  writeTextFile: WriteTextFileFn;
  mkdir: MkdirFn;
  remove: RemoveFn;
  readDir: ReadDirFn;
  serve: ServeFn;
  unrefTimer: UnrefTimerFn;
}
