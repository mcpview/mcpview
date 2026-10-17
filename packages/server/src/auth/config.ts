/**
 * Auth configuration loader.
 *
 * Loads auth config from YAML file with env var overrides.
 * Priority: env vars > YAML > (nothing = no auth)
 *
 * @module lib/server/auth/config
 */

import { parse as parseYaml } from "@std/yaml";
import { env, readTextFile } from "../runtime/runtime.ts";
import type { AuthProvider } from "./provider.ts";
import {
  createAuth0AuthProvider,
  createGitHubAuthProvider,
  createGoogleAuthProvider,
  createOIDCAuthProvider,
} from "./presets.ts";

/** Supported auth provider names */
export type AuthProviderName = "github" | "google" | "auth0" | "oidc";

const VALID_PROVIDERS: AuthProviderName[] = [
  "github",
  "google",
  "auth0",
  "oidc",
];

/**
 * Fields shared by all {@link AuthConfig} variants.
 */
interface AuthConfigBase {
  /** JWT audience (aud claim) */
  audience: string;
  /** RFC 9728 § 2 resource identifier (HTTP(S) URL or opaque URI) */
  resource: string;
  /** Scopes supported by this server */
  scopesSupported?: string[];
  /**
   * Absolute HTTP(S) URL where the `/.well-known/oauth-protected-resource`
   * metadata document is served publicly (RFC 9728 § 3).
   *
   * Required when `resource` is an opaque URI (e.g., an OIDC project ID used
   * as JWT audience per RFC 9728 § 2) — otherwise preset factories will
   * throw at construction. When `resource` is itself an HTTP(S) URL, this
   * field is optional and auto-derived by the preset bridge layer. Mirrors
   * `JwtAuthProviderOptions.resourceMetadataUrl`.
   */
  resourceMetadataUrl?: string;
}

/** Auth config for GitHub Actions OIDC (no provider-specific fields). */
export interface GitHubAuthConfig extends AuthConfigBase {
  provider: "github";
}

/** Auth config for Google OIDC (no provider-specific fields). */
export interface GoogleAuthConfig extends AuthConfigBase {
  provider: "google";
}

/** Auth config for Auth0 — `domain` is REQUIRED at the type level. */
export interface Auth0AuthConfig extends AuthConfigBase {
  provider: "auth0";
  /** Auth0 tenant domain (e.g., `"my-tenant.auth0.com"`). */
  domain: string;
}

/** Auth config for generic OIDC — `issuer` is REQUIRED at the type level. */
export interface OIDCAuthConfig extends AuthConfigBase {
  provider: "oidc";
  /** OIDC issuer URL (used as both JWT `iss` and JWKS discovery root). */
  issuer: string;
  /** JWKS URI, optional — derived from `issuer` if absent. */
  jwksUri?: string;
}

/**
 * Parsed auth configuration (after YAML + env merge).
 *
 * 0.17.0: discriminated union on `provider` tag. Each variant encodes
 * its provider-specific required fields at the type level:
 *   - `"github"` / `"google"`: base only
 *   - `"auth0"`: base + required `domain`
 *   - `"oidc"`: base + required `issuer`, optional `jwksUri`
 *
 * TypeScript narrows on `config.provider`, so `createAuthProviderFromConfig`
 * no longer needs non-null assertions (`config.domain!`) — the required
 * fields are typed correctly in each branch.
 *
 * The runtime checks in `loadAuthConfig()` stay as defense-in-depth for
 * YAML/env input (untyped), but TS callers constructing `AuthConfig` literals
 * directly now get compile-time safety.
 *
 * BREAKING from 0.16.x: callers who constructed `AuthConfig` literals with
 * optional `domain`/`issuer` and relied on runtime validation now get a
 * compile error if they don't match a variant's required fields. Migration:
 * ensure the literal satisfies the discriminated variant (e.g.,
 * `provider: "auth0"` requires `domain`). See
 * `superWorldSavior/mcp-server#11`.
 */
export type AuthConfig =
  | GitHubAuthConfig
  | GoogleAuthConfig
  | Auth0AuthConfig
  | OIDCAuthConfig;

/**
 * YAML file schema (top-level has `auth` key).
 */
interface ConfigFile {
  auth?: {
    provider?: string;
    audience?: string;
    resource?: string;
    domain?: string;
    issuer?: string;
    jwksUri?: string;
    scopesSupported?: string[];
    resourceMetadataUrl?: string;
  };
}

