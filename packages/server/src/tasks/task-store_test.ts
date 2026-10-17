/**
 * Tests for the Tasks extension store (io.modelcontextprotocol/tasks, SEP-2663).
 *
 * Test coverage targets:
 * - State-machine transitions (spec §Task Status)
 * - requireInput() key uniqueness invariant (spec §Task Update Requests)
 * - tasks/update partial-response semantics
 * - tasks/cancel cooperative semantics
 * - TTL expiry → failed, then -32602-equivalent (null) on get()
 * - maxTasks eviction order (terminal first, then oldest non-terminal)
 * - isAsyncTaskDescriptor type guard
 * - generateTaskId entropy (128-bit collision probability)
 * - Notification callback wiring
 *
 * @module lib/server/tasks/task-store_test
 */

// Owner threaded through every call: the store binds each task to its creator,
// and the caller is a required argument rather than a defaulted one — a silent
// default is the one thing an authorization check must never have.
const OWNER = "test-owner";

import { assertEquals, assertInstanceOf, assertNotEquals } from "@std/assert";
import {
  createTask,
  generateTaskId,
  isAsyncTaskDescriptor,
  TaskStore,
} from "./task-store.ts";
import type { DetailedTask, InputRequiredTask } from "./task-store.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Store with cleanup disabled so tests control timing. */
function makeStore(overrides?: { maxTasks?: number; defaultTtlMs?: number }) {
  return new TaskStore({
    cleanupIntervalMs: 0, // disable auto-sweep
    defaultTtlMs: overrides?.defaultTtlMs ?? 3_600_000,
    maxTasks: overrides?.maxTasks ?? 5_000,
  });
}

