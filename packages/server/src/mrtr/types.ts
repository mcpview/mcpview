/**
 * Type definitions for Multi Round-Trip Requests (MRTR, spec 2026-07-28, SEP-2322).
 *
 * MRTR entirely replaces the old server-initiated request pattern. Instead of
 * the server pushing sampling/createMessage, elicitation/create or roots/list
 * over a side channel, the server returns an InputRequiredResult from any
 * tools/call, resources/read or prompts/get request. The client gathers the
 * data and retries the ORIGINAL method under a NEW JSON-RPC id, carrying
 * inputResponses (keyed by the server-assigned ids from the previous result)
 * and echoing requestState verbatim if one was included.
 *
 * @module lib/server/mrtr/types
 */

/** The three request types a server may embed in an InputRequiredResult (spec 2026-07-28). */
export type InputRequestMethod =
  | "elicitation/create"
  | "sampling/createMessage"
  | "roots/list";

/** One slot in the inputRequests map. */
export interface InputRequestEntry {
  readonly method: InputRequestMethod;
  readonly params: Record<string, unknown>;
}

/**
 * Return this from a tool/resource handler to trigger an MRTR round-trip.
 *
 * Spec rule 6 (MUST): at least one of inputRequests or requestState MUST
 * be present. The framework validates this and returns -32603 Internal Error
 * if both are absent -- that is a server-authoring error, not a client error.
 *
 * Security note: requestState passes through the client untouched and is
 * therefore ATTACKER-CONTROLLED on retry. Use sealRequestState() to bind it
 * cryptographically to the authenticated principal, the originating method, and
 * the request parameters. Do NOT use an unprotected requestState for
 * authorization or resource-access decisions.
 */
export interface InputRequiredSignal {
  readonly resultType: "input_required";
  /**
   * Map of server-assigned string ids to sub-request objects.
   * Keys must be unique within the scope of the originating request (spec rule 2).
   */
  readonly inputRequests?: Record<string, InputRequestEntry>;
  /**
   * Opaque token the client must echo on retry (spec rule 2, client rule 2).
   *
   * When McpAppOptions.mrtr.signingKey is configured, produce this value
   * by calling sealRequestState(). The sealed token binds the principal,
   * method, params-digest, expiry and a random nonce under HMAC-SHA256 so the
   * server can reject a tampered or replayed token on retry.
   *
   * Without a signing key, the value is passed through to the client and back
   * as-is -- adequate only when requestState influences nothing that requires
   * integrity.
   */
  readonly requestState?: string;
}

/**
 * Configuration for the MRTR subsystem in McpAppOptions.
 *
 * Wire this in to McpAppOptions.mrtr before calling start() or startHttp().
 */
export interface MrtrOptions {
  /**
   * 64-character lowercase hex string (32 bytes) used as the HMAC-SHA256 key
   * for sealing and verifying requestState tokens.
   *
   * Generate once per deployment with:
   *   bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
   *
   * In load-balanced deployments all instances MUST share the same key; rotating
   * the key immediately invalidates all in-flight requestState tokens.
   *
   * If absent, the framework emits a [WARN] at startup and passes requestState
   * through without integrity protection. Handlers MUST NOT use unprotected
   * requestState for authorization or resource-access decisions.
   */
  signingKey?: string;

  /**
   * Lifetime of a sealed requestState token in seconds.
   *
   * Default: 300 (5 minutes). The spec warns that these measures do NOT
   * guarantee single-use. Deployers who need at-most-once semantics MUST
   * enforce that invariant server-side (e.g., by consuming the nonce from a
   * shared store on the first use).
   */
  defaultTtlSecs?: number;

  /**
   * Atomic store used to reject a second use of the same signed requestState.
   *
   * With a signing key and no explicit store, McpApp uses a process-local
   * MemoryMrtrReplayStore. That protects one continuously running process only:
   * a restart loses its reservations. Every instance in a load-balanced
   * deployment MUST receive the same durable shared store implementation.
   *
   * The nonce is consumed before the handler runs. This provides at-most-once
   * admission, not exactly-once completion: if the handler commits a mutation
   * and its response is lost, the same token is still rejected on retry.
   */
  replayStore?: import("./replay-store.ts").MrtrReplayStore;
}
