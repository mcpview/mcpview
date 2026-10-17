import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertThrows,
} from "@std/assert";
import { CimdConfigError } from "./client-id-metadata.ts";
import { OAuthClientProviderImpl } from "./provider.ts";
import { MemoryTokenStore } from "./token-store/memory-store.ts";
import type { CimdClientConfig, OAuthClientConfig } from "./types.ts";

function cimdConfig(
  overrides: Partial<CimdClientConfig> = {},
): CimdClientConfig {
  return {
    clientName: "Casys CLI",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
    callbackPort: 38987,
    clientRegistration: {
      method: "client_id_metadata",
      clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
      redirectUri: "http://127.0.0.1:38987/callback",
    },
    ...overrides,
  };
}

Deno.test("OAuthClientProviderImpl - tokens() returns undefined when no stored tokens", async () => {
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test-client",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  const tokens = await provider.tokens();
  assertEquals(tokens, undefined);
});

Deno.test("OAuthClientProviderImpl - saveTokens and tokens round-trip", async () => {
  const store = new MemoryTokenStore();
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test-client",
    tokenStore: store,
    openBrowser: async () => {},
  });
  await provider.saveTokens({
    access_token: "access-123",
    token_type: "bearer",
    refresh_token: "refresh-456",
  });
  const tokens = await provider.tokens();
  assertExists(tokens);
  assertEquals(tokens.access_token, "access-123");
  assertEquals(tokens.refresh_token, "refresh-456");
});

Deno.test("OAuthClientProviderImpl - saveTokens preserves existing refresh_token when new tokens omit it", async () => {
  const store = new MemoryTokenStore();
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test-client",
    tokenStore: store,
    openBrowser: async () => {},
  });

  // Discovery first, exactly as `auth()` does before it ever saves tokens.
  // Since SEP-2352 the carry-over is scoped to one authorization server, so
  // this keeps the test on the real code path rather than a shape `auth()`
  // never produces. The boundary itself lives in issuer-binding_test.ts.
  await provider.saveDiscoveryState({
    authorizationServerUrl: "https://as.example.com",
  });

  await provider.saveTokens({
    access_token: "access-123",
    token_type: "bearer",
    refresh_token: "refresh-456",
  });
  await provider.saveTokens({
    access_token: "access-789",
    token_type: "bearer",
  });

  const tokens = await provider.tokens();
  assertExists(tokens);
  assertEquals(tokens.access_token, "access-789");
  assertEquals(tokens.refresh_token, "refresh-456");
});

Deno.test("OAuthClientProviderImpl - clientMetadata returns correct shape", () => {
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "my-client-id",
    clientName: "Test App",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  const metadata = provider.clientMetadata;
  assertEquals(metadata.client_name, "Test App");
  assertEquals(metadata.grant_types, ["authorization_code", "refresh_token"]);
  assertEquals(metadata.token_endpoint_auth_method, "none");
  assertEquals(metadata.application_type, "native");
});

Deno.test("OAuthClientProviderImpl - clientMetadata sets application_type native for CIMD mode", () => {
  const provider = new OAuthClientProviderImpl(
    "https://mcp.example.com",
    cimdConfig(),
  );
  assertEquals(provider.clientMetadata.application_type, "native");
});

Deno.test("OAuthClientProviderImpl - saveCodeVerifier and codeVerifier round-trip", async () => {
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  await provider.saveCodeVerifier("verifier-xyz");
  const verifier = await provider.codeVerifier();
  assertEquals(verifier, "verifier-xyz");
});

Deno.test("OAuthClientProviderImpl - redirectToAuthorization calls openBrowser", async () => {
  let capturedUrl = "";
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test",
    tokenStore: new MemoryTokenStore(),
    openBrowser: (url) => {
      capturedUrl = url;
      return Promise.resolve();
    },
  });
  const authUrl = new URL(
    "https://accounts.google.com/o/oauth2/auth?foo=bar",
  );
  await provider.redirectToAuthorization(authUrl);
  assertEquals(capturedUrl, authUrl.toString());
});

Deno.test("OAuthClientProviderImpl - clientInformation returns client_id", async () => {
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "my-client-id",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  const info = await provider.clientInformation();
  assertExists(info);
  assertEquals(info.client_id, "my-client-id");
});