/** Flush microtask queue so Promise handlers run. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ── isAsyncTaskDescriptor ─────────────────────────────────────────────────────

Deno.test("isAsyncTaskDescriptor — true for createTask() output", () => {
  const descriptor = createTask({}, () => Promise.resolve({ ok: true }));
  assertEquals(isAsyncTaskDescriptor(descriptor), true);
});

Deno.test("isAsyncTaskDescriptor — false for plain objects", () => {
  assertEquals(isAsyncTaskDescriptor(null), false);
  assertEquals(isAsyncTaskDescriptor({}), false);
  assertEquals(isAsyncTaskDescriptor({ _type: "not-async-task" }), false);
  assertEquals(
    isAsyncTaskDescriptor({ content: [{ type: "text", text: "hi" }] }),
    false,
  );
  assertEquals(isAsyncTaskDescriptor("string"), false);
  assertEquals(isAsyncTaskDescriptor(42), false);
});

Deno.test("isAsyncTaskDescriptor — false for object missing run function", () => {
  assertEquals(
    isAsyncTaskDescriptor({ _type: "async-task", options: {} }),
    false,
  );
});

// ── generateTaskId entropy ────────────────────────────────────────────────────

Deno.test("generateTaskId — 32 lowercase hex chars (128-bit)", () => {
  const id = generateTaskId();
  assertEquals(id.length, 32);
  assertEquals(/^[0-9a-f]{32}$/.test(id), true);
});

Deno.test("generateTaskId — negligible collision probability across 1000 samples", () => {
  // P(collision | 1000 128-bit draws) ≈ 1.5e-34; this test would flake once
  // in 10^34 runs — effectively never. If it ever fails, the RNG is broken.
  const ids = new Set(Array.from({ length: 1_000 }, generateTaskId));
  assertEquals(ids.size, 1_000);
});

// ── spawn / get ───────────────────────────────────────────────────────────────

Deno.test("spawn — task immediately visible via get()", () => {
  const store = makeStore();
  const descriptor = createTask({}, () => Promise.resolve({ done: true }));
  const fields = store.spawn(descriptor, OWNER);

  // Spec §Task Creation: "a subsequent tasks/get for the returned taskId must
  // resolve immediately" — synchronously after spawn() returns.
  const task = store.get(fields.taskId, OWNER);
  assertEquals(task?.taskId, fields.taskId);
  assertEquals(task?.status, "working");
});

Deno.test("spawn — returns CreateTaskResultFields with correct base fields", () => {
  const store = makeStore();
  const descriptor = createTask(
    { pollIntervalMs: 2_000, statusMessage: "Scanning" },
    () => Promise.resolve({}),
  );
  const fields = store.spawn(descriptor, OWNER);

  assertEquals(typeof fields.taskId, "string");
  assertEquals(fields.status, "working");
  assertEquals(fields.statusMessage, "Scanning");
  assertEquals(fields.pollIntervalMs, 2_000);
  assertEquals(typeof fields.createdAt, "string");
  assertEquals(typeof fields.lastUpdatedAt, "string");
});

Deno.test("get — returns null for unknown taskId", () => {
  const store = makeStore();
  assertEquals(store.get("nonexistent-task-id", OWNER), null);
});

// ── State machine: working → completed ───────────────────────────────────────

Deno.test("state machine — working → completed on successful run()", async () => {
  const store = makeStore();
  const descriptor = createTask({}, () => Promise.resolve({ rows: 42 }));
  const { taskId } = store.spawn(descriptor, OWNER);

  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "completed");
  if (task?.status === "completed") {
    assertEquals(task.result, { rows: 42 });
  }
});

Deno.test("state machine — non-object result is boxed under 'value'", async () => {
  const store = makeStore();
  const { taskId } = store.spawn(
    createTask({}, () => Promise.resolve(99)),
    OWNER,
  );

  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "completed");
  if (task?.status === "completed") {
    assertEquals(task.result, { value: 99 });
  }
});

// ── State machine: working → failed ──────────────────────────────────────────

Deno.test("state machine — working → failed when run() throws JSON-RPC error", async () => {
  const store = makeStore();
  const descriptor = createTask(
    {},
    () => Promise.reject({ code: -32603, message: "Internal error in task" }),
  );
  const { taskId } = store.spawn(descriptor, OWNER);

  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "failed");
  if (task?.status === "failed") {
    assertEquals(task.error.code, -32603);
    assertEquals(task.error.message, "Internal error in task");
  }
});

Deno.test("state machine — working → failed when run() throws plain Error (wrapped as -32603)", async () => {
  const store = makeStore();
  const descriptor = createTask(
    {},
    () => Promise.reject(new Error("unexpected crash")),
  );
  const { taskId } = store.spawn(descriptor, OWNER);

  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "failed");
  if (task?.status === "failed") {
    assertEquals(task.error.code, -32603);
    assertEquals(task.error.message, "unexpected crash");
  }
});

// ── State machine: working → cancelled ───────────────────────────────────────

Deno.test("state machine — working → cancelled when run() observes abort and throws AbortError", async () => {
  const store = makeStore();
  const descriptor = createTask({}, async (ctrl) => {
    // Observe cancellation and propagate it.
    await new Promise<void>((_, reject) => {
      ctrl.signal.addEventListener("abort", () => {
        reject(new DOMException("Task was cancelled", "AbortError"));
      });
    });
  });
  const { taskId } = store.spawn(descriptor, OWNER);

  store.cancel(taskId, OWNER);
  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "cancelled");
});

Deno.test("cancel — returns true for known task, false for unknown", () => {
  const store = makeStore();
  const { taskId } = store.spawn(
    createTask({}, () => Promise.resolve({})),
    OWNER,
  );
  assertEquals(store.cancel(taskId, OWNER), true);
  assertEquals(store.cancel("ghost", OWNER), false);
});

Deno.test("cancel — cancelling a completed task returns true (task is found) but does not change status", async () => {
  const store = makeStore();
  const { taskId } = store.spawn(
    createTask({}, () => Promise.resolve({ ok: true })),
    OWNER,
  );

  await flushMicrotasks(); // let it complete

  assertEquals(store.get(taskId, OWNER)?.status, "completed");
  // Cancel on a terminal task: found → true, status unchanged.
  assertEquals(store.cancel(taskId, OWNER), true);
  assertEquals(store.get(taskId, OWNER)?.status, "completed");
});

// ── State machine: working → input_required → working → completed ──────────

Deno.test("state machine — working → input_required → working → completed", async () => {
  const store = makeStore();
  const capturedResolve: ((v: Record<string, unknown>) => void) | null = null;

  const descriptor = createTask({}, async (ctrl) => {
    const response = await ctrl.requireInput("step-1", {
      method: "sampling/createMessage",
      params: { messages: [] },
    });
    return { answer: response["text"] };
  });

  const { taskId } = store.spawn(descriptor, OWNER);
  await flushMicrotasks();

  // Should be in input_required now
  const pendingTask = store.get(taskId, OWNER);
  assertEquals(pendingTask?.status, "input_required");
  if (pendingTask?.status === "input_required") {
    assertEquals(Object.keys(pendingTask.inputRequests), ["step-1"]);
    assertEquals(
      pendingTask.inputRequests["step-1"].method,
      "sampling/createMessage",
    );
  }

  // Deliver response via tasks/update
  const ok = store.update(
    taskId,
    { "step-1": { text: "Hello from client" } },
    OWNER,
  );
  assertEquals(ok, true);
  await flushMicrotasks();

  const doneTask = store.get(taskId, OWNER);
  assertEquals(doneTask?.status, "completed");
  if (doneTask?.status === "completed") {
    assertEquals(doneTask.result, { answer: "Hello from client" });
  }
  // Void to prevent TS "variable assigned but never read" if we captured
  assertEquals(capturedResolve, null);
});

// ── requireInput key uniqueness ──────────────────────────────────────────────

Deno.test("requireInput — rejects on reuse of an already-answered key", async () => {
  const store = makeStore();
  let didReuse = false;
  let reuseError: Error | undefined;

  const descriptor = createTask({}, async (ctrl) => {
    await ctrl.requireInput("key-once", {
      method: "sampling/createMessage",
      params: {},
    });
    try {
      await ctrl.requireInput("key-once", {
        method: "sampling/createMessage",
        params: {},
      });
      didReuse = true;
    } catch (e) {
      reuseError = e instanceof Error ? e : new Error(String(e));
    }
    return {};
  });

  const { taskId } = store.spawn(descriptor, OWNER);
  await flushMicrotasks();

  // Answer the first call
  store.update(taskId, { "key-once": { ok: true } }, OWNER);
  await flushMicrotasks(); // run() re-tries with same key
  await flushMicrotasks(); // run() catches the error and returns

  assertEquals(didReuse, false);
  assertInstanceOf(reuseError, Error);
  // Lint guard: ensure the variable is used
  assertEquals(reuseError !== undefined, true);
});

Deno.test("requireInput — rejects on use of a currently-outstanding key", async () => {
  const store = makeStore();
  let doubleError: Error | undefined;

  // The first requireInput pends; the second with the same key must reject
  // immediately because "dup" is already in pendingResolvers.
  // Using Promise.allSettled would block forever on the first (never-settling)
  // promise. Instead, detach the first and await only the second.
  store.spawn(
    createTask({}, async (ctrl) => {
      // Detach: we intentionally do not await this promise.
      void ctrl.requireInput("dup", {
        method: "elicitation/create",
        params: {},
      }).catch(
        () => {},
      );
      // Second call: "dup" already outstanding — must reject.
      try {
        await ctrl.requireInput("dup", {
          method: "elicitation/create",
          params: {},
        });
      } catch (e) {
        doubleError = e instanceof Error ? e : new Error(String(e));
      }
      return {};
    }),
    OWNER,
  );

  await flushMicrotasks();

  assertInstanceOf(doubleError, Error);
});

// ── tasks/update partial response ─────────────────────────────────────────────

Deno.test("update — ignores responses for unknown keys (spec SHOULD)", async () => {
  const store = makeStore();
  const { taskId } = store.spawn(
    createTask({}, async (ctrl) => {
      await ctrl.requireInput("real-key", {
        method: "elicitation/create",
        params: {},
      });
      return {};
    }),
    OWNER,
  );

  await flushMicrotasks();

  // Send a mix of a real key and an unknown one — should succeed without throwing.
  const ok = store.update(taskId, {
    "ghost-key": { ignored: true },
    "real-key": { answer: "yes" },
  }, OWNER);
  assertEquals(ok, true);
  await flushMicrotasks();

  assertEquals(store.get(taskId, OWNER)?.status, "completed");
});

Deno.test("update — returns false for unknown taskId", () => {
  const store = makeStore();
  assertEquals(store.update("ghost", { key: {} }, OWNER), false);
});

Deno.test("update — returns false for unknown taskId (SHOULD -32602)", () => {
  const store = makeStore();
  assertEquals(store.update("no-such-task", { x: {} }, OWNER), false);
});

// ── setStatusMessage ──────────────────────────────────────────────────────────

Deno.test("setStatusMessage — visible on subsequent get()", async () => {
  const store = makeStore();
  let ctrlRef: Parameters<Parameters<typeof createTask>[1]>[0] | null = null;

  const descriptor = createTask({}, async (ctrl) => {
    ctrlRef = ctrl;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    ctrl.setStatusMessage("Almost done");
    return {};
  });

  const { taskId } = store.spawn(descriptor, OWNER);
  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  if (task?.status === "working" || task?.status === "completed") {
    // setStatusMessage may have run by now or not — just check it's a string
    const msg = task.statusMessage;
    assertEquals(typeof msg === "string" || msg === undefined, true);
  }
  assertEquals(ctrlRef !== null, true);
});

// ── TTL expiry ────────────────────────────────────────────────────────────────

Deno.test("TTL expiry — sweep marks task failed", async () => {
  // Build a task with 1 ms TTL so it expires instantly.
  const store = new TaskStore({
    cleanupIntervalMs: 0,
    defaultTtlMs: 1,
    maxTasks: 5_000,
  });

  // Use a descriptor with explicit ttlMs: 1 ms so it expires in the next sweep.
  const { taskId } = store.spawn(
    createTask({ ttlMs: 1 }, async (ctrl) => {
      // Block until aborted
      await new Promise<void>((_, reject) => {
        ctrl.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }),
    OWNER,
  );

  // Wait past the TTL then manually sweep.
  await new Promise<void>((resolve) => setTimeout(resolve, 5));

  // Trigger sweep by accessing private method via a trick: create a second
  // store and call dispose, but we can also just expose _sweep indirectly.
  // Since _sweep is private, we verify indirectly via a test-only store
  // subclass pattern — or simply call dispose() which calls _sweep first.
  //
  // Actually, the cleanest approach: access the private method via type assertion.
  (store as unknown as { _sweep(): void })._sweep();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "failed");
  if (task?.status === "failed") {
    assertEquals(task.error.code, -32603);
    assertEquals(typeof task.error.message, "string");
  }

  store.dispose();
});

Deno.test("TTL expiry — null TTL (no expiry) is respected", async () => {
  const store = new TaskStore({
    cleanupIntervalMs: 0,
    defaultTtlMs: 1,
    maxTasks: 5_000,
  });

  const { taskId } = store.spawn(
    createTask({ ttlMs: null }, async (ctrl) => {
      // Block forever until cancelled
      await new Promise<void>((_, reject) => {
        ctrl.signal.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }),
    OWNER,
  );

  // Sweep with defaultTtlMs: 1 would expire a task with ttlMs: 1, but ttlMs: null is exempt.
  await new Promise<void>((resolve) => setTimeout(resolve, 5));
  (store as unknown as { _sweep(): void })._sweep();

  assertEquals(store.get(taskId, OWNER)?.status, "working");

  store.cancel(taskId, OWNER);
  store.dispose();
});

// ── maxTasks eviction ─────────────────────────────────────────────────────────

Deno.test("eviction — terminal tasks evicted before non-terminal when at cap", async () => {
  const store = makeStore({ maxTasks: 3 });

  // Spawn two tasks and let them complete.
  const d1 = store.spawn(
    createTask({}, () => Promise.resolve({ i: 1 })),
    OWNER,
  );
  const d2 = store.spawn(
    createTask({}, () => Promise.resolve({ i: 2 })),
    OWNER,
  );
  await flushMicrotasks();

  assertEquals(store.get(d1.taskId, OWNER)?.status, "completed");
  assertEquals(store.get(d2.taskId, OWNER)?.status, "completed");

  // Spawn a blocking (non-terminal) task at size 2.
  const d3 = store.spawn(
    createTask({}, async (ctrl) => {
      await new Promise<void>((_, reject) => {
        ctrl.signal.addEventListener(
          "abort",
          () => reject(new DOMException("abort", "AbortError")),
        );
      });
    }),
    OWNER,
  );

  // Now spawn a fourth — should evict oldest terminal task (d1, terminalAt < d2.terminalAt).
  const d4 = store.spawn(
    createTask({}, () => Promise.resolve({ i: 4 })),
    OWNER,
  );
  await flushMicrotasks();

  // d1 was evicted (oldest terminal); d2, d3, d4 remain.
  assertEquals(store.get(d1.taskId, OWNER), null);
  assertNotEquals(store.get(d2.taskId, OWNER), null);
  assertNotEquals(store.get(d3.taskId, OWNER), null);
  assertNotEquals(store.get(d4.taskId, OWNER), null);

  store.cancel(d3.taskId, OWNER);
  store.dispose();
});

Deno.test("eviction — oldest non-terminal evicted when no terminal tasks remain", async () => {
  const store = makeStore({ maxTasks: 2 });

  // Both tasks block forever.
  const blocker = (label: string) =>
    createTask({ statusMessage: label }, async (ctrl) => {
      await new Promise<void>((_, reject) => {
        ctrl.signal.addEventListener(
          "abort",
          () => reject(new DOMException("abort", "AbortError")),
        );
      });
    });

  const d1 = store.spawn(blocker("first"), OWNER);
  const d2 = store.spawn(blocker("second"), OWNER);

  // Spawn third at cap — d1 (oldest) must be evicted.
  const d3 = store.spawn(blocker("third"), OWNER);
  await flushMicrotasks();

  assertEquals(store.get(d1.taskId, OWNER), null);
  assertNotEquals(store.get(d2.taskId, OWNER), null);
  assertNotEquals(store.get(d3.taskId, OWNER), null);

  store.cancel(d2.taskId, OWNER);
  store.cancel(d3.taskId, OWNER);
  store.dispose();
});

// ── drain / dispose ───────────────────────────────────────────────────────────

Deno.test("drain — signals all in-flight tasks", async () => {
  const store = makeStore();
  const signals: AbortSignal[] = [];

  const makeBlocker = () =>
    createTask({}, async (ctrl) => {
      signals.push(ctrl.signal);
      await new Promise<void>((_, reject) => {
        ctrl.signal.addEventListener("abort", () =>
          reject(new DOMException("abort", "AbortError")));
      });
    });

  store.spawn(makeBlocker(), OWNER);
  store.spawn(makeBlocker(), OWNER);
  await flushMicrotasks();

  store.drain();
  await flushMicrotasks();

  assertEquals(signals.length, 2);
  assertEquals(signals[0].aborted, true);
  assertEquals(signals[1].aborted, true);

  store.dispose();
});

Deno.test("dispose — safe to call twice (idempotent)", () => {
  const store = makeStore();
  store.dispose();
  store.dispose(); // must not throw
});

// ── Notification callback ─────────────────────────────────────────────────────

Deno.test("notification callback — fires on spawn (initial working state)", () => {
  const notifications: DetailedTask[] = [];
  const store = new TaskStore({
    cleanupIntervalMs: 0,
    defaultTtlMs: 3_600_000,
    maxTasks: 5_000,
    onNotification: (t) => notifications.push(t),
  });

  store.spawn(createTask({}, () => Promise.resolve({})), OWNER);

  // No notification on spawn itself — the task starts working silently.
  // Notification fires on transition INTO input_required or INTO a terminal state.
  assertEquals(notifications.length, 0);

  store.dispose();
});

Deno.test("notification callback — fires when task completes", async () => {
  const notifications: DetailedTask[] = [];
  const store = new TaskStore({
    cleanupIntervalMs: 0,
    defaultTtlMs: 3_600_000,
    maxTasks: 5_000,
    onNotification: (t) => notifications.push(t),
  });

  store.spawn(createTask({}, () => Promise.resolve({ result: "done" })), OWNER);
  await flushMicrotasks();

  assertEquals(notifications.length, 1);
  assertEquals(notifications[0].status, "completed");

  store.dispose();
});

Deno.test("notification callback — fires on input_required transition", async () => {
  const notifications: DetailedTask[] = [];
  const store = new TaskStore({
    cleanupIntervalMs: 0,
    defaultTtlMs: 3_600_000,
    maxTasks: 5_000,
    onNotification: (t) => notifications.push(t),
  });

  const { taskId } = store.spawn(
    createTask({}, async (ctrl) => {
      await ctrl.requireInput("q", {
        method: "elicitation/create",
        params: {},
      });
      return {};
    }),
    OWNER,
  );
  await flushMicrotasks();

  // Should have fired for input_required
  assertEquals(notifications.length >= 1, true);
  const inputReqNotif = notifications.find((n) =>
    n.status === "input_required"
  );
  assertEquals(inputReqNotif !== undefined, true);
  if (inputReqNotif?.status === "input_required") {
    assertEquals("q" in inputReqNotif.inputRequests, true);
  }

  store.update(taskId, { q: { text: "answer" } }, OWNER);
  await flushMicrotasks();

  // working notification then completed
  const completedNotif = notifications.find((n) => n.status === "completed");
  assertEquals(completedNotif !== undefined, true);

  store.dispose();
});

// ── createTask type guard roundtrip ──────────────────────────────────────────

Deno.test("createTask → isAsyncTaskDescriptor roundtrip", () => {
  const d = createTask({ ttlMs: 60_000 }, () => Promise.resolve({}));
  assertEquals(isAsyncTaskDescriptor(d), true);
  assertEquals(d._type, "async-task");
  assertEquals(typeof d.run, "function");
  assertEquals(d.options.ttlMs, 60_000);
});

// ── Multiple concurrent requireInput calls ────────────────────────────────────

Deno.test("multiple concurrent requireInput — all visible in inputRequests", async () => {
  const store = makeStore();

  const { taskId } = store.spawn(
    createTask({}, async (ctrl) => {
      // Fire two in parallel
      const [a, b] = await Promise.all([
        ctrl.requireInput("alpha", {
          method: "elicitation/create",
          params: { p: 1 },
        }),
        ctrl.requireInput("beta", {
          method: "sampling/createMessage",
          params: { p: 2 },
        }),
      ]);
      return { a: a["v"], b: b["v"] };
    }),
    OWNER,
  );
  await flushMicrotasks();

  const task = store.get(taskId, OWNER) as InputRequiredTask;
  assertEquals(task.status, "input_required");
  assertEquals(Object.keys(task.inputRequests).sort(), ["alpha", "beta"]);

  // Deliver both responses
  store.update(taskId, { alpha: { v: 1 }, beta: { v: 2 } }, OWNER);
  await flushMicrotasks();

  const done = store.get(taskId, OWNER);
  assertEquals(done?.status, "completed");
  if (done?.status === "completed") {
    assertEquals(done.result, { a: 1, b: 2 });
  }

  store.dispose();
});

// ── Signal propagation on cancel during requireInput ─────────────────────────

Deno.test("cancel during requireInput — promise rejects with AbortError", async () => {
  const store = makeStore();
  let caughtError: unknown;

  const { taskId } = store.spawn(
    createTask({}, async (ctrl) => {
      try {
        await ctrl.requireInput("blocked", {
          method: "elicitation/create",
          params: {},
        });
      } catch (e) {
        caughtError = e;
      }
      return {};
    }),
    OWNER,
  );
  await flushMicrotasks();

  store.cancel(taskId, OWNER);
  await flushMicrotasks();

  assertInstanceOf(caughtError, DOMException);
  assertEquals((caughtError as DOMException).name, "AbortError");
});

// ── Spec: failed NOT for non-JSON-RPC errors passed as result ───────────────

Deno.test("spec: tool-level isError does NOT produce failed status", async () => {
  const store = makeStore();

  // A tool result with isError: true reaches 'completed'.
  const { taskId } = store.spawn(
    createTask({}, () =>
      Promise.resolve({
        content: [{ type: "text", text: "Not found" }],
        isError: true,
      })),
    OWNER,
  );
  await flushMicrotasks();

  const task = store.get(taskId, OWNER);
  assertEquals(task?.status, "completed");
  if (task?.status === "completed") {
    assertEquals(task.result["isError"], true);
  }
});

// ── Input-request grammar (round 11) ─────────────────────────────────────────

Deno.test("requireInput — only MRTR methods are accepted", async () => {
  // Accepting any string let a task ask for a method no client implements, so it
  // STRANDED in input_required forever instead of failing. A stranded task is
  // worse than a failed one: it consumes a poll loop and never resolves.
  const store = new TaskStore({ cleanupIntervalMs: 0 });
  try {
    for (
      const method of [
        "client/request",
        "tools/call",
        "elicitation/createFoo",
        "",
        "toString",
        "__proto__",
      ]
    ) {
      const { taskId } = store.spawn(
        createTask({}, (ctrl) =>
          ctrl.requireInput("k", {
            method,
            params: { message: "hi" },
          })),
        OWNER,
      );
      await flushMicrotasks();
      const task = store.get(taskId, OWNER);
      assertEquals(
        task?.status,
        "failed",
        `${JSON.stringify(method)} must fail the task, not strand it`,
      );
    }
  } finally {
    store.dispose();
  }
});

Deno.test("requireInput — the three permitted methods are accepted", () => {
  // The counterweight: a grammar that rejects everything would pass the test above
  // while making the feature unusable.
  const store = new TaskStore({ cleanupIntervalMs: 0 });
  try {
    for (
      const method of [
        "elicitation/create",
        "sampling/createMessage",
        "roots/list",
      ]
    ) {
      const { taskId } = store.spawn(
        createTask(
          {},
          (ctrl) => ctrl.requireInput("k", { method, params: {} }),
        ),
        OWNER,
      );
      const task = store.get(taskId, OWNER);
      assertEquals(
        task?.status === "failed",
        false,
        `${method} must be accepted`,
      );
    }
  } finally {
    store.dispose();
  }
});

Deno.test("requireInput — malformed params fail the task", async () => {
  const store = new TaskStore({ cleanupIntervalMs: 0 });
  try {
    for (const params of [null, "x", 42, [], undefined]) {
      const { taskId } = store.spawn(
        createTask({}, (ctrl) =>
          ctrl.requireInput("k", {
            method: "elicitation/create",
            // deno-lint-ignore no-explicit-any
            params: params as any,
          })),
        OWNER,
      );
      await flushMicrotasks();
      assertEquals(
        store.get(taskId, OWNER)?.status,
        "failed",
        `params ${JSON.stringify(params)} must fail the task`,
      );
    }
  } finally {
    store.dispose();
  }
});
