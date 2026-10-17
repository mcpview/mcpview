import { assertEquals, assertRejects } from "@std/assert";
import { CallbackServer } from "./callback-server.ts";

Deno.test("CallbackServer - receives auth code from redirect", async () => {
  const server = new CallbackServer();
  const { port, codePromise } = await server.start();

  const resp = await fetch(
    `http://127.0.0.1:${port}/callback?code=test-auth-code&state=abc`,
  );
  assertEquals(resp.status, 200);
  const body = await resp.text();
  assertEquals(body.includes("Authentication successful"), true);

  const code = await codePromise;
  assertEquals(code, "test-auth-code");

  await server.close();
});

Deno.test("CallbackServer - timeout rejects promise", async () => {
  const server = new CallbackServer({ timeout: 200 });
  const { codePromise } = await server.start();

  await assertRejects(
    () => codePromise,
    Error,
    "timeout",
  );

  await server.close();
});

Deno.test("CallbackServer - returns error page on missing code", async () => {
  const server = new CallbackServer();
  const { port } = await server.start();

  const resp = await fetch(`http://127.0.0.1:${port}/callback`);
  assertEquals(resp.status, 400);
  await resp.text();

  await server.close();
});

Deno.test("CallbackServer - port 0 auto-assigns", async () => {
  const server = new CallbackServer({ port: 0 });
  const { port } = await server.start();
  assertEquals(port > 0, true);
  await server.close();
});

Deno.test("CallbackServer - start rejects cleanly when bind port is already in use", async () => {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  const server = new CallbackServer({
    hostname: "127.0.0.1",
    port,
    timeout: 1_000,
  });

  try {
    await assertRejects(
      () => server.start(),
      Error,
    );
  } finally {
    await server.close();
    listener.close();
  }
});

Deno.test("CallbackServer - binds to 127.0.0.1 by default", async () => {
  const server = new CallbackServer({ port: 0 });
  const { port } = await server.start();
  assertEquals(
    (server as unknown as { hostname: string }).hostname,
    "127.0.0.1",
  );

  const resp = await fetch(`http://127.0.0.1:${port}/other`);
  assertEquals(resp.status, 404);
  await resp.text();

  await server.close();
});

Deno.test("CallbackServer - 404 on non-callback path", async () => {
  const server = new CallbackServer();
  const { port } = await server.start();

  const resp = await fetch(`http://127.0.0.1:${port}/other`);
  assertEquals(resp.status, 404);
  await resp.text();

  await server.close();
});
