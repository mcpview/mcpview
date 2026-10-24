import { assert, assertEquals } from "@std/assert";
import { createActiveContextController } from "./active-context-controller.ts";
import {
  type ActiveContextHost,
  type ActiveContextHostCapabilities,
  type ActiveContextPolicyConfig,
  type ActiveContextSelection,
  type ContextSelectionItem,
  createActiveContextPolicy,
} from "./active-context.ts";
import { activateContext } from "./active-context-flow.ts";

function policy(overrides: Partial<ActiveContextPolicyConfig> = {}) {
  return createActiveContextPolicy({
    schema: "test/context-races",
    version: 1,
    maxItems: 5,
    maxResourceBytes: 1024,
    maxTextFallbackBytes: 512,
    limits: {
      id: 80,
      view: 80,
      label: 80,
      value: 100,
      resourceUri: 100,
      resourceMimeType: 80,
    },
    ...overrides,
  });
}

function item(id: string, value = "original"): ContextSelectionItem {
  return { id, view: "Race fixture", label: id, value, reconcileKey: "rows" };
}

type Update = Parameters<ActiveContextHost["updateModelContext"]>[0];
interface HostCall {
  params: Update;
  accept(): void;
  reject(): void;
}

function controlledHost(initiallySupported = true) {
  let supported = initiallySupported;
  const calls: HostCall[] = [];
  const messages: unknown[] = [];
  const host: ActiveContextHost & { sendMessage(message: unknown): Promise<void> } = {
    getHostCapabilities(): ActiveContextHostCapabilities {
      return supported ? { updateModelContext: { structuredContent: {} } } : {};
    },
    updateModelContext(params) {
      return new Promise((resolve, reject) => {
        calls.push({
          params,
          accept: () => resolve({}),
          reject: () => reject(new Error("host refused this update")),
        });
      });
    },
    sendMessage(message) {
      messages.push(message);
      return Promise.resolve();
    },
  };
  return { host, calls, messages, setSupported: (next: boolean) => supported = next };
}

/** Let already queued promise operations start; no clock or network is involved. */
async function queued() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
}

async function callAt(calls: HostCall[], index: number): Promise<HostCall> {
  await queued();
  assert(calls[index], `Expected host update ${index + 1}, observed ${calls.length}`);
  return calls[index];
}

function sentItems(call: HostCall): Array<{ id: string; value?: string }> {
  return call.params.structuredContent?.items as Array<{ id: string; value?: string }>;
}

function selectedIds(selections: ActiveContextSelection[]): string[] {
  return selections.map((selection) => selection.item.id);
}

Deno.test("controller races - failed undo cannot resurrect A after a newer queued B succeeds or retries", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy());
  const actions = controller.actionsForScope("root");
  const committedA = actions.activateReversible(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  const undoA = await committedA;
  assert(undoA);

  const undoingA = undoA();
  const undoCall = await callAt(fixture.calls, 1);
  assertEquals(sentItems(undoCall), []);
  const addingB = actions.select([item("B")], "add");
  undoCall.reject();
  assertEquals(await undoingA, false);
  const bCall = await callAt(fixture.calls, 2);
  assertEquals(sentItems(bCall).map((entry) => entry.id), ["B"]);
  bCall.accept();
  assertEquals(await addingB, "shared");
  const beforeRetry = controller.getSnapshot();

  const retrying = controller.retry();
  const retryCall = await callAt(fixture.calls, 3);
  const retryIds = sentItems(retryCall).map((entry) => entry.id);
  retryCall.accept();
  assertEquals(await retrying, "shared");
  const afterRetry = controller.getSnapshot();
  assertEquals({
    desiredBefore: selectedIds(beforeRetry.desiredSelections),
    confirmedBefore: selectedIds(beforeRetry.selections),
    retryIds,
    desiredAfter: selectedIds(afterRetry.desiredSelections),
    confirmedAfter: selectedIds(afterRetry.selections),
  }, {
    desiredBefore: ["B"],
    confirmedBefore: ["B"],
    retryIds: ["B"],
    desiredAfter: ["B"],
    confirmedAfter: ["B"],
  });
  undoA.release?.();
});

