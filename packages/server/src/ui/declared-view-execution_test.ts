import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import { DECLARED_VIEW_META_KEY } from "@mcpview/contracts";
import {
  createDeclaredViewExecution,
  type DeclaredViewNativeResult,
} from "../../mod.ts";

const list = "ui://erp/list";
const detail = "ui://erp/detail";
const tools = [
  { name: "list", _meta: { ui: { resourceUri: list } } },
  { name: "get", _meta: { ui: { resourceUri: detail } } },
  { name: "sum" },
];
const catalog = { tools, mountableResourceUris: [list, detail] };
const invoice = {
  content: [{ type: "text", text: "Invoice 17" }],
  structuredContent: { record: { id: 17 } },
  _meta: { "io.casys/viewer": { version: 1, refresh: "get" } },
};

Deno.test("declared execution resolves the returned call among equal data and multiple completed calls", () => {
  const execution = createDeclaredViewExecution(catalog);
  const first = execution.capture("list", invoice);
  const second = execution.capture("get", invoice);
  assertEquals(first.data, second.data);
  assert(first.data !== second.data);
  assertNotEquals(first.reference, second.reference);
  assertEquals(execution.resolve(first.reference), {
    result: invoice,
    resourceUri: list,
  });
  assertEquals(execution.resolve(second.reference), {
    result: invoice,
    resourceUri: detail,
  });
});

Deno.test("declared execution detaches custom projections from the private native snapshot", () => {
  const execution = createDeclaredViewExecution(catalog);
  const original = structuredClone(invoice);
  const rows = [original.structuredContent.record];
  const captured = execution.capture("get", original, rows);
  const projection = captured.data as { id: number }[];
  assertEquals(projection, [{ id: 17 }]);
  projection[0].id = 18;
  original.structuredContent.record.id = 19;
  assertEquals(execution.resolve(captured.reference), {
    result: invoice,
    resourceUri: detail,
  });
  assertEquals(
    execution.capture("get", { ...invoice, structuredContent: null }).data,
    null,
  );
});

Deno.test("declared execution rejects receipts from simultaneous invocations and unissued references", async () => {
  async function invoke() {
    const execution = createDeclaredViewExecution(catalog);
    const native = await Promise.resolve(invoice);
    return { execution, reference: execution.capture("get", native).reference };
  }
  const [a, b] = await Promise.all([invoke(), invoke()]);
  assertEquals(a.execution.resolve(b.reference), undefined);
  assertEquals(b.execution.resolve(a.reference), undefined);
  assertEquals(a.execution.resolve("unissued"), undefined);
  assertEquals(a.execution.resolve(a.reference), {
    result: invoice,
    resourceUri: detail,
  });
});

Deno.test("declared execution validates the native URI, descriptor fallback, and exact registry", () => {
  const execution = createDeclaredViewExecution({
    ...catalog,
    mountableResourceUris: [list, detail, "ui://bad path"],
    acceptsResult: (uri, result) =>
      uri === list || result.structuredContent !== undefined,
  });
  const capture = (name: string, native: DeclaredViewNativeResult) =>
    execution.resolve(execution.capture(name, native).reference);
  const override = {
    ...invoice,
    _meta: { ...invoice._meta, ui: { resourceUri: detail } },
  };
  assertEquals(capture("list", override), {
    result: override,
    resourceUri: detail,
  });
  assertEquals(capture("get", invoice), {
    result: invoice,
    resourceUri: detail,
  });
  for (
    const [name, result] of [
      ["list", {
        ...invoice,
        _meta: { ui: { resourceUri: "ui://erp/missing" } },
      }],
      ["list", { ...invoice, _meta: { ui: { resourceUri: null } } }],
      ["list", { ...invoice, _meta: { ui: { resourceUri: "ui://bad path" } } }],
      ["get", { content: invoice.content }],
      ["sum", invoice],
      ["unknown", override],
    ] as const
  ) {
    assertEquals(capture(name, result), { result });
  }
  assertThrows(
    () =>
      createDeclaredViewExecution({ ...catalog, tools: [tools[0], tools[0]] }),
    TypeError,
  );
});

Deno.test("declared execution leaves errors and interim results unrouted and discards upstream route claims", () => {
  const execution = createDeclaredViewExecution(catalog);
  const fakeRoute = { version: 1, resourceUri: list };
  for (
    const result of [
      { ...invoice, isError: true, resultType: "complete" },
      { resultType: "input_required", requestState: "checkpoint" },
      { resultType: "task", taskId: "id" },
      { resultType: "future", content: [] },
      {},
    ]
  ) {
    const native = {
      ...result,
      _meta: { ...invoice._meta, [DECLARED_VIEW_META_KEY]: fakeRoute },
    };
    const capture = execution.capture("get", native);
    assertEquals(execution.resolve(capture.reference), {
      result: { ...result, _meta: invoice._meta },
    });
    assertEquals(native._meta[DECLARED_VIEW_META_KEY], fakeRoute);
  }
});
