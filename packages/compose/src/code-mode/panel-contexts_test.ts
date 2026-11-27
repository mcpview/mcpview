import { assertEquals, assertRejects } from "@std/assert";
import { createPanelContexts } from "./panel-contexts.ts";
type Update = {
  content?: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
};

Deno.test("panel model context preserves an adjoining selection and clears snapshots after disposal", async () => {
  const updates: Update[] = [];
  const hosts = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const lifetime = new AbortController();
  const first = hosts.forPanel("a", "Sales invoices", lifetime.signal);
  const second = hosts.forPanel("b", "Invoice detail", lifetime.signal);
  const a = { structuredContent: { document: "A" } };
  const b = { structuredContent: { document: "B" } };
  await Promise.all([
    first(a),
    second(b),
  ]);
  assertEquals(updates[1], {
    structuredContent: {
      panels: [
        { title: "Sales invoices", context: a.structuredContent },
        { title: "Invoice detail", context: b.structuredContent },
      ],
    },
  });
  await second({ structuredContent: {} });
  assertEquals(updates[2], a);
  lifetime.abort();
  await assertRejects(() => first(a));
  await hosts.clear();
  assertEquals(updates[3], { structuredContent: {} });
});

Deno.test("a rejected update does not enter another panel's acknowledged context", async () => {
  const updates: Update[] = [];
  const hosts = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve(updates.length === 1 ? { isError: true } : {});
  });
  const { signal } = new AbortController();
  const a = { content: [{ type: "text" as const, text: "private A" }] };
  const b = { content: [{ type: "text" as const, text: "selected B" }] };
  await hosts.forPanel("a", "A", signal)(a);
  await hosts.forPanel("b", "B", signal)(b);
  assertEquals(updates, [a, b]);
});

for (const mode of ["exception", "error response"] as const) {
  Deno.test(`a failed context clear (${mode}) keeps the acknowledged snapshot for the next attempt`, async () => {
    const updates: Update[] = [];
    const store = createPanelContexts((update: Update) => {
      updates.push(update);
      if (updates.length === 2) {
        if (mode === "exception") {
          return Promise.reject(new Error("temporary failure"));
        }
        return Promise.resolve({ isError: true });
      }
      return Promise.resolve({});
    }, () => "Host context update declined");
    const old = new AbortController();
    const value = {
      structuredContent: { ref: "invoice-A" },
      content: [{ type: "text" as const, text: "A" }],
    };
    await store.forPanel("a", "A", old.signal)(value);
    old.abort();
    await assertRejects(
      () => store.clear(),
      Error,
      mode === "exception" ? "temporary failure" : "Host context update declined",
    );
    await store.clear();
    await store.clear();
    const empty = { structuredContent: {}, content: [] };
    assertEquals(updates, [value, empty, empty]);
  });
}

Deno.test("a late disposal cannot clear a current board even after a previous clear failed", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((value: Update) => {
    updates.push(value);
    return Promise.resolve(updates.length === 2 ? { isError: true } : {});
  });
  const old = new AbortController();
  const current = new AbortController();
  const a = { structuredContent: { ref: "invoice-A" } };
  const b = { structuredContent: { ref: "invoice-B" } };
  await store.forPanel("detail", "Detail", old.signal)(a);
  old.abort();
  await assertRejects(() => store.clear());
  await store.forPanel("detail", "Detail", current.signal)(b);
  await store.clear();
  assertEquals(updates, [a, { structuredContent: {} }, b]);
  current.abort();
  await store.clear();
  assertEquals(updates.at(-1), { structuredContent: {} });
});

Deno.test("a retired pin in flight cannot join the next board or overwrite a newer selection", async () => {
  const pending = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const updates: Update[] = [];
  const store = createPanelContexts(async (value: Update) => {
    updates.push(value);
    if (updates.length === 1) {
      started.resolve();
      await pending.promise;
    }
    return {};
  });
  const old = new AbortController();
  const current = new AbortController();
  const a = { structuredContent: { ref: "invoice-A" } };
  const b = { structuredContent: { ref: "invoice-B" } };
  const oldPin = store.forPanel("old", "A", old.signal)(a);
  await started.promise;
  old.abort();
  const newerPin = store.forPanel("new", "B", current.signal)(b);
  const lateCleanup = store.clear();
  pending.resolve();
  await Promise.all([oldPin, newerPin, lateCleanup]);
  assertEquals(updates, [a, b]);
  const third = new AbortController();
  await store.forPanel("third", "C", third.signal)({
    structuredContent: { ref: "C" },
  });
  current.abort();
  await store.clear();
  assertEquals(updates.at(-1), { structuredContent: { ref: "C" } });
});

Deno.test("a layout receipt coexists with the October basket and a fresh board starts empty", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const life = new AbortController();
  const revenue = store.forPanel("revenue", "Revenue", life.signal);
  const layout = store.forBoard(life.signal);
  const pinned = { activeItems: ["October"] };
  const receipt = {
    snippetLayout: { runId: "run-a", revision: 2, status: "ready" },
  };
  await revenue({ structuredContent: pinned });
  await layout({ structuredContent: receipt });
  assertEquals(updates.at(-1), {
    structuredContent: { ...pinned, ...receipt },
  });
  await revenue({ structuredContent: {} });
  assertEquals(updates.at(-1), { structuredContent: receipt });
  life.abort();
  await store.clear();
  assertEquals(updates.at(-1), { structuredContent: {} });
  const again = store.forPanel(
    "revenue",
    "Revenue",
    new AbortController().signal,
  );
  await again({ structuredContent: { activeItems: ["December"] } });
  assertEquals(updates.at(-1), {
    structuredContent: { activeItems: ["December"] },
  });
});

