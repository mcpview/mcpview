import { assertEquals } from "@std/assert";
import { MemoryTokenStore } from "./memory-store.ts";

Deno.test("MemoryTokenStore - get returns null for unknown server", async () => {
  const store = new MemoryTokenStore();
  const result = await store.get("https://unknown.example.com");
  assertEquals(result, null);
});

Deno.test("MemoryTokenStore - set and get round-trip", async () => {
  const store = new MemoryTokenStore();
  const creds = {
    serverUrl: "https://mcp.example.com",
    tokens: { access_token: "abc123", token_type: "bearer" },
    obtainedAt: Date.now(),
  };
  await store.set(creds.serverUrl, creds);
  const result = await store.get(creds.serverUrl);
  assertEquals(result?.tokens.access_token, "abc123");
});

Deno.test("MemoryTokenStore - delete removes credentials", async () => {
  const store = new MemoryTokenStore();
  const url = "https://mcp.example.com";
  await store.set(url, {
    serverUrl: url,
    tokens: { access_token: "abc", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  await store.delete(url);
  assertEquals(await store.get(url), null);
});

Deno.test("MemoryTokenStore - list returns stored server URLs", async () => {
  const store = new MemoryTokenStore();
  await store.set("https://a.com", {
    serverUrl: "https://a.com",
    tokens: { access_token: "a", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  await store.set("https://b.com", {
    serverUrl: "https://b.com",
    tokens: { access_token: "b", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  const urls = await store.list();
  assertEquals(urls.sort(), ["https://a.com", "https://b.com"]);
});
