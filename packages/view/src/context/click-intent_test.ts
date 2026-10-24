import { assertEquals, assertThrows } from "@std/assert";
import {
  CLICK_INTENT_DELAY_MS,
  type ClickIntent,
  type ClickIntentRevert,
  type ClickIntentSchedule,
  type ContextClickIntent,
  createClickIntentArbiter,
  type DetailClickIntent,
  detailOnClickIntent,
  isDetailClickIntent,
} from "./click-intent.ts";

function scheduler() {
  let now = 0;
  const tasks: Array<{ run: () => void; at: number; cancelled: boolean }> = [];
  const schedule: ClickIntentSchedule = (run, delay) => {
    const task = { run, at: now + delay, cancelled: false };
    tasks.push(task);
    return () => task.cancelled = true;
  };
  return {
    schedule,
    tasks,
    advance(ms: number) {
      now += ms;
      for (const task of tasks) {
        if (!task.cancelled && task.at <= now) {
          task.cancelled = true;
          task.run();
        }
      }
    },
  };
}

function target(key: string, events: string[], scope?: string): ContextClickIntent {
  return {
    key,
    scope,
    onSingle: () => {
      events.push(`context:${key}`);
    },
    onDouble: () => events.push(`detail:${key}`),
  };
}

function setup() {
  const clock = scheduler();
  const arbiter = createClickIntentArbiter(clock.schedule);
  const events: string[] = [];
  return { clock, arbiter, events };
}

Deno.test("click intent - pointer single commits only after the arbitration delay", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("A", events));
  clock.advance(CLICK_INTENT_DELAY_MS - 1);
  assertEquals(events, []);
  clock.advance(1);
  assertEquals(events, ["context:A"]);
  arbiter.dispose();
});

Deno.test("click intent - native double emits zero context writes, including compensation", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent, 1);
  clock.advance(CLICK_INTENT_DELAY_MS - 1);
  assertEquals(events, []);
  arbiter.click(intent, 2);
  // No context change occurs between the native second click and dblclick.
  assertEquals(events, []);
  arbiter.doubleClick(intent);
  assertEquals(events, ["detail:A"]);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A"]);
});

Deno.test("click intent - second click cancels single even if dblclick is not forwarded", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent, 1);
  arbiter.click(intent, 2);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, []);
});

Deno.test("click intent - direct dblclick cancels the unresolved single", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent);
  arbiter.doubleClick(intent);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A"]);
});

Deno.test("click intent - rapid native burst opens detail once until a new first click", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent, 1);
  arbiter.click(intent, 2);
  arbiter.doubleClick(intent);
  arbiter.click(intent, 3);
  arbiter.click(intent, 4);
  arbiter.doubleClick(intent);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A"]);
  arbiter.click(intent, 1);
  arbiter.click(intent, 2);
  arbiter.doubleClick(intent);
  assertEquals(events, ["detail:A", "detail:A"]);
});

Deno.test("click intent - independent targets keep their singles when one target doubles", () => {
  const { clock, arbiter, events } = setup();
  const a = target("A", events);
  arbiter.click(target("B", events));
  arbiter.click(a);
  arbiter.click(a, 2);
  arbiter.doubleClick(a);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A", "context:B"]);
});

Deno.test("click intent - two first clicks are separate sequences and preserve both singles", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent, 1);
  arbiter.click(intent, 1);
  assertEquals(events, []);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:A", "context:A"]);
});

Deno.test("click intent - interval can cover slower double-click preferences", () => {
  const clock = scheduler();
  const arbiter = createClickIntentArbiter({ schedule: clock.schedule, doubleClickDelayMs: 1200 });
  const events: string[] = [];
  const intent = target("A", events);
  arbiter.click(intent);
  clock.advance(1100);
  arbiter.click(intent, 2);
  arbiter.doubleClick(intent);
  clock.advance(1000);
  assertEquals(events, ["detail:A"]);
});

Deno.test("click intent - double beyond configured interval cannot undo a committed single", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent);
  clock.advance(CLICK_INTENT_DELAY_MS);
  arbiter.click(intent, 2);
  arbiter.doubleClick(intent);
  assertEquals(events, ["context:A", "detail:A"]);
});

