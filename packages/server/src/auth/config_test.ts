/**
 * Tests for auth config loader (YAML + env).
 *
 * @module lib/server/auth/config_test
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { createAuthProviderFromConfig, loadAuthConfig } from "./config.ts";
import type { AuthConfig } from "./config.ts";
import { JwtAuthProvider } from "./jwt-provider.ts";

// ============================================
// Helper: set/clear env vars for test isolation
// ============================================

function withEnv(
  vars: Record<string, string>,
  fn: () => Promise<void> | void,
): () => Promise<void> {
  return async () => {
    const originals: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) {
      originals[key] = Deno.env.get(key);
      Deno.env.set(key, vars[key]);
    }
    try {
      await fn();
    } finally {
      for (const [key, val] of Object.entries(originals)) {
        if (val === undefined) {
          Deno.env.delete(key);
        } else {
          Deno.env.set(key, val);
        }
      }
    }
  };
}

function clearAuthEnv() {
  for (
    const key of [
      "MCP_AUTH_PROVIDER",
      "MCP_AUTH_AUDIENCE",
      "MCP_AUTH_RESOURCE",
      "MCP_AUTH_DOMAIN",
      "MCP_AUTH_ISSUER",
      "MCP_AUTH_JWKS_URI",
      "MCP_AUTH_SCOPES",
      // Added in 0.15.1 to match the new env var read in
      // config.ts:loadEnvAuth() (introduced 0.15.0 for the
      // resource_metadata_url YAML/env plumbing). Without this entry,
      // a test that sets MCP_AUTH_RESOURCE_METADATA_URL leaks its value
      // to subsequent tests in the same process → spurious green/red flips.
      "MCP_AUTH_RESOURCE_METADATA_URL",
    ]
  ) {
    Deno.env.delete(key);
  }
}

// ============================================
// loadAuthConfig - no config
// ============================================

Deno.test("loadAuthConfig - returns null when no YAML and no env vars", async () => {
  clearAuthEnv();
  const config = await loadAuthConfig("/nonexistent/path/mcp-server.yaml");
  assertEquals(config, null);
});

// ============================================
// loadAuthConfig - env vars only
// ============================================

Deno.test(
  "loadAuthConfig - loads from env vars (no YAML)",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "google",
      MCP_AUTH_AUDIENCE: "https://my-mcp.example.com",
      MCP_AUTH_RESOURCE: "https://my-mcp.example.com",
    },
    async () => {
      const config = await loadAuthConfig("/nonexistent/path.yaml");
      assert(config !== null);
      assertEquals(config!.provider, "google");
      assertEquals(config!.audience, "https://my-mcp.example.com");
      assertEquals(config!.resource, "https://my-mcp.example.com");
    },
  ),
);

Deno.test(
  "loadAuthConfig - env scopes parsed as space-separated",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "google",
      MCP_AUTH_AUDIENCE: "https://test.com",
      MCP_AUTH_RESOURCE: "https://test.com",
      MCP_AUTH_SCOPES: "read write admin",
    },
    async () => {
      const config = await loadAuthConfig("/nonexistent/path.yaml");
      assertEquals(config!.scopesSupported, ["read", "write", "admin"]);
    },
  ),
);

// ============================================
// loadAuthConfig - validation (fail-fast)
// ============================================

Deno.test(
  "loadAuthConfig - throws on unknown provider",
  withEnv(
    { MCP_AUTH_PROVIDER: "invalid-provider" },
    async () => {
      await assertRejects(
        () => loadAuthConfig("/nonexistent.yaml"),
        Error,
        "Unknown auth provider",
      );
    },
  ),
);

Deno.test(
  "loadAuthConfig - throws when audience missing",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "google",
      MCP_AUTH_RESOURCE: "https://test.com",
    },
    async () => {
      // Clear audience specifically
      Deno.env.delete("MCP_AUTH_AUDIENCE");
      await assertRejects(
        () => loadAuthConfig("/nonexistent.yaml"),
        Error,
        "audience",
      );
    },
  ),
);

Deno.test(
  "loadAuthConfig - throws when resource missing",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "google",
      MCP_AUTH_AUDIENCE: "https://test.com",
    },
    async () => {
      Deno.env.delete("MCP_AUTH_RESOURCE");
      await assertRejects(
        () => loadAuthConfig("/nonexistent.yaml"),
        Error,
        "resource",
      );
    },
  ),
);

Deno.test(
  "loadAuthConfig - auth0 throws when domain missing",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "auth0",
      MCP_AUTH_AUDIENCE: "https://test.com",
      MCP_AUTH_RESOURCE: "https://test.com",
    },
    async () => {
      Deno.env.delete("MCP_AUTH_DOMAIN");
      await assertRejects(
        () => loadAuthConfig("/nonexistent.yaml"),
        Error,
        "domain",
      );
    },
  ),
);

Deno.test(
  "loadAuthConfig - oidc throws when issuer missing",
  withEnv(
    {
      MCP_AUTH_PROVIDER: "oidc",
      MCP_AUTH_AUDIENCE: "https://test.com",
      MCP_AUTH_RESOURCE: "https://test.com",
    },
    async () => {
      Deno.env.delete("MCP_AUTH_ISSUER");
      await assertRejects(
        () => loadAuthConfig("/nonexistent.yaml"),
        Error,
        "issuer",
      );
    },
  ),
);

// ============================================
// loadAuthConfig - YAML file
// ============================================

Deno.test("loadAuthConfig - loads from YAML file", async () => {
  clearAuthEnv();
  const tmpFile = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(
      tmpFile,
      `auth:
  provider: github
  audience: https://yaml-audience.example.com
  resource: https://yaml-resource.example.com
  scopesSupported:
    - read
    - write
`,
    );

    const config = await loadAuthConfig(tmpFile);
    assert(config !== null);
    assertEquals(config!.provider, "github");
    assertEquals(config!.audience, "https://yaml-audience.example.com");
    assertEquals(config!.resource, "https://yaml-resource.example.com");
    assertEquals(config!.scopesSupported, ["read", "write"]);
  } finally {
    await Deno.remove(tmpFile);
  }
});

Deno.test("loadAuthConfig - YAML with auth0 domain", async () => {
  clearAuthEnv();
  const tmpFile = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(
      tmpFile,
      `auth:
  provider: auth0
  audience: https://test.com
  resource: https://test.com
  domain: my-tenant.auth0.com
`,
    );

    const config = await loadAuthConfig(tmpFile);
    // `AuthConfig` is a discriminated union on `provider` (since 0.17.0), and
    // `domain` exists only on the auth0 variant. `assertEquals` checks the tag
    // but does not narrow the type, so assert it as a guard before reading it.
    assert(config?.provider === "auth0");
    assertEquals(config.domain, "my-tenant.auth0.com");
  } finally {
    await Deno.remove(tmpFile);
  }
});

// ============================================
// loadAuthConfig - env overrides YAML
// ============================================

Deno.test(
  "loadAuthConfig - env vars override YAML values",
  withEnv(
    {
      MCP_AUTH_AUDIENCE: "https://env-override.example.com",
    },
    async () => {
      const tmpFile = await Deno.makeTempFile({ suffix: ".yaml" });
      try {
        await Deno.writeTextFile(
          tmpFile,
          `auth:
  provider: google
  audience: https://yaml-audience.example.com
  resource: https://yaml-resource.example.com
`,
        );

        // Remove other env vars that might interfere
        Deno.env.delete("MCP_AUTH_PROVIDER");
        Deno.env.delete("MCP_AUTH_RESOURCE");

        const config = await loadAuthConfig(tmpFile);
        // provider and resource from YAML, audience overridden by env
        assertEquals(config!.provider, "google");
        assertEquals(config!.audience, "https://env-override.example.com");
        assertEquals(config!.resource, "https://yaml-resource.example.com");
      } finally {
        await Deno.remove(tmpFile);
      }
    },
  ),
);

Deno.test("loadAuthConfig - YAML without auth section returns null", async () => {
  clearAuthEnv();
  const tmpFile = await Deno.makeTempFile({ suffix: ".yaml" });
  try {
    await Deno.writeTextFile(tmpFile, "server:\n  name: test\n");
    const config = await loadAuthConfig(tmpFile);
    assertEquals(config, null);
  } finally {
    await Deno.remove(tmpFile);
  }
});

// ============================================
// createAuthProviderFromConfig
// ============================================

// Note (0.16.0): `authorization_servers` and `resource_metadata_url` are
// now `HttpsUrl` branded, normalized via `new URL().toString()`. Host-only
// URLs gain a trailing slash (e.g., `"https://foo.com"` → `"https://foo.com/"`),
// and we cast back to `string[]` / `string` on the assertion side to compare
// structurally — the brand has no runtime presence.

Deno.test("createAuthProviderFromConfig - github creates JwtAuthProvider", () => {
  const config: AuthConfig = {
    provider: "github",
    audience: "https://test.com",
    resource: "https://test.com",
  };
  const provider = createAuthProviderFromConfig(config);
  assert(provider instanceof JwtAuthProvider);
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers as string[], [
    "https://token.actions.githubusercontent.com/",
  ]);
});

Deno.test("createAuthProviderFromConfig - google creates JwtAuthProvider", () => {
  const config: AuthConfig = {
    provider: "google",
    audience: "https://test.com",
    resource: "https://test.com",
  };
  const provider = createAuthProviderFromConfig(config);
  assert(provider instanceof JwtAuthProvider);
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers as string[], [
    "https://accounts.google.com/",
  ]);
});

Deno.test("createAuthProviderFromConfig - auth0 creates JwtAuthProvider with domain", () => {
  const config: AuthConfig = {
    provider: "auth0",
    audience: "https://test.com",
    resource: "https://test.com",
    domain: "my-tenant.auth0.com",
  };
  const provider = createAuthProviderFromConfig(config);
  assert(provider instanceof JwtAuthProvider);
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers as string[], [
    "https://my-tenant.auth0.com/",
  ]);
});

Deno.test("createAuthProviderFromConfig - oidc creates JwtAuthProvider with issuer", () => {
  const config: AuthConfig = {
    provider: "oidc",
    audience: "https://test.com",
    resource: "https://test.com",
    issuer: "https://my-idp.example.com",
  };
  const provider = createAuthProviderFromConfig(config);
  assert(provider instanceof JwtAuthProvider);
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers as string[], [
    "https://my-idp.example.com/",
  ]);
});

Deno.test("createAuthProviderFromConfig - passes scopesSupported to metadata", () => {
  const config: AuthConfig = {
    provider: "google",
    audience: "https://test.com",
    resource: "https://test.com",
    scopesSupported: ["read", "write"],
  };
  const provider = createAuthProviderFromConfig(config);
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.scopes_supported, ["read", "write"]);
});

Deno.test("createAuthProviderFromConfig - forwards resourceMetadataUrl for opaque resource (0.15.0+)", () => {
  // Regression test for 0.15.0: YAML/env users with an opaque `resource`
  // (e.g., OIDC project ID as JWT audience per RFC 9728 § 2) MUST be able
  // to supply `resourceMetadataUrl` through the config layer, otherwise
  // JwtAuthProvider would throw at boot with no recovery path.
  const config: AuthConfig = {
    provider: "oidc",
    audience: "367545125829670172",
    resource: "367545125829670172",
    issuer: "https://idp.example.com",
    resourceMetadataUrl:
      "https://my-tenant.example.com/mcp/.well-known/oauth-protected-resource",
  };
  const provider = createAuthProviderFromConfig(config);
  assert(provider instanceof JwtAuthProvider);
  const metadata = provider.getResourceMetadata();
  // Explicit path URL — `new URL().toString()` does not add a trailing slash.
  assertEquals(
    metadata.resource_metadata_url as string,
    "https://my-tenant.example.com/mcp/.well-known/oauth-protected-resource",
  );
});
