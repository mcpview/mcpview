import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { CallbackServer, OAuthCallbackError } from "./callback-server.ts";

Deno.test("CallbackServer - receives auth code from redirect", async () => {
  const server = new CallbackServer();
  const { port, codePromise, callbackPromise } = await server.start();

  const resp = await fetch(
    `http://127.0.0.1:${port}/callback?code=test-auth-code&state=abc&iss=https%3A%2F%2Fauth.example.com%2Ftenant%3Fa%3Db`,
  );
  assertEquals(resp.status, 200);
  const body = await resp.text();
  assertEquals(body.includes("Authentication successful"), true);

  const code = await codePromise;
  assertEquals(code, "test-auth-code");
  assertEquals(await callbackPromise, {
    code,
    iss: "https://auth.example.com/tenant?a=b",
    state: "abc",
  });

  await server.close();
});

Deno.test("CallbackServer - optional issuer and state remain absent", async () => {
  const server = new CallbackServer();
  const { port, callbackPromise } = await server.start();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/callback?code=code`);
    await response.text();
    assertEquals(await callbackPromise, {
      code: "code",
      iss: undefined,
      state: undefined,
    });
  } finally {
    await server.close();
  }
});

Deno.test("CallbackServer - OAuth error rejects both callback promises promptly", async () => {
  const server = new CallbackServer();
  const { port, codePromise, callbackPromise } = await server.start();
  try {
    const params = new URLSearchParams({
      error: "access_denied",
      error_description: "User <declined> access",
      iss: "https://auth.example.com",
      state: "expected-state",
    });
    const response = await fetch(`http://127.0.0.1:${port}/callback?${params}`);
    assertEquals(response.status, 400);
    assertEquals((await response.text()).includes("User <declined>"), false);
    const error = await assertRejects(
      () => callbackPromise,
      OAuthCallbackError,
    );
    assertInstanceOf(error, OAuthCallbackError);
    assertEquals(error.error, "access_denied");
    assertEquals(error.errorDescription, "User <declined> access");
    assertEquals(error.iss, "https://auth.example.com");
    assertEquals(error.state, "expected-state");
    assertEquals(await assertRejects(() => codePromise), error);
  } finally {
    await server.close();
  }
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

Deno.test("CallbackServer - timeout is safe when both promises are ignored", async () => {
  const server = new CallbackServer({ timeout: 10 });
  await server.start();
  await new Promise((resolve) => setTimeout(resolve, 50));
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

Deno.test("CallbackServer - close before the redirect rejects both promises", async () => {
  const server = new CallbackServer();
  const { callbackPromise, codePromise } = await server.start();
  await server.close();
  await assertRejects(
    () => callbackPromise,
    Error,
    "closed before the authorization callback was received",
  );
  await assertRejects(
    () => codePromise,
    Error,
    "closed before the authorization callback was received",
  );
});
