import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertRejects,
} from "@std/assert";
import {
  auth,
  IssuerMismatchError,
  OAuthError,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { prepareOAuthProvider } from "./connect.ts";
import { OAuthClientProviderImpl } from "./provider.ts";
import { MemoryTokenStore } from "./token-store/memory-store.ts";

Deno.test("SDK v2 OAuth completes the code callback and refreshes issuer-bound tokens", async () => {
  const serverUrl = "https://mcp.example.com/mcp";
  const issuer = "https://auth.example.com";
  const store = new MemoryTokenStore();
  let authorizationUrl: URL | undefined;
  const grants: URLSearchParams[] = [];
  const provider = new OAuthClientProviderImpl(serverUrl, {
    clientId: "casys-client",
    tokenStore: store,
    openBrowser: (url) => {
      authorizationUrl = new URL(url);
      return Promise.resolve();
    },
  });
  provider.setRedirectUrl("http://localhost:38987/callback");

  // Exercise the published SDK, with only the authorization server's HTTP
  // responses substituted. In v2 the callback requires discoveryState() and
  // token saves carry an issuer stamp in addition to the wire token response.
  const fetchFn: typeof fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
    );
    if (url.origin === "https://mcp.example.com") {
      return Promise.resolve(Response.json({
        resource: serverUrl,
        authorization_servers: [issuer],
      }));
    }
    if (url.pathname.includes(".well-known")) {
      return Promise.resolve(Response.json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      }));
    }
    assertEquals(url.href, `${issuer}/token`);
    const grant = new URLSearchParams(String(init?.body));
    grants.push(grant);
    return Promise.resolve(Response.json({
      access_token: grants.length === 1 ? "access-code" : "access-refreshed",
      token_type: "Bearer",
      ...(grants.length === 1 ? { refresh_token: "refresh-secret" } : {}),
    }));
  };

  assertEquals(await auth(provider, { serverUrl, fetchFn }), "REDIRECT");
  assertExists(authorizationUrl);
  assertEquals(authorizationUrl.searchParams.get("client_id"), "casys-client");
  assertEquals(
    authorizationUrl.searchParams.get("code_challenge_method"),
    "S256",
  );
  assertEquals(
    (await provider.discoveryState())?.authorizationServerUrl,
    issuer,
  );

  assertEquals(
    await auth(provider, { serverUrl, authorizationCode: "code-123", fetchFn }),
    "AUTHORIZED",
  );
  assertEquals(grants[0].get("grant_type"), "authorization_code");
  assertEquals(grants[0].get("code_verifier"), await provider.codeVerifier());
  assertEquals(grants[0].get("code"), "code-123");
  assertEquals((await provider.tokens())?.issuer, issuer);
  assertEquals((await store.get(serverUrl))?.authServerUrl, `${issuer}/`);

  assertEquals(await auth(provider, { serverUrl, fetchFn }), "AUTHORIZED");
  assertEquals(grants[1].get("grant_type"), "refresh_token");
  assertEquals(grants[1].get("refresh_token"), "refresh-secret");
  assertEquals((await provider.tokens())?.access_token, "access-refreshed");
  assertEquals((await provider.tokens())?.refresh_token, "refresh-secret");
  assertEquals((await provider.tokens())?.issuer, issuer);

  await provider.invalidateCredentials("discovery");
  assertEquals(await provider.discoveryState(), undefined);
  // Discovery invalidation does not remove the bearer used for ordinary calls.
  assertEquals((await provider.tokens())?.access_token, "access-refreshed");
});

for (
  const scenario of [
    {
      name: "advertised correct issuer",
      supported: true,
      iss: "https://auth.example.com",
      authorized: true,
    },
    {
      name: "advertised different issuer",
      supported: true,
      iss: "https://other.example.com",
      authorized: false,
    },
    {
      name: "advertised missing issuer",
      supported: true,
      iss: undefined,
      authorized: false,
    },
    {
      name: "no advertised issuer support",
      supported: false,
      iss: undefined,
      authorized: true,
    },
    {
      name: "advertised OAuth denial",
      supported: true,
      iss: "https://auth.example.com",
      authorized: false,
      error: "access_denied",
    },
    {
      name: "OAuth denial with different issuer",
      supported: true,
      iss: "https://other.example.com",
      authorized: false,
      error: "access_denied",
    },
  ]
) {
  Deno.test(`SDK v2 localhost callback - ${scenario.name}`, async () => {
    const serverUrl = "https://mcp.example.com/mcp";
    const issuer = "https://auth.example.com";
    let authorizationUrl: URL | undefined;
    const grants: URLSearchParams[] = [];
    const prepared = await prepareOAuthProvider(serverUrl, {
      clientId: "casys-client",
      tokenStore: new MemoryTokenStore(),
      openBrowser: (url) => {
        authorizationUrl = new URL(url);
        return Promise.resolve();
      },
    });
    const fetchFn: typeof fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === "https://mcp.example.com") {
        return Promise.resolve(Response.json({
          resource: serverUrl,
          authorization_servers: [issuer],
        }));
      }
      if (url.pathname.includes(".well-known")) {
        return Promise.resolve(Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          ...(scenario.supported
            ? { authorization_response_iss_parameter_supported: true }
            : {}),
        }));
      }
      assertEquals(url.href, `${issuer}/token`);
      grants.push(new URLSearchParams(String(init?.body)));
      return Promise.resolve(Response.json({
        access_token: "callback-token",
        token_type: "Bearer",
      }));
    };
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      authProvider: prepared.provider,
      fetch: fetchFn,
    });
    try {
      assertEquals(
        await auth(prepared.provider, { serverUrl, fetchFn }),
        "REDIRECT",
      );
      assertExists(authorizationUrl);
      const callbackUrl = new URL(String(prepared.provider.redirectUrl));
      callbackUrl.searchParams.set("state", "caller-state");
      if (scenario.iss !== undefined) {
        callbackUrl.searchParams.set("iss", scenario.iss);
      }
      if (scenario.error) {
        callbackUrl.searchParams.set("error", scenario.error);
        callbackUrl.searchParams.set(
          "error_description",
          "Untrusted denial details",
        );
      } else {
        callbackUrl.searchParams.set("code", "callback-code");
      }
      const response = await fetch(callbackUrl);
      assertEquals(response.status, scenario.error ? 400 : 200);
      await response.text();

      if (scenario.authorized) {
        const callback = await prepared.callbackPromise;
        assertEquals(callback.state, "caller-state");
        assertEquals(callback.iss, scenario.iss);
        await prepared.finishAuth(transport);
        assertEquals(grants.length, 1);
        assertEquals(grants[0].get("code"), "callback-code");
        assertEquals(
          grants[0].get("code_verifier"),
          await prepared.provider.codeVerifier(),
        );
        assertEquals(
          (await prepared.provider.tokens())?.access_token,
          "callback-token",
        );
        assertEquals((await prepared.provider.tokens())?.issuer, issuer);
      } else {
        const error = await assertRejects(() => prepared.finishAuth(transport));
        if (!(scenario.error && scenario.iss === issuer)) {
          assertInstanceOf(error, IssuerMismatchError);
          assertEquals(error.kind, "authorization_response");
          assertEquals(
            error.message.includes("Untrusted denial details"),
            false,
          );
        } else {
          assertInstanceOf(error, OAuthError);
          assertEquals(
            error.message.includes("Untrusted denial details"),
            true,
          );
        }
        assertEquals(grants.length, 0);
        assertEquals(await prepared.provider.tokens(), undefined);
      }
    } finally {
      await transport.close();
      await prepared.callbackServer.close();
    }
  });
}