Deno.test("click intent - detail-only target opens once for a complete native click burst", () => {
  const { clock, arbiter, events } = setup();
  const intent = detailOnClickIntent("A", () => events.push("detail:A"));
  assertEquals(isDetailClickIntent(intent), true);
  assertEquals("onSingle" in intent, false);
  assertEquals("runConversation" in intent, false);
  for (const count of [1, 2, 3, 4]) arbiter.click(intent, count);
  arbiter.doubleClick(intent);
  arbiter.doubleClick(intent);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A"]);
});

Deno.test("click intent - changing same target to detail mode cancels unresolved context", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("A", events));
  arbiter.click(detailOnClickIntent("A", () => events.push("detail:A")));
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A"]);
});

Deno.test("click intent - losing context support during double-click cancels the first intent", () => {
  for (const forwardSecondClick of [false, true]) {
    const { clock, arbiter, events } = setup();
    arbiter.click(target("A", events));
    const detail = detailOnClickIntent("A", () => events.push("detail:A"));
    if (forwardSecondClick) arbiter.click(detail, 2);
    arbiter.doubleClick(detail);
    clock.advance(CLICK_INTENT_DELAY_MS);
    assertEquals(events, []);
  }
});

Deno.test("click intent - assistive detail=0 runs one immediate single", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("A", events), 0);
  arbiter.click(detailOnClickIntent("B", () => events.push("detail:B")), 0);
  assertEquals(events, ["context:A", "detail:B"]);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:A", "detail:B"]);
});

Deno.test("click intent - Space selects immediately and Enter cancels unresolved pointer selection", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  const prevented: string[] = [];
  arbiter.keyDown(intent, { key: " ", preventDefault: () => prevented.push("Space") });
  arbiter.click(intent);
  arbiter.keyDown(intent, { key: "Enter", preventDefault: () => prevented.push("Enter") });
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:A", "detail:A"]);
  assertEquals(prevented, ["Space", "Enter"]);
});

Deno.test("click intent - Space replaces an unresolved pointer single without duplicating it", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent);
  arbiter.keyDown(intent, { key: " ", preventDefault: () => {} });
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:A"]);
});

Deno.test("click intent - ignored and repeated keys have no effect", () => {
  const { arbiter, events } = setup();
  for (const key of ["Enter", " ", "Escape"]) {
    arbiter.keyDown(target("A", events), {
      key,
      repeat: key !== "Escape",
      preventDefault: () => events.push("prevented"),
    });
  }
  assertEquals(events, []);
});

Deno.test("click intent - both detail-only keyboard gestures open local detail", () => {
  const { arbiter, events } = setup();
  const intent = detailOnClickIntent("A", () => events.push("detail:A"));
  for (const key of [" ", "Enter"]) {
    arbiter.keyDown(intent, { key, preventDefault: () => events.push("prevented") });
  }
  assertEquals(events, ["prevented", "detail:A", "prevented", "detail:A"]);
});

Deno.test("click intent - explicit detail cancels pointer single and can be repeated", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent);
  arbiter.activateDetail(intent);
  arbiter.activateDetail(intent);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A", "detail:A"]);
});

Deno.test("click intent - cancel and cancelAll suppress even stale scheduler callbacks", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("A", events));
  arbiter.click(target("B", events));
  arbiter.cancel("A");
  // Exercise the identity guard even if an already queued callback runs anyway.
  clock.tasks[0].run();
  arbiter.cancelAll();
  for (const task of clock.tasks) task.run();
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, []);
});

Deno.test("click intent - same keys in separate scopes arbitrate independently", () => {
  const { clock, arbiter, events } = setup();
  const old = target("A", events, "old");
  const current = target("A", events, "current");
  arbiter.click(old);
  arbiter.click(current);
  arbiter.click(current, 2);
  arbiter.doubleClick(current);
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["detail:A", "context:A"]);
});

Deno.test("click intent - leaving a scope invalidates stale callbacks but keeps other scopes", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("old", events, "old"));
  arbiter.click(target("current", events, "current"));
  arbiter.cancelScope("old");
  clock.tasks[0].run();
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:current"]);
});

Deno.test("click intent - cancel uses exact scoped identity without key collisions", () => {
  const { clock, arbiter, events } = setup();
  arbiter.click(target("b:c", events, "a"));
  arbiter.click(target("c", events, "a:b"));
  arbiter.cancel("b:c", "a");
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, ["context:c"]);
});