/**
 * Load auth configuration from YAML file + env var overrides.
 *
 * 1. Reads YAML file (if it exists)
 * 2. Overlays env vars (MCP_AUTH_* take precedence)
 * 3. Validates the merged config
 * 4. Returns null if no auth is configured
 *
 * Env var mapping:
 * - MCP_AUTH_PROVIDER → auth.provider
 * - MCP_AUTH_AUDIENCE → auth.audience
 * - MCP_AUTH_RESOURCE → auth.resource
 * - MCP_AUTH_DOMAIN → auth.domain
 * - MCP_AUTH_ISSUER → auth.issuer
 * - MCP_AUTH_JWKS_URI → auth.jwksUri
 * - MCP_AUTH_SCOPES → auth.scopesSupported (space-separated)
 * - MCP_AUTH_RESOURCE_METADATA_URL → auth.resourceMetadataUrl
 *
 * @param configPath - Path to YAML config file. Defaults to "mcp-server.yaml" in cwd.
 * @returns AuthConfig or null if no auth configured
 * @throws Error if config is invalid (fail-fast)
 */
export async function loadAuthConfig(
  configPath?: string,
): Promise<AuthConfig | null> {
  // 1. Load YAML (optional - file may not exist)
  const yamlAuth = await loadYamlAuth(configPath ?? "mcp-server.yaml");

  // 2. Read env vars
  const envProvider = env("MCP_AUTH_PROVIDER");
  const envAudience = env("MCP_AUTH_AUDIENCE");
  const envResource = env("MCP_AUTH_RESOURCE");
  const envDomain = env("MCP_AUTH_DOMAIN");
  const envIssuer = env("MCP_AUTH_ISSUER");
  const envJwksUri = env("MCP_AUTH_JWKS_URI");
  const envScopes = env("MCP_AUTH_SCOPES");
  const envResourceMetadataUrl = env("MCP_AUTH_RESOURCE_METADATA_URL");

  // 3. Merge: env overrides YAML
  const providerRaw = envProvider ?? yamlAuth?.provider;

  // No provider configured anywhere → no auth
  if (!providerRaw) return null;

  // Validate provider name — untyped YAML/env input requires a runtime check
  // even after 0.17.0's compile-time DU. This is the defense-in-depth layer.
  if (!VALID_PROVIDERS.includes(providerRaw as AuthProviderName)) {
    throw new Error(
      `[AuthConfig] Unknown auth provider: "${providerRaw}". ` +
        `Valid values: ${VALID_PROVIDERS.join(", ")}`,
    );
  }
  const provider = providerRaw as AuthProviderName;

  const audience = envAudience ?? yamlAuth?.audience;
  const resource = envResource ?? yamlAuth?.resource;

  if (!audience) {
    throw new Error(
      `[AuthConfig] "audience" is required when provider="${provider}". ` +
        "Set auth.audience in YAML or MCP_AUTH_AUDIENCE env var.",
    );
  }
  if (!resource) {
    throw new Error(
      `[AuthConfig] "resource" is required when provider="${provider}". ` +
        "Set auth.resource in YAML or MCP_AUTH_RESOURCE env var.",
    );
  }

  const base: AuthConfigBase = {
    audience,
    resource,
    scopesSupported: envScopes
      ? envScopes.split(" ").filter(Boolean)
      : yamlAuth?.scopesSupported,
    resourceMetadataUrl: envResourceMetadataUrl ??
      yamlAuth?.resourceMetadataUrl,
  };

  // 4. Construct the correct DU variant, enforcing provider-specific
  // required fields at runtime. The runtime checks mirror the type-level
  // constraints in the DU variants (Auth0AuthConfig.domain, OIDCAuthConfig.issuer).
  //
  // The `issuer` / `domain` fields are URL-shaped at runtime even though the
  // DU variants type them as `string`. 0.17.0 runs them through `new URL()`
  // here (at the YAML/env boundary) to catch typos like
  // `MCP_AUTH_ISSUER=not-a-url` with a clear error naming the offending field,
  // instead of surfacing a confusing `authorizationServers[0]` error deep
  // inside the preset bridge later (pre-existing issue caught during 0.17.0
  // review, code-reviewer finding).
  switch (provider) {
    case "github":
      return { provider: "github", ...base };
    case "google":
      return { provider: "google", ...base };
    case "auth0": {
      const domain = envDomain ?? yamlAuth?.domain;
      if (!domain) {
        throw new Error(
          '[AuthConfig] "domain" is required for auth0 provider. ' +
            "Set auth.domain in YAML or MCP_AUTH_DOMAIN env var.",
        );
      }
      return { provider: "auth0", ...base, domain };
    }
    case "oidc": {
      const issuer = envIssuer ?? yamlAuth?.issuer;
      if (!issuer) {
        throw new Error(
          '[AuthConfig] "issuer" is required for oidc provider. ' +
            "Set auth.issuer in YAML or MCP_AUTH_ISSUER env var.",
        );
      }
      try {
        const parsed = new URL(issuer);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error(
            `[AuthConfig] "issuer" for oidc provider must use http(s):// ` +
              `scheme, got ${JSON.stringify(parsed.protocol)} in ` +
              `${JSON.stringify(issuer)}.`,
          );
        }
      } catch (err) {
        // If new URL() threw, re-wrap with AuthConfig-labelled error.
        // If our explicit scheme check threw, re-throw as-is (already labelled).
        if (err instanceof Error && err.message.startsWith("[AuthConfig]")) {
          throw err;
        }
        throw new Error(
          `[AuthConfig] "issuer" for oidc provider is not a valid URL: ` +
            `${JSON.stringify(issuer)}. Set auth.issuer in YAML or ` +
            `MCP_AUTH_ISSUER env var to an absolute http(s)://... URL.`,
        );
      }
      const jwksUri = envJwksUri ?? yamlAuth?.jwksUri;
      return { provider: "oidc", ...base, issuer, jwksUri };
    }
    default: {
      // Exhaustiveness guard: future provider additions land here as a TS
      // error at this function. Runtime throw is belt-and-suspenders — the
      // earlier `VALID_PROVIDERS.includes` check at line ~130 already
      // eliminates unknown provider strings.
      const _exhaustive: never = provider;
      throw new Error(
        `[AuthConfig] Unreachable — unhandled provider ${
          JSON.stringify(_exhaustive)
        }`,
      );
    }
  }
}

