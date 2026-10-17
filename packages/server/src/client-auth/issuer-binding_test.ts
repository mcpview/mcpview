/**
 * Credentials are bound to the authorization server that minted them (SEP-2352).
 *
 * The exposure this closes is concrete. `auth()` in the SDK discovers the
 * authorization server from the MCP server's own protected-resource metadata,
 * then hands whatever `tokens()` returns to
 * `refreshAuthorization(authorizationServerUrl, …)`. Without a binding, an MCP
 * server that changes — or is made to advertise — a different authorization
 * server receives a refresh token minted by the previous one.
 */

import { assertEquals, assertExists } from "@std/assert";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { OAuthClientProviderImpl } from "./provider.ts";
import type { StoredCredentials, TokenStore } from "./types.ts";

const SERVER_URL = "https://mcp.example.com";
const AS_ONE = "https://as-one.example.com";
const AS_TWO = "https://attacker.example.com";

/** Mirrors the provider's normalisation, for asserting on what it stored. */
function canonicalIssuerOf(value: string): string {
  return new URL(value).href;
}

const TOKENS: OAuthTokens = {
  access_token: "at-1",
  refresh_token: "rt-secret",
  token_type: "Bearer",
};

function memoryStore(seed?: StoredCredentials): TokenStore & {
  readonly records: Map<string, StoredCredentials>;
} {
  const records = new Map<string, StoredCredentials>();
  if (seed) records.set(seed.serverUrl, seed);

  return {
    records,
    get: (url) => Promise.resolve(records.get(url) ?? null),
    set: (url, creds) => {
      records.set(url, creds);
      return Promise.resolve();
    },
    delete: (url) => {
      records.delete(url);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...records.keys()]),
  };
}

function buildProvider(store: TokenStore, logs: string[] = []) {
  return new OAuthClientProviderImpl(SERVER_URL, {
    clientId: "static-client",
    tokenStore: store,
    openBrowser: () => Promise.resolve(),
    logger: (message) => logs.push(message),
  });
}

/** What `auth()` does before it asks for tokens. */
async function discover(
  provider: OAuthClientProviderImpl,
  issuer: string,
): Promise<void> {
  await provider.saveDiscoveryState({
    authorizationServerUrl: issuer,
    authorizationServerMetadata: {
      issuer,
      response_types_supported: ["code"],
    },
  });
}

Deno.test("issuer binding - the refresh token is withheld from a different authorization server", async () => {
  // The attack, end to end: credentials minted by AS_ONE, and a server now
  // advertising AS_TWO.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const logs: string[] = [];
  const provider = buildProvider(store, logs);

  await discover(provider, AS_TWO);

  assertEquals(
    await provider.tokens(),
    undefined,
    "the refresh token must not travel to an authorization server that did not mint it",
  );
  // And it is gone, so a later call with no issuer in hand cannot serve it either.
  assertEquals(store.records.has(SERVER_URL), false);
  assertEquals(
    logs.some((l) => l.includes("authorization server changed")),
    true,
    "an operator needs to see why the login prompt reappeared",
  );
});

Deno.test("issuer binding - the same authorization server still gets its tokens", async () => {
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const provider = buildProvider(store);

  await discover(provider, AS_ONE);

  assertEquals((await provider.tokens())?.refresh_token, "rt-secret");
  assertEquals(store.records.has(SERVER_URL), true);
});

Deno.test("issuer binding - legacy records with no issuer are discarded", async () => {
  // Written before the binding existed: nothing proves who minted them.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
  });
  const logs: string[] = [];
  const provider = buildProvider(store, logs);

  await discover(provider, AS_ONE);

  assertEquals(await provider.tokens(), undefined);
  assertEquals(store.records.has(SERVER_URL), false);
  assertEquals(logs.some((l) => l.includes("no recorded issuer")), true);
});

Deno.test("issuer binding - a transport asking for the bearer is not blocked", async () => {
  // `tokens()` is also called outside `auth()`, to attach a bearer to an
  // ordinary request. No issuer is known there, and that path is not the
  // exposure: the token goes to the MCP server it was minted for. Failing
  // closed here would break every authenticated call instead.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
  });
  const provider = buildProvider(store);

  assertEquals((await provider.tokens())?.access_token, "at-1");
});

Deno.test("issuer binding - saveTokens records the issuer", async () => {
  // Without this, every save writes exactly the legacy record the check above
  // has to throw away, and the protection would look like a login loop.
  const store = memoryStore();
  const provider = buildProvider(store);

  await discover(provider, AS_ONE);
  await provider.saveTokens(TOKENS);

  const saved = store.records.get(SERVER_URL);
  assertExists(saved);
  // Stored canonicalised, so a later comparison is not defeated by a trailing
  // slash or a case difference in the host.
  assertEquals(saved.authServerUrl, canonicalIssuerOf(AS_ONE));

  // Round trip: what was just written is accepted by the same issuer.
  assertEquals((await provider.tokens())?.refresh_token, "rt-secret");
});

