/**
 * Atomic nonce consumption for MRTR requestState tokens.
 *
 * Integrity verification proves that a token was minted by the server and is
 * bound to the current request. A replay store adds the separate single-use
 * property by reserving the signed nonce before business logic runs.
 */

/**
 * Store used to consume a verified MRTR nonce exactly once.
 *
 * Implementations MUST make the check-and-reserve operation atomic. Return
 * `true` only for the caller that reserved the nonce, `false` when it was
 * already consumed, and throw when availability cannot be established.
 *
 * `expiresAt` is the signed token expiry as Unix epoch seconds. Stores should
 * remove the reservation after that time; retaining it longer is safe but
 * wastes capacity.
 *
 * A load-balanced deployment MUST provide one shared implementation to every
 * McpApp instance. Redis can implement the contract with `SET key 1 NX EXAT`.
 */
export interface MrtrReplayStore {
  consume(nonce: string, expiresAt: number): boolean | Promise<boolean>;
}

export interface MemoryMrtrReplayStoreOptions {
  /**
   * Maximum live reservations before the store fails closed.
   *
   * Default: 100,000.
   */
  maxEntries?: number;

  /** Test seam for the current Unix epoch time in seconds. */
  nowSecs?: () => number;
}

/**
 * Process-local replay protection.
 *
 * This is the safe default for one continuously running McpApp process. It
 * cannot coordinate separate processes or survive a restart; horizontally
 * scaled or restart-safe deployments must inject a durable shared
 * `MrtrReplayStore`.
 */
export class MemoryMrtrReplayStore implements MrtrReplayStore {
  private readonly entries = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly nowSecs: () => number;

  constructor(options: MemoryMrtrReplayStoreOptions = {}) {
    const maxEntries = options.maxEntries ?? 100_000;
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new Error(
        `MemoryMrtrReplayStore maxEntries must be a positive integer (got ${maxEntries})`,
      );
    }
    this.maxEntries = maxEntries;
    this.nowSecs = options.nowSecs ?? (() => Math.floor(Date.now() / 1000));
  }

  consume(nonce: string, expiresAt: number): boolean {
    if (!/^[0-9a-f]{32}$/.test(nonce)) {
      throw new Error("MRTR replay nonce must be 32 lowercase hex characters");
    }
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
      throw new Error(
        "MRTR replay expiry must be a non-negative safe-integer Unix timestamp",
      );
    }

    const now = this.nowSecs();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error(
        "MRTR replay clock must return a non-negative safe-integer Unix timestamp",
      );
    }
    const existingExpiry = this.entries.get(nonce);
    if (existingExpiry !== undefined) {
      if (existingExpiry > now) return false;
      this.entries.delete(nonce);
    }

    if (expiresAt <= now) return false;

    if (this.entries.size >= this.maxEntries) {
      for (const [storedNonce, storedExpiry] of this.entries) {
        if (storedExpiry <= now) this.entries.delete(storedNonce);
      }
      if (this.entries.size >= this.maxEntries) {
        throw new Error(
          `MRTR replay store capacity exceeded (${this.maxEntries} live nonces)`,
        );
      }
    }

    // No await may occur between the check and this write. In one JS process,
    // that makes the reservation atomic across concurrent request continuations.
    this.entries.set(nonce, expiresAt);
    return true;
  }
}