/**
 * Create an AuthProvider from a loaded AuthConfig.
 *
 * 0.17.0: `config` is a discriminated union on `provider`, so TypeScript
 * narrows `config.domain`/`config.issuer` as required (non-optional) in
 * their respective branches. No more non-null assertions (`config.domain!`)
 * or defensive runtime checks here — the type system guarantees them.
 *
 * @param config - Validated auth config
 * @returns AuthProvider instance
 */
export function createAuthProviderFromConfig(config: AuthConfig): AuthProvider {
  const base = {
    audience: config.audience,
    resource: config.resource,
    scopesSupported: config.scopesSupported,
    resourceMetadataUrl: config.resourceMetadataUrl,
  };

  switch (config.provider) {
    case "github":
      return createGitHubAuthProvider(base);
    case "google":
      return createGoogleAuthProvider(base);
    case "auth0":
      return createAuth0AuthProvider({ ...base, domain: config.domain });
    case "oidc":
      return createOIDCAuthProvider({
        ...base,
        issuer: config.issuer,
        jwksUri: config.jwksUri,
        authorizationServers: [config.issuer],
      });
    default: {
      // Exhaustiveness guard matching the one in loadAuthConfig — when a
      // 5th variant is added to AuthConfig, TS flags this function as
      // incomplete before any caller is affected.
      const _exhaustive: never = config;
      throw new Error(
        `[AuthConfig] Unreachable — unhandled variant ${
          JSON.stringify(_exhaustive)
        }`,
      );
    }
  }
}

/**
 * Load the auth section from a YAML config file.
 * Returns null if file doesn't exist (not an error).
 */
async function loadYamlAuth(
  path: string,
): Promise<ConfigFile["auth"] | null> {
  // readTextFile returns null if file doesn't exist
  const text = await readTextFile(path);
  if (text === null) return null;

  const parsed = parseYaml(text);

  // Validate parsed YAML is an object (not string, array, null, etc.)
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const configFile = parsed as Record<string, unknown>;
  if (
    !configFile.auth || typeof configFile.auth !== "object" ||
    Array.isArray(configFile.auth)
  ) {
    return null;
  }

  const auth = configFile.auth as Record<string, unknown>;
  return {
    provider: typeof auth.provider === "string" ? auth.provider : undefined,
    audience: typeof auth.audience === "string" ? auth.audience : undefined,
    resource: typeof auth.resource === "string" ? auth.resource : undefined,
    domain: typeof auth.domain === "string" ? auth.domain : undefined,
    issuer: typeof auth.issuer === "string" ? auth.issuer : undefined,
    jwksUri: typeof auth.jwksUri === "string" ? auth.jwksUri : undefined,
    scopesSupported: Array.isArray(auth.scopesSupported)
      ? auth.scopesSupported.filter((s: unknown): s is string =>
        typeof s === "string"
      )
      : undefined,
    resourceMetadataUrl: typeof auth.resourceMetadataUrl === "string"
      ? auth.resourceMetadataUrl
      : undefined,
  };
}
