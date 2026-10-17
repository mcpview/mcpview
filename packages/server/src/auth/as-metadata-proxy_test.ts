/**
 * Tests for AS Metadata Proxy (DCR discovery helper).
 *
 * Uses dependency injection on `fetch` — no global mocking, no local
 * servers. Each test injects a fake fetch that returns controlled
 * responses.
 *
 * @module lib/server/auth/as-metadata-proxy_test
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  type AsMetadataProxyOptions,
  createAsMetadataHandler,
} from "./as-metadata-proxy.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

const UPSTREAM_METADATA = {
  issuer: "https://idp.example.com",
  authorization_endpoint: "https://idp.example.com/oauth/authorize",
  token_endpoint: "https://idp.example.com/oauth/token",
  jwks_uri: "https://idp.example.com/.well-known/jwks.json",
  scopes_supported: ["openid", "profile"],
};

const UPSTREAM_URL = "https://idp.example.com/.well-known/openid-configuration";
const REGISTRATION_URL = "https://my-app.example.com/oauth/register";

/** Creates a fake fetch that returns the given metadata. */
function fakeFetch(
  body: Record<string, unknown> = UPSTREAM_METADATA,
  status = 200,
): typeof globalThis.fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof globalThis.fetch;
}

/** Creates a fake fetch that rejects with an error. */
function failingFetch(message = "network error"): typeof globalThis.fetch {
  return ((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.reject(new Error(message))) as typeof globalThis.fetch;
}

/** Creates a fake fetch that tracks call count and captured URLs. */
function countingFetch(
  body: Record<string, unknown> = UPSTREAM_METADATA,
): {
  fetch: typeof globalThis.fetch;
  callCount: () => number;
  lastUrl: () => string | undefined;
} {
  let count = 0;
  let capturedUrl: string | undefined;
  const fn = ((input: string | URL | Request, _init?: RequestInit) => {
    count++;
    capturedUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.href
      : input.url;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
  return { fetch: fn, callCount: () => count, lastUrl: () => capturedUrl };
}

function opts(
  overrides: Partial<AsMetadataProxyOptions> = {},
): AsMetadataProxyOptions {
  return {
    upstreamMetadataUrl: UPSTREAM_URL,
    registrationEndpoint: REGISTRATION_URL,
    ...overrides,
  };
}

const dummyRequest = new Request(
  "https://my-app.example.com/.well-known/oauth-authorization-server",
);

// ═════════════════════════════════════════════════════════════════════
// Construction-time validation
// ═════════════════════════════════════════════════════════════════════

Deno.test("throws on invalid upstreamMetadataUrl at construction", () => {
  assertThrows(
    () =>
      createAsMetadataHandler(opts({
        upstreamMetadataUrl: "not-a-url",
        fetch: fakeFetch(),
      })),
    Error,
    "upstreamMetadataUrl",
  );
});

Deno.test("throws on invalid upstreamIssuer at construction", () => {
  assertThrows(
    () =>
      createAsMetadataHandler(opts({
        upstreamMetadataUrl: undefined,
        upstreamIssuer: "not-a-url",
        fetch: fakeFetch(),
      })),
    Error,
    "upstreamIssuer",
  );
});

Deno.test("throws on invalid registrationEndpoint at construction", () => {
  assertThrows(
    () =>
      createAsMetadataHandler(opts({
        registrationEndpoint: "ftp://bad-scheme.example.com",
        fetch: fakeFetch(),
      })),
    Error,
    "registrationEndpoint",
  );
});

Deno.test("throws when both upstreamMetadataUrl and upstreamIssuer are set", () => {
  assertThrows(
    () =>
      createAsMetadataHandler({
        upstreamMetadataUrl: UPSTREAM_URL,
        upstreamIssuer: "https://idp.example.com",
        registrationEndpoint: REGISTRATION_URL,
        fetch: fakeFetch(),
      }),
    Error,
    "not both",
  );
});

Deno.test("throws when neither upstreamMetadataUrl nor upstreamIssuer is set", () => {
  assertThrows(
    () =>
      createAsMetadataHandler({
        registrationEndpoint: REGISTRATION_URL,
        fetch: fakeFetch(),
      }),
    Error,
    "is required",
  );
});

// ═════════════════════════════════════════════════════════════════════
// upstreamMetadataUrl form (explicit URL)
// ═════════════════════════════════════════════════════════════════════

Deno.test("url form: returns enriched metadata with registration_endpoint", async () => {
  const handler = createAsMetadataHandler(opts({ fetch: fakeFetch() }));

  const res = await handler(dummyRequest);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.registration_endpoint, REGISTRATION_URL);
  assertEquals(body.issuer, UPSTREAM_METADATA.issuer);
  assertEquals(
    body.authorization_endpoint,
    UPSTREAM_METADATA.authorization_endpoint,
  );
  assertEquals(body.token_endpoint, UPSTREAM_METADATA.token_endpoint);
});

Deno.test("url form: fetches the exact URL provided", async () => {
  const customUrl =
    "https://as.example.com/.well-known/oauth-authorization-server";
  const { fetch: countFetch, lastUrl } = countingFetch();
  const handler = createAsMetadataHandler(opts({
    upstreamMetadataUrl: customUrl,
    fetch: countFetch,
  }));

  await handler(dummyRequest);
  assertEquals(lastUrl(), customUrl);
});

// ═════════════════════════════════════════════════════════════════════
// upstreamIssuer form (OIDC shorthand)
// ═════════════════════════════════════════════════════════════════════

Deno.test("issuer form: derives .well-known/openid-configuration URL", async () => {
  const { fetch: countFetch, lastUrl } = countingFetch();
  const handler = createAsMetadataHandler({
    upstreamIssuer: "https://idp.example.com",
    registrationEndpoint: REGISTRATION_URL,
    fetch: countFetch,
  });

  await handler(dummyRequest);
  assertEquals(
    lastUrl(),
    "https://idp.example.com/.well-known/openid-configuration",
  );
});

Deno.test("issuer form: strips trailing slash before deriving URL", async () => {
  const { fetch: countFetch, lastUrl } = countingFetch();
  const handler = createAsMetadataHandler({
    upstreamIssuer: "https://idp.example.com/",
    registrationEndpoint: REGISTRATION_URL,
    fetch: countFetch,
  });

  await handler(dummyRequest);
  assertEquals(
    lastUrl(),
    "https://idp.example.com/.well-known/openid-configuration",
  );
});

Deno.test("issuer form: returns enriched metadata", async () => {
  const handler = createAsMetadataHandler({
    upstreamIssuer: "https://idp.example.com",
    registrationEndpoint: REGISTRATION_URL,
    fetch: fakeFetch(),
  });

  const res = await handler(dummyRequest);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.registration_endpoint, REGISTRATION_URL);
  assertEquals(body.issuer, UPSTREAM_METADATA.issuer);
});

// ═════════════════════════════════════════════════════════════════════
// Response headers
// ═════════════════════════════════════════════════════════════════════

Deno.test("Content-Type is application/json", async () => {
  const handler = createAsMetadataHandler(opts({ fetch: fakeFetch() }));
  const res = await handler(dummyRequest);
  assertEquals(res.headers.get("Content-Type"), "application/json");
});

Deno.test("Cache-Control is set to public, max-age=3600", async () => {
  const handler = createAsMetadataHandler(opts({ fetch: fakeFetch() }));
  const res = await handler(dummyRequest);
  assertEquals(res.headers.get("Cache-Control"), "public, max-age=3600");
});

// ═════════════════════════════════════════════════════════════════════
// extraFields
// ═════════════════════════════════════════════════════════════════════

Deno.test("extraFields override upstream values", async () => {
  const handler = createAsMetadataHandler(opts({
    fetch: fakeFetch(),
    extraFields: {
      scopes_supported: ["openid", "profile", "mcp:tools"],
      code_challenge_methods_supported: ["S256"],
    },
  }));

  const res = await handler(dummyRequest);
  const body = await res.json();

  assertEquals(body.scopes_supported, ["openid", "profile", "mcp:tools"]);
  assertEquals(body.code_challenge_methods_supported, ["S256"]);
  assertEquals(body.registration_endpoint, REGISTRATION_URL);
});

// ═════════════════════════════════════════════════════════════════════
// Caching
// ═════════════════════════════════════════════════════════════════════

Deno.test("caches upstream response across calls", async () => {
  const { fetch: countFetch, callCount } = countingFetch();
  const handler = createAsMetadataHandler(opts({ fetch: countFetch }));

  await handler(dummyRequest);
  assertEquals(callCount(), 1);

  await handler(dummyRequest);
  assertEquals(callCount(), 1);

  await handler(dummyRequest);
  assertEquals(callCount(), 1);
});

Deno.test("stale cache triggers background refresh", async () => {
  const { fetch: countFetch, callCount } = countingFetch();
  const handler = createAsMetadataHandler(opts({
    fetch: countFetch,
    cacheTtlMs: 0,
  }));

  const res1 = await handler(dummyRequest);
  assertEquals(res1.status, 200);
  assertEquals(callCount(), 1);

  // Stale → serves cached + background refresh
  const res2 = await handler(dummyRequest);
  assertEquals(res2.status, 200);

  await new Promise((r) => setTimeout(r, 50));
  assertEquals(callCount(), 2);
});

// ═════════════════════════════════════════════════════════════════════
// Error handling
// ═════════════════════════════════════════════════════════════════════

Deno.test("returns 502 on upstream fetch failure (cold start)", async () => {
  const handler = createAsMetadataHandler(opts({
    fetch: failingFetch("connection refused"),
  }));

  const res = await handler(dummyRequest);
  assertEquals(res.status, 502);

  const body = await res.json();
  assertEquals(body.error, "as_metadata_unavailable");
});

Deno.test("returns 502 with message on non-2xx upstream response", async () => {
  const handler = createAsMetadataHandler(opts({
    fetch: fakeFetch({}, 503),
  }));

  const res = await handler(dummyRequest);
  assertEquals(res.status, 502);

  const body = await res.json();
  assertEquals(body.error, "as_metadata_unavailable");
});

Deno.test("stale-while-revalidate serves cached on refresh failure", async () => {
  let callIndex = 0;
  const flakyFetch = ((_input: string | URL | Request) => {
    callIndex++;
    if (callIndex === 1) {
      return Promise.resolve(
        new Response(JSON.stringify(UPSTREAM_METADATA), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.reject(new Error("upstream down"));
  }) as typeof globalThis.fetch;

  const handler = createAsMetadataHandler(opts({
    fetch: flakyFetch,
    cacheTtlMs: 0,
  }));

  // Cold start: succeeds
  const res1 = await handler(dummyRequest);
  assertEquals(res1.status, 200);
  const body1 = await res1.json();
  assertEquals(body1.issuer, UPSTREAM_METADATA.issuer);

  // Stale → serves cached, background refresh fails silently
  const res2 = await handler(dummyRequest);
  assertEquals(res2.status, 200);
  const body2 = await res2.json();
  assertEquals(body2.issuer, UPSTREAM_METADATA.issuer);
  assertEquals(body2.registration_endpoint, REGISTRATION_URL);

  await new Promise((r) => setTimeout(r, 50));
});

// ═════════════════════════════════════════════════════════════════════
// Thundering-herd guard
// ═════════════════════════════════════════════════════════════════════

Deno.test("only one background refresh fires on concurrent stale requests", async () => {
  const { fetch: countFetch, callCount } = countingFetch();
  const handler = createAsMetadataHandler(opts({
    fetch: countFetch,
    cacheTtlMs: 0,
  }));

  // Cold start
  await handler(dummyRequest);
  assertEquals(callCount(), 1);

  // 5 concurrent stale requests
  await Promise.all([
    handler(dummyRequest),
    handler(dummyRequest),
    handler(dummyRequest),
    handler(dummyRequest),
    handler(dummyRequest),
  ]);

  await new Promise((r) => setTimeout(r, 50));
  // 1 cold start + 1 background refresh = 2 (not 6)
  assertEquals(callCount(), 2);
});

// ═════════════════════════════════════════════════════════════════════
// Background refresh updates cache
// ═════════════════════════════════════════════════════════════════════

Deno.test("background refresh updates cache with new upstream data", async () => {
  let callIndex = 0;
  const evolvingFetch = ((_input: string | URL | Request) => {
    callIndex++;
    const body = callIndex === 1
      ? { issuer: "https://old.example.com" }
      : { issuer: "https://new.example.com" };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;

  const handler = createAsMetadataHandler(opts({
    fetch: evolvingFetch,
    cacheTtlMs: 0,
  }));

  // Cold start: old data
  const body1 = await (await handler(dummyRequest)).json();
  assertEquals(body1.issuer, "https://old.example.com");

  // Stale: serves old, triggers background refresh
  const body2 = await (await handler(dummyRequest)).json();
  assertEquals(body2.issuer, "https://old.example.com");

  // Wait for background refresh
  await new Promise((r) => setTimeout(r, 50));

  // Now serves new data
  const body3 = await (await handler(dummyRequest)).json();
  assertEquals(body3.issuer, "https://new.example.com");
});

// ═════════════════════════════════════════════════════════════════════
// Upstream shape validation
// ═════════════════════════════════════════════════════════════════════

Deno.test("returns 502 when upstream returns non-object JSON", async () => {
  const arrayFetch = ((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(JSON.stringify(["not", "an", "object"]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof globalThis.fetch;

  const handler = createAsMetadataHandler(opts({ fetch: arrayFetch }));
  const res = await handler(dummyRequest);
  assertEquals(res.status, 502);
});

Deno.test("returns 502 when upstream metadata lacks issuer field", async () => {
  const noIssuerFetch = ((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(
        JSON.stringify({ authorization_endpoint: "https://example.com/auth" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )) as typeof globalThis.fetch;

  const handler = createAsMetadataHandler(opts({ fetch: noIssuerFetch }));
  const res = await handler(dummyRequest);
  assertEquals(res.status, 502);
});

// ═════════════════════════════════════════════════════════════════════
// Method validation
// ═════════════════════════════════════════════════════════════════════

Deno.test("returns 405 on POST request", async () => {
  const handler = createAsMetadataHandler(opts({ fetch: fakeFetch() }));
  const postReq = new Request(
    "https://my-app.example.com/.well-known/oauth-authorization-server",
    { method: "POST" },
  );
  const res = await handler(postReq);
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("Allow"), "GET, HEAD");
});

// ═════════════════════════════════════════════════════════════════════
// cacheTtlMs validation
// ═════════════════════════════════════════════════════════════════════

Deno.test("throws on negative cacheTtlMs at construction", () => {
  assertThrows(
    () => createAsMetadataHandler(opts({ cacheTtlMs: -1, fetch: fakeFetch() })),
    Error,
    "cacheTtlMs",
  );
});

Deno.test("throws on NaN cacheTtlMs at construction", () => {
  assertThrows(
    () =>
      createAsMetadataHandler(opts({ cacheTtlMs: NaN, fetch: fakeFetch() })),
    Error,
    "cacheTtlMs",
  );
});

// ═════════════════════════════════════════════════════════════════════
// registration_endpoint priority
// ═════════════════════════════════════════════════════════════════════

Deno.test("registration_endpoint wins over extraFields override attempt", async () => {
  const handler = createAsMetadataHandler(opts({
    fetch: fakeFetch(),
    extraFields: { registration_endpoint: "https://evil.example.com/register" },
  }));

  const res = await handler(dummyRequest);
  const body = await res.json();
  assertEquals(body.registration_endpoint, REGISTRATION_URL);
});
