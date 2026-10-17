/**
 * requestState seal/verify — HMAC-SHA256 integrity protection for MRTR tokens
 * (spec 2026-07-28, SEP-2322 §Server Requirements, rule 4-5).
 *
 * The spec requires integrity protection whenever `requestState` influences
 * authorization, resource access, or business logic. This module implements
 * that protection with HMAC-SHA256 over a canonical JSON encoding — not AES-GCM,
 * because the server needs the payload readable (for the binding checks in
 * `verifyRequestState`) and the only threat model it addresses is CLIENT-SIDE
 * TAMPERING. The client sees the token; confidentiality of individual fields is
 * not required. AES-GCM would add the `nonce` / `tag` overhead of authenticated
 * encryption without the benefit, since the `sub`/`method`/`paramsDigest` bindings
 * already prevent cross-request / cross-user replay.
 *
 * Wire format (deliberately NOT JWT — JWT headers add no value here since the
 * algorithm is fixed, and they invite consumers to parse the token as one):
 *   base64url(utf8(canonicalJson(payload))) + "." + base64url(hmacBytes)
 *
 * The HMAC covers the base64url-encoded JSON string (as UTF-8 bytes), not the
 * raw JSON. This means the MAC is over the encoding as well as the content,
 * preventing attacks that try to craft a byte string that decodes differently
 * under different parsers.
 *
 * Canonical JSON: keys sorted lexicographically at every nesting level, no
 * extra whitespace, UTF-8 encoded. Two implementations of the same payload
 * always produce the same canonical form.
 *
 * All functions are pure and async (Web Crypto). No network, no server state.
 *
 * @module lib/server/mrtr/request-state
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Claims embedded inside the HMAC-SHA256-protected requestState token.
 *
 * All fields participate in the MAC: modifying any byte causes HMAC mismatch.
 *
 * Replay-bounding properties:
 * - `sub` prevents a different user from reusing the same token.
 * - `exp` limits the time window for replay.
 * - `method` + `paramsDigest` prevent cross-request replay
 *   (a token for `tools/call(echo)` is rejected on `tools/call(exec)` or
 *   `resources/read`).
 * - `nonce` ensures tokens minted at the same second for the same call are
 *   non-identical, defeating precomputation attacks.
 *
 * What these measures do NOT guarantee: single-use within the TTL. The spec
 * explicitly warns about this. Deployers who need at-most-once semantics MUST
 * consume the `nonce` in a server-side store on first use.
 */
export interface RequestStatePayload {
  /** Authenticated principal (JWT sub, hashed API-key, …). */
  readonly sub: string;
  /** JSON-RPC method of the originating request (e.g. "tools/call"). */
  readonly method: string;
  /**
   * Hex-encoded SHA-256 of the canonical JSON of salient parameters.
   *
   * For tools/call:       canonicalJson({ arguments: args, name: toolName })
   * For resources/read:   canonicalJson({ uri })
   * For prompts/get:      canonicalJson({ name: promptName })
   *
   * Binding the token to these parameters prevents cross-argument replay:
   * a token minted for `tools/call(echo, {})` is rejected on
   * `tools/call(exec, {cmd:"rm -rf /"})`.
   */
  readonly paramsDigest: string;
  /** Unix epoch seconds (integer) after which the token MUST be rejected. */
  readonly exp: number;
  /**
   * 16-byte random hex nonce, minted at seal time.
   *
   * Generate with: `bytesToHex(crypto.getRandomValues(new Uint8Array(16)))`.
   *
   * Does NOT guarantee single-use — see the module docstring. Its purpose is to
   * ensure tokens minted for the same call at the same second are non-identical.
   */
  readonly nonce: string;
}

/** Reason a `verifyRequestState` call returned `ok: false`. */
export type RequestStateRejectionReason =
  /** HMAC mismatch: one or more bytes of the payload were modified after sealing. */
  | "tampered"
  /** `sub` does not match the current authenticated principal. */
  | "wrong_principal"
  /** `exp` is in the past (or at `nowSecs`). */
  | "expired"
  /** `method` does not match the current JSON-RPC method. */
  | "wrong_method"
  /** `paramsDigest` does not match the current salient parameters. */
  | "wrong_params";

/** Return value of `verifyRequestState`. */
export type VerifyResult =
  | { readonly ok: true; readonly payload: RequestStatePayload }
  | {
    readonly ok: false;
    readonly reason: RequestStateRejectionReason;
    readonly message: string;
  };

// ── Base64url helpers ─────────────────────────────────────────────────────────
//
// The standard `btoa` / `atob` pair works with binary strings (one char = one
// byte). For Uint8Array we convert via a loop. We avoid the spread operator
// (`String.fromCharCode(...bytes)`) because large arrays hit the call-stack
// argument limit.

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Returns null when the input is not valid base64url. */
function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  // Restore standard base64 alphabet and padding.
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  const standard = padded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    const binary = atob(standard);
    // Use new ArrayBuffer explicitly so the resulting Uint8Array carries an
    // ArrayBuffer (not ArrayBufferLike), satisfying Web Crypto's BufferSource.
    const buf = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

