/**
 * MRTR retry admission policy.
 *
 * This module owns the transport-independent decision whether a retried
 * request may reach application code. HTTP and stdio adapt its outcomes to
 * their respective error envelopes; neither transport reimplements HMAC
 * verification or nonce consumption.
 *
 * @module lib/server/mrtr/retry-guard
 */

import type { MrtrReplayStore } from "./replay-store.ts";
import {
  type RequestStateRejectionReason,
  verifyRequestState,
} from "./request-state.ts";

/** Bind a requestState to the retry that is attempting to spend it. */
export interface MrtrRetryBindings {
  readonly principal: string;
  readonly method: string;
  readonly paramsDigest: string;
}

/** Inputs required to decide whether one MRTR retry is admissible. */
export interface GuardMrtrRetryInput {
  /** Presence matters; response contents remain untrusted handler input. */
  readonly inputResponses?: Record<string, unknown>;
  /** Attacker-controlled state echoed by the client, when any. */
  readonly requestState?: string;
  /** Null deliberately represents the explicitly unprotected deployment mode. */
  readonly key: CryptoKey | null;
  /** Required only when a signed requestState is presented. */
  readonly replayStore: MrtrReplayStore | null;
  readonly bindings: MrtrRetryBindings;
}

/**
 * Transport-neutral admission outcome.
 *
 * `accepted.retryVerified` is deliberately tri-state: absent for a first leg,
 * false for the configured unprotected mode, and true only after signature,
 * binding and atomic nonce reservation all succeeded.
 */
export type MrtrRetryGuardOutcome =
  | { readonly kind: "accepted"; readonly retryVerified?: boolean }
  | { readonly kind: "missing_state" }
  | {
    readonly kind: "invalid_state";
    readonly reason: RequestStateRejectionReason;
  }
  | {
    readonly kind: "replay_store_unavailable";
    readonly reason: "missing" | "consume_failed";
  }
  | { readonly kind: "replayed" };

/**
 * Decide whether a retried request may enter application code.
 *
 * A signed state is verified and its nonce is atomically reserved before the
 * handler runs. This intentionally gives at-most-once admission, not exactly
 * once completion: a transport adapter must never move consumption after a
 * business side effect.
 */
export async function guardMrtrRetry(
  input: GuardMrtrRetryInput,
): Promise<MrtrRetryGuardOutcome> {
  const hasInputResponses = input.inputResponses !== undefined;
  const { requestState, key } = input;

  if (hasInputResponses && requestState === undefined && key !== null) {
    return { kind: "missing_state" };
  }

  if (requestState === undefined) {
    return { kind: "accepted" };
  }

  if (key === null) {
    return { kind: "accepted", retryVerified: false };
  }

  const verdict = await verifyRequestState(requestState, key, input.bindings);
  if (!verdict.ok) {
    return { kind: "invalid_state", reason: verdict.reason };
  }

  if (input.replayStore === null) {
    return { kind: "replay_store_unavailable", reason: "missing" };
  }

  let consumed: boolean;
  try {
    const result = await input.replayStore.consume(
      verdict.payload.nonce,
      verdict.payload.exp,
    );
    if (result !== true && result !== false) {
      throw new Error("mrtr.replayStore.consume() must return a boolean");
    }
    consumed = result;
  } catch {
    return { kind: "replay_store_unavailable", reason: "consume_failed" };
  }

  return consumed
    ? { kind: "accepted", retryVerified: true }
    : { kind: "replayed" };
}
