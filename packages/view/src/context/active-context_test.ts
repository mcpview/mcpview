import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { type ContextSelectionItem, createActiveContextPolicy } from "./active-context.ts";

import { config, host, item } from "./testing/fixtures_test.ts";

Deno.test("projection graduates compact 1–3, references 4–8, exactly one application query above 8", async () => {
  let queryCalls = 0;
  const policy = createActiveContextPolicy({
    ...config,
    query: (items) => {
      queryCalls++;
      return config.query!(items);
    },
  });
  for (const count of [1, 2, 3, 4, 8, 9, 50]) {
    const { app, calls } = host();
    assertEquals(
      await policy.replaceActiveContext(
        app,
        Array.from({ length: count }, (_, i) => item(String(i))),
      ),
      "shared",
    );
    const snapshot = calls[0].structuredContent!;
    const items = snapshot.items as ContextSelectionItem[];
    assertEquals(items.length, count > 8 ? 1 : count);
    assertEquals(items.every((entry) => entry.fields !== undefined), count <= 3);
    assertEquals(items.some((entry) => entry.query !== undefined), count > 8);
  }
  assertEquals(queryCalls, 2);
});
Deno.test("application must supply a query callback when large selection is enabled", () => {
  assertThrows(() => createActiveContextPolicy({ ...config, query: undefined }), TypeError);
  createActiveContextPolicy({ ...config, maxItems: 8, query: undefined });
  assertThrows(() => createActiveContextPolicy({ ...config, compactUpTo: 9 }), TypeError);
});
Deno.test("closed snapshot never serializes scope, reconciliation, resource bytes or local metadata", () => {
  const policy = createActiveContextPolicy(config);
  const result = policy.activeContextSnapshot([{
    ...item("a"),
    metadata: { private: true },
    resource: { uri: "local:a", mimeType: "text/plain", bytes: new Uint8Array([1]) },
  }]);
  assertEquals(Object.keys(result.items[0]).sort(), ["fields", "id", "label", "value", "view"]);
  assertEquals(result.schema, config.schema);
  assertEquals(result.version, config.version);
});
Deno.test("IDs remain tool-resolvable; overlong or control-character IDs reject instead of truncate", async () => {
  const policy = createActiveContextPolicy(config);
  const { app, calls } = host();
  for (const id of ["", " ", "a\nb", "x".repeat(81)]) {
    const result = await policy.writeActiveContext(app, [item(id)]);
    assertEquals(result.error?.code, "invalid-snapshot");
  }
  assertEquals(calls.length, 0);
  assertEquals(policy.activeContextSnapshot([item(" A 😀 ")]).items[0].id, " A 😀 ");
});
Deno.test("untrusted text strips controls and marks Unicode truncation", () => {
  const policy = createActiveContextPolicy(config);
  const result = policy.activeContextSnapshot([{
    ...item("a"),
    label: "\u0000  " + "😀".repeat(21) + "\n",
    value: "a\tb\u007f",
  }]);
  assertEquals(result.items[0].label, "😀".repeat(19) + "…");
  assertEquals(result.items[0].value, "a b");
});
Deno.test("invalid app projection and payload budget never call the host", async () => {
  const bad = createActiveContextPolicy({ ...config, query: () => item("q") });
  const { app, calls } = host();
  assertEquals(
    (await bad.writeActiveContext(app, Array.from({ length: 9 }, (_, i) => item(String(i))))).error
      ?.code,
    "invalid-snapshot",
  );
  const bounded = createActiveContextPolicy({ ...config, maxSnapshotBytes: 100 });
  assertEquals(
    (await bounded.writeActiveContext(app, [item("a")])).error?.code,
    "invalid-snapshot",
  );
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assertEquals(
    (await createActiveContextPolicy(config).writeActiveContext(app, [{
      ...item("a"),
      ref: cycle,
    }])).error?.code,
    "invalid-snapshot",
  );
  assertEquals(calls.length, 0);
});
Deno.test("structured content is preferred; text-only gets the same JSON; clear is canonical", async () => {
  const policy = createActiveContextPolicy(config);
  for (const modalities of [{ structuredContent: {}, text: {} }, { text: {} }]) {
    const { app, calls } = host(modalities);
    await policy.replaceActiveContext(app, [item("a")]);
    await policy.clearActiveContext(app);
    const snapshot = calls[0].structuredContent ??
      JSON.parse(calls[0].content![0].type === "text" ? calls[0].content![0].text : "");
    assertEquals(snapshot, policy.activeContextSnapshot([item("a")]));
    const clear = calls[1].structuredContent ??
      JSON.parse(calls[1].content![0].type === "text" ? calls[1].content![0].text : "");
    assertEquals(clear, { schema: config.schema, version: config.version, items: [] });
  }
});
Deno.test("unsupported is neutral and never triggers another transport", async () => {
  const { app, calls } = host({ resource: {} });
  assertEquals(
    await createActiveContextPolicy(config).replaceActiveContext(app, [item("a")]),
    "unsupported",
  );
  assertEquals(calls, []);
});
Deno.test("resource ladder: latest resource, byte bound, safe text fallback, binary metadata only", async () => {
  const policy = createActiveContextPolicy(config);
  const resource = {
    uri: "local:a",
    mimeType: "text/plain",
    bytes: new Uint8Array([1, 2, 3]),
    textFallback: "😀😀",
  };
  const binary = { ...resource, mimeType: "application/octet-stream" };
  const rich = host({ structuredContent: {}, resource: {}, text: {} });
  assertEquals(await policy.replaceActiveContext(rich.app, [{ ...item("a"), resource }]), "shared");
  assertEquals(rich.calls[0].content, [{
    type: "resource",
    resource: { uri: "local:a", mimeType: "text/plain", blob: "AQID" },
  }]);
  assertEquals(
    (await policy.writeActiveContext(rich.app, [{
      ...item("a"),
      resource: { ...resource, bytes: new Uint8Array(21) },
    }])).error?.code,
    "resource-too-large",
  );
  const text = host({ text: {} });
  await policy.replaceActiveContext(text.app, [{ ...item("a"), resource }]);
  assertEquals(text.calls[0].content?.length, 2);
  await policy.replaceActiveContext(text.app, [{ ...item("a"), resource: binary }]);
  assertEquals(text.calls[1].content?.length, 1);
  await policy.replaceActiveContext(text.app, [{
    ...item("a"),
    resource: { ...resource, textFallback: "😀😀😀" },
  }]);
  assertEquals(text.calls[2].content?.length, 1);
  const none = createActiveContextPolicy({ ...config, resourcePolicy: "none" });
  await none.replaceActiveContext(rich.app, [{ ...item("a"), resource }]);
  assertEquals(rich.calls.at(-1)?.content, []);
});
Deno.test("explicit group reconciliation isolates views and respects explicit resource invalidation", () => {
  const policy = createActiveContextPolicy(config);
  const a = {
    ...item("a", "one"),
    resource: { uri: "local:a", mimeType: "text/plain", bytes: new Uint8Array([1]) },
  };
  const selected = [{ scopeKey: "root", item: a }, { scopeKey: "root", item: item("b", "two") }];
  const refreshed = policy.reconcileActiveContextViewSelections(selected, "root", "one", [{
    ...item("a", "one"),
    value: "new",
  }]);
  assertEquals(refreshed[0].item.resource, a.resource);
  const invalidated = policy.reconcileActiveContextViewSelections(refreshed, "root", "one", [{
    ...item("a", "one"),
    resource: undefined,
  }]);
  assertEquals(invalidated[0].item.resource, undefined);
  assertEquals(
    policy.reconcileActiveContextViewSelections(selected, "root", "one", []).map((s) => s.item.id),
    ["b"],
  );
});
Deno.test("queue survives a rejected operation and serializes subsequent work", async () => {
  const queue = createActiveContextPolicy(config).createActiveContextQueue();
  const events: number[] = [];
  const first = queue.run(() => {
    events.push(1);
    return Promise.reject(new Error("bad"));
  });
  const second = queue.run(() => {
    events.push(2);
    return Promise.resolve(2);
  });
  await assertRejects(() => first);
  assertEquals(await second, 2);
  assertEquals(events, [1, 2]);
});

Deno.test("host SDK and DOM timeout rejections are classified without racing the serialized write", async () => {
  const policy = createActiveContextPolicy(config);
  for (
    const cause of [
      Object.assign(new Error("Request timed out"), { code: -32001 }),
      new DOMException("Timed out", "TimeoutError"),
      new Error("offline"),
    ]
  ) {
    const { app } = host();
    app.updateModelContext = () => Promise.reject(cause);
    const result = await policy.writeActiveContext(app, [item("a")]);
    assertEquals(result.error?.code, cause.message === "offline" ? "transport-error" : "timeout");
    assertEquals(result.error?.message, cause.message);
  }
});
