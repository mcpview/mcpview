// deno-lint-ignore-file require-await
/**
 * Unit tests for middleware runner.
 *
 * Tests the onion-model middleware composition.
 */

import { assertEquals, assertRejects } from "@std/assert";
import { createMiddlewareRunner } from "./runner.ts";
import type { Middleware, MiddlewareContext } from "./types.ts";

Deno.test("middleware runner - executes handler when no middlewares", async () => {
  const run = createMiddlewareRunner(
    [],
    async (ctx) => `hello ${ctx.toolName}`,
  );
  const result = await run({ toolName: "test", args: {} });
  assertEquals(result, "hello test");
});

Deno.test("middleware runner - executes middlewares in onion order", async () => {
  const order: string[] = [];

  const m1: Middleware = async (_ctx, next) => {
    order.push("m1-before");
    const r = await next();
    order.push("m1-after");
    return r;
  };
  const m2: Middleware = async (_ctx, next) => {
    order.push("m2-before");
    const r = await next();
    order.push("m2-after");
    return r;
  };

  const run = createMiddlewareRunner([m1, m2], async () => {
    order.push("handler");
    return "ok";
  });

  const result = await run({ toolName: "test", args: {} });

  assertEquals(order, [
    "m1-before",
    "m2-before",
    "handler",
    "m2-after",
    "m1-after",
  ]);
  assertEquals(result, "ok");
});

Deno.test("middleware runner - middleware can short-circuit by not calling next", async () => {
  let handlerCalled = false;

  const blocker: Middleware = async (_ctx, _next) => "blocked";
  const run = createMiddlewareRunner([blocker], async () => {
    handlerCalled = true;
    return "handler";
  });

  const result = await run({ toolName: "test", args: {} });

  assertEquals(result, "blocked");
  assertEquals(handlerCalled, false);
});

Deno.test("middleware runner - middleware can enrich context", async () => {
  let capturedValue: unknown;

  const enricher: Middleware = async (ctx, next) => {
    ctx.customField = "enriched";
    return next();
  };

  const run = createMiddlewareRunner([enricher], async (ctx) => {
    capturedValue = ctx.customField;
    return "ok";
  });

  await run({ toolName: "test", args: {} });
  assertEquals(capturedValue, "enriched");
});

Deno.test("middleware runner - error in middleware propagates", async () => {
  const thrower: Middleware = async (_ctx, _next) => {
    throw new Error("middleware error");
  };

  const run = createMiddlewareRunner([thrower], async () => "ok");

  await assertRejects(
    () => run({ toolName: "test", args: {} }),
    Error,
    "middleware error",
  );
});

Deno.test("middleware runner - error in handler propagates through middlewares", async () => {
  const order: string[] = [];

  const wrapper: Middleware = async (_ctx, next) => {
    order.push("before");
    try {
      return await next();
    } finally {
      order.push("after");
    }
  };

  const run = createMiddlewareRunner([wrapper], async () => {
    throw new Error("handler error");
  });

  await assertRejects(
    () => run({ toolName: "test", args: {} }),
    Error,
    "handler error",
  );

  // The after should still execute (finally block)
  assertEquals(order, ["before", "after"]);
});

Deno.test("middleware runner - context has toolName and args", async () => {
  let capturedCtx: MiddlewareContext | undefined;

  const run = createMiddlewareRunner([], async (ctx) => {
    capturedCtx = ctx;
    return "ok";
  });

  await run({ toolName: "my_tool", args: { x: 42 } });

  assertEquals(capturedCtx?.toolName, "my_tool");
  assertEquals(capturedCtx?.args, { x: 42 });
});

Deno.test("middleware runner - context passes request for HTTP transport", async () => {
  let capturedRequest: Request | undefined;

  const run = createMiddlewareRunner([], async (ctx) => {
    capturedRequest = ctx.request;
    return "ok";
  });

  const req = new Request("http://localhost/mcp", {
    method: "POST",
    headers: { Authorization: "Bearer test" },
  });

  await run({ toolName: "test", args: {}, request: req });

  assertEquals(capturedRequest?.url, "http://localhost/mcp");
  assertEquals(capturedRequest?.headers.get("Authorization"), "Bearer test");
});

Deno.test("middleware runner - three middlewares compose correctly", async () => {
  const values: number[] = [];

  const m1: Middleware = async (_ctx, next) => {
    values.push(1);
    const r = await next();
    values.push(6);
    return r;
  };
  const m2: Middleware = async (_ctx, next) => {
    values.push(2);
    const r = await next();
    values.push(5);
    return r;
  };
  const m3: Middleware = async (_ctx, next) => {
    values.push(3);
    const r = await next();
    values.push(4);
    return r;
  };

  const run = createMiddlewareRunner([m1, m2, m3], async () => "done");
  await run({ toolName: "test", args: {} });

  assertEquals(values, [1, 2, 3, 4, 5, 6]);
});

Deno.test("middleware runner - throws when next() called after handler completes (double-call guard)", async () => {
  let storedNext: (() => Promise<unknown>) | null = null;

  const sneaky: Middleware = async (_ctx, next) => {
    storedNext = next;
    return next(); // first call - OK
  };

  const run = createMiddlewareRunner([sneaky], async () => "ok");
  await run({ toolName: "test", args: {} });

  // Now try to call next() again after pipeline completed
  await assertRejects(
    () => storedNext!(),
    Error,
    "next() called after pipeline already completed",
  );
});
