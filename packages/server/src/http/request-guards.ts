/**
 * Request-scoped guards: who is calling, and may they touch this task.
 *
 * Extracted from `mcp-app.ts`. Like `body.ts`, these are pure over their
 * arguments — they read no `McpApp` state — which is what let them move at all.
 * `jsonRpcResponse` stays in `mcp-app.ts` and is passed in rather than imported,
 * so this module has no edge back to the class.
 *
 * Not re-exported from `mod.ts` — internal.
 *
 * @module lib/server/http/request-guards
 */

import { ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "./../auth/types.ts";
import type { McpAppOptions } from "./../types.ts";
import { jsonRpcResponse, MRTR_NO_AUTH_PRINCIPAL } from "./wire.ts";

/**
 * Principal to bind a `requestState` to.
 *
 * Three cases, only two of which are acceptable:
 *
 * 1. **No auth configured** — every caller shares one authority by definition, so
 *    there is no boundary to enforce and the sentinel above is honest about it.
 *    The method and argument bindings still apply.
 * 2. **Authenticated with a subject** — the binding separates callers, which is
 *    the case it exists for.
 * 3. **Authenticated without a usable subject** — `AuthInfo.subject` falls back to
 *    `"unknown"` for a valid token carrying no `sub` claim. The reserved no-auth
 *    sentinel is also invalid for authenticated callers. Sealing against either
 *    would hide an authority collision. Returns `null` so the caller fails closed.
 */
export function callerPrincipal(authInfo: AuthInfo | undefined): string | null {
  if (authInfo === undefined) return MRTR_NO_AUTH_PRINCIPAL;
  const subject = authInfo.subject;
  if (
    subject === undefined || subject === "" || subject === "unknown" ||
    subject === MRTR_NO_AUTH_PRINCIPAL
  ) {
    // `null`, not a throw: the task handlers call this outside any try/catch, so
    // a throw would surface through the POST-level catch as -32700 "Parse error"
    // — a diagnosis pointing nowhere near a misconfigured auth provider. The
    // caller turns this into an explicit error instead.
    return null;
  }
  return subject;
}

/**
 * Authorization key for a task-related request.
 *
 * Defaults to the authenticated principal. A consumer whose authorization depends
 * on more than identity — a tenant, an organisation, a workspace — supplies
 * `taskOwnerKey` so that dimension becomes part of the key. Without it, binding to
 * the subject alone leaves a task created under one tenant reachable from another
 * by the same user.
 */
export async function taskOwnerKeyFor(
  options: McpAppOptions,
  authInfo: AuthInfo | undefined,
  request: Request | undefined,
  principal: string,
): Promise<string | null> {
  if (options.taskOwnerKey === undefined || request === undefined) {
    return principal;
  }
  let key: unknown;
  try {
    key = await options.taskOwnerKey(authInfo, request);
  } catch {
    // A throwing hook is a consumer bug, but it must fail closed and legibly —
    // not escape to the POST-level catch and be reported as -32700 Parse error.
    return null;
  }
  // An empty or non-string key would put every caller under one owner, undoing
  // the isolation the hook exists to provide — and `""` is exactly what the
  // obvious implementation yields when a header is missing. Refuse it rather
  // than silently sharing tasks between callers.
  if (typeof key !== "string" || key.length === 0) return null;
  return key;
}

/** The error to return when `taskOwnerKey` produced an unusable value. */
export function noOwnerKeyError(id: unknown, version: string): Response {
  return jsonRpcResponse(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: ErrorCode.InternalError,
        message:
          "taskOwnerKey returned an empty or non-string value, which would place every caller under one owner.",
        data: {
          problem: "invalid_task_owner_key",
          recovery:
            'Return a non-empty string. If the value it derives from can be absent, decide explicitly what an anonymous caller\'s key is rather than letting it fall to "".',
        },
      },
    },
    500,
    { "MCP-Protocol-Version": version },
  );
}

/** The error to return when no caller boundary can be established. */
export function noPrincipalError(id: unknown, version: string): Response {
  return jsonRpcResponse(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: ErrorCode.InternalError,
        message:
          "Server cannot establish a caller identity: the auth provider returned no usable subject for an authenticated request.",
        data: {
          problem: "no_caller_principal",
          recovery:
            "Configure the auth provider to supply a subject claim, or disable auth if all callers genuinely share one authority.",
        },
      },
    },
    500,
    { "MCP-Protocol-Version": version },
  );
}

/** Lowercase hex encoding, for the requestState nonce. */
export function bytesToHexLocal(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build a JSON-RPC response with an explicit HTTP status.
 *
 * Module-scoped rather than nested in `startHttp`: request-validation helpers on
 * the class need it too, and duplicating the header defaults is how a response
 * ends up missing its Content-Type.
 */
