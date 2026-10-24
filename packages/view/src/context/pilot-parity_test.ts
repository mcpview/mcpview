import { assert, assertEquals } from "@std/assert";
import { createActiveContextController } from "./active-context-controller.ts";
import {
  type ActiveContextMutation,
  type ActiveContextSelection,
  type ContextSelectionItem,
  createActiveContextPolicy,
} from "./active-context.ts";
import { config, host, item } from "./testing/fixtures_test.ts";

// Behavioral ports of the established pilot suites, expressed through the
// generic policy/controller API. Application wire identities and group storage
// are supplied by fixtures; obsolete immediate-click compensation is excluded.
const resource = {
  uri: "local:series",
  mimeType: "application/json",
  bytes: new TextEncoder().encode("[10,20]"),
  textFallback: "[10,20]",
};

function ids(selections: readonly ActiveContextSelection[]): string[] {
  return selections.map((selection) => selection.item.id);
}

function selected(id: string, scopeKey = "root", group = "parts"): ActiveContextSelection {
  return { scopeKey, item: item(id, group) };
}

function mutationFactory(policy: ReturnType<typeof createActiveContextPolicy>) {
  let nextId = 0;
  return (id: string, reversible = false): ActiveContextMutation => ({
    id: ++nextId,
    active: true,
    reversible,
    apply: (current) => policy.addActiveContextSelection(current, "root", item(id)),
  });
}

function sentIds(call: ReturnType<typeof host>["calls"][number]): string[] {
  return (call.structuredContent!.items as ContextSelectionItem[]).map((entry) => entry.id);
}

Deno.test("pilot parity - resource base64 roundtrips across chunk boundaries and a large uneven tail", async () => {
  const policy = createActiveContextPolicy({ ...config, maxResourceBytes: 80_000 });
  for (const size of [24_575, 24_576, 24_577, 50_003]) {
    const bytes = Uint8Array.from({ length: size }, (_, index) => index % 251);
    const h = host({ text: {}, resource: {} });
    assertEquals(
      await policy.replaceActiveContext(h.app, [{
        ...item("series"),
        resource: { ...resource, bytes },
      }]),
      "shared",
    );
    const block = h.calls[0].content?.[1];
    assert(block?.type === "resource");
    const decoded = Uint8Array.from(atob(block.resource.blob), (char) => char.charCodeAt(0));
    assertEquals(decoded, bytes);
  }
});

Deno.test("pilot parity - JSON resource preserves exact UTF8 bytes and omits an oversized fallback", () => {
  const policy = createActiveContextPolicy(config);
  const payload = { x: "界" };
  const result = policy.activeContextJsonResource("local:json", payload);
  assertEquals(new TextDecoder().decode(result.bytes), JSON.stringify(payload));
  assertEquals(result.mimeType, "application/json");
  assertEquals(result.textFallback, undefined);
  const small = policy.activeContextJsonResource("local:small", [1, 2]);
  assertEquals(small.textFallback, "[1,2]");
  assertEquals(new TextDecoder().decode(small.bytes), small.textFallback);
});

Deno.test("pilot parity - removing a resource clears structured supplemental content in one replacement", async () => {
  const policy = createActiveContextPolicy(config);
  const h = host({ structuredContent: {}, resource: {} });
  await policy.replaceActiveContext(h.app, [{ ...item("a"), resource }]);
  await policy.replaceActiveContext(h.app, [item("a")]);
  assertEquals(h.calls[0].content?.[0].type, "resource");
  assertEquals(h.calls[1], {
    structuredContent: policy.activeContextSnapshot([item("a")]),
    content: [],
  });
  await policy.clearActiveContext(h.app);
  assertEquals(h.calls[2], { structuredContent: policy.activeContextSnapshot([]), content: [] });
});

