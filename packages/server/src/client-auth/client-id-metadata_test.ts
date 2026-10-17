import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  buildClientIdMetadataDocument,
  CimdConfigError,
  isCimdConfig,
} from "./client-id-metadata.ts";
import { MemoryTokenStore } from "./token-store/memory-store.ts";
import type { CimdClientConfig } from "./types.ts";

function config(
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

function assertCimdError(
  fn: () => unknown,
  code: CimdConfigError["code"],
): void {
  const error = assertThrows(fn);
  assertInstanceOf(error, CimdConfigError);
  assertEquals(error.code, code);
}

Deno.test("buildClientIdMetadataDocument is deterministic and preserves client_id exactly", () => {
  const cfg: CimdClientConfig = {
    ...config(),
    scopes: ["openid", "profile"],
    clientRegistration: {
      method: "client_id_metadata",
      clientIdMetadataUrl: "https://client.example.com?tenant=acme",
      redirectUri: "http://127.0.0.1:38987/callback",
    },
  };

  const first = buildClientIdMetadataDocument(cfg);
  const second = buildClientIdMetadataDocument(cfg);

  assertEquals(first, second);
  assertEquals(
    first.client_id,
    "https://client.example.com?tenant=acme",
  );
  assertEquals(first.redirect_uris, ["http://127.0.0.1:38987/callback"]);
  assertEquals(first.grant_types, ["authorization_code", "refresh_token"]);
  assertEquals(first.scope, "openid profile");
  assertEquals(first.application_type, "native");
});

Deno.test("buildClientIdMetadataDocument rejects configs with both static and CIMD client ids", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument({
        ...config(),
        clientId: "static-client-id",
      } as unknown as CimdClientConfig),
    "cimd_config_conflict",
  );
});

Deno.test("buildClientIdMetadataDocument rejects configs with neither client registration mode", () => {
  const { clientRegistration: _clientRegistration, ...withoutRegistration } =
    config();

  assertCimdError(
    () =>
      buildClientIdMetadataDocument(
        withoutRegistration as unknown as CimdClientConfig,
      ),
    "cimd_registration_missing",
  );
});

Deno.test("buildClientIdMetadataDocument rejects unknown clientRegistration methods", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument({
        ...config(),
        clientRegistration: {
          ...config().clientRegistration,
          method: "dynamic_client_registration",
        },
      } as unknown as CimdClientConfig),
    "cimd_method_invalid",
  );
});

Deno.test("buildClientIdMetadataDocument rejects non-HTTPS client metadata URLs", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "http://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:38987/callback",
        },
      })),
    "cimd_url_invalid",
  );
});

Deno.test("buildClientIdMetadataDocument rejects CIMD configs without a fixed callback port", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        callbackPort: 0,
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:0/callback",
        },
      })),
    "cimd_port_unfixed",
  );
});

Deno.test("buildClientIdMetadataDocument rejects redirect URIs whose port differs from callbackPort", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        callbackPort: 38987,
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:38988/callback",
        },
      })),
    "cimd_redirect_mismatch",
  );
});

Deno.test("buildClientIdMetadataDocument rejects non-127.0.0.1 loopback redirect hosts", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://localhost:38987/callback",
        },
      })),
    "cimd_redirect_mismatch",
  );
});

Deno.test("buildClientIdMetadataDocument rejects redirect URIs outside the runtime callback path", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:38987/other",
        },
      })),
    "cimd_redirect_mismatch",
  );
});

Deno.test("buildClientIdMetadataDocument rejects non-HTTP loopback redirect URIs", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "https://127.0.0.1:38987/callback",
        },
      })),
    "cimd_redirect_mismatch",
  );
});

Deno.test("buildClientIdMetadataDocument rejects CIMD configs without an explicit client name", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientName: "",
      })),
    "cimd_name_missing",
  );
});

Deno.test("buildClientIdMetadataDocument includes optional metadata without overriding reserved fields", () => {
  const document = buildClientIdMetadataDocument(config({
    clientRegistration: {
      method: "client_id_metadata",
      clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
      redirectUri: "http://127.0.0.1:38987/callback",
      metadata: {
        client_uri: "https://client.example.com",
        logo_uri: "https://client.example.com/logo.png",
        contacts: ["ops@client.example.com"],
        extra: {
          "urn:example:custom": "custom-value",
        },
      },
    },
  }));

  assertEquals(
    document.client_id,
    "https://client.example.com/oauth/client.json",
  );
  assertEquals(document.grant_types, ["authorization_code", "refresh_token"]);
  assertEquals(document.client_uri, "https://client.example.com");
  assertEquals(document.logo_uri, "https://client.example.com/logo.png");
  assertEquals(document.contacts, ["ops@client.example.com"]);
  assertEquals(document["urn:example:custom"], "custom-value");
});

Deno.test("buildClientIdMetadataDocument rejects reserved metadata extra keys", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:38987/callback",
          metadata: {
            extra: {
              scope: "admin",
            },
          },
        },
      })),
    "cimd_reserved_metadata_key",
  );
});

Deno.test("buildClientIdMetadataDocument rejects application_type in extra metadata", () => {
  assertCimdError(
    () =>
      buildClientIdMetadataDocument(config({
        clientRegistration: {
          method: "client_id_metadata",
          clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
          redirectUri: "http://127.0.0.1:38987/callback",
          metadata: {
            extra: {
              application_type: "web",
            },
          },
        },
      })),
    "cimd_reserved_metadata_key",
  );
});

Deno.test("buildClientIdMetadataDocument always sets application_type to native", () => {
  const document = buildClientIdMetadataDocument(config());
  assertEquals(document.application_type, "native");
});

Deno.test("buildClientIdMetadataDocument rejects dedicated metadata fields in extra", () => {
  for (const key of ["client_uri", "logo_uri", "contacts"]) {
    assertCimdError(
      () =>
        buildClientIdMetadataDocument(config({
          clientRegistration: {
            method: "client_id_metadata",
            clientIdMetadataUrl: "https://client.example.com/oauth/client.json",
            redirectUri: "http://127.0.0.1:38987/callback",
            metadata: {
              extra: {
                [key]: "https://client.example.com",
              },
            },
          },
        })),
      "cimd_reserved_metadata_key",
    );
  }
});

Deno.test("isCimdConfig only matches explicit client_id_metadata registration", () => {
  assertEquals(isCimdConfig(config()), true);
  assertEquals(
    isCimdConfig({
      clientId: "static-client",
      tokenStore: new MemoryTokenStore(),
      openBrowser: async () => {},
    }),
    false,
  );
  assertEquals(
    isCimdConfig({
      ...config(),
      clientRegistration: {
        ...config().clientRegistration,
        method: "dynamic_client_registration",
      },
    } as unknown as CimdClientConfig),
    false,
  );
});
