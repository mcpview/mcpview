import { assertEquals, assertRejects } from "@std/assert";
import { App } from "@modelcontextprotocol/ext-apps";

import {
  type TeardownReason,
  type ToolInputParams,
  type ToolInputPartialParams,
  type ToolResultParams,
  wireLifecycleCallbacks,
  wireTeardownLifecycle,
} from "./lifecycle.ts";
import type { AppHandle, AppLifecycleCallbacks } from "./types.ts";

interface FakeOneShotApp {
  ontoolinput?: (params: ToolInputParams) => void;
  ontoolinputpartial?: (params: ToolInputPartialParams) => void;
  ontoolresult?: (params: ToolResultParams) => void;
}

interface FakeTeardownApp {
  onteardown?: () => Promise<Record<string, never>>;
}

function fakeApp(): FakeOneShotApp {
  return {};
}

function input(label: string): ToolInputParams {
  return { arguments: { label } };
}

function partial(label: string): ToolInputPartialParams {
  return { arguments: { label } };
}

function result(label: string): ToolResultParams {
  return { content: [{ type: "text", text: label }] };
}

function fakeHandle(): AppHandle<Record<string, never>> {
  return {
    ctx: {} as AppHandle<Record<string, never>>["ctx"],
    events: {} as AppHandle<Record<string, never>>["events"],
    currentView: "home",
    navigate: () => Promise.resolve(),
    dispose: () => Promise.resolve(),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

Deno.test("wireLifecycleCallbacks registers every one-shot handler immediately", () => {
  const app = fakeApp();
  wireLifecycleCallbacks(
    app as Parameters<typeof wireLifecycleCallbacks>[0],
    {} satisfies AppLifecycleCallbacks<Record<string, never>>,
  );

  assertEquals(typeof app.ontoolinput, "function");
  assertEquals(typeof app.ontoolinputpartial, "function");
  assertEquals(typeof app.ontoolresult, "function");
});

Deno.test("wireLifecycleCallbacks is accepted by ext-apps strict mode before connect", () => {
  const app = new App(
    { name: "lifecycle-test", version: "0.0.0" },
    {},
    { strict: true },
  );

  // ext-apps throws in strict mode when a one-shot handler is first
  // registered after its initialize handshake. This pre-connect registration
  // must therefore complete silently.
  wireLifecycleCallbacks(app, {});
  assertEquals(typeof app.ontoolinput, "function");
});

Deno.test("LifecycleDispatcher buffers all notification kinds then replays their FIFO arrival order", async () => {
  const app = fakeApp();
  const seen: string[] = [];
  const handle = fakeHandle();
  const dispatcher = wireLifecycleCallbacks(
    app as Parameters<typeof wireLifecycleCallbacks<Record<string, never>>>[0],
    {
      onToolInput: (params, receivedHandle) => {
        seen.push(`input:${params.arguments?.label}`);
        assertEquals(receivedHandle, handle);
      },
      onToolInputPartial: (params, receivedHandle) => {
        seen.push(`partial:${params.arguments?.label}`);
        assertEquals(receivedHandle, handle);
      },
      onToolResult: (params, receivedHandle) => {
        const first = params.content[0];
        seen.push(`result:${first?.type === "text" ? first.text : "unexpected"}`);
        assertEquals(receivedHandle, handle);
      },
    },
  );

  app.ontoolinput?.(input("one"));
  app.ontoolinputpartial?.(partial("two"));
  app.ontoolresult?.(result("three"));
  assertEquals(seen, []);

  await dispatcher.activate(handle);
  assertEquals(seen, ["input:one", "partial:two", "result:three"]);
});

Deno.test("LifecycleDispatcher serializes async callbacks and queues arrivals during replay", async () => {
  const app = fakeApp();
  const seen: string[] = [];
  const gate = deferred<void>();
  const dispatcher = wireLifecycleCallbacks(
    app as Parameters<typeof wireLifecycleCallbacks<Record<string, never>>>[0],
    {
      onToolInput: async (params) => {
        seen.push(`start:${params.arguments?.label}`);
        await gate.promise;
        seen.push(`end:${params.arguments?.label}`);
      },
      onToolResult: (params) => {
        const first = params.content[0];
        seen.push(`result:${first?.type === "text" ? first.text : "unexpected"}`);
      },
    },
  );

  app.ontoolinput?.(input("first"));
  const replay = dispatcher.activate(fakeHandle());
  await Promise.resolve();
  assertEquals(seen, ["start:first"]);

  // The handle is set while replay is blocked. This notification must append
  // after the buffered input rather than begin a concurrent callback.
  app.ontoolresult?.(result("second"));
  assertEquals(seen, ["start:first"]);

  gate.resolve();
  await replay;
  assertEquals(seen, ["start:first", "end:first", "result:second"]);
});

Deno.test("LifecycleDispatcher logs a callback failure and continues the FIFO", async () => {
  const app = fakeApp();
  const seen: string[] = [];
  const originalError = console.error;
  console.error = () => {};
  try {
    const dispatcher = wireLifecycleCallbacks(
      app as Parameters<typeof wireLifecycleCallbacks<Record<string, never>>>[0],
      {
        onToolInput: () => {
          throw new Error("expected test callback failure");
        },
        onToolResult: () => {
          seen.push("result delivered");
        },
      },
    );
    app.ontoolinput?.(input("broken"));
    app.ontoolresult?.(result("still-deliver"));

    await dispatcher.activate(fakeHandle());
    assertEquals(seen, ["result delivered"]);
  } finally {
    console.error = originalError;
  }
});

Deno.test("LifecycleDispatcher rejects a second activation", async () => {
  const app = fakeApp();
  const dispatcher = wireLifecycleCallbacks(
    app as Parameters<typeof wireLifecycleCallbacks<Record<string, never>>>[0],
    {},
  );
  await dispatcher.activate(fakeHandle());
  await assertRejects(
    () => dispatcher.activate(fakeHandle()),
    Error,
    "may only be called once",
  );
});

Deno.test("wireTeardownLifecycle registers the host handler before activation", () => {
  const app: FakeTeardownApp = {};
  wireTeardownLifecycle(app as Parameters<typeof wireTeardownLifecycle>[0]);
  assertEquals(typeof app.onteardown, "function");
});

Deno.test("wireTeardownLifecycle is accepted by ext-apps strict mode before connect", () => {
  const app = new App(
    { name: "teardown-test", version: "0.0.0" },
    {},
    { strict: true },
  );
  wireTeardownLifecycle(app);
  assertEquals(typeof app.onteardown, "function");
});

Deno.test("host teardown and manual dispose share one cleanup", async () => {
  const app: FakeTeardownApp = {};
  const calls: string[] = [];
  const dispatcher = wireTeardownLifecycle(
    app as Parameters<typeof wireTeardownLifecycle<Record<string, never>>>[0],
    (_handle, reason: TeardownReason) => {
      calls.push(`user:${reason}`);
    },
  );
  const hostRequest = app.onteardown?.();
  assertEquals(calls, []);

  dispatcher.activate(fakeHandle(), () => {
    calls.push("internal");
  });
  await hostRequest;
  await dispatcher.dispose();

  assertEquals(calls, ["user:host", "internal"]);
});

Deno.test("manual dispose followed by host teardown cleans up once", async () => {
  const app: FakeTeardownApp = {};
  let userCalls = 0;
  let internalCalls = 0;
  const dispatcher = wireTeardownLifecycle(
    app as Parameters<typeof wireTeardownLifecycle<Record<string, never>>>[0],
    () => {
      userCalls++;
    },
  );
  dispatcher.activate(fakeHandle(), () => {
    internalCalls++;
  });

  await dispatcher.dispose();
  assertEquals(await app.onteardown?.(), {});
  assertEquals(userCalls, 1);
  assertEquals(internalCalls, 1);
});

Deno.test("teardown always runs internal cleanup when the user callback fails", async () => {
  const app: FakeTeardownApp = {};
  let internalCalls = 0;
  const dispatcher = wireTeardownLifecycle(
    app as Parameters<typeof wireTeardownLifecycle<Record<string, never>>>[0],
    () => {
      throw new Error("user teardown failed");
    },
  );
  dispatcher.activate(fakeHandle(), () => {
    internalCalls++;
  });

  await assertRejects(() => dispatcher.dispose(), Error, "user teardown failed");
  assertEquals(internalCalls, 1);
});