Deno.test("pilot parity - removing a text fallback leaves only the current canonical text snapshot", async () => {
  const policy = createActiveContextPolicy(config);
  const h = host({ text: {} });
  await policy.replaceActiveContext(h.app, [{ ...item("a"), resource }]);
  await policy.replaceActiveContext(h.app, [item("a")]);
  assertEquals(h.calls[0].content?.length, 2);
  assertEquals(h.calls[1].content, [{
    type: "text",
    text: JSON.stringify(policy.activeContextSnapshot([item("a")])),
  }]);
  assertEquals(JSON.stringify(h.calls[1]).includes("[10,20]"), false);
});

Deno.test("pilot parity - losing resource modality uses advertised text fallback without a stale blob", async () => {
  const policy = createActiveContextPolicy(config);
  const modalities: Record<string, unknown> = { structuredContent: {}, resource: {}, text: {} };
  const h = host(modalities);
  const withResource = { ...item("a"), resource };
  await policy.replaceActiveContext(h.app, [withResource]);
  delete modalities.resource;
  await policy.replaceActiveContext(h.app, [withResource]);
  assertEquals(h.calls[1].content, [{ type: "text", text: resource.textFallback }]);
  delete modalities.text;
  await policy.replaceActiveContext(h.app, [withResource]);
  assertEquals("content" in h.calls[2], false, "Do not send unadvertised supplemental content");
});

Deno.test("pilot parity - text fallback accepts textual MIME with parameters and JSON", async () => {
  const policy = createActiveContextPolicy(config);
  for (const mimeType of ["text/plain; charset=utf-8", "application/json"]) {
    const h = host({ text: {} });
    await policy.replaceActiveContext(h.app, [{
      ...item("a"),
      resource: { ...resource, mimeType },
    }]);
    assertEquals(h.calls[0].content?.[1], { type: "text", text: resource.textFallback });
    assertEquals(JSON.stringify(h.calls[0]).includes("blob"), false);
  }
});

Deno.test("pilot parity - a poisoned fallback never serializes binary attachment content into text", async () => {
  const policy = createActiveContextPolicy(config);
  for (const mimeType of ["application/octet-stream", "application/pdf", "image/png"]) {
    const h = host({ text: {} });
    await policy.replaceActiveContext(h.app, [{
      ...item("a"),
      resource: { ...resource, mimeType, textFallback: "BINARY!" },
    }]);
    assertEquals(h.calls[0].content?.length, 1);
    assertEquals(JSON.stringify(h.calls[0]).includes("BINARY!"), false);
  }
});

Deno.test("pilot parity - text fallback is bounded by UTF8 bytes and empty fallback is omitted", async () => {
  const policy = createActiveContextPolicy(config);
  for (
    const [textFallback, included] of [["😀😀", true], ["😀😀😀", false], ["", false]] as const
  ) {
    const h = host({ text: {} });
    assertEquals(
      await policy.replaceActiveContext(h.app, [{
        ...item("a"),
        resource: { ...resource, textFallback },
      }]),
      "shared",
    );
    assertEquals(h.calls[0].content?.length, included ? 2 : 1);
  }
});

Deno.test("pilot parity - structured-only capability never receives an unadvertised text fallback", async () => {
  const policy = createActiveContextPolicy(config);
  const h = host({ structuredContent: {} });
  await policy.replaceActiveContext(h.app, [{ ...item("a"), resource }]);
  assertEquals(h.calls, [{ structuredContent: policy.activeContextSnapshot([item("a")]) }]);
});

Deno.test("pilot parity - latest local resource replaces older bytes while preserving both item identities", () => {
  const policy = createActiveContextPolicy(config);
  const replacement = { ...resource, uri: "local:new", bytes: new Uint8Array([7]) };
  const a = policy.addActiveContextSelection([], "root", { ...item("a"), resource });
  const b = policy.addActiveContextSelection(a, "root", { ...item("b"), resource: replacement });
  assertEquals(ids(b), ["a", "b"]);
  assertEquals(b[0].item.resource, undefined);
  assertEquals(b[1].item.resource, replacement);
  assertEquals(
    JSON.stringify(policy.activeContextSnapshot(b.map((entry) => entry.item))).includes("bytes"),
    false,
  );
});

