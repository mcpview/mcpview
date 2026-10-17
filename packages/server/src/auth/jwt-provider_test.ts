// deno-lint-ignore-file require-await
/**
 * Tests for JwtAuthProvider and OIDC presets.
 *
 * Includes real JWT signing/verification via local JWKS server.
 *
 * @module lib/server/auth/jwt-provider_test
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { JwtAuthProvider } from "./jwt-provider.ts";
import {
  createAuth0AuthProvider,
  createGitHubAuthProvider,
  createGoogleAuthProvider,
  createOIDCAuthProvider,
} from "./presets.ts";
import { httpsUrl } from "./types.ts";

// ============================================
// Helper: Local JWKS server for real JWT tests
// ============================================

interface LocalJwks {
  port: number;
  issuer: string;
  shutdown: () => Promise<void>;
  sign: (
    claims: Record<string, unknown>,
    options?: { expiresIn?: string },
  ) => Promise<string>;
}

async function startLocalJwksServer(): Promise<LocalJwks> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const jwksJson = JSON.stringify({ keys: [jwk] });

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();

  const issuer = `http://localhost:${port}`;

  const server = Deno.serve(
    { port, onListen: () => {} },
    (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/jwks.json") {
        return new Response(jwksJson, {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  );

  return {
    port,
    issuer,
    shutdown: () => server.shutdown(),
    sign: async (claims, options) => {
      const builder = new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
        .setIssuer(issuer)
        .setIssuedAt();

      if (options?.expiresIn) {
        builder.setExpirationTime(options.expiresIn);
      } else {
        builder.setExpirationTime("1h");
      }

      return builder.sign(privateKey);
    },
  };
}

// ============================================
// JwtAuthProvider - Construction & Fail-Fast
// ============================================
//
// In 0.16.0 the `JwtAuthProviderOptions` type is a discriminated union that
// rejects raw strings for URL-typed fields at compile time. The fail-fast
// tests below therefore provide a dummy `resourceMetadataUrl` (branded
// via `httpsUrl()`) so that the test subject — the runtime falsy checks
// in the constructor (`!options.issuer`, etc.) — remains reachable.

const DUMMY_METADATA_URL = httpsUrl(
  "https://dummy.example.com/.well-known/oauth-protected-resource",
);

Deno.test("JwtAuthProvider - throws when issuer missing", () => {
  assertThrows(
    () =>
      new JwtAuthProvider({
        kind: "opaque",
        issuer: "",
        audience: "aud",
        resource: "opaque",
        authorizationServers: [httpsUrl("https://auth.example.com")],
        resourceMetadataUrl: DUMMY_METADATA_URL,
      }),
    Error,
    "issuer is required",
  );
});

Deno.test("JwtAuthProvider - throws when audience missing", () => {
  assertThrows(
    () =>
      new JwtAuthProvider({
        kind: "opaque",
        issuer: "https://issuer.example.com",
        audience: "",
        resource: "opaque",
        authorizationServers: [httpsUrl("https://auth.example.com")],
        resourceMetadataUrl: DUMMY_METADATA_URL,
      }),
    Error,
    "audience is required",
  );
});

Deno.test("JwtAuthProvider - throws when resource missing", () => {
  assertThrows(
    () =>
      new JwtAuthProvider({
        kind: "opaque",
        issuer: "https://issuer.example.com",
        audience: "aud",
        resource: "",
        authorizationServers: [httpsUrl("https://auth.example.com")],
        resourceMetadataUrl: DUMMY_METADATA_URL,
      }),
    Error,
    "resource is required",
  );
});

Deno.test("JwtAuthProvider - throws when authorizationServers empty", () => {
  assertThrows(
    () =>
      new JwtAuthProvider({
        kind: "opaque",
        issuer: "https://issuer.example.com",
        audience: "aud",
        resource: "opaque",
        authorizationServers: [],
        resourceMetadataUrl: DUMMY_METADATA_URL,
      }),
    Error,
    "at least one authorizationServer",
  );
});

Deno.test("JwtAuthProvider - constructs with valid options", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://issuer.example.com",
    audience: "https://my-mcp.example.com",
    resource: httpsUrl("https://my-mcp.example.com"),
    authorizationServers: [httpsUrl("https://issuer.example.com")],
    scopesSupported: ["read", "write"],
  });
  assert(provider instanceof JwtAuthProvider);
});

Deno.test("JwtAuthProvider - getResourceMetadata returns correct data", () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://issuer.example.com",
    audience: "https://my-mcp.example.com",
    resource: httpsUrl("https://my-mcp.example.com"),
    authorizationServers: [
      httpsUrl("https://auth1.example.com"),
      httpsUrl("https://auth2.example.com"),
    ],
    scopesSupported: ["read", "admin"],
  });

  const metadata = provider.getResourceMetadata();
  // `resource` normalizes via httpsUrl() → trailing slash added
  assertEquals(metadata.resource as string, "https://my-mcp.example.com/");
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://auth1.example.com/",
    "https://auth2.example.com/",
  ]);
  assertEquals(metadata.scopes_supported, ["read", "admin"]);
  assertEquals(metadata.bearer_methods_supported, ["header"]);
});

Deno.test("JwtAuthProvider - verifyToken returns null for garbage token", async () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://issuer.example.com",
    audience: "https://my-mcp.example.com",
    resource: httpsUrl("https://my-mcp.example.com"),
    authorizationServers: [httpsUrl("https://issuer.example.com")],
  });

  const result = await provider.verifyToken("not-a-valid-jwt");
  assertEquals(result, null);
});

Deno.test("JwtAuthProvider - verifyToken returns null for expired JWT format", async () => {
  const provider = new JwtAuthProvider({
    kind: "url",
    issuer: "https://issuer.example.com",
    audience: "https://my-mcp.example.com",
    resource: httpsUrl("https://my-mcp.example.com"),
    authorizationServers: [httpsUrl("https://issuer.example.com")],
  });

  // A structurally valid but unsigned/invalid JWT
  const fakeJwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.invalid-signature";
  const result = await provider.verifyToken(fakeJwt);
  assertEquals(result, null);
});

// ============================================
// Presets
// ============================================
//
// Presets accept raw `string` fields per `PresetOptions` — the bridge
// layer inside `presets.ts` wraps them through `httpsUrl()` before
// passing to the branded `JwtAuthProvider` constructor.

Deno.test("createGitHubAuthProvider - sets correct issuer", () => {
  const provider = createGitHubAuthProvider({
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
  });

  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://token.actions.githubusercontent.com/",
  ]);
  // `resource` normalized to add trailing slash by `httpsUrl()`
  assertEquals(metadata.resource as string, "https://my-mcp.example.com/");
  assertEquals(metadata.bearer_methods_supported, ["header"]);
});

Deno.test("createGoogleAuthProvider - sets correct issuer", () => {
  const provider = createGoogleAuthProvider({
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
  });

  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://accounts.google.com/",
  ]);
});

Deno.test("createAuth0AuthProvider - sets correct issuer from domain", () => {
  const provider = createAuth0AuthProvider({
    domain: "my-tenant.auth0.com",
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
  });

  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://my-tenant.auth0.com/",
  ]);
});

Deno.test("createAuth0AuthProvider - passes scopesSupported", () => {
  const provider = createAuth0AuthProvider({
    domain: "my-tenant.auth0.com",
    audience: "https://test.com",
    resource: "https://test.com",
    scopesSupported: ["read", "write", "admin"],
  });

  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.scopes_supported, ["read", "write", "admin"]);
});

Deno.test("createOIDCAuthProvider - generic provider with custom issuer", () => {
  const provider = createOIDCAuthProvider({
    issuer: "https://custom-idp.example.com",
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
    authorizationServers: ["https://custom-idp.example.com"],
    jwksUri: "https://custom-idp.example.com/keys",
  });

  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://custom-idp.example.com/",
  ]);
  assertEquals(metadata.resource as string, "https://my-mcp.example.com/");
});

Deno.test("createOIDCAuthProvider - defaults authorizationServers to [issuer]", () => {
  // 0.16.0: when `authorizationServers` is omitted in OIDCPresetOptions,
  // the preset falls back to `[issuer]` — matching the pre-0.16.0 behavior
  // where `config.ts` explicitly passed `[config.issuer!]`.
  const provider = createOIDCAuthProvider({
    issuer: "https://custom-idp.example.com",
    audience: "https://my-mcp.example.com",
    resource: "https://my-mcp.example.com",
  });
  const metadata = provider.getResourceMetadata();
  assertEquals(metadata.authorization_servers.map((u) => u as string), [
    "https://custom-idp.example.com/",
  ]);
});

// ============================================
// Real JWT verification with local JWKS server
// ============================================

Deno.test("JwtAuthProvider - verifies valid JWT from local JWKS", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-42",
      aud: "https://my-mcp.example.com",
      scope: "read write",
    });

    const result = await provider.verifyToken(token);
    assert(result !== null);
    assertEquals(result!.subject, "user-42");
    assertEquals(result!.scopes, ["read", "write"]);
    assert(result!.expiresAt !== undefined);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - rejects JWT with wrong audience", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-1",
      aud: "https://wrong-audience.example.com",
    });

    const result = await provider.verifyToken(token);
    assertEquals(result, null);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - rejects expired JWT", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    // Sign a token that expired 1 hour ago
    const token = await jwks.sign(
      {
        sub: "user-1",
        aud: "https://my-mcp.example.com",
      },
      { expiresIn: "-1h" },
    );

    const result = await provider.verifyToken(token);
    assertEquals(result, null);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - extracts scopes from 'scope' claim (space-separated string)", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-1",
      aud: "https://my-mcp.example.com",
      scope: "read write admin",
    });

    const result = await provider.verifyToken(token);
    assertEquals(result!.scopes, ["read", "write", "admin"]);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - extracts scopes from 'scp' claim (array)", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-1",
      aud: "https://my-mcp.example.com",
      scp: ["read", "write"],
    });

    const result = await provider.verifyToken(token);
    assertEquals(result!.scopes, ["read", "write"]);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - returns empty scopes when no scope/scp claim", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-1",
      aud: "https://my-mcp.example.com",
      // No scope or scp claim
    });

    const result = await provider.verifyToken(token);
    assertEquals(result!.scopes, []);
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - extracts clientId from azp claim", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      sub: "user-1",
      aud: "https://my-mcp.example.com",
      azp: "my-client-app",
    });

    const result = await provider.verifyToken(token);
    assertEquals(result!.clientId, "my-client-app");
  } finally {
    await jwks.shutdown();
  }
});

Deno.test("JwtAuthProvider - subject defaults to 'unknown' when no sub claim", async () => {
  const jwks = await startLocalJwksServer();
  try {
    const provider = new JwtAuthProvider({
      kind: "url",
      issuer: jwks.issuer,
      audience: "https://my-mcp.example.com",
      resource: httpsUrl("https://my-mcp.example.com"),
      authorizationServers: [httpsUrl(jwks.issuer)],
      jwksUri: `${jwks.issuer}/.well-known/jwks.json`,
    });

    const token = await jwks.sign({
      // No sub claim
      aud: "https://my-mcp.example.com",
    });

    const result = await provider.verifyToken(token);
    assertEquals(result!.subject, "unknown");
  } finally {
    await jwks.shutdown();
  }
});
