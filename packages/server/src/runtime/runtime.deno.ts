/**
 * Runtime adapter — Deno implementation
 *
 * Implements the RuntimePort contract for Deno.
 * Selected automatically by runtime.ts (the selector) when running under Deno.
 *
 * @see types.ts for the port contract
 * @module lib/server/runtime.deno
 */

import type {
  FetchHandler,
  RuntimePort,
  ServeHandle,
  ServeOptions,
} from "./types.ts";

// Re-export types so consumers import from a single module
export type { FetchHandler, ServeHandle, ServeOptions } from "./types.ts";

/**
 * Get an environment variable.
 */
export function env(key: string): string | undefined {
  return Deno.env.get(key);
}

/**
 * Read a UTF-8 text file.
 * Returns null if the file does not exist.
 */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return null;
    }
    throw err;
  }
}

/**
 * Write a UTF-8 text file.
 */
export async function writeTextFile(
  path: string,
  content: string,
  opts?: { mode?: number },
): Promise<void> {
  await Deno.writeTextFile(path, content, opts);
}

/**
 * Create a directory.
 */
export async function mkdir(
  path: string,
  opts?: { recursive?: boolean; mode?: number },
): Promise<void> {
  await Deno.mkdir(path, opts);
}

/**
 * Remove a file or empty directory. No-op if absent.
 */
export async function remove(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return;
    }
    throw err;
  }
}

/**
 * Read directory entry names. Returns [] if absent.
 */
export async function readDir(path: string): Promise<string[]> {
  try {
    const names: string[] = [];
    for await (const entry of Deno.readDir(path)) {
      names.push(entry.name);
    }
    return names;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return [];
    }
    throw err;
  }
}

/**
 * Start an HTTP server with a fetch-style handler.
 */
export function serve(
  options: ServeOptions,
  handler: FetchHandler,
): ServeHandle {
  let server: Deno.HttpServer | null = null;
  try {
    server = Deno.serve(
      {
        port: options.port,
        hostname: options.hostname,
        onListen: options.onListen,
      },
      handler,
    );
  } catch (err) {
    const error = toError(err);
    if (options.onError) {
      options.onError(error);
      return {
        shutdown: () => Promise.resolve(),
      };
    }
    throw error;
  }
  return {
    shutdown: () => server.shutdown(),
  };
}

/**
 * Unref a timer so it doesn't block process exit.
 */
export function unrefTimer(id: number): void {
  Deno.unrefTimer(id);
}

/** Compile-time contract check — ensures this module satisfies RuntimePort */
void ({
  env,
  readTextFile,
  writeTextFile,
  mkdir,
  remove,
  readDir,
  serve,
  unrefTimer,
} satisfies RuntimePort);

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
