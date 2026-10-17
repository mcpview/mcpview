/**
 * Capability check for MRTR inputRequests (spec 2026-07-28, SEP-2322).
 *
 * Rule 7 (MUST NOT): "Servers MUST NOT emit an inputRequest for a capability
 * the client has not declared in io.modelcontextprotocol/clientCapabilities."
 *
 * In the stateless transport model, `clientCapabilities` is per-request: it
 * arrives in `params._meta["io.modelcontextprotocol/clientCapabilities"]` and
 * is therefore already parsed by the time this check runs. There is no session
 * to cache it from — each call carries its own capability declaration.
 *
 * The function is pure: it takes the data it needs and returns a typed result.
 * No network, no server state, no side effects.
 *
 * @module lib/server/mrtr/capability-check
 */

import type { InputRequestEntry } from "./types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Successful capability check — all methods map to declared capabilities. */
export interface CapabilityCheckOk {
  /**
   * The canonical form of `inputRequests` — the value the caller MUST emit.
   *
   * Checking a JSON clone and then serialising the original is two serialisations,
   * and a stateful `toJSON()` can return different values for each. That is not a
   * theoretical gap: it reopens exactly the bypass canonicalisation was added to
   * close. Emit this, not the input.
   */
  readonly canonicalRequests?: Record<string, unknown>;
  readonly ok: true;
}

/** Failed capability check — one or more capabilities are missing. */
export interface CapabilityCheckFail {
  /**
   * Which fault this is.
   *
   * `missing_capability` — the client did not declare something the request needs.
   * That is the client's to fix, and `-32021` says exactly that.
   *
   * `malformed` — the SERVER produced an input request that is structurally
   * invalid: an unknown method, a missing or non-object `params`, a map that will
   * not serialise. Reporting those as a missing capability tells the client to
   * declare something it already has, and hides a server bug behind a client-facing
   * error.
   */
  readonly kind: "missing_capability" | "malformed";
  /**
   * `ClientCapabilities`-shaped payload for the error's `data`, when the missing
   * capability is nested. Absent for top-level ones, where the caller derives it
   * from `missingCapabilities`.
   */
  readonly requiredCapabilities?: Record<string, unknown>;
  readonly ok: false;
  /**
   * Top-level `ClientCapabilities` keys the client did not declare but the
   * `inputRequests` map requires.
   *
   * Forward these directly into `-32021 MissingRequiredClientCapabilityError`
   * as `data.requiredCapabilities` (spec 2026-07-28 §per-request protocol fields).
   *
   * Example: `["sampling", "elicitation"]` if both are absent.
   */
  readonly missingCapabilities: string[];
}

export type CapabilityCheckResult = CapabilityCheckOk | CapabilityCheckFail;

// ── Method → capability mapping ───────────────────────────────────────────────
//
// Spec 2026-07-28: only these three methods are legal in `inputRequests`.
// Any unrecognised method is treated as a missing capability (fail-safe): an
// unknown method is a server-authoring error, and the spec forbids emitting it
// on the wire. Rejecting it here prevents that wire violation.

/**
 * The only methods an input request may carry, mapped to the capability each needs.
 *
 * Exported so the Tasks boundary enforces the same grammar. A task that requests
 * input uses MRTR request shapes, and a second, looser list there is how a task
 * ends up asking for a method no client implements — which strands it rather than
 * failing it.
 */
export const METHOD_TO_CAPABILITY: Readonly<Record<string, string>> = {
  "elicitation/create": "elicitation",
  "sampling/createMessage": "sampling",
  "roots/list": "roots",
};

// ── checkInputRequestCapabilities ─────────────────────────────────────────────

/**
 * Verify that every `inputRequest` entry maps to a capability the client declared.
 *
 * Mapping (spec 2026-07-28):
 *   elicitation/create   → clientCapabilities.elicitation
 *   sampling/createMessage → clientCapabilities.sampling
 *   roots/list           → clientCapabilities.roots
 *
 * Unknown methods fail-safe: the spec only permits the three methods above.
 * An unknown method in `inputRequests` is a server-authoring bug and is
 * rejected here before it reaches the wire.
 *
 * @param inputRequests       - The map from the handler's `InputRequiredSignal`.
 * @param clientCapabilities  - Parsed from `params._meta[STATELESS_CLIENT_CAPABILITIES_KEY]`.
 *                               `undefined` when the client sent no `_meta` at all —
 *                               treated as "no capabilities declared".
 * @returns `{ ok: true }` or `{ ok: false, missingCapabilities: string[] }`.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reduce a value to what it will actually be on the wire.
 *
 * The gate must inspect the JSON representation, not the live object: the two can
 * differ. `new String("url")` is not `=== "url"` but serialises to `"url"`, and a
 * `toJSON()` can introduce fields — `tools`, say — that exist only after
 * serialisation. Checking the live object then shipping the serialised one means
 * the check and the payload disagree, which is precisely the gap a caller would
 * use to obtain an input request the client cannot service.
 *
 * Returns `undefined` when the value cannot be serialised at all, which callers
 * treat as malformed.
 */
function canonicalise(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return undefined;
  }
}