// ── Canonical JSON ─────────────────────────────────────────────────────────────
//
// Sorted keys at every nesting level; no extra whitespace; UTF-8 encoding is
// inherited from TextEncoder below. Two objects with the same fields in any
// order produce the same canonical form, so the HMAC is comparison-invariant.

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const pairs = Object.keys(obj).sort().map(
      (k) => JSON.stringify(k) + ":" + canonicalJson(obj[k]),
    );
    return "{" + pairs.join(",") + "}";
  }
  // undefined, function, symbol — not representable in JSON; treat as null
  return "null";
}

// ── Key management ──────────────────────────────────────────────────────────

/**
 * Import a 32-byte key expressed as 64 lowercase hex characters.
 * The resulting `CryptoKey` supports HMAC-SHA256 sign + verify.
 *
 * @throws If `hexKey` is not exactly 64 lowercase hex chars.
 */
export async function importStateKey(hexKey: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) {
    throw new Error(
      "mrtr.signingKey must be a 64-character lowercase hex string (32 bytes). " +
        "Generate with: bytesToHex(crypto.getRandomValues(new Uint8Array(32)))",
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hexKey.slice(i * 2, i * 2 + 2), 16);
  }
  return await crypto.subtle.importKey(
    "raw",
    bytes,
    { name: "HMAC", hash: "SHA-256" },
    // exportable: false — the key material does not leave the Web Crypto subsystem
    false,
    ["sign", "verify"],
  );
}

/**
 * Generate a fresh 32-byte HMAC-SHA256 key.
 *
 * Marked `extractable: true` so `exportStateKey` can convert it to hex for
 * storage. Keys at rest should be stored in a secrets manager, not logged.
 */
export async function generateStateKey(): Promise<CryptoKey> {
  // Specify length: 256 bits (32 bytes) to match importStateKey's expected size.
  // Without this, Web Crypto defaults to the HMAC block size (512 bits = 64 bytes),
  // which would make generateStateKey + exportStateKey produce 128 hex chars —
  // incompatible with importStateKey which expects exactly 64.
  return await crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    /* extractable */ true,
    ["sign", "verify"],
  );
}

/**
 * Export a `CryptoKey` to 64-char lowercase hex for storage or serialization.
 *
 * Only works on keys created with `generateStateKey()` (which sets
 * `extractable: true`). Keys imported with `importStateKey()` are non-extractable
 * by design — re-hex from the original string instead.
 */
export async function exportStateKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  const bytes = new Uint8Array(raw);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// ── Digest of salient parameters ──────────────────────────────────────────────

/**
 * Compute the hex-encoded SHA-256 of the canonical JSON of `salientParams`.
 *
 * Pass the result as `paramsDigest` when building a `RequestStatePayload`.
 * Also pass it as `expected.paramsDigest` to `verifyRequestState` on retry
 * to avoid hashing the same input twice.
 *
 * Canonical encoding is deterministic regardless of JS object property order,
 * so the digest is stable across re-construction of the same logical value.
 */