Deno.test("controller races - an older ACK must preserve a newer synchronous capacity failure", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(
    fixture.host,
    "root",
    policy({ maxItems: 1, onFull: "reject" }),
  );
  const actions = controller.actionsForScope("root");
  const addingA = actions.activate(item("A"));
  const aCall = await callAt(fixture.calls, 0);
  assertEquals(await actions.activate(item("B")), "none");
  const failure = controller.getSnapshot().error;
  assert(failure);
  assertEquals(controller.getSnapshot().failed, true);
  aCall.accept();
  assertEquals(await addingA, "context");
  assertEquals(fixture.calls.length, 1);
  const state = controller.getSnapshot();
  assertEquals({
    ids: selectedIds(state.selections),
    failed: state.failed,
    error: state.error,
    pending: state.pending,
  }, { ids: ["A"], failed: true, error: failure, pending: false });
});

Deno.test("controller races - retry after an unsupported root switch cannot resend old-root intent", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "old", policy());
  const selecting = controller.actionsForScope("old").activate(item("old-item"));
  (await callAt(fixture.calls, 0)).accept();
  assertEquals(await selecting, "context");
  fixture.setSupported(false);
  controller.setScope("new");
  assertEquals(await controller.clearPreviousScope(), "unsupported");
  const beforeRetry = controller.getSnapshot();

  fixture.setSupported(true);
  const retrying = controller.retry();
  const retried = await callAt(fixture.calls, 1);
  const retryItems = sentItems(retried);
  retried.accept();
  await retrying;
  assertEquals({
    desiredAfterSwitch: selectedIds(beforeRetry.desiredSelections),
    confirmedBeforeRetry: selectedIds(beforeRetry.selections),
    retryItems,
    confirmedAfterRetry: selectedIds(controller.getSnapshot().selections),
    messages: fixture.messages,
  }, {
    desiredAfterSwitch: [],
    confirmedBeforeRetry: ["old-item"],
    retryItems: [],
    confirmedAfterRetry: [],
    messages: [],
  });
});

Deno.test("controller races - unsupported context never starts an automatic conversation", async () => {
  const fixture = controlledHost(false);
  const contextPolicy = policy();
  const controller = createActiveContextController(fixture.host, "root", contextPolicy);
  const actions = controller.actionsForScope("root");
  assertEquals(await actions.activate(item("A")), "unsupported");
  assertEquals(
    await activateContext(
      fixture.host,
      [item("A")],
      contextPolicy,
    ),
    "unsupported",
  );
  assertEquals(fixture.calls, []);
  assertEquals(fixture.messages, []);
  assertEquals(controller.getSnapshot().selections, []);
  assertEquals(controller.getSnapshot().desiredSelections, []);
});

Deno.test("controller races - undo preserves a later explicit update to the same item", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy());
  const actions = controller.actionsForScope("root");
  const selecting = actions.activateReversible(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  const undo = await selecting;
  assert(undo);
  const updating = actions.activate(item("A", "fresh"));
  (await callAt(fixture.calls, 1)).accept();
  assertEquals(await updating, "context");
  assertEquals(await undo(), true);
  assertEquals(
    fixture.calls.length,
    2,
    "No host write is needed when the later update already wins",
  );
  assertEquals(controller.getSnapshot().selections[0]?.item.value, "fresh");
  assertEquals(controller.getSnapshot().desiredSelections[0]?.item.value, "fresh");
  undo.release?.();
});

Deno.test("controller races - undo preserves a later same-item removal", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy());
  const actions = controller.actionsForScope("root");
  const selecting = actions.activateReversible(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  const undo = await selecting;
  assert(undo);
  const removing = actions.remove(controller.getSnapshot().selections[0]);
  (await callAt(fixture.calls, 1)).accept();
  assertEquals(await removing, "cleared");
  assertEquals(await undo(), true);
  assertEquals(fixture.calls.length, 2);
  assertEquals(controller.getSnapshot().selections, []);
  assertEquals(controller.getSnapshot().desiredSelections, []);
  undo.release?.();
});

