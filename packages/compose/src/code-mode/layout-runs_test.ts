import { assertEquals, assertNotEquals, assertRejects, assertThrows } from "@std/assert";
import { BoardLayoutRuns } from "./layout-runs.ts";

const panels = new Map([["revenue", []], ["margin", [380, 640]]]);
const scope = "workspace:alice";
function arrangement() {
  return {
    version: 1 as const,
    order: ["margin", "revenue"],
    widths: [{ panel: "margin", width: 640 }],
    placements: [{ panel: "margin", beside: "revenue", side: "left" as const }],
  };
}

Deno.test("layout drafts are scoped, name-bound and only accept widths declared for each panel", () => {
  const runs = new BoardLayoutRuns();
  const id = "test-run";
  runs.open(scope, id, panels);
  const layout = arrangement();
  assertThrows(() => runs.stage("other", id, 1, layout));
  assertThrows(() => runs.open("other", id, panels), Error, "already registered");
  assertThrows(() =>
    runs.stage(scope, id, 1, { ...layout, widths: [{ panel: "revenue", width: 640 }] })
  );
  assertThrows(() => runs.stage(scope, id, 1, { ...layout, order: ["margin"] }));
  assertThrows(() => runs.stage(scope, id, 1, { ...layout, basket: ["October"] }));
  assertEquals(runs.stage(scope, id, 1, layout), { runId: id, revision: 1 });
  assertThrows(() => runs.selected(scope, id));
  assertThrows(() => runs.selected(scope, id, 1, "Monday"));
  runs.saved("other", id, "Monday");
  assertThrows(() => runs.selected(scope, id, 1, "Monday"));
  runs.saved(scope, id, "Monday");
  assertThrows(() => runs.selected(scope, id, 1, "Tuesday"));
  assertEquals(runs.selected(scope, id, 1, "Monday"), layout);
  const revised = { ...layout, order: ["revenue", "margin"] };
  runs.stage(scope, id, 2, revised);
  runs.stage(scope, id, 2, { ...revised, widths: [{ width: 640, panel: "margin" }] });
  assertThrows(() => runs.stage(scope, id, 2, layout), Error, "stale");
  assertThrows(() => runs.stage(scope, id, 1, layout), Error, "stale");
  assertThrows(() => runs.selected("other", id, 2, "Monday"));
  assertThrows(() => runs.selected(scope, id, 1, "Monday"));
  revised.order.reverse();
  assertNotEquals(runs.selected(scope, id, 2, "Monday")?.order, revised.order);
});

Deno.test("replays validate the saved layout against today's widths and keep a separate revision history", () => {
  const runs = new BoardLayoutRuns({ maxPendingReferences: 2 });
  const initial = arrangement();
  const restored = runs.open(scope, "first", panels, "Monday", initial);
  assertEquals(restored, initial);
  initial.widths[0].width = 380;
  assertEquals(runs.selected(scope, "first"), restored);
  const changed = new Map(panels).set("margin", [380]);
  assertEquals(runs.open(scope, "second", changed, "Monday", restored), undefined);
  runs.stage(scope, "second", 1, initial);
  assertThrows(() => runs.selected(scope, "second", 1, "Tuesday"));
  assertEquals(runs.selected(scope, "second", 1, "Monday"), initial);
  runs.open(scope, "third", panels);
  assertThrows(() => runs.stage(scope, "first", 1, initial), Error, "expired");
});

Deno.test("a lost update receipt is retried without undoing a later save in another chat", async () => {
  const runs = new BoardLayoutRuns<string>();
  for (const id of ["chat-a", "chat-b"]) {
    runs.open(scope, id, panels, "Monday");
    runs.stage(scope, id, 1, arrangement());
  }
  const writes: string[] = [];
  const update = (id: string) =>
    runs.commitUpdate(scope, id, 1, "Monday", () => {
      writes.push(id);
      return Promise.resolve("receipt-" + id);
    });
  assertEquals(await update("chat-a"), "receipt-chat-a");
  assertEquals(await update("chat-b"), "receipt-chat-b");
  assertEquals(await update("chat-a"), "receipt-chat-a");
  assertEquals(writes, ["chat-a", "chat-b"]);
});

Deno.test("concurrent retries share one write, revisions finish in order and a failed write can retry", async () => {
  const runs = new BoardLayoutRuns<number>();
  runs.open(scope, "run", panels, "Monday");
  runs.stage(scope, "run", 1, arrangement());
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const writes: number[] = [];
  const slow = () =>
    runs.commitUpdate(scope, "run", 1, "Monday", async () => {
      writes.push(1);
      started.resolve();
      await release.promise;
      return 1;
    });
  const first = slow(), duplicate = slow();
  await started.promise;
  runs.stage(scope, "run", 2, arrangement());
  const second = runs.commitUpdate(scope, "run", 2, "Monday", () => {
    writes.push(2);
    return Promise.resolve(2);
  });
  assertEquals(writes, [1]);
  release.resolve();
  assertEquals(await Promise.all([first, duplicate, second]), [1, 1, 2]);
  assertEquals(writes, [1, 2]);
  runs.stage(scope, "run", 3, arrangement());
  await assertRejects(
    () =>
      runs.commitUpdate(scope, "run", 3, "Monday", () => {
        return Promise.reject(new Error("disk unavailable"));
      }),
    Error,
    "disk unavailable",
  );
  assertEquals(await runs.commitUpdate(scope, "run", 3, "Monday", () => Promise.resolve(3)), 3);
});