Deno.test("text-only hosts get both the selection and the layout receipt in separate blocks", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const { signal } = new AbortController();
  const data = { type: "text" as const, text: "October" };
  const receipt = {
    type: "text" as const,
    text: '{"snippetLayout":{"revision":1}}',
  };
  await store.forBoard(signal)({ content: [receipt] });
  await store.forPanel("revenue", "Revenue", signal)({ content: [data] });
  assertEquals(updates.at(-1), { content: [data, receipt] });
});

Deno.test("an in-place update receipt retires the layout reference and retains the basket until disposal", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const basket = new AbortController();
  const display = new AbortController();
  const october = { structuredContent: { month: "October" } };
  await store.forPanel("revenue", "Revenue", basket.signal)(october);
  await store.forBoard(display.signal)({
    structuredContent: { snippetLayout: { revision: 2 } },
  });
  display.abort();
  await store.clear();
  assertEquals(updates.at(-1), october);
  basket.abort();
  await store.clear();
  assertEquals(updates.at(-1), { structuredContent: {} });
});

Deno.test("a panel and the board retain independent structured values when their keys overlap", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const panelLife = new AbortController();
  const boardLife = new AbortController();
  const panel = store.forPanel("measurements", "Measurements", panelLife.signal);
  const board = store.forBoard(boardLife.signal);
  const panelContext = { snippetLayout: { selectedMeasure: "A" }, count: 1 };
  const receipt = { snippetLayout: { revision: 1 } };
  const note = { type: "text" as const, text: "a measurement" };
  await panel({ structuredContent: panelContext, content: [note] });
  await board({ structuredContent: receipt });
  assertEquals(updates.at(-1), {
    content: [note],
    structuredContent: { panels: [{ title: "Measurements", context: panelContext }], ...receipt },
  });
  boardLife.abort();
  await store.clear();
  assertEquals(updates.at(-1), { content: [note], structuredContent: panelContext });
});

Deno.test("the board cannot replace the structured panels envelope", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    return Promise.resolve({});
  });
  const { signal } = new AbortController();
  const board = store.forBoard(signal);
  await board({ structuredContent: { snippetLayout: { revision: 1 } } });
  await assertRejects(
    () => board({ structuredContent: { panels: ["replace"] } }),
    TypeError,
    "panels",
  );
  await store.forPanel("a", "A", signal)({ structuredContent: { month: "October" } });
  assertEquals(updates, [
    { structuredContent: { snippetLayout: { revision: 1 } } },
    { structuredContent: { month: "October", snippetLayout: { revision: 1 } } },
  ]);
});

Deno.test("clear removes a possibly delivered board receipt while keeping the acknowledged panel", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    if (updates.length === 2) return Promise.reject(new Error("receipt acknowledgement lost"));
    return Promise.resolve({});
  });
  const basket = new AbortController();
  const display = new AbortController();
  const selected = { structuredContent: { month: "October" } };
  const pending = { structuredContent: { snippetLayout: { status: "pending" } } };
  await store.forPanel("revenue", "Revenue", basket.signal)(selected);
  await assertRejects(() => store.forBoard(display.signal)(pending));
  display.abort();
  await store.clear();
  await store.clear();
  assertEquals(updates, [
    selected,
    { structuredContent: { ...selected.structuredContent, ...pending.structuredContent } },
    selected,
  ]);
});

Deno.test("first unacknowledged contribution is cleared in every attempted content format, retrying a lost clear", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    if (updates.length <= 2) return Promise.reject(new Error("transport disconnected after send"));
    return Promise.resolve({});
  });
  const life = new AbortController();
  const contribution = {
    structuredContent: { ref: "A" },
    content: [{ type: "text" as const, text: "A" }],
  };
  await assertRejects(() => store.forPanel("a", "A", life.signal)(contribution));
  life.abort();
  await assertRejects(() => store.clear());
  await store.clear();
  await store.clear();
  const empty = { structuredContent: {}, content: [] };
  assertEquals(updates, [contribution, empty, empty]);
});

Deno.test("a successful panel write reconciles an uncertain board receipt even after an explicit refusal", async () => {
  const updates: Update[] = [];
  const store = createPanelContexts((update: Update) => {
    updates.push(update);
    if (updates.length === 1) return Promise.reject(new Error("timeout"));
    if (updates.length === 2) return Promise.resolve({ isError: true });
    return Promise.resolve({});
  });
  const { signal } = new AbortController();
  const note = { content: [{ type: "text" as const, text: "old receipt" }] };
  const selected = { structuredContent: { ref: "A" } };
  await assertRejects(() => store.forBoard(signal)(note));
  const panel = store.forPanel("a", "A", signal);
  await panel(selected);
  await panel(selected);
  await store.clear();
  const reconciled = { content: [], ...selected };
  assertEquals(updates, [note, reconciled, reconciled]);
});
