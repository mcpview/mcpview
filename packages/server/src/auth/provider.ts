/**
 * AuthProvider abstract class.
 *
 * Abstract class (not interface) for DI compatibility with diod tokens.
 * Implement this to provide custom token validation (API keys, opaque tokens, etc.)
 *
 * @module lib/server/auth/provider
 */

import type { AuthInfo, ProtectedResourceMetadata } from "./types.ts";

/**
 * Base class for authentication providers.
 *
 * @example
 * ```typescript
 * class ApiKeyProvider extends AuthProvider {
 *   async verifyToken(token: string): Promise<AuthInfo | null> {
 *     const user = await db.findByApiKey(token);
 *     if (!user) return null;
 *     return { subject: user.id, scopes: user.scopes };
 *   }
 *
 *   getResourceMetadata(): ProtectedResourceMetadata {
 *     return {
 *       resource: "https://my-mcp.example.com",
 *       resource_metadata_url:
 *         "https://my-mcp.example.com/.well-known/oauth-protected-resource",
 *       authorization_servers: ["https://auth.example.com"],
 *       bearer_methods_supported: ["header"],
 *     };
 *   }
 * }
 * ```
 */
export abstract class AuthProvider {
  /**
   * Validate a token and extract auth information.
   *
   * @param token - The raw Bearer token string
   * @returns AuthInfo if valid, null if invalid/expired
   */
  abstract verifyToken(token: string): Promise<AuthInfo | null>;

  /**
   * Return RFC 9728 Protected Resource Metadata for this provider.
   */
  abstract getResourceMetadata(): ProtectedResourceMetadata;
}
