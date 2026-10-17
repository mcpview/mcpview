/**
 * File-based token store.
 *
 * Stores OAuth credentials as JSON files with restrictive permissions (0o600).
 * One file per MCP server, keyed by SHA-256 hash of the server URL.
 *
 * @module lib/server/client-auth/token-store/file-store
 */

import type { StoredCredentials, TokenStore } from "../types.ts";
import {
  mkdir,
  readDir,
  readTextFile,
  remove,
  writeTextFile,
} from "../../runtime/runtime.ts";

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class FileTokenStore implements TokenStore {
  constructor(private baseDir: string) {}

  private async filePath(serverUrl: string): Promise<string> {
    const hash = await sha256hex(serverUrl);
    return `${this.baseDir}/${hash}.json`;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true, mode: 0o700 });
  }

  async get(serverUrl: string): Promise<StoredCredentials | null> {
    const path = await this.filePath(serverUrl);
    const content = await readTextFile(path);
    return content === null ? null : JSON.parse(content) as StoredCredentials;
  }

  async set(serverUrl: string, credentials: StoredCredentials): Promise<void> {
    await this.ensureDir();
    const path = await this.filePath(serverUrl);
    const content = JSON.stringify(credentials, null, 2);
    await writeTextFile(path, content, { mode: 0o600 });
  }

  async delete(serverUrl: string): Promise<void> {
    const path = await this.filePath(serverUrl);
    await remove(path);
  }

  async list(): Promise<string[]> {
    const urls: string[] = [];
    for (const name of await readDir(this.baseDir)) {
      if (name.endsWith(".json")) {
        try {
          const content = await readTextFile(`${this.baseDir}/${name}`);
          if (content === null) continue;
          const creds = JSON.parse(content) as StoredCredentials;
          urls.push(creds.serverUrl);
        } catch {
          // Corrupted file, skip
        }
      }
    }
    return urls;
  }
}
