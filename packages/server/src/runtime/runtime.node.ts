// deno-lint-ignore-file no-process-global
/**
 * Runtime adapter — Node.js implementation
 *
 * Implements the RuntimePort contract for Node.js.
 * Drop-in replacement for runtime.ts (Deno) — swapped by build script.
 *
 * @see runtime-types.ts for the port contract
 * @module lib/server/runtime.node
 */

import { Buffer } from "node:buffer";
import {
  mkdir as nodeMkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import type {
  FetchHandler,
  RuntimePort,
  ServeHandle,
  ServeOptions,
} from "./types.ts";

// Re-export types so consumers import from a single module
export type { FetchHandler, ServeHandle, ServeOptions } from "./types.ts";

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Payload too large. Max ${maxBytes} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Get an environment variable.
 */
export function env(key: string): string | undefined {
  return process.env[key];
}

/**
 * Read a UTF-8 text file.
 * Returns null if the file does not exist.
 */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (err: unknown) {
    if (
      err && typeof err === "object" && "code" in err && err.code === "ENOENT"
    ) {
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
  await writeFile(path, content, { mode: opts?.mode });
}

/**
 * Create a directory.
 */
export async function mkdir(
  path: string,
  opts?: { recursive?: boolean; mode?: number },
): Promise<void> {
  await nodeMkdir(path, { recursive: opts?.recursive, mode: opts?.mode });
}

/**
 * Remove a file or empty directory. No-op if absent.
 */
export async function remove(path: string): Promise<void> {
  try {
    await rm(path);
  } catch (err: unknown) {
    if (isNodeNotFound(err)) {
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
    return await readdir(path);
  } catch (err: unknown) {
    if (isNodeNotFound(err)) {
      return [];
    }
    throw err;
  }
}

/**
 * Start an HTTP server with a fetch-style handler.
 * Uses node:http with a Request/Response adapter (compatible with Hono).
 */
export function serve(
  options: ServeOptions,
  handler: FetchHandler,
): ServeHandle {
  const hostname = options.hostname ?? "0.0.0.0";
  const maxBodyBytes = options.maxBodyBytes ?? null;

  const server = createServer(async (nodeReq, nodeRes) => {
    try {
      const contentLength = nodeReq.headers["content-length"];
      if (maxBodyBytes !== null && contentLength) {
        const length = Array.isArray(contentLength)
          ? Number(contentLength[0])
          : Number(contentLength);
        if (!Number.isNaN(length) && length > maxBodyBytes) {
          nodeRes.writeHead(413);
          nodeRes.end(`Payload too large. Max ${maxBodyBytes} bytes.`);
          return;
        }
      }

      // Convert Node.js IncomingMessage → Web Request
      // Prefer Host header (correct behind reverse proxy) over bound hostname
      const host = nodeReq.headers.host ?? `${hostname}:${options.port}`;
      const url = `http://${host}${nodeReq.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(nodeReq.headers)) {
        if (value) {
          if (Array.isArray(value)) {
            for (const v of value) headers.append(key, v);
          } else {
            headers.set(key, value);
          }
        }
      }

      const body = nodeReq.method !== "GET" && nodeReq.method !== "HEAD"
        ? await collectBody(nodeReq, maxBodyBytes)
        : undefined;

      const request = new Request(url, {
        method: nodeReq.method ?? "GET",
        headers,
        body,
        // @ts-ignore: duplex needed for streaming requests in Node 20+
        duplex: body ? "half" : undefined,
      });

      // Call the fetch handler (Hono, etc.)
      const response = await handler(request);

      // Convert Web Response → Node.js ServerResponse
      // Use raw header entries to preserve duplicate Set-Cookie headers
      const resHeaders: Record<string, string | string[]> = {};
      response.headers.forEach((value, key) => {
        const existing = resHeaders[key];
        if (existing !== undefined) {
          resHeaders[key] = Array.isArray(existing)
            ? [...existing, value]
            : [existing, value];
        } else {
          resHeaders[key] = value;
        }
      });
      nodeRes.writeHead(response.status, resHeaders);

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          nodeRes.write(value);
        }
        nodeRes.end();
      } else {
        nodeRes.end();
      }
    } catch (err) {
      if (err instanceof PayloadTooLargeError) {
        if (!nodeRes.headersSent) {
          nodeRes.writeHead(413);
          nodeRes.end(err.message);
        }
        return;
      }
      console.error("[runtime.node] Request handler error:", err);
      if (!nodeRes.headersSent) {
        nodeRes.writeHead(500);
        nodeRes.end("Internal Server Error");
      }
    }
  });

  server.on("error", (err) => {
    if (options.onError) {
      options.onError(err);
      return;
    }
    setTimeout(() => {
      throw err;
    }, 0);
  });

  server.listen(options.port, hostname, () => {
    if (options.onListen) {
      const address = server.address();
      const port = typeof address === "object" && address !== null
        ? address.port
        : options.port;
      options.onListen({ hostname, port });
    }
  });

  return {
    shutdown: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err && !isNodeServerNotRunning(err)) {
            reject(err);
            return;
          }
          resolve();
        });
      }),
  };
}

/**
 * Unref a timer so it doesn't block process exit.
 */
export function unrefTimer(id: number): void {
  // In Node.js, setTimeout returns a Timeout object (not a numeric ID).
  // The caller passes it as `number` for Deno compat — we cast back.
  try {
    const timer = id as unknown as { unref?: () => void };
    if (
      typeof timer === "object" && timer && typeof timer.unref === "function"
    ) {
      timer.unref();
    }
  } catch (err) {
    console.warn("[runtime.node] Failed to unref timer:", err);
  }
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

// ─── Internal helpers ────────────────────────────────────

/** Collect request body from Node.js IncomingMessage */
function collectBody(
  req: import("node:http").IncomingMessage,
  maxBytes: number | null,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      if (rejected) return;
      total += chunk.length;
      if (maxBytes !== null && total > maxBytes) {
        rejected = true;
        req.destroy();
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rejected) {
        const body = Buffer.concat(chunks);
        resolve(
          body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ),
        );
      }
    });
    req.on("error", (err) => {
      if (!rejected) {
        reject(err);
      }
    });
  });
}

function isNodeNotFound(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && err.code === "ENOENT",
  );
}

function isNodeServerNotRunning(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err &&
      err.code === "ERR_SERVER_NOT_RUNNING",
  );
}