Deno.test("controller races - undoing removal replays a later no-op reconcile refresh", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy());
  const actions = controller.actionsForScope("root");
  const initial = actions.activate(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  await initial;
  const removing = actions.toggleReversible(item("A"));
  (await callAt(fixture.calls, 1)).accept();
  const undo = await removing;
  assert(undo);
  assertEquals(await actions.reconcile([item("A", "refreshed")]), "unchanged");
  const undoing = undo();
  const restored = await callAt(fixture.calls, 2);
  assertEquals(sentItems(restored).map(({ id, value }) => ({ id, value })), [
    { id: "A", value: "refreshed" },
  ]);
  restored.accept();
  assertEquals(await undoing, true);
  assertEquals(controller.getSnapshot().desiredSelections[0]?.item.value, "refreshed");
  assertEquals(controller.getSnapshot().selections[0]?.item.value, "refreshed");
  undo.release?.();
});

Deno.test("controller races - undoing removal cannot resurrect an item excluded by later no-op reconcile", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy());
  const actions = controller.actionsForScope("root");
  const initial = actions.activate(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  await initial;
  const removing = actions.toggleReversible(item("A"));
  (await callAt(fixture.calls, 1)).accept();
  const undo = await removing;
  assert(undo);
  assertEquals(await actions.reconcile([]), "unchanged");
  assertEquals(await undo(), true);
  assertEquals(fixture.calls.length, 2);
  assertEquals(controller.getSnapshot().selections, []);
  assertEquals(controller.getSnapshot().desiredSelections, []);
  undo.release?.();
});

Deno.test("controller races - undo writes compensation when queued replacements can overwrite the matching ACK", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(fixture.host, "root", policy({ maxItems: 2 }));
  const actions = controller.actionsForScope("root");
  const initial = actions.activate(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  await initial;
  const addingB = actions.activateReversible(item("B"));
  (await callAt(fixture.calls, 1)).accept();
  const undo = await addingB;
  assert(undo);
  const addingC = actions.activate(item("C"));
  const removingC = actions.toggle(item("C"));
  const readdingB = actions.activate(item("B"));
  const undoing = undo();
  assertEquals(selectedIds(controller.getSnapshot().desiredSelections), ["A", "B"]);
  for (const index of [2, 3, 4]) (await callAt(fixture.calls, index)).accept();
  const compensation = await callAt(fixture.calls, 5);
  assertEquals(sentItems(compensation).map(({ id }) => id), ["A", "B"]);
  compensation.accept();
  assertEquals(await undoing, true);
  await Promise.all([addingC, removingC, readdingB]);
  assertEquals(selectedIds(controller.getSnapshot().selections), ["A", "B"]);
  assertEquals(controller.getSnapshot().failed, false);
  undo.release?.();
});

Deno.test("controller races - rejected undo leaves its journal intact for release and clear", async () => {
  const fixture = controlledHost();
  const controller = createActiveContextController(
    fixture.host,
    "root",
    policy({ maxItems: 1, onFull: "reject" }),
  );
  const actions = controller.actionsForScope("root");
  const initial = actions.activate(item("A"));
  (await callAt(fixture.calls, 0)).accept();
  await initial;
  const removing = actions.toggleReversible(item("A"));
  (await callAt(fixture.calls, 1)).accept();
  const undo = await removing;
  assert(undo);
  const addingB = actions.activate(item("B"));
  (await callAt(fixture.calls, 2)).accept();
  await addingB;
  assertEquals(await undo(), false);
  assertEquals(controller.getSnapshot().failed, true);
  assertEquals(controller.getSnapshot().error?.code, "invalid-snapshot");
  assertEquals(selectedIds(controller.getSnapshot().desiredSelections), ["B"]);
  assertEquals(selectedIds(controller.getSnapshot().selections), ["B"]);
  assertEquals(fixture.calls.length, 3);
  // A second attempt must still fail, proving the failed attempt did not
  // deactivate the mutation or silently report an already-undone success.
  assertEquals(await undo(), false);
  undo.release?.();
  const clearing = actions.clear();
  (await callAt(fixture.calls, 3)).accept();
  assertEquals(await clearing, "cleared");
  assertEquals(controller.getSnapshot().failed, false);
  assertEquals(controller.getSnapshot().desiredSelections, []);
});
