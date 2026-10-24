import { assertEquals } from "@std/assert";
import { createActiveContextController } from "./active-context-controller.ts";
import { createActiveContextPolicy } from "./active-context.ts";
import { config, host, item } from "./testing/fixtures_test.ts";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => resolve = r);
  return { promise, resolve };
}
async function tick() {
  await Promise.resolve();
  await Promise.resolve();
}
Deno.test("controller publishes desired immediately and shared chips only after ACK", async () => {
  const ack = deferred<unknown>();
  const h = host();
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return ack.promise;
  };
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const operation = c.actionsForScope("root").activate(item("a"));
  assertEquals(c.getSnapshot().desiredSelections.length, 1);
  assertEquals(c.getSnapshot().selections.length, 0);
  assertEquals(c.getSnapshot().pending, true);
  ack.resolve({});
  assertEquals(await operation, "context");
  assertEquals(c.getSnapshot().selections.length, 1);
  assertEquals(c.getSnapshot().pending, false);
});
Deno.test("queued toggles use desired intent and writes cannot overtake an ACK", async () => {
  const ack = deferred<unknown>();
  const h = host();
  let index = 0;
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return index++ === 0 ? ack.promise : Promise.resolve({});
  };
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const a = c.actionsForScope("root");
  const one = a.toggle(item("a"));
  const two = a.toggle(item("a"));
  await tick();
  assertEquals(h.calls.length, 1);
  assertEquals(c.getSnapshot().desiredSelections, []);
  ack.resolve({});
  await Promise.all([one, two]);
  assertEquals(h.calls.length, 2);
  assertEquals(c.getSnapshot().selections, []);
});
Deno.test("failure preserves confirmed chips and desired intent; retry writes desired and later success clears failure", async () => {
  const h = host();
  let fail = false;
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return Promise.resolve(fail ? { isError: true } : {});
  };
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const a = c.actionsForScope("root");
  await a.activate(item("a"));
  fail = true;
  await a.activate(item("b"));
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["a"]);
  assertEquals(c.getSnapshot().desiredSelections.map((s) => s.item.id), ["a", "b"]);
  assertEquals(c.getSnapshot().error?.code, "host-rejection");
  fail = false;
  assertEquals(await c.retry(), "shared");
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["a", "b"]);
  assertEquals(c.getSnapshot().error, null);
  fail = true;
  await a.activate(item("c"));
  fail = false;
  await a.activate(item("d"));
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["a", "b", "c", "d"]);
  assertEquals(c.getSnapshot().failed, false);
});
Deno.test("root change commits in-flight host truth until clear ACK, rejects stale actions including clear", async () => {
  const first = deferred<unknown>();
  const clear = deferred<unknown>();
  const h = host();
  let index = 0;
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return index++ === 0 ? first.promise : clear.promise;
  };
  const c = createActiveContextController(h.app, "old", createActiveContextPolicy(config));
  const old = c.actionsForScope("old");
  const activation = old.activate(item("a"));
  await tick();
  c.setScope("new");
  assertEquals(await old.clear(), "superseded");
  assertEquals(await old.activate(item("b")), "superseded");
  first.resolve({});
  assertEquals(await activation, "superseded");
  await tick();
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["a"]);
  assertEquals(c.getSnapshot().desiredSelections, []);
  clear.resolve({});
  await c.clearPreviousScope();
  assertEquals(c.getSnapshot().selections, []);
  assertEquals(h.calls.length, 2);
});
Deno.test("failed root clear remains retryable and new root action never resends old members", async () => {
  const h = host();
  let fail = false;
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return Promise.resolve(fail ? { isError: true } : {});
  };
  const c = createActiveContextController(h.app, "old", createActiveContextPolicy(config));
  await c.actionsForScope("old").activate(item("old-item"));
  fail = true;
  c.setScope("new");
  await c.clearPreviousScope();
  assertEquals(c.getSnapshot().selections[0].item.id, "old-item");
  assertEquals(c.getSnapshot().desiredSelections, []);
  fail = false;
  assertEquals(await c.retry(), "cleared");
  await c.actionsForScope("new").activate(item("new-item"));
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["new-item"]);
});
Deno.test("late reversible undo replays newer gestures and refresh intent without restoring removed data", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const a = c.actionsForScope("root");
  await a.activate(item("a"));
  const revert = await a.toggleReversible(item("a"));
  await a.activate(item("b"));
  await a.reconcileGroup("parts", [item("b")]);
  assertEquals(await revert!(), true);
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["b"]);
  revert!.release?.();
});
Deno.test("undo restores an evicted member while retaining later selections and release seals the journal", async () => {
  const h = host();
  const p = createActiveContextPolicy({ ...config, maxItems: 2 });
  const c = createActiveContextController(h.app, "root", p);
  const a = c.actionsForScope("root");
  await a.activate(item("a"));
  await a.activate(item("b"));
  const revert = await a.activateReversible(item("c"));
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["b", "c"]);
  assertEquals(await revert!(), true);
  assertEquals(c.getSnapshot().selections.map((s) => s.item.id), ["a", "b"]);
  revert!.release?.();
});
Deno.test("batch selects 50 raw members but sends exactly one query; group reconciliation is isolated", async () => {
  let queries = 0;
  const h = host();
  const p = createActiveContextPolicy({
    ...config,
    query: (items) => {
      queries++;
      return config.query!(items);
    },
  });
  const c = createActiveContextController(h.app, "root", p);
  const a = c.actionsForScope("root");
  await a.select(Array.from({ length: 50 }, (_, i) => item(String(i), i < 25 ? "one" : "two")));
  assertEquals(queries, 1);
  assertEquals(c.getSnapshot().selections.length, 50);
  assertEquals((h.calls[0].structuredContent?.items as unknown[]).length, 1);
  await a.reconcileGroup("one", []);
  assertEquals(c.getSnapshot().selections.length, 25);
  await a.select([item("25")], "remove");
  assertEquals(c.getSnapshot().selections.length, 24);
});
Deno.test("listener exceptions never reinterpret a successful host ACK and remount subscriptions retain state", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  let observed = 0;
  c.subscribe(() => {
    throw new Error("render failure");
  });
  const unsubscribe = c.subscribe(() => observed++);
  assertEquals(await c.actionsForScope("root").activate(item("a")), "context");
  unsubscribe();
  c.subscribe(() => observed++);
  assertEquals(c.getSnapshot().selections.length, 1);
  assertEquals(c.getSnapshot().failed, false);
  assertEquals(observed > 0, true);
});
Deno.test("two controllers on one App share transport serialization", async () => {
  const ack = deferred<unknown>();
  const h = host();
  let index = 0;
  h.app.updateModelContext = (params) => {
    h.calls.push(params);
    return index++ === 0 ? ack.promise : Promise.resolve({});
  };
  const p = createActiveContextPolicy(config);
  const one = createActiveContextController(h.app, "root", p);
  const two = createActiveContextController(h.app, "root", p);
  const a = one.actionsForScope("root").activate(item("a"));
  const b = two.actionsForScope("root").activate(item("b"));
  await tick();
  assertEquals(h.calls.length, 1);
  ack.resolve({});
  await Promise.all([a, b]);
  assertEquals(h.calls.length, 2);
});
Deno.test("unsupported controller remains neutral, retains no optimistic shared state and sends no message", async () => {
  const h = host({});
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  assertEquals(await c.actionsForScope("root").activate(item("a")), "unsupported");
  assertEquals(c.getSnapshot().failed, false);
  assertEquals(c.getSnapshot().pending, false);
  assertEquals(c.getSnapshot().selections, []);
  assertEquals(h.calls.length, 0);
});
Deno.test("invalid projection becomes visible error without mutating ACK state", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  await c.actionsForScope("root").activate(item("a"));
  await c.actionsForScope("root").activate(item("x".repeat(81)));
  assertEquals(h.calls.length, 1);
  assertEquals(c.getSnapshot().error?.code, "invalid-snapshot");
  assertEquals(c.getSnapshot().selections.length, 1);
});
Deno.test("explicit teardown clears once; stale handles and disposed controller cannot write", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const a = c.actionsForScope("root");
  await a.activate(item("a"));
  assertEquals(await c.dispose(), "cleared");
  assertEquals(await a.activate(item("b")), "superseded");
  assertEquals(await c.retry(), "superseded");
  assertEquals(h.calls.length, 2);
});

Deno.test("controller rejects oversized attachment visibly and preserves confirmed bytes on omitted resource", async () => {
  const h = host({ structuredContent: {}, resource: {} });
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const a = c.actionsForScope("root");
  const resource = { uri: "local:a", mimeType: "text/plain", bytes: new Uint8Array([1]) };
  await a.activate({ ...item("a"), resource });
  await a.activate({ ...item("b"), resource: { ...resource, bytes: new Uint8Array(21) } });
  assertEquals(c.getSnapshot().error?.code, "resource-too-large");
  assertEquals(h.calls.length, 1);
  assertEquals(c.getSnapshot().selections[0].item.resource, resource);
  await a.activate({ ...item("a"), label: "Updated" });
  assertEquals(c.getSnapshot().selections[0].item.resource, resource);
  await a.activate({ ...item("a"), resource: undefined });
  assertEquals(c.getSnapshot().selections[0].item.resource, undefined);
});
