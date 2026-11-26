import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  composeSnippetBoard,
  emitSnippetBoardEvent,
  readSnippetPanels,
  readSnippetSyncRules,
  SNIPPET_PANELS_META_KEY,
  SNIPPET_SYNC_META_KEY,
  type SnippetPanel,
} from "./board.ts";

const uri = "ui://ledger/invoice";

function invoice(id: string, provider = "ledger") {
  return {
    id,
    name: "invoice",
    provider,
    title: id,
    result: {
      structuredContent: { value: { id } },
      _meta: { ui: { resourceUri: uri }, detail: { privateToView: id } },
    },
  };
}

function envelope(panels: unknown[]) {
  return {
    structuredContent: { value: { total: 2 } },
    _meta: { [SNIPPET_PANELS_META_KEY]: panels },
  };
}

Deno.test("Code Mode board keeps ordered, provider-qualified receipts for repeated native views", () => {
  const receipts = [invoice("second"), invoice("first"), invoice("third", "other")];
  const board = composeSnippetBoard(envelope(receipts), { layout: "tabs" });
  assertEquals(board.layout, "tabs");
  assertEquals(
    board.children.map((
      { resourceUri, componentId, slot, source },
    ) => [resourceUri, componentId, slot, source]),
    [
      [uri, "second", 0, "ledger:invoice"],
      [uri, "first", 1, "ledger:invoice"],
      [uri, "third", 2, "other:invoice"],
    ],
  );
  assertEquals(board.sharedContext, { value: { total: 2 } });
  for (const [index, child] of board.children.entries()) {
    assertStrictEquals(child.context?.panel, receipts[index]);
  }
});

Deno.test("Code Mode board only collects valid view metadata and counts displayed receipts for layout", () => {
  const first = invoice("first");
  const plain = { ...invoice("plain"), result: { content: [{ type: "text", text: "summary" }] } };
  const result = envelope([null, { ...first, result: [] }, first, plain, first]);
  assertEquals(readSnippetPanels(result), [first, plain]);
  assertEquals(readSnippetPanels({ structuredContent: { panels: [first] } }), []);
  const board = composeSnippetBoard(result, {
    layout: (count) => count === 1 ? "stack" : "grid",
  });
  assertEquals(board.children.map((child) => child.componentId), ["first"]);
  assertEquals(board.layout, "stack");
});

Deno.test("a board can mount a local adapter for a data-only provider alongside native views", () => {
  const original = invoice("native");
  const stats = { ...invoice("stats", "metrics"), result: { structuredContent: { seconds: 12 } } };
  const surface = {
    layout: { type: "row" as const },
    components: [{ id: "time", component: "time" }],
  };
  const board = composeSnippetBoard(envelope([stats, original]), {
    resolveView: (panel) =>
      panel.provider === "metrics"
        ? {
          resourceUri: "ui://board/stats",
          context: { units: "s" },
          supportedWidths: [320, 520],
          surface,
        }
        : undefined,
  });
  assertEquals(board.layout, "stack");
  assertEquals(board.children.map((child) => child.resourceUri), ["ui://board/stats", uri]);
  const [first] = board.children;
  assertStrictEquals(first.context?.panel, stats);
  assertEquals(first.context?.view, { units: "s" });
  assertEquals(first.surface, surface);
  assertEquals(board.children.map((child) => child.supportedWidths), [[320, 520], undefined]);
});

Deno.test("a board routes declared events between its mounted receipt IDs", () => {
  const first = { ...invoice("first"), events: { emits: ["invoice.selected"] } };
  const detail = { ...invoice("detail"), events: { accepts: ["invoice.focus"] } };
  const distractor = { ...detail, id: "distractor" };
  const rule = {
    from: first.id,
    event: "invoice.selected",
    to: detail.id,
    action: "invoice.focus",
  };
  const result = envelope([distractor, detail, first]);
  Object.assign(result._meta, {
    [SNIPPET_SYNC_META_KEY]: [rule, rule, { ...rule, to: "*" }, { ...rule, to: uri }],
  });
  assertEquals(readSnippetSyncRules(result), [rule]);
  const local = (panel: SnippetPanel) => ({ resourceUri: uri, events: panel.events });
  const board = composeSnippetBoard(result, { resolveView: local });
  assertEquals(board.sync, [{ from: 2, event: rule.event, to: 1, action: rule.action }]);
  const deliveries: unknown[][] = [];
  const deliver = (...args: unknown[]) => deliveries.push(args);
  emitSnippetBoardEvent(board, first.id, rule.event, { invoice: "INV-001" }, deliver);
  emitSnippetBoardEvent(board, distractor.id, rule.event, { invoice: "INV-002" }, deliver);
  emitSnippetBoardEvent(board, first.id, "*", { invoice: "INV-003" }, deliver);
  emitSnippetBoardEvent(board, first.id, rule.event, 123n, deliver);
  emitSnippetBoardEvent(board, first.id, rule.event, "x".repeat(128 * 1024), deliver);
  assertEquals(deliveries, [[detail.id, rule.action, { invoice: "INV-001" }]]);
  const narrowed = composeSnippetBoard(result, {
    resolveView: (panel) => panel.id === detail.id ? { resourceUri: uri } : local(panel),
  });
  assertEquals(narrowed.sync, []);
  const absent = composeSnippetBoard(result, {
    resolveView: (panel) => panel.id === detail.id ? { resourceUri: "" } : local(panel),
  });
  assertEquals(absent.sync, []);
  result._meta[SNIPPET_PANELS_META_KEY].push(first);
  assertEquals(readSnippetSyncRules(result), []);
});