Deno.test("pilot parity - same-named levels reconcile independently by group and root", () => {
  const policy = createActiveContextPolicy(config);
  const initial = [
    selected("a", "root", "level:a"),
    selected("b", "root", "level:b"),
    selected("c", "other", "level:a"),
  ];
  const fresh = { ...initial[0].item, value: "fresh" };
  const refreshed = policy.reconcileActiveContextViewSelections(initial, "root", "level:a", [
    fresh,
    initial[1].item,
  ]);
  assertEquals(refreshed, [{ scopeKey: "root", item: fresh }, initial[1], initial[2]]);
  assertEquals(
    policy.reconcileActiveContextViewSelections(refreshed, "root", "level:a", []),
    initial.slice(1),
  );
});

Deno.test("pilot parity - document predicate removes missing rows without touching another document or root", () => {
  const policy = createActiveContextPolicy({
    ...config,
    documentContains: (document, id) => id.startsWith(`${document}/`),
  });
  const initial = [
    selected("doc-a/row-1"),
    selected("doc-a/row-2"),
    selected("doc-b/row-1"),
    selected("doc-a/row-3", "other"),
  ];
  const fresh = { ...initial[0].item, value: "fresh" };
  const result = policy.reconcileActiveContextDocumentSelections(initial, "root", "doc-a", [fresh, {
    ...initial[2].item,
    value: "unrelated",
  }]);
  assertEquals(result, [{ scopeKey: "root", item: fresh }, initial[2], initial[3]]);
});

Deno.test("pilot parity - list refresh preserves selected inline detail rows in a separate group", () => {
  const policy = createActiveContextPolicy(config);
  const initial = [selected("list-row", "root", "list"), selected("detail-row", "root", "detail")];
  assertEquals(policy.reconcileActiveContextViewSelections(initial, "root", "list", []), [
    initial[1],
  ]);
});

Deno.test("pilot parity - undo replays bounded eviction in order instead of restoring an old whole snapshot", () => {
  const policy = createActiveContextPolicy({ ...config, maxItems: 3 });
  const add = mutationFactory(policy);
  const initial = [add("a"), add("b"), add("c")];
  const earlier = add("d", true);
  const later = add("e");
  assertEquals(ids(policy.replayActiveContextMutations([...initial, earlier, later])), [
    "c",
    "d",
    "e",
  ]);
  earlier.active = false;
  assertEquals(ids(policy.replayActiveContextMutations([...initial, earlier, later])), [
    "b",
    "c",
    "e",
  ]);
});

Deno.test("pilot parity - journal compaction folds only the sealed prefix and then releases the suffix", () => {
  const policy = createActiveContextPolicy(config);
  const add = mutationFactory(policy);
  const a = add("a");
  const b = add("b", true);
  const c = add("c");
  const retained = policy.compactActiveContextMutations([], [a, b, c]);
  assertEquals(ids(retained.base), ["a"]);
  assertEquals(retained.mutations.map((entry) => entry.id), [b.id, c.id]);
  b.active = false;
  b.reversible = false;
  const sealed = policy.compactActiveContextMutations(retained.base, retained.mutations);
  assertEquals(ids(sealed.base), ["a", "c"]);
  assertEquals(sealed.mutations, []);
});

Deno.test("pilot parity - resource equality detects byte changes while accepting equal copies", () => {
  const policy = createActiveContextPolicy(config);
  const original = { ...item("a"), resource };
  assertEquals(
    policy.sameActiveContextItem(original, {
      ...original,
      resource: { ...resource, bytes: resource.bytes.slice() },
    }),
    true,
  );
  const changed = resource.bytes.slice();
  changed[changed.length - 1] ^= 1;
  assertEquals(
    policy.sameActiveContextItem(original, {
      ...original,
      resource: { ...resource, bytes: changed },
    }),
    false,
  );
});

