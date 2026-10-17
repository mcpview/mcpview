import { assertEquals, assertExists } from "@std/assert";
import { FileTokenStore } from "./file-store.ts";

Deno.test("FileTokenStore - get returns null for unknown server", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const store = new FileTokenStore(dir);
  assertEquals(await store.get("https://unknown.example.com"), null);
});

Deno.test("FileTokenStore - set and get round-trip", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const store = new FileTokenStore(dir);
  const url = "https://mcp.example.com";
  const creds = {
    serverUrl: url,
    tokens: { access_token: "secret-token", token_type: "bearer" },
    obtainedAt: Date.now(),
  };
  await store.set(url, creds);
  const result = await store.get(url);
  assertExists(result);
  assertEquals(result.tokens.access_token, "secret-token");
});

Deno.test("FileTokenStore - delete removes file", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const store = new FileTokenStore(dir);
  const url = "https://mcp.example.com";
  await store.set(url, {
    serverUrl: url,
    tokens: { access_token: "x", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  await store.delete(url);
  assertEquals(await store.get(url), null);
});

Deno.test("FileTokenStore - list returns stored URLs", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const store = new FileTokenStore(dir);
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
  assertEquals(urls.length, 2);
});

Deno.test("FileTokenStore - file permissions are 0o600", async () => {
  if (Deno.build.os === "windows") return;
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const store = new FileTokenStore(dir);
  const url = "https://secure.example.com";
  await store.set(url, {
    serverUrl: url,
    tokens: { access_token: "secret", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      const stat = await Deno.stat(`${dir}/${entry.name}`);
      assertEquals(stat.mode! & 0o777, 0o600);
    }
  }
});

Deno.test("FileTokenStore - creates base directory if missing", async () => {
  const dir = await Deno.makeTempDir({ prefix: "pml-creds-" });
  const nestedDir = `${dir}/nested/deep`;
  const store = new FileTokenStore(nestedDir);
  await store.set("https://a.com", {
    serverUrl: "https://a.com",
    tokens: { access_token: "a", token_type: "bearer" },
    obtainedAt: Date.now(),
  });
  const result = await store.get("https://a.com");
  assertExists(result);
});
