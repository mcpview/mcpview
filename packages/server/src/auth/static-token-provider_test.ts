/**
 * Tests for StaticTokenAuthProvider.
 *
 * @module lib/server/auth/static-token-provider_test
 */

import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import { httpsUrl } from "./types.ts";
import {
  createStaticTokenAuthProvider,
  StaticTokenAuthProvider,
} from "./static-token-provider.ts";

// ── Construction ─────────────────────────────────────────────────────────────

Deno.test("StaticTokenAuthProvider - throws on empty tokens array", () => {
  assertThrows(
    () =>
      new StaticTokenAuthProvider([], { resource: "https://mcp.example.com" }),
    Error,
    "at least one token",
  );
});

Deno.test("StaticTokenAuthProvider - throws on missing resource", () => {
  assertThrows(
    () => new StaticTokenAuthProvider(["tok"], { resource: "  " }),
    Error,
    "`resource` is required",
  );
});

Deno.test("StaticTokenAuthProvider - throws on non-URL resource", () => {
  assertThrows(
    () => new StaticTokenAuthProvider(["tok"], { resource: "not-a-url" }),
    Error,
  );
});

// ── verifyToken ──────────────────────────────────────────────────────────────

Deno.test("StaticTokenAuthProvider - valid token returns AuthInfo", async () => {
  const provider = createStaticTokenAuthProvider(["secret-token"], {
    resource: "https://mcp.example.com",
    subject: "ci",
    scopes: ["read"],
  });
  const info = await provider.verifyToken("secret-token");
  assertEquals(info?.subject, "ci");
  assertEquals(info?.scopes, ["read"]);
});

Deno.test("StaticTokenAuthProvider - unknown token returns null", async () => {
  const provider = createStaticTokenAuthProvider(["secret-token"], {
    resource: "https://mcp.example.com",
  });
  assertEquals(await provider.verifyToken("wrong-token"), null);
});

Deno.test("StaticTokenAuthProvider - multiple tokens all valid", async () => {
  const provider = createStaticTokenAuthProvider(["token-a", "token-b"], {
    resource: "https://mcp.example.com",
  });
  const tokenA = await provider.verifyToken("token-a");
  const tokenB = await provider.verifyToken("token-b");
  assertEquals(tokenA?.subject, "static-token-user");
  assertEquals(tokenB?.subject, "static-token-user");
  // Backwards compatibility: string allowlists intentionally share authority.
  assertStrictEquals(tokenA, tokenB);
  assertEquals(await provider.verifyToken("token-c"), null);
});

Deno.test("StaticTokenAuthProvider - credentials return distinct frozen identities and scopes", async () => {
  const aliceScopes = ["erp:read"];
  const provider = createStaticTokenAuthProvider(
    [
      { token: "token-a", subject: "alice", scopes: aliceScopes },
      {
        token: "token-b",
        subject: "automation",
        scopes: ["erp:read", "erp:write"],
      },
    ],
    { resource: "https://mcp.example.com" },
  );

  // Caller-owned arrays cannot mutate the stored authority after construction.
  aliceScopes.push("erp:write");

  const alice = await provider.verifyToken("token-a");
  const automation = await provider.verifyToken("token-b");
  assert(alice !== null);
  assert(automation !== null);
  assert(alice !== automation);
  assertEquals(alice, { subject: "alice", scopes: ["erp:read"] });
  assertEquals(automation, {
    subject: "automation",
    scopes: ["erp:read", "erp:write"],
  });
  assertEquals(Object.isFrozen(alice), true);
  assertEquals(Object.isFrozen(alice.scopes), true);
  assertThrows(() => alice.scopes.push("admin"));
  assertEquals(await provider.verifyToken("unknown-token"), null);
  assertEquals(provider.getResourceMetadata().scopes_supported, [
    "erp:read",
    "erp:write",
  ]);
});

Deno.test("StaticTokenAuthProvider - credential subjects are trimmed and may repeat for rotation", async () => {
  const provider = createStaticTokenAuthProvider(
    [
      { token: "old-token", subject: " alice " },
      { token: "new-token", subject: "alice" },
    ],
    { resource: "https://mcp.example.com" },
  );
  assertEquals((await provider.verifyToken("old-token"))?.subject, "alice");
  assertEquals((await provider.verifyToken("new-token"))?.subject, "alice");
});

Deno.test("StaticTokenAuthProvider - rejects unusable credential subjects", () => {
  for (
    const subject of [
      "",
      "   ",
      "unknown",
      " unknown ",
      "\u0000unauthenticated",
      "alice\nadmin",
    ]
  ) {
    assertThrows(
      () =>
        createStaticTokenAuthProvider(
          [{ token: "secret-token", subject }],
          { resource: "https://mcp.example.com" },
        ),
      Error,
      "non-reserved subject without control characters",
    );
  }
});

Deno.test("StaticTokenAuthProvider - rejects mixed and empty credential entries", () => {
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [
          "legacy-token",
          { token: "identity-token", subject: "alice" },
        ] as unknown as readonly string[],
        { resource: "https://mcp.example.com" },
      ),
    Error,
    "either all token strings or all credential objects",
  );
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [{ token: " ", subject: "alice" }],
        { resource: "https://mcp.example.com" },
      ),
    Error,
    "non-empty token",
  );
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [{ token: "token-a", subject: "alice", scopes: [" "] }],
        { resource: "https://mcp.example.com" },
      ),
    Error,
    "invalid scope",
  );
});

