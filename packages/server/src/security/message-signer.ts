/**
 * HMAC-SHA256 Message Signer for PostMessage Channels
 *
 * Signs and verifies JSON-RPC messages exchanged via PostMessage.
 * Each message gains `_hmac` (signature) and `_seq` (monotonic counter)
 * fields for authentication and anti-replay protection.
 *
 * HMAC payload: `"${_seq}:${id}:${method}:${JSON.stringify(params|result|error)}"`
 *
 * Uses the Web Crypto API exclusively (Deno, Node.js 18+, browsers).
 *
 * @module server/security/message-signer
 */

// ---------------------------------------------------------------------------
// Hex utilities
// ---------------------------------------------------------------------------

/** Convert a Uint8Array to a lowercase hex string. */
export function bytesToHex(bytes: Uint8Array): string {
  const out: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, "0");
  }
  return out.join("");
}

/** Convert a hex string to a Uint8Array. Returns null if invalid hex. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A JSON-RPC message with optional HMAC signature fields. */
export interface SignedMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
  _hmac?: string;
  _seq?: number;
  [key: string]: unknown;
}

/** Result of verifying a signed message. */
export interface VerifyResult {
  /** Whether the signature is valid. */
  valid: boolean;
  /** The message with `_hmac` and `_seq` stripped. */
  message: SignedMessage;
  /** Error description when valid is false. */
  error?: string;
}

// ---------------------------------------------------------------------------
// HMAC Payload
// ---------------------------------------------------------------------------

/**
 * Build the canonical HMAC payload string.
 *
 * Format: `"${seq}:${id}:${method}:${body}"`
 */
export function buildHmacPayload(message: SignedMessage, seq: number): string {
  const id = message.id ?? "";
  const method = message.method ?? "";
  let body: string;
  if (message.params !== undefined) body = JSON.stringify(message.params);
  else if (message.result !== undefined) body = JSON.stringify(message.result);
  else if (message.error !== undefined) body = JSON.stringify(message.error);
  else body = "{}";
  return `${seq}:${id}:${method}:${body}`;
}

// ---------------------------------------------------------------------------
// MessageSigner
// ---------------------------------------------------------------------------

/**
 * HMAC-SHA256 message signer/verifier for a single PostMessage channel.
 *
 * Maintains separate sequence counters for send and receive directions.
 *
 * @example
 * ```ts
 * const signer = new MessageSigner(secretHex);
 * await signer.init();
 *
 * const signed = await signer.sign({ jsonrpc: '2.0', method: 'tools/call', params: {} });
 * const result = await signer.verify(signed);
 * ```
 */
export class MessageSigner {
  private cryptoKey: CryptoKey | null = null;
  private sendSeq = 0;
  private lastRecvSeq = -1;
  private readonly secretHex: string;

  /**
   * Generate a 32-byte (256-bit) random hex secret for channel authentication.
   * Uses `crypto.getRandomValues()` for cryptographic randomness.
   *
   * @returns 64-character lowercase hex string (32 bytes)
   */
  static generateSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  constructor(secretHex: string) {
    this.secretHex = secretHex;
  }

  /**
   * Initialize the CryptoKey. Must be called before sign()/verify().
   * Idempotent.
   */
  async init(): Promise<void> {
    if (this.cryptoKey) return;
    const keyBytes = hexToBytes(this.secretHex);
    if (!keyBytes) {
      throw new Error(
        "[MessageSigner] Invalid secret: must be a valid hex string. " +
          "Use MessageSigner.generateSecret() to create one.",
      );
    }
    this.cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyBytes.buffer as ArrayBuffer,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  /** Sign a JSON-RPC message by adding `_hmac` and `_seq` fields. */
  async sign(message: SignedMessage): Promise<SignedMessage> {
    if (!this.cryptoKey) {
      throw new Error(
        "[MessageSigner] Not initialized. Call init() before sign().",
      );
    }
    const seq = this.sendSeq++;
    const payload = buildHmacPayload(message, seq);
    const sig = await crypto.subtle.sign(
      "HMAC",
      this.cryptoKey,
      new TextEncoder().encode(payload),
    );
    return { ...message, _seq: seq, _hmac: bytesToHex(new Uint8Array(sig)) };
  }

  /**
   * Verify a signed message and strip `_hmac`/`_seq` fields.
   *
   * Rejects if: missing fields, replay (seq <= lastSeen), HMAC mismatch.
   */
  async verify(message: SignedMessage): Promise<VerifyResult> {
    if (!this.cryptoKey) {
      throw new Error(
        "[MessageSigner] Not initialized. Call init() before verify().",
      );
    }
    const { _hmac, _seq, ...clean } = message;

    if (_hmac === undefined || _seq === undefined) {
      return {
        valid: false,
        message: clean as SignedMessage,
        error: "Missing _hmac or _seq field",
      };
    }
    if (typeof _seq !== "number" || _seq <= this.lastRecvSeq) {
      return {
        valid: false,
        message: clean as SignedMessage,
        error:
          `Replay detected: _seq=${_seq} <= lastRecvSeq=${this.lastRecvSeq}`,
      };
    }
    const hmacBytes = hexToBytes(_hmac);
    if (!hmacBytes) {
      return {
        valid: false,
        message: clean as SignedMessage,
        error: "Invalid _hmac: not valid hex",
      };
    }
    const payload = buildHmacPayload(clean as SignedMessage, _seq);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      this.cryptoKey,
      hmacBytes.buffer as ArrayBuffer,
      new TextEncoder().encode(payload),
    );
    if (!isValid) {
      return {
        valid: false,
        message: clean as SignedMessage,
        error: "HMAC signature mismatch",
      };
    }
    this.lastRecvSeq = _seq;
    return { valid: true, message: clean as SignedMessage };
  }

  /** Reset sequence counters (for testing). */
  reset(): void {
    this.sendSeq = 0;
    this.lastRecvSeq = -1;
  }
}
