/**
 * In-memory token store for testing and ephemeral use.
 *
 * @module lib/server/client-auth/token-store/memory-store
 */

import type { StoredCredentials, TokenStore } from "../types.ts";

export class MemoryTokenStore implements TokenStore {
  private store = new Map<string, StoredCredentials>();

  // Not `async`: the Map operations are synchronous. The interface returns
  // Promises so a real store can be I/O-backed; `Promise.resolve` satisfies it
  // without claiming an await point that does not exist.
  get(serverUrl: string): Promise<StoredCredentials | null> {
    return Promise.resolve(this.store.get(serverUrl) ?? null);
  }

  set(serverUrl: string, credentials: StoredCredentials): Promise<void> {
    this.store.set(serverUrl, credentials);
    return Promise.resolve();
  }

  delete(serverUrl: string): Promise<void> {
    this.store.delete(serverUrl);
    return Promise.resolve();
  }

  list(): Promise<string[]> {
    return Promise.resolve([...this.store.keys()]);
  }
}
