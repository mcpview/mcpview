/**
 * HTTP body reading, with a size ceiling.
 *
 * Extracted from `mcp-app.ts`: these are pure functions over Web APIs with no
 * dependency on `McpApp` state, which is exactly what made them separable when
 * the dispatch code was not. Keeping them here makes them unit-testable without
 * standing up a server.
 *
 * Not re-exported from `mod.ts` — this is internal.
 *
 * @module lib/server/http/body
 */

/** Default cap on a request body, in bytes. */
export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Payload too large. Max ${maxBytes} bytes.`);
    this.name = "BodyTooLargeError";
  }
}

export function getClientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return headers.get("x-real-ip") ??
    headers.get("cf-connecting-ip") ??
    "unknown";
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes: number | null,
): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (maxBytes !== null && contentLength) {
    const length = Number(contentLength);
    if (!Number.isNaN(length) && length > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (maxBytes !== null && total > maxBytes) {
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
