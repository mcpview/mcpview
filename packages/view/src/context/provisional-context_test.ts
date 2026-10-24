import { assert, assertEquals } from "@std/assert";
import { createActiveContextController } from "./active-context-controller.ts";
import { createActiveContextPolicy } from "./active-context.ts";
import {
  type ClickIntentSchedule,
  type ContextClickIntent,
  createClickIntentArbiter,
} from "./click-intent.ts";
import { config, host, item } from "./testing/fixtures_test.ts";

function clock() {
  let now = 0;
  const tasks: Array<{ at: number; run(): void; cancelled: boolean }> = [];
  const schedule: ClickIntentSchedule = (run, delay) => {
    const task = { at: now + delay, run, cancelled: false };
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
function setup(options: { maxItems?: number; onFull?: "reject"; delay?: number } = {}) {
  const h = host();
  const acknowledgements: Array<(result: unknown) => void> = [];
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return new Promise((resolve) => acknowledgements.push(resolve));
  };
  const controller = createActiveContextController(
    h.app,
    "root",
    createActiveContextPolicy({
      ...config,
      maxItems: options.maxItems ?? 5,
      onFull: options.onFull,
      documentContains: (documentId, itemId) => documentId === itemId,
    }),
  );
  const actions = controller.actionsForScope("root");
  const timer = clock();
  const arbiter = createClickIntentArbiter({
    schedule: timer.schedule,
    doubleClickDelayMs: options.delay,
  });
  const details: string[] = [];
  function intent(id: string): ContextClickIntent {
    return {
      key: id,
      scope: "root",
      onPreview: () => actions.previewToggle(item(id)),
      onSingle: () => actions.toggle(item(id)).then(() => undefined),
      onDouble: () => details.push(id),
    };
  }
  async function tick() {
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  }
  async function accept(index: number, result: unknown = {}) {
    await tick();
    assert(acknowledgements[index], `Missing host call ${index}`);
    acknowledgements[index](result);
    await tick();
  }
  const desired = () => controller.getSnapshot().desiredSelections.map((s) => s.item.id);
  const confirmed = () => controller.getSnapshot().selections.map((s) => s.item.id);
  const sent = (index: number) =>
    (h.calls[index].structuredContent?.items as Array<{ id: string }>).map((s) => s.id);
  return {
    ...h,
    controller,
    actions,
    timer,
    arbiter,
    details,
    intent,
    tick,
    accept,
    desired,
    confirmed,
    sent,
  };
}

Deno.test("provisional context - pointer feedback is immediate; double at 200ms restores intent without a write", async () => {
  const f = setup();
  const intent = f.intent("A");
  f.arbiter.click(intent);
  assertEquals(f.desired(), ["A"]);
  assertEquals(f.actions.selectionState("A"), "adding");
  assertEquals(f.actions.isSelected(item("A")), false);
  assertEquals(f.controller.getSnapshot().pending, true);
  await f.controller.settled(); // Unresolved previews do not block transport settlement.
  assertEquals(f.calls.length, 0);
  f.timer.advance(200);
  f.arbiter.click(intent, 2);
  assertEquals(f.desired(), []);
  assertEquals(f.controller.getSnapshot().pending, false);
  f.arbiter.doubleClick(intent);
  f.timer.advance(1000);
  await f.tick();
  assertEquals(f.calls.length, 0);
  assertEquals(f.details, ["A"]);
  assertEquals(f.actions.selectionState("A"), "none");
});

Deno.test("provisional context - default 500ms commit keeps adding until ACK and double removal preserves shared truth", async () => {
  const f = setup();
  const intent = f.intent("A");
  f.arbiter.click(intent);
  f.timer.advance(499);
  await f.tick();
  assertEquals(f.calls.length, 0);
  f.timer.advance(1);
  await f.tick();
  assertEquals(f.sent(0), ["A"]);
  assertEquals(f.confirmed(), []);
  assertEquals(f.actions.selectionState(item("A")), "adding");
  assertEquals(f.controller.getSnapshot().pending, true);
  await f.accept(0);
  assertEquals(f.actions.selectionState("A"), "selected");
  assertEquals(f.controller.getSnapshot().pending, false);
  f.arbiter.click(intent);
  assertEquals(f.desired(), []);
  assertEquals(f.confirmed(), ["A"]);
  assertEquals(f.actions.isSelected(item("A")), true);
  assertEquals(f.actions.selectionState("A"), "removing");
  f.timer.advance(200);
  f.arbiter.doubleClick(intent);
  assertEquals(f.desired(), ["A"]);
  assertEquals(f.actions.selectionState("A"), "selected");
  assertEquals(f.controller.getSnapshot().pending, false);
  f.timer.advance(500);
  await f.tick();
  assertEquals(f.calls.length, 1);
});

Deno.test("provisional context - overlapping previews never leak into normal writes, retries, or earlier commits", async () => {
  const f = setup();
  f.arbiter.click(f.intent("A"));
  f.timer.advance(100);
  f.arbiter.click(f.intent("B"));
  const addingC = f.actions.activate(item("C"));
  await f.tick();
  assertEquals(f.desired(), ["A", "B", "C"]);
  assertEquals(f.sent(0), ["C"]);
  await f.accept(0);
  await addingC;
  assertEquals(f.confirmed(), ["C"]);
  assertEquals(f.controller.getSnapshot().pending, true);
  const retrying = f.controller.retry();
  await f.tick();
  assertEquals(f.sent(1), ["C"]);
  await f.accept(1);
  await retrying;
  f.timer.advance(400);
  await f.tick();
  assertEquals(f.sent(2), ["A", "C"]);
  f.timer.advance(100);
  await f.tick();
  assertEquals(f.calls.length, 3, "B must wait for the earlier host ACK");
  await f.accept(2);
  assertEquals(f.sent(3), ["A", "B", "C"]);
  await f.accept(3);
  assertEquals(f.confirmed(), ["A", "B", "C"]);
  assertEquals(f.desired(), f.confirmed());
  assertEquals(f.controller.getSnapshot().pending, false);
});

Deno.test("provisional context - cancel one overlapping preview preserves another and in-flight normal write", async () => {
  const f = setup();
  const a = f.intent("A");
  f.arbiter.click(a);
  f.arbiter.click(f.intent("B"));
  const addingC = f.actions.activate(item("C"));
  await f.tick();
  f.timer.advance(200);
  f.arbiter.doubleClick(a);
  assertEquals(f.desired(), ["B", "C"]);
  assertEquals(f.controller.getSnapshot().pending, true);
  assertEquals(f.sent(0), ["C"]);
  f.timer.advance(300);
  await f.accept(0);
  await addingC;
  assertEquals(f.sent(1), ["B", "C"]);
  await f.accept(1);
  assertEquals(f.confirmed(), ["B", "C"]);
  assertEquals(f.actions.selectionState("A"), "none");
});

Deno.test("provisional context - host rejection keeps desired intent visible, retry excludes another preview", async () => {
  const f = setup();
  f.arbiter.click(f.intent("A"));
  f.timer.advance(500);
  await f.accept(0, { isError: true });
  assertEquals(f.actions.selectionState("A"), "adding");
  assertEquals(f.controller.getSnapshot().failed, true);
  assertEquals(f.controller.getSnapshot().pending, false);
  f.arbiter.click(f.intent("B"));
  const retrying = f.controller.retry();
  await f.tick();
  assertEquals(f.sent(1), ["A"]);
  f.arbiter.cancelAll();
  assertEquals(f.desired(), ["A"]);
  await f.accept(1);
  await retrying;
  assertEquals(f.actions.selectionState("A"), "selected");
  assertEquals(f.actions.selectionState("B"), "none");
  assertEquals(f.controller.getSnapshot().failed, false);
});

Deno.test("provisional context - scope replacement, clear, and disposal invalidate receipts without residual pending", async () => {
  for (const action of ["scope", "clear", "dispose"] as const) {
    const f = setup();
    const receipt = f.actions.previewToggle(item("A"));
    const operation = action === "scope"
      ? (f.controller.setScope("new"), f.controller.clearPreviousScope())
      : action === "clear"
      ? f.actions.clear()
      : f.controller.dispose();
    assertEquals(f.desired(), []);
    assertEquals(f.actions.selectionState("A"), "none");
    receipt.cancel();
    await receipt.commit();
    await f.accept(0);
    await operation;
    assertEquals(f.sent(0), []);
    assertEquals(f.calls.length, 1);
    assertEquals(f.controller.getSnapshot().pending, false);
  }
});

Deno.test("provisional context - arbiter cancellation cleans local pending and stale scheduled callbacks", async () => {
  for (const method of ["cancel", "cancelScope", "cancelAll", "dispose"] as const) {
    const f = setup();
    f.arbiter.click(f.intent("A"));
    if (method === "cancel") f.arbiter.cancel("A", "root");
    else if (method === "cancelScope") f.arbiter.cancelScope("root");
    else f.arbiter[method]();
    for (const task of f.timer.tasks) task.run();
    await f.tick();
    assertEquals(f.desired(), []);
    assertEquals(f.controller.getSnapshot().pending, false);
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("provisional context - capacity rejection is transactional and cancellation of dependent previews cannot stick", async () => {
  const f = setup({ maxItems: 1, onFull: "reject" });
  const initial = f.actions.activate(item("A"));
  await f.accept(0);
  await initial;
  const removing = f.actions.previewToggle(item("A"));
  // A normal host update may not depend on an uncommitted removal of A.
  assertEquals(await f.actions.activate(item("B")), "none");
  assertEquals(f.desired(), []);
  assertEquals(f.calls.length, 1);
  const adding = f.actions.previewToggle(item("B"));
  assertEquals(f.desired(), ["B"]);
  removing.cancel();
  assertEquals(f.desired(), ["A"]);
  assertEquals(f.controller.getSnapshot().pending, false);
  await adding.commit();
  assertEquals(f.calls.length, 1);
  const clearing = f.actions.clear();
  await f.accept(1);
  assertEquals(await clearing, "cleared");
});

Deno.test("provisional context - configured delay, keyboard and assistive clicks retain immediate host behavior", async () => {
  const f = setup({ delay: 900 });
  f.arbiter.click(f.intent("A"));
  f.timer.advance(500);
  await f.tick();
  assertEquals(f.calls.length, 0);
  f.arbiter.keyDown(f.intent("A"), { key: " ", preventDefault() {} });
  await f.tick();
  assertEquals(f.sent(0), ["A"]);
  await f.accept(0);
  f.arbiter.click(f.intent("B"), 0);
  await f.tick();
  assertEquals(f.sent(1), ["A", "B"]);
  await f.accept(1);
  f.timer.advance(1000);
  assertEquals(f.calls.length, 2);
  f.arbiter.dispose();
});

Deno.test("provisional context - explicit removal or reconciliation still writes when preview already removed desired membership", async () => {
  for (
    const method of [
      "remove",
      "reconcile",
      "reconcileGroup",
      "reconcileDocument",
      "hostRemoval",
    ] as const
  ) {
    const f = setup();
    const initial = f.actions.activate(item("A"));
    await f.accept(0);
    await initial;
    const selected = f.controller.getSnapshot().selections[0];
    const preview = f.actions.previewToggle(item("A"));
    const removal = method === "remove"
      ? f.actions.remove(selected)
      : method === "reconcile"
      ? f.actions.reconcile([])
      : method === "reconcileGroup"
      ? f.actions.reconcileGroup("parts", [])
      : method === "hostRemoval"
      ? f.controller.reconcileHostRemoval(["A"])
      : f.actions.reconcileDocument("A", []);
    await f.tick();
    assertEquals(f.sent(1), []);
    preview.cancel();
    assertEquals(f.desired(), []);
    assertEquals(f.controller.getSnapshot().pending, true);
    await f.accept(1);
    assertEquals(await removal, "cleared");
    assertEquals(f.confirmed(), []);
    assertEquals(f.controller.getSnapshot().pending, false);
    await preview.commit();
    assertEquals(f.calls.length, 2);
  }
});

Deno.test("provisional context - cancellation drops dependent capacity previews while preserving unrelated removal", async () => {
  const f = setup({ maxItems: 2, onFull: "reject" });
  const initial = f.actions.select([item("A"), item("B")]);
  await f.accept(0);
  await initial;
  const removingA = f.actions.previewToggle(item("A"));
  const addingC = f.actions.previewToggle(item("C"));
  const removingB = f.actions.previewToggle(item("B"));
  assertEquals(f.desired(), ["C"]);
  removingA.cancel();
  assertEquals(f.desired(), ["A"]);
  assertEquals(f.actions.selectionState("B"), "removing");
  assertEquals(f.controller.getSnapshot().pending, true);
  await addingC.commit();
  assertEquals(f.calls.length, 1);
  const committingB = removingB.commit();
  await f.accept(1);
  await committingB;
  assertEquals(f.sent(1), ["A"]);
  assertEquals(f.confirmed(), ["A"]);
  assertEquals(f.controller.getSnapshot().pending, false);
});

Deno.test("provisional context - interleaved same-target sequences retain their own deadlines", async () => {
  for (const initiallySelected of [false, true]) {
    const f = setup();
    if (initiallySelected) {
      const initial = f.actions.activate(item("A"));
      await f.accept(0);
      await initial;
    }
    const offset = f.calls.length;
    f.arbiter.click(f.intent("A"), 1);
    f.timer.advance(100);
    f.arbiter.click(f.intent("B"), 1);
    f.timer.advance(100);
    f.arbiter.click(f.intent("A"), 1);
    assertEquals(f.desired().includes("A"), initiallySelected);
    assertEquals(f.desired().includes("B"), true);
    f.timer.advance(299); // 499: all three sequences are provisional.
    await f.tick();
    assertEquals(f.calls.length, offset);
    f.timer.advance(1); // 500: first A alone wins.
    await f.tick();
    assertEquals(f.sent(offset), initiallySelected ? [] : ["A"]);
    await f.accept(offset);
    assertEquals(f.desired().includes("A"), initiallySelected);
    f.timer.advance(99); // 599
    await f.tick();
    assertEquals(f.calls.length, offset + 1);
    f.timer.advance(1); // 600: B wins independently.
    await f.tick();
    assertEquals(f.sent(offset + 1), initiallySelected ? ["B"] : ["A", "B"]);
    await f.accept(offset + 1);
    f.timer.advance(99); // 699
    await f.tick();
    assertEquals(f.calls.length, offset + 2);
    f.timer.advance(1); // 700: second A restores its original membership.
    await f.tick();
    assertEquals(f.sent(offset + 2).sort(), initiallySelected ? ["A", "B"] : ["B"]);
    await f.accept(offset + 2);
    assertEquals(f.confirmed().sort(), initiallySelected ? ["A", "B"] : ["B"]);
    assertEquals(f.desired().sort(), f.confirmed().sort());
    assertEquals(f.controller.getSnapshot().pending, false);
    f.arbiter.dispose();
  }
});

Deno.test("context example - opening A detail preserves B's independent pending selection", async () => {
  const { createExampleInteractions } = await import("../../examples/context/src/interactions.ts");
  const f = setup();
  const details: string[] = [];
  const { intent } = createExampleInteractions(
    { ...f.actions, supported: true },
    "root",
    (record) => details.push(record.id),
  );
  f.arbiter.click(intent(item("B")), 1);
  f.timer.advance(100);
  const a = intent(item("A"));
  f.arbiter.click(a, 1);
  f.timer.advance(100);
  f.arbiter.click(a, 2);
  f.arbiter.doubleClick(a);
  assertEquals(details, ["A"]);
  assertEquals(f.desired(), ["B"]);
  f.timer.advance(299);
  await f.tick();
  assertEquals(f.calls.length, 0);
  f.timer.advance(1);
  await f.tick();
  assertEquals(f.sent(0), ["B"]);
  await f.accept(0);
  f.timer.advance(1000);
  await f.tick();
  assertEquals(f.calls.length, 1);
  assertEquals(f.confirmed(), ["B"]);
  f.arbiter.dispose();
});

Deno.test("provisional context - cancelling multiple same-target sequences preserves other targets and cleans every timer", async () => {
  for (const cleanup of ["cancelScope", "dispose"] as const) {
    const f = setup();
    f.arbiter.click(f.intent("A"), 1);
    f.timer.advance(100);
    f.arbiter.click(f.intent("B"), 1);
    f.timer.advance(100);
    const a = f.intent("A");
    f.arbiter.click(a, 1);
    f.timer.advance(100);
    f.arbiter.click(a, 2);
    f.arbiter.doubleClick(a);
    assertEquals(f.desired(), ["B"]);
    assertEquals(f.details, ["A"]);
    assertEquals(f.timer.tasks.filter((task) => !task.cancelled).length, 1);
    f.timer.advance(299);
    await f.tick();
    assertEquals(f.calls.length, 0);
    f.timer.advance(1);
    await f.accept(0);
    assertEquals(f.sent(0), ["B"]);
    f.arbiter.click(a, 1);
    f.arbiter.click(a, 1);
    f.arbiter.click(f.intent("C"), 1);
    if (cleanup === "cancelScope") f.arbiter.cancelScope("root");
    else f.arbiter.dispose();
    assertEquals(f.desired(), ["B"]);
    assertEquals(f.controller.getSnapshot().pending, false);
    assertEquals(f.timer.tasks.every((task) => task.cancelled), true);
    // Exercise callbacks even when a scheduler delivers them after cancellation.
    for (const task of f.timer.tasks) task.run();
    await f.tick();
    assertEquals(f.calls.length, 1);
    assertEquals(f.desired(), ["B"]);
    f.arbiter.dispose();
  }
});
