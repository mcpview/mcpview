/**
 * MRTR — Multi Round-Trip Requests (Track B, spec 2026-07-28, SEP-2322).
 *
 * Public re-export barrel. Import everything the transport layer needs from
 * this single path rather than reaching into sub-modules directly.
 *
 * @module lib/server/mrtr
 */

// Types shared across all MRTR code
export type {
  InputRequestEntry,
  InputRequestMethod,
  InputRequiredSignal,
  MrtrOptions,
} from "./types.ts";

// Atomic single-use enforcement for verified requestState nonces.
export type {
  MemoryMrtrReplayStoreOptions,
  MrtrReplayStore,
} from "./replay-store.ts";
export { MemoryMrtrReplayStore } from "./replay-store.ts";

// Transport-neutral retry admission: integrity bindings + single-use replay gate.
export type {
  GuardMrtrRetryInput,
  MrtrRetryBindings,
  MrtrRetryGuardOutcome,
} from "./retry-guard.ts";
export { guardMrtrRetry } from "./retry-guard.ts";

// requestState seal/verify (HMAC-SHA256 integrity protection)
export type {
  RequestStatePayload,
  RequestStateRejectionReason,
  VerifyResult,
} from "./request-state.ts";
export {
  exportStateKey,
  generateStateKey,
  importStateKey,
  paramsDigest,
  sealRequestState,
  verifyRequestState,
} from "./request-state.ts";

// Capability check (spec rule 7 — MUST NOT emit for undeclared capabilities)
export type {
  CapabilityCheckFail,
  CapabilityCheckOk,
  CapabilityCheckResult,
} from "./capability-check.ts";
export { checkInputRequestCapabilities } from "./capability-check.ts";