export function checkInputRequestCapabilities(
  inputRequests: Record<string, InputRequestEntry>,
  clientCapabilities: Record<string, unknown> | undefined,
): CapabilityCheckResult {
  // Collect every capability key that is required by the inputRequests.
  // Use a Set to deduplicate: multiple slots may require the same capability.
  // Canonicalise the WHOLE map once. Everything below inspects this clone, and the
  // caller emits it — so the value checked and the value sent are the same object,
  // serialised once.
  const canonicalRequests = canonicalise(inputRequests);
  if (!isRecord(canonicalRequests)) {
    return {
      ok: false,
      kind: "malformed",
      missingCapabilities: ["<inputRequests could not be serialised>"],
    };
  }

  const required = new Set<string>();
  for (const entry of Object.values(canonicalRequests) as InputRequestEntry[]) {
    // Sub-capabilities: declaring `elicitation` does not grant URL mode, and
    // declaring `sampling` does not grant tool-using sampling. Checking only the
    // top-level key let a server ask for a mode the client cannot service, which
    // strands the request exactly as an undeclared capability would.
    // The map VALUE must itself be an object. `{ k: null }` serialises fine, so it
    // survived canonicalisation and then threw on `entry.params` — landing in the
    // generic tool-error path as a 200, not the 500 a malformed server output
    // requires. Checked before anything dereferences it.
    if (!isRecord(entry)) {
      return {
        ok: false,
        kind: "malformed",
        missingCapabilities: [
          "<inputRequests values must be request objects>",
        ],
      };
    }

    // `method` must be a string, and looked up as an OWN key.
    //
    // Two distinct faults hid here. A non-string method — `{ toString: null }`
    // survives JSON — throws a TypeError when used as a property key, landing in
    // the generic tool-error path as a 200. And `"toString"` or `"constructor"`
    // resolve INHERITED properties of the mapping object, so `capKey` came back
    // as a function rather than undefined and produced a nonsense
    // missing-capability error naming a method that does not exist.
    if (typeof entry.method !== "string") {
      return {
        ok: false,
        kind: "malformed",
        missingCapabilities: ["<inputRequest method must be a string>"],
      };
    }

    // Already canonical: `entry` came out of the clone above. A `params` that is
    // present but not an object is malformed — reading it as `{}` would skip the
    // sub-capability checks entirely, a server-authoring bug resolving to "no
    // extra capability needed".
    //
    // `null` is rejected along with the rest, deliberately. I had intended to let
    // it through as equivalent to "absent", but the two are not the same: omitting
    // `params` says the request needs none, while `params: null` asserts a value
    // that the schema types as an object. Accepting it would mean the sub-capability
    // checks silently do not run for a request that looks like it declared
    // something.
    //
    // Absence is method-specific: the schema requires `params` on
    // `elicitation/create` (message + requestedSchema) and `sampling/createMessage`
    // (messages + maxTokens). Only `ListRootsRequest` may omit it. Accepting an
    // omission everywhere let a request ship that no client could service — it has
    // nothing to render or sample.
    if (entry.params === undefined && entry.method !== "roots/list") {
      return {
        ok: false,
        kind: "malformed",
        missingCapabilities: [
          `<${entry.method} requires params>`,
        ],
      };
    }
    if (entry.params !== undefined && !isRecord(entry.params)) {
      return {
        ok: false,
        kind: "malformed",
        missingCapabilities: [
          `<malformed inputRequest params for ${entry.method}>`,
        ],
      };
    }
    const params = isRecord(entry.params) ? entry.params : {};
    if (entry.method === "elicitation/create" && params["mode"] === "url") {
      const elicitation = isRecord(clientCapabilities?.["elicitation"])
        ? clientCapabilities["elicitation"] as Record<string, unknown>
        : undefined;
      if (elicitation?.["url"] === undefined) {
        return {
          ok: false,
          kind: "missing_capability",
          missingCapabilities: ["elicitation.url"],
          // Nested, matching ClientCapabilities. A flat "elicitation.url" key
          // deserialises to `{}` on a typed client — it reads as "nothing
          // missing", the opposite of the message.
          requiredCapabilities: { elicitation: { url: {} } },
        };
      }
    }
    if (
      entry.method === "sampling/createMessage" &&
      (params["tools"] !== undefined || params["toolChoice"] !== undefined)
    ) {
      const sampling = isRecord(clientCapabilities?.["sampling"])
        ? clientCapabilities["sampling"] as Record<string, unknown>
        : undefined;
      if (sampling?.["tools"] === undefined) {
        return {
          ok: false,
          kind: "missing_capability",
          missingCapabilities: ["sampling.tools"],
          requiredCapabilities: { sampling: { tools: {} } },
        };
      }
    }

    const capKey = Object.hasOwn(METHOD_TO_CAPABILITY, entry.method)
      ? METHOD_TO_CAPABILITY[entry.method]
      : undefined;
    if (capKey === undefined) {
      // MRTR permits exactly three methods. An unknown one is invalid outright,
      // so it must fail regardless of what the client declared — mapping it to
      // its own name let a client "satisfy" it by declaring a capability of the
      // same name, which is not a capability at all.
      return {
        ok: false,
        kind: "malformed",
        missingCapabilities: [
          `<unsupported inputRequest method: ${entry.method}>`,
        ],
      };
    }
    required.add(capKey);
  }

  if (required.size === 0) {
    // Empty inputRequests map — nothing to check
    return { ok: true, canonicalRequests };
  }

  const missing: string[] = [];
  for (const capKey of required) {
    // The client "declared" the capability when its key is present in
    // `clientCapabilities` with any value (including `{}`). An absent key or
    // an undefined `clientCapabilities` object means "not declared".
    const declared = clientCapabilities !== undefined &&
      Object.hasOwn(clientCapabilities, capKey);
    if (!declared) missing.push(capKey);
  }

  if (missing.length > 0) {
    return {
      ok: false,
      kind: "missing_capability",
      missingCapabilities: missing,
    };
  }
  return { ok: true, canonicalRequests };
}