Deno.test("OAuthClientProviderImpl - CIMD clientInformation uses metadata URL as client_id", async () => {
  const provider = new OAuthClientProviderImpl(
    "https://mcp.example.com",
    cimdConfig(),
  );

  const info = await provider.clientInformation();

  assertExists(info);
  assertEquals(
    info.client_id,
    "https://client.example.com/oauth/client.json",
  );
});

Deno.test("OAuthClientProviderImpl - CIMD clientInformation is not overwritten by saved client info", async () => {
  const provider = new OAuthClientProviderImpl(
    "https://mcp.example.com",
    cimdConfig(),
  );

  await provider.saveClientInformation({ client_id: "dcr-client-id" });
  const info = await provider.clientInformation();

  assertExists(info);
  assertEquals(
    info.client_id,
    "https://client.example.com/oauth/client.json",
  );
});

Deno.test("OAuthClientProviderImpl - CIMD redirectUrl and clientMetadata use configured redirect URI", () => {
  const provider = new OAuthClientProviderImpl(
    "https://mcp.example.com",
    cimdConfig(),
  );

  assertEquals(
    String(provider.redirectUrl),
    "http://127.0.0.1:38987/callback",
  );
  assertEquals(provider.clientMetadata.client_name, "Casys CLI");
  assertEquals(provider.clientMetadata.redirect_uris, [
    "http://127.0.0.1:38987/callback",
  ]);
});

Deno.test("OAuthClientProviderImpl - CIMD constructor fast-fails invalid config", () => {
  const error = assertThrows(() =>
    new OAuthClientProviderImpl(
      "https://mcp.example.com",
      cimdConfig({ clientName: "" }),
    )
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_name_missing");
});

Deno.test("OAuthClientProviderImpl - constructor rejects invalid clientRegistration method", () => {
  const error = assertThrows(() =>
    new OAuthClientProviderImpl("https://mcp.example.com", {
      clientRegistration: { method: "bogus" },
      tokenStore: new MemoryTokenStore(),
      openBrowser: async () => {},
    } as unknown as OAuthClientConfig)
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_method_invalid");
});

Deno.test("OAuthClientProviderImpl - constructor rejects incomplete clientRegistration", () => {
  const error = assertThrows(() =>
    new OAuthClientProviderImpl("https://mcp.example.com", {
      clientRegistration: {},
      tokenStore: new MemoryTokenStore(),
      openBrowser: async () => {},
    } as unknown as OAuthClientConfig)
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_registration_missing");
});

Deno.test("OAuthClientProviderImpl - constructor rejects missing client mode", () => {
  const error = assertThrows(() =>
    new OAuthClientProviderImpl("https://mcp.example.com", {
      tokenStore: new MemoryTokenStore(),
      openBrowser: async () => {},
    } as unknown as OAuthClientConfig)
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_registration_missing");
});

Deno.test("OAuthClientProviderImpl - CIMD setRedirectUrl rejects incoherent redirect URIs", () => {
  const provider = new OAuthClientProviderImpl(
    "https://mcp.example.com",
    cimdConfig(),
  );

  const error = assertThrows(() =>
    provider.setRedirectUrl("http://127.0.0.1:38988/callback")
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_redirect_mismatch");
  assertEquals(
    String(provider.redirectUrl),
    "http://127.0.0.1:38987/callback",
  );
});

Deno.test("OAuthClientProviderImpl - invalidateCredentials clears tokens", async () => {
  const store = new MemoryTokenStore();
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test",
    tokenStore: store,
    openBrowser: async () => {},
  });
  await provider.saveTokens({
    access_token: "secret",
    token_type: "bearer",
  });
  assertExists(await provider.tokens());

  await provider.invalidateCredentials("tokens");
  assertEquals(await provider.tokens(), undefined);
});

Deno.test("OAuthClientProviderImpl - invalidateCredentials('all') clears everything", async () => {
  const store = new MemoryTokenStore();
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test",
    tokenStore: store,
    openBrowser: async () => {},
  });
  await provider.saveTokens({
    access_token: "secret",
    token_type: "bearer",
  });
  await provider.saveCodeVerifier("my-verifier");

  await provider.invalidateCredentials("all");
  assertEquals(await provider.tokens(), undefined);
  assertEquals(await provider.codeVerifier(), "");
});

Deno.test("OAuthClientProviderImpl - setRedirectUrl updates redirectUrl", () => {
  const provider = new OAuthClientProviderImpl("https://mcp.example.com", {
    clientId: "test",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  provider.setRedirectUrl("http://localhost:12345/callback");
  assertEquals(String(provider.redirectUrl), "http://localhost:12345/callback");
});
