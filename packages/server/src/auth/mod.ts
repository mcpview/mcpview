/**
 * Auth module for McpApp.
 *
 * @module lib/server/auth
 */

// Types
export type {
  AuthInfo,
  AuthOptions,
  HttpsUrl,
  ProtectedResourceMetadata,
} from "./types.ts";
// HttpsUrl brand factories (0.16.0) — construct branded URL values for
// `JwtAuthProviderOptions`, `ProtectedResourceMetadata`, and anywhere else
// that requires a validated absolute HTTP(S) URL.
export { httpsUrl, tryHttpsUrl } from "./types.ts";

// Provider base class
export { AuthProvider } from "./provider.ts";

// Middleware and utilities
export {
  AuthError,
  createAuthMiddleware,
  createForbiddenResponse,
  createUnauthorizedResponse,
  extractBearerToken,
} from "./middleware.ts";

// Scope enforcement
export { createScopeMiddleware } from "./scope-middleware.ts";

// Multi-tenant resolution (tenant enforcement on top of auth)
export { createMultiTenantMiddleware } from "./multi-tenant-middleware.ts";
export type {
  MultiTenantMiddlewareOptions,
  TenantResolution,
  TenantResolver,
} from "./multi-tenant-middleware.ts";

// JWT Provider
export { JwtAuthProvider } from "./jwt-provider.ts";
// JwtAuthProviderOptions is a discriminated union in 0.16.0 — both branch
// types are exported so advanced callers can type-annotate variables
// explicitly.
export type {
  JwtAuthProviderOptions,
  JwtAuthProviderOptionsOpaqueResource,
  JwtAuthProviderOptionsUrlResource,
} from "./jwt-provider.ts";

// OIDC Presets
export {
  buildJwtAuthProvider,
  createAuth0AuthProvider,
  createGitHubAuthProvider,
  createGoogleAuthProvider,
  createOIDCAuthProvider,
} from "./presets.ts";
export type {
  BuildJwtAuthProviderOptions,
  OIDCPresetOptions,
  PresetOptions,
} from "./presets.ts";

// AS Metadata Proxy (DCR discovery for IdPs without native RFC 7591)
export { createAsMetadataHandler } from "./as-metadata-proxy.ts";
export type { AsMetadataProxyOptions } from "./as-metadata-proxy.ts";

// Config loader (YAML + env)
export { createAuthProviderFromConfig, loadAuthConfig } from "./config.ts";
// `AuthConfig` is a discriminated union in 0.17.0 — each variant is also
// exported for callers that want to annotate variables explicitly.
export type {
  Auth0AuthConfig,
  AuthConfig,
  AuthProviderName,
  GitHubAuthConfig,
  GoogleAuthConfig,
  OIDCAuthConfig,
} from "./config.ts";

// Static Token Provider (opaque pre-shared bearer tokens; no OIDC/JWT infra)
export {
  createStaticTokenAuthProvider,
  StaticTokenAuthProvider,
} from "./static-token-provider.ts";
export type {
  StaticTokenAuthProviderOptions,
  StaticTokenCredential,
} from "./static-token-provider.ts";