Deno.test("issuer binding - the AS URL is the fallback when metadata has no issuer", async () => {
  // A server publishing no RFC 8414 metadata still has to be bound to
  // something; the discovered URL is what `auth()` would refresh against.
  const store = memoryStore();
  const provider = buildProvider(store);

  await provider.saveDiscoveryState({ authorizationServerUrl: AS_ONE });
  await provider.saveTokens(TOKENS);

  assertEquals(
    store.records.get(SERVER_URL)?.authServerUrl,
    canonicalIssuerOf(AS_ONE),
  );
});

Deno.test("issuer binding - invalidating discovery clears the recorded issuer", async () => {
  // A stale issuer would make the next `tokens()` compare against an
  // authorization server the SDK has already given up on, discarding
  // credentials that are still valid.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const provider = buildProvider(store);

  await discover(provider, AS_TWO);
  await provider.invalidateCredentials("discovery");

  // No issuer in hand any more, so the stored record is served rather than
  // judged against a server that is no longer in play.
  const store2 = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const fresh = buildProvider(store2);
  await discover(fresh, AS_TWO);
  await fresh.invalidateCredentials("discovery");

  assertEquals((await fresh.tokens())?.access_token, "at-1");
});

Deno.test("issuer binding - a forged `issuer` claim does not unlock credentials", async () => {
  // The bypass this design exists to close. `issuer` is published BY the
  // authorization server, so an attacker's server reached at AS_TWO can claim
  // to be AS_ONE. Binding to the claim would hand it the real AS_ONE tokens;
  // binding to the URL the client actually resolved does not.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const logs: string[] = [];
  const provider = buildProvider(store, logs);

  await provider.saveDiscoveryState({
    authorizationServerUrl: AS_TWO,
    authorizationServerMetadata: {
      issuer: AS_ONE, // the lie
      response_types_supported: ["code"],
    },
  });

  assertEquals(
    await provider.tokens(),
    undefined,
    "a server may not unlock another server's credentials by claiming its name",
  );
  assertEquals(
    logs.some((l) => l.includes("RFC 8414 requires them to match")),
    true,
    "the mismatch is worth surfacing: it means broken or hostile metadata",
  );
});

Deno.test("issuer binding - a code exchange does not inherit another server's refresh token", async () => {
  // `auth({ authorizationCode })` calls saveTokens WITHOUT going through
  // tokens() first, so the refresh-token carry-over is the one place a
  // credential from a previous issuer can survive. If the exchange returns no
  // refresh token, the old one must not be re-labelled with the new issuer.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS, // refresh_token: "rt-secret", minted by AS_ONE
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const provider = buildProvider(store);

  await discover(provider, AS_TWO);
  await provider.saveTokens({ access_token: "at-new", token_type: "Bearer" });

  const saved = store.records.get(SERVER_URL);
  assertExists(saved);
  assertEquals(
    saved.tokens.refresh_token,
    undefined,
    "AS_ONE's refresh token must not be carried over to AS_TWO",
  );
  assertEquals(saved.authServerUrl, canonicalIssuerOf(AS_TWO));
});

Deno.test("issuer binding - the same server still inherits its own refresh token", async () => {
  // The carry-over exists for a reason: a refresh response often omits the
  // refresh token, and dropping it would force a full re-login every time.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: AS_ONE,
  });
  const provider = buildProvider(store);

  await discover(provider, AS_ONE);
  await provider.saveTokens({ access_token: "at-new", token_type: "Bearer" });

  assertEquals(
    store.records.get(SERVER_URL)?.tokens.refresh_token,
    "rt-secret",
  );
});

Deno.test("issuer binding - a trailing slash is not a server change", async () => {
  // Raw string comparison would read these as different servers and wipe valid
  // credentials on every call — a self-inflicted login loop.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: "https://as-one.example.com",
  });
  const provider = buildProvider(store);

  await discover(provider, "https://as-one.example.com/");

  assertEquals((await provider.tokens())?.access_token, "at-1");
});

Deno.test("issuer binding - logs do not leak credentials embedded in a URL", async () => {
  // A URL may carry `userinfo`, and a query string may carry a token. Both
  // would otherwise travel verbatim to whatever the consumer wired as a logger.
  const store = memoryStore({
    serverUrl: SERVER_URL,
    tokens: TOKENS,
    obtainedAt: 1,
    authServerUrl: "https://user:hunter2@as-one.example.com/x?token=secret",
  });
  const logs: string[] = [];
  const provider = buildProvider(store, logs);

  await discover(provider, AS_TWO);
  await provider.tokens();

  const line = logs.join("\n");
  assertEquals(line.includes("hunter2"), false, "password leaked into logs");
  assertEquals(line.includes("secret"), false, "query token leaked into logs");
  assertEquals(line.includes("as-one.example.com"), true, "still identifiable");
});