export async function paramsDigest(salientParams: unknown): Promise<string> {
  const canonical = canonicalJson(salientParams);
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashBytes = new Uint8Array(hashBuffer);
  let hex = "";
  for (const byte of hashBytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

// ── Seal ──────────────────────────────────────────────────────────────────────

/**
 * Seal a `RequestStatePayload` into a compact, integrity-protected token.
 *
 * Wire format:
 *   base64url(utf8(canonicalJson(payload))) + "." + base64url(hmacSha256)
 *
 * The HMAC covers the base64url-encoded JSON string (as UTF-8 bytes), not the
 * raw JSON, so the MAC binds the encoding. Both segments are base64url (no
 * padding, URL-safe alphabet).
 *
 * @param payload  - Fully-formed `RequestStatePayload`. The caller is responsible
 *                   for generating the `nonce`; see `types.ts` for guidance.
 * @param key      - HMAC-SHA256 key from `importStateKey` or `generateStateKey`.
 * @returns  Opaque token string to carry in `InputRequiredSignal.requestState`.
 */
export async function sealRequestState(
  payload: RequestStatePayload,
  key: CryptoKey,
): Promise<string> {
  const canonical = canonicalJson(payload);
  const encodedJson = new TextEncoder().encode(canonical);
  const b64uJson = toBase64Url(encodedJson);

  // HMAC is computed over the UTF-8 bytes of the base64url string, not over
  // the raw JSON bytes. This ensures the MAC is over the wire representation.
  const hmacInput = new TextEncoder().encode(b64uJson);
  const hmacBuffer = await crypto.subtle.sign("HMAC", key, hmacInput);
  const hmacBytes = new Uint8Array(hmacBuffer);
  const b64uHmac = toBase64Url(hmacBytes);

  return `${b64uJson}.${b64uHmac}`;
}

// ── Verify ────────────────────────────────────────────────────────────────────

/**
 * Verify a `requestState` token against the expected claims for the current request.
 *
 * The input `token` is ATTACKER-CONTROLLED (the spec requires treating it as
 * such). Checks run in order: integrity first (so a tampered payload never
 * reaches field comparison), then bindings from most-impactful to least.
 *
 * Rejection order: tampered → wrong_principal → expired → wrong_method → wrong_params
 *
 * Each rejection reason is distinct so the server can distinguish attack
 * patterns in logs / metrics without leaking the payload to the client
 * (the client receives only the generic -32602 error code and a safe message).
 *
 * @param token          - The token as received from the client (untrusted).
 * @param key            - The server's HMAC-SHA256 signing key.
 * @param expected       - Values derived from the CURRENT (retry) request.
 * @param expected.principal    - Authenticated principal (JWT sub, …). Pass `""` when
 *                                 the endpoint is unauthenticated; the token's `sub`
 *                                 must also be `""` for a match.
 * @param expected.method       - JSON-RPC method of the retry request.
 * @param expected.paramsDigest - Pre-computed digest of the retry's salient params.
 *                                 Avoids double-hashing: compute once, pass here and
 *                                 keep for business logic.
 * @param expected.nowSecs      - Wall-clock Unix epoch seconds. Defaults to
 *                                 `Math.floor(Date.now() / 1000)`. Override in tests.
 */
export async function verifyRequestState(
  token: string,
  key: CryptoKey,
  expected: {
    readonly principal: string;
    readonly method: string;
    readonly paramsDigest: string;
    readonly nowSecs?: number;
  },
): Promise<VerifyResult> {
  // ── 1. Structural parse ─────────────────────────────────────────────────────
  const dotIdx = token.indexOf(".");
  if (dotIdx < 1 || dotIdx === token.length - 1) {
    return {
      ok: false,
      reason: "tampered",
      message: "Token format invalid: expected <base64url>.<base64url>",
    };
  }

  const b64uJson = token.slice(0, dotIdx);
  const b64uHmac = token.slice(dotIdx + 1);

  // ── 2. HMAC integrity check ─────────────────────────────────────────────────
  // Must run before any field comparison: a tampered payload must never reach
  // principal/method/params comparison where it could leak information.
  const hmacBytes = fromBase64Url(b64uHmac);
  if (hmacBytes === null) {
    return {
      ok: false,
      reason: "tampered",
      message: "HMAC segment is not valid base64url",
    };
  }

  const hmacInput = new TextEncoder().encode(b64uJson);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify("HMAC", key, hmacBytes, hmacInput);
  } catch {
    // Key algorithm mismatch or corrupt hmacBytes — treat as tampered.
    valid = false;
  }
  if (!valid) {
    return {
      ok: false,
      reason: "tampered",
      message:
        "HMAC verification failed: payload was modified after sealing or wrong key",
    };
  }

  // ── 3. Decode payload (JSON bytes from base64url) ──────────────────────────
  const jsonBytes = fromBase64Url(b64uJson);
  if (jsonBytes === null) {
    // HMAC passed but base64url decode failed — structural corruption
    return {
      ok: false,
      reason: "tampered",
      message: "Payload segment is not valid base64url",
    };
  }

  let payload: RequestStatePayload;
  try {
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(
      jsonBytes,
    );
    const parsed: unknown = JSON.parse(jsonText);
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      throw new TypeError("payload must be a JSON object");
    }
    // Narrow to RequestStatePayload — field-level type checks happen below.
    payload = parsed as RequestStatePayload;
  } catch {
    return {
      ok: false,
      reason: "tampered",
      message: "Payload is not a valid JSON object",
    };
  }

  // ── 4. Principal binding ────────────────────────────────────────────────────
  if (payload.sub !== expected.principal) {
    return {
      ok: false,
      reason: "wrong_principal",
      message: "Token principal does not match the current authenticated user",
    };
  }

  // ── 5. Expiry ──────────────────────────────────────────────────────────────
  const nowSecs = expected.nowSecs ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSecs) {
    return {
      ok: false,
      reason: "expired",
      message: `Token expired (exp=${payload.exp}, now=${nowSecs})`,
    };
  }

  // ── 6. Method binding ──────────────────────────────────────────────────────
  if (payload.method !== expected.method) {
    return {
      ok: false,
      reason: "wrong_method",
      message:
        `Token method "${payload.method}" does not match request method "${expected.method}"`,
    };
  }

  // ── 7. Params binding ──────────────────────────────────────────────────────
  if (payload.paramsDigest !== expected.paramsDigest) {
    return {
      ok: false,
      reason: "wrong_params",
      message:
        "Token paramsDigest does not match the current request parameters",
    };
  }

  return { ok: true, payload };
}