Deno.test("click intent - dispose cancels timers and permanently disables all actions", () => {
  const { clock, arbiter, events } = setup();
  const intent = target("A", events);
  arbiter.click(intent);
  arbiter.dispose();
  arbiter.dispose();
  clock.tasks[0].run();
  arbiter.click(intent);
  arbiter.doubleClick(intent);
  arbiter.activateDetail(intent);
  arbiter.keyDown(intent, { key: " ", preventDefault: () => events.push("prevented") });
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(events, []);
});

Deno.test("click intent - async pending single does not block unrelated local detail or invoke undo", async () => {
  const { clock, arbiter, events } = setup();
  let finish!: (revert: ClickIntentRevert) => void;
  arbiter.click({
    key: "A",
    onSingle: () => {
      events.push("context:start");
      return new Promise<ClickIntentRevert>((resolve) => finish = resolve);
    },
    onDouble: () => events.push("detail:A"),
  });
  clock.advance(CLICK_INTENT_DELAY_MS);
  arbiter.activateDetail(target("B", events));
  arbiter.dispose();
  const undo: ClickIntentRevert = () => {
    events.push("undo");
  };
  undo.release = () => events.push("release");
  finish(undo);
  await Promise.resolve();
  assertEquals(events, ["context:start", "detail:B", "release"]);
});

Deno.test("click intent - asynchronous errors reach the error hook without unhandled rejection", async () => {
  const clock = scheduler();
  const errors: unknown[] = [];
  const arbiter = createClickIntentArbiter({
    schedule: clock.schedule,
    onError: (error) => errors.push(error),
  });
  const failure = new Error("context unavailable");
  arbiter.click({ key: "A", onSingle: () => Promise.reject(failure), onDouble: () => {} });
  clock.advance(CLICK_INTENT_DELAY_MS);
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(errors, [failure]);
});

Deno.test("click intent - delayed synchronous singles and receipt-release errors reach the hook", () => {
  const clock = scheduler();
  const errors: Array<{ error: unknown; key: string }> = [];
  const arbiter = createClickIntentArbiter({
    schedule: clock.schedule,
    onError: (error, intent) => errors.push({ error, key: intent.key }),
  });
  const actionFailure = new Error("context unavailable");
  const releaseFailure = new Error("journal unavailable");
  arbiter.click({
    key: "A",
    onSingle: () => {
      throw actionFailure;
    },
    onDouble: () => {},
  });
  const receipt: ClickIntentRevert = () => {};
  receipt.release = () => {
    throw releaseFailure;
  };
  arbiter.click({ key: "B", onSingle: () => receipt, onDouble: () => {} });
  clock.advance(CLICK_INTENT_DELAY_MS);
  assertEquals(errors, [
    { error: actionFailure, key: "A" },
    { error: releaseFailure, key: "B" },
  ]);
});

Deno.test("click intent - synchronous scheduler has no residual callback or pending single", () => {
  const events: string[] = [];
  let cancelled = 0;
  const arbiter = createClickIntentArbiter((run) => {
    run();
    return () => cancelled++;
  });
  arbiter.click(target("A", events));
  arbiter.cancelAll();
  assertEquals(events, ["context:A"]);
  assertEquals(cancelled, 1);
});

Deno.test("click intent - invalid arbitration intervals fail immediately", () => {
  for (const doubleClickDelayMs of [-1, NaN, Infinity]) {
    assertThrows(() => createClickIntentArbiter({ doubleClickDelayMs }), RangeError);
  }
});

Deno.test("click intent - detail intent cannot contain a context action or conversation channel", () => {
  const illegal: DetailClickIntent = {
    key: "A",
    clickAction: "detail",
    doublePolicy: "local",
    onDouble: () => {},
    // @ts-expect-error A detail-only target cannot select context.
    onSingle: () => {},
  };
  const conversational: DetailClickIntent = {
    key: "A",
    clickAction: "detail",
    doublePolicy: "local",
    onDouble: () => {},
    // @ts-expect-error A local detail target has no conversation channel.
    runConversation: () => {},
  };
  assertEquals(isDetailClickIntent(illegal as ClickIntent), true);
  assertEquals(isDetailClickIntent(conversational as ClickIntent), true);
});