Deno.test("StaticTokenAuthProvider - duplicate credential errors never expose the token", () => {
  const secret = "raw-bearer-secret-must-not-leak";
  const error = assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [
          { token: secret, subject: "alice" },
          { token: ` ${secret} `, subject: "automation" },
        ],
        { resource: "https://mcp.example.com" },
      ),
    Error,
    "duplicate token mapping",
  );
  assertEquals(error.message.includes(secret), false);
});

Deno.test("StaticTokenAuthProvider - identity credentials reject shared authority options", () => {
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [{ token: "token-a", subject: "alice" }],
        { resource: "https://mcp.example.com", subject: "shared" },
      ),
    Error,
    "cannot be combined",
  );
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [{ token: "token-a", subject: "alice" }],
        { resource: "https://mcp.example.com", scopes: ["shared"] },
      ),
    Error,
    "cannot be combined",
  );
});

Deno.test("StaticTokenAuthProvider - identity metadata override must cover granted scopes", () => {
  assertThrows(
    () =>
      createStaticTokenAuthProvider(
        [{ token: "token-a", subject: "alice", scopes: ["read"] }],
        {
          resource: "https://mcp.example.com",
          scopesSupported: ["write"],
        },
      ),
    Error,
    "must include every scope",
  );

  const provider = createStaticTokenAuthProvider(
    [{ token: "token-a", subject: "alice", scopes: ["read"] }],
    {
      resource: "https://mcp.example.com",
      scopesSupported: ["read", "write"],
    },
  );
  assertEquals(provider.getResourceMetadata().scopes_supported, [
    "read",
    "write",
  ]);
});

Deno.test("StaticTokenAuthProvider - defaults: subject and scopes", async () => {
  const provider = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
  });
  const info = await provider.verifyToken("tok");
  assertEquals(info?.subject, "static-token-user");
  assertEquals(info?.scopes, []);
});

// ── getResourceMetadata ──────────────────────────────────────────────────────

Deno.test("StaticTokenAuthProvider - metadata: empty authorization_servers + header method", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
  }).getResourceMetadata();
  assertEquals(meta.resource, "https://mcp.example.com");
  assertEquals(meta.authorization_servers, []);
  assertEquals(meta.bearer_methods_supported, ["header"]);
  assertEquals(
    meta.resource_metadata_url,
    httpsUrl("https://mcp.example.com/.well-known/oauth-protected-resource"),
  );
});

Deno.test("StaticTokenAuthProvider - metadata: RFC 9728 3.1 path insertion", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com/v2/mcp",
  }).getResourceMetadata();
  assertEquals(
    meta.resource_metadata_url,
    httpsUrl(
      "https://mcp.example.com/.well-known/oauth-protected-resource/v2/mcp",
    ),
  );
});

Deno.test("StaticTokenAuthProvider - metadata: explicit resourceMetadataUrl wins", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
    resourceMetadataUrl:
      "https://meta.example.com/.well-known/oauth-protected-resource",
  }).getResourceMetadata();
  assertEquals(
    meta.resource_metadata_url,
    httpsUrl("https://meta.example.com/.well-known/oauth-protected-resource"),
  );
});

Deno.test("StaticTokenAuthProvider - metadata: scopes_supported derives from scopes", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
    scopes: ["read", "write"],
  }).getResourceMetadata();
  assertEquals(meta.scopes_supported, ["read", "write"]);
});

Deno.test("StaticTokenAuthProvider - metadata: scopes_supported override", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
    scopes: ["read"],
    scopesSupported: ["read", "write", "admin"],
  }).getResourceMetadata();
  assertEquals(meta.scopes_supported, ["read", "write", "admin"]);
});

Deno.test("StaticTokenAuthProvider - throws on empty token entry", () => {
  assertThrows(
    () =>
      new StaticTokenAuthProvider(["", "ok"], {
        resource: "https://mcp.example.com",
      }),
    Error,
    "empty entries",
  );
});

Deno.test("StaticTokenAuthProvider - verifyToken scopes cannot be mutated", async () => {
  const provider = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com",
    scopes: ["read"],
  });
  const info = await provider.verifyToken("tok");
  assertThrows(() => info!.scopes.push("admin"));
});

Deno.test("StaticTokenAuthProvider - metadata: preserves resource query string", () => {
  const meta = createStaticTokenAuthProvider(["tok"], {
    resource: "https://mcp.example.com/v2?tenant=a",
  }).getResourceMetadata();
  assertEquals(
    meta.resource_metadata_url,
    httpsUrl(
      "https://mcp.example.com/.well-known/oauth-protected-resource/v2?tenant=a",
    ),
  );
});

Deno.test("StaticTokenAuthProvider - validates resource even when resourceMetadataUrl is set", () => {
  assertThrows(
    () =>
      new StaticTokenAuthProvider(["tok"], {
        resource: "not-a-url",
        resourceMetadataUrl:
          "https://meta.example.com/.well-known/oauth-protected-resource",
      }),
    Error,
  );
});

Deno.test("StaticTokenAuthProvider - stored tokens are trimmed to match extracted bearer", async () => {
  const provider = createStaticTokenAuthProvider([" secret "], {
    resource: "https://mcp.example.com",
  });
  assertEquals(
    (await provider.verifyToken("secret"))?.subject,
    "static-token-user",
  );
  // verifyToken trims its argument too, so a padded direct call matches.
  assertEquals(
    (await provider.verifyToken(" secret "))?.subject,
    "static-token-user",
  );
});