Deno.test("pilot parity - atomic relative bulk add and remove replay across an earlier reversible removal", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const actions = c.actionsForScope("root");
  await actions.select([item("1"), item("2"), item("3")]);
  const undo = await actions.toggleReversible(item("1"));
  assert(undo);
  await actions.select([item("4"), item("5")], "add");
  await actions.select([item("2"), item("5")], "remove");
  assertEquals(h.calls.length, 4, "Each bulk action is one complete host replacement");
  assertEquals(await undo(), true);
  assertEquals(ids(c.getSnapshot().selections), ["1", "3", "4"]);
  assertEquals(h.calls.map(sentIds), [
    ["1", "2", "3"],
    ["2", "3"],
    ["2", "3", "4", "5"],
    ["3", "4"],
    ["1", "3", "4"],
  ]);
  undo.release?.();
});

Deno.test("pilot parity - unchanged refresh emits no host write, pending transition or subscriber notification", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const actions = c.actionsForScope("root");
  let notifications = 0;
  c.subscribe(() => notifications++);
  assertEquals(await actions.reconcile([item("a")]), "unchanged");
  assertEquals(notifications, 0);
  await actions.activate(item("a"));
  const before = notifications;
  const writes = h.calls.length;
  assertEquals(await actions.reconcile([item("a")]), "unchanged");
  assertEquals(await actions.reconcileGroup("parts", [item("a")]), "unchanged");
  assertEquals(notifications, before);
  assertEquals(h.calls.length, writes);
  assertEquals(c.getSnapshot().pending, false);
});

Deno.test("pilot parity - eight references become one query at nine and undo restores the original eight", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const actions = c.actionsForScope("root");
  const rows = Array.from({ length: 8 }, (_, index) => item(String(index + 1)));
  await actions.select(rows);
  const undo = await actions.activateReversible(item("9"));
  assert(undo);
  assertEquals(ids(c.getSnapshot().selections), rows.map((entry) => entry.id).concat("9"));
  assertEquals(sentIds(h.calls[0]), rows.map((entry) => entry.id));
  assertEquals(sentIds(h.calls[1]), ["selection-query"]);
  assertEquals((h.calls[1].structuredContent!.items as ContextSelectionItem[])[0].query, {
    tool: "parts_list",
    ids: rows.map((entry) => entry.id).concat("9"),
  });
  assertEquals(await undo(), true);
  assertEquals(sentIds(h.calls[2]), rows.map((entry) => entry.id));
  assertEquals(ids(c.getSnapshot().selections), rows.map((entry) => entry.id));
  undo.release?.();
});

Deno.test("pilot parity - removing a query-represented group cannot be undone by a late ninth-member undo", async () => {
  const h = host();
  const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
  const actions = c.actionsForScope("root");
  await actions.select(Array.from({ length: 8 }, (_, index) => item(String(index + 1))));
  const undo = await actions.activateReversible(item("9"));
  assert(undo);
  assertEquals(sentIds(h.calls[1]), ["selection-query"]);
  assertEquals(await actions.reconcileGroup("parts", []), "cleared");
  assertEquals(await undo(), true);
  assertEquals(ids(c.getSnapshot().selections), []);
  assertEquals(c.getSnapshot().desiredSelections, []);
  assertEquals(h.calls.length, 3);
  assertEquals(sentIds(h.calls[2]), []);
  undo.release?.();
});

Deno.test("pilot parity - explicit resource invalidation on refresh clears prior supplemental content in every modality", async () => {
  for (
    const modalities of [{ text: {} }, { structuredContent: {}, text: {} }, {
      structuredContent: {},
      resource: {},
    }]
  ) {
    const h = host(modalities);
    const c = createActiveContextController(h.app, "root", createActiveContextPolicy(config));
    const actions = c.actionsForScope("root");
    await actions.activate({ ...item("a"), resource });
    await actions.reconcile([{ ...item("a"), value: "fresh", resource: undefined }]);
    assertEquals(c.getSnapshot().selections[0].item.resource, undefined);
    assertEquals(h.calls[1].content?.some((block) => block.type === "resource"), false);
    assertEquals(JSON.stringify(h.calls[1]).includes(resource.textFallback), false);
    if ("structuredContent" in modalities) assertEquals(h.calls[1].content, []);
  }
});
