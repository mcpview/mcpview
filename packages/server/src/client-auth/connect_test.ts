import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { CallbackServer } from "./callback-server.ts";
import { CimdConfigError } from "./client-id-metadata.ts";
import { prepareOAuthProvider } from "./connect.ts";
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

function unusedLoopbackPort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return port;
}

Deno.test("prepareOAuthProvider - static config preserves localhost redirect URL", async () => {
  const result = await prepareOAuthProvider("https://mcp.example.com", {
    clientId: "static-client",
    tokenStore: new MemoryTokenStore(),
    openBrowser: async () => {},
  });
  try {
    assertEquals(result.callbackPort > 0, true);
    assertEquals(
      (result.callbackServer as unknown as { hostname: string }).hostname,
      "localhost",
    );
    assertEquals(
      String(result.provider.redirectUrl),
      `http://localhost:${result.callbackPort}/callback`,
    );
  } finally {
    await result.callbackServer.close();
  }
});

Deno.test("prepareOAuthProvider - invalid clientRegistration method fails before callback server start", async () => {
  const originalStart = CallbackServer.prototype.start;
  let started = false;
  CallbackServer.prototype.start = function () {
    started = true;
    return Promise.resolve({
      port: 38987,
      codePromise: new Promise<string>(() => {}),
    });
  };

  try {
    const error = await assertRejects(() =>
      prepareOAuthProvider("https://mcp.example.com", {
        clientRegistration: { method: "bogus" },
        tokenStore: new MemoryTokenStore(),
        openBrowser: async () => {},
      } as unknown as OAuthClientConfig)
    );

    assertInstanceOf(error, CimdConfigError);
    assertEquals(error.code, "cimd_method_invalid");
    assertEquals(started, false);
  } finally {
    CallbackServer.prototype.start = originalStart;
  }
});

Deno.test("prepareOAuthProvider - missing client mode fails before callback server start", async () => {
  const originalStart = CallbackServer.prototype.start;
  let started = false;
  CallbackServer.prototype.start = function () {
    started = true;
    return Promise.resolve({
      port: 38987,
      codePromise: new Promise<string>(() => {}),
    });
  };

  try {
    const error = await assertRejects(() =>
      prepareOAuthProvider("https://mcp.example.com", {
        tokenStore: new MemoryTokenStore(),
        openBrowser: async () => {},
      } as unknown as OAuthClientConfig)
    );

    assertInstanceOf(error, CimdConfigError);
    assertEquals(error.code, "cimd_registration_missing");
    assertEquals(started, false);
  } finally {
    CallbackServer.prototype.start = originalStart;
  }
});

Deno.test("prepareOAuthProvider - CIMD invalid config fast-fails before callback server start", async () => {
  const error = await assertRejects(() =>
    prepareOAuthProvider(
      "https://mcp.example.com",
      cimdConfig({
        callbackPort: 0,
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:0/callback",
        },
      }),
    )
  );

  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, "cimd_port_unfixed");
});

Deno.test("prepareOAuthProvider - CIMD rejects when bound port differs from callbackPort", async () => {
  const originalStart = CallbackServer.prototype.start;
  const originalClose = CallbackServer.prototype.close;
  CallbackServer.prototype.start = function () {
    return Promise.resolve({
      port: 38988,
      codePromise: new Promise<string>(() => {}),
    });
  };
  CallbackServer.prototype.close = function () {
    return Promise.resolve();
  };

  try {
    const error = await assertRejects(() =>
      prepareOAuthProvider("https://mcp.example.com", cimdConfig())
    );

    assertInstanceOf(error, CimdConfigError);
    assertEquals(error.code, "cimd_redirect_mismatch");
    assertEquals(error.context.callbackPort, 38987);
    assertEquals(error.context.boundPort, 38988);
  } finally {
    CallbackServer.prototype.start = originalStart;
    CallbackServer.prototype.close = originalClose;
  }
});

Deno.test("prepareOAuthProvider - CIMD uses fixed callback port and configured redirect URI", async () => {
  const port = unusedLoopbackPort();
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const result = await prepareOAuthProvider("https://mcp.example.com", {
    ...cimdConfig({
      callbackPort: port,
      clientRegistration: {
        method: "client_id_metadata",
        clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
        redirectUri,
      },
    }),
  });
  try {
    assertEquals(result.callbackPort, port);
    assertEquals(
      (result.callbackServer as unknown as { hostname: string }).hostname,
      "127.0.0.1",
    );
    assertEquals(String(result.provider.redirectUrl), redirectUri);
    assertEquals(result.provider.clientMetadata.redirect_uris, [redirectUri]);
    const info = await result.provider.clientInformation();
    assertEquals(
      info?.client_id,
      "https://client.example.com/oauth/client.json",
    );
  } finally {
    await result.callbackServer.close();
  }
});
