/**
 * Wire-level primitives shared by the dispatch code and its extracted guards.
 *
 * This module exists to keep `http/request-guards.ts` from importing
 * `mcp-app.ts`, which would be a cycle. It holds only what both need: no state,
 * no `McpApp` reference.
 *
 * Not re-exported from `mod.ts` — internal.
 *
 * @module lib/server/http/wire
 */

/**
 * Sentinel used when there is no authentication at all.
 *
 * Deliberately not a plausible subject value. Authenticated callers are also
 * checked against this exact value before MRTR or task state is accepted, so a
 * custom provider cannot create an authority collision by returning it.
 */
export const MRTR_NO_AUTH_PRINCIPAL = "\u0000unauthenticated";

export function jsonRpcResponse(
  payload: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

/**
 * Narrow type-guard: returns true iff `v` is a plain object (not array, not null).
 * Used to safely extract fields from JSON-RPC `params` without unsafe casts.
 */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
