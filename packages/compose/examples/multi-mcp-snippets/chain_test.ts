import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { createFileSnippetStore } from "../../../server/snippets.ts";
import { createChain, panelMetaKey } from "./chain.ts";
import { parseProviders } from "./config.ts";

function setup() {
  const calls: unknown[] = [];
  const nativeCad = {
    content: [{ type: "text" as const, text: "Original CAD result" }],
    structuredContent: { value: { stlSha256: "abc" }, originalExtra: { meshFormat: "glb" } },
    _meta: { boardMesh: "native mesh fixture" },
  };
  const nativeSlicer = {
    content: [{ type: "text" as const, text: "Original slicer result" }],
    structuredContent: { value: { minutes: 24 } },
  };
  const execute = createChain(
    new Map([
      ["cad", {
        names: ["plate-stl"],
        call: (tool: string, args: unknown) => {
          calls.push(["cad", tool, args]);
          return Promise.resolve(
            tool === "list_snippets"
              ? {
                content: [],
                structuredContent: {
                  snippets: [
                    { name: "plate-stl", inputSchema: { type: "object" } },
                    { name: "tool-outside-scope" },
                  ],
                },
              }
              : nativeCad,
          );
        },
      }],
      ["slicer", {
        names: ["pla-print-estimate"],
        call: (tool: string, args: unknown) => {
          calls.push(["slicer", tool, args]);
          return Promise.resolve(nativeSlicer);
        },
      }],
    ]),
  );
  return { execute, calls, nativeCad, nativeSlicer };
}

const code = `
const listing = await api.listSnippets("cad");
const cad = await api.runSnippet("cad", listing[0].name, { thicknessMm: api.params.thicknessMm });
const sliced = await api.runSnippet("slicer", "pla-print-estimate", { stlSha256: cad.value.stlSha256 });
await api.panel(cad.id, "CAD");
await api.panel(sliced.id);
return { minutes: sliced.value.minutes, names: listing.map(item => item.name), keys: Object.keys(cad) };
`;

Deno.test("passes sandbox values between named snippets and keeps native results in app metadata", async () => {
  const { execute, calls, nativeCad, nativeSlicer } = setup();
  const result = await execute({ code, params: { thicknessMm: 2 } });
  assertEquals(calls, [
    ["cad", "list_snippets", {}],
    ["cad", "run_snippet", { name: "plate-stl", input: { thicknessMm: 2 } }],
    ["slicer", "run_snippet", { name: "pla-print-estimate", input: { stlSha256: "abc" } }],
  ]);
  const panels = result._meta?.[panelMetaKey] as { id: string; result: unknown }[];
  assertEquals(panels.map(({ result }) => result), [nativeCad, nativeSlicer]);
  assertEquals(result.structuredContent, {
    value: { minutes: 24, names: ["plate-stl"], keys: ["id", "value"] },
    panels: [
      { provider: "cad", id: panels[0].id, name: "plate-stl", title: "CAD" },
      {
        provider: "slicer",
        id: panels[1].id,
        name: "pla-print-estimate",
        title: "pla-print-estimate",
      },
    ],
  });
});

Deno.test("saves only completed chains and replays with fresh parameters and receipts", async () => {
  const { execute, calls } = setup();
  await assertRejects(() => execute({ code: "throw 1", saveAs: "broken" }));
  const first = await execute({ code, params: { thicknessMm: 2 }, saveAs: "plate" });
  const list = await execute({ listSaved: true });
  assertEquals(list.structuredContent, {
    value: { snippets: [{ id: "plate", name: "plate", parameters: { thicknessMm: "number" } }] },
    panels: [],
  });
  await assertRejects(
    () => execute({ replay: "plate", params: { thicknessMm: "two" } }),
    Error,
    "JSON types",
  );
  const second = await execute({ replay: "plate", params: { thicknessMm: 5 } });
  assertEquals(calls[4], ["cad", "run_snippet", { name: "plate-stl", input: { thicknessMm: 5 } }]);
  const firstPanels = first._meta?.[panelMetaKey] as { id: string }[];
  const secondPanels = second._meta?.[panelMetaKey] as { id: string }[];
  assertEquals(firstPanels[0].id === secondPanels[0].id, false);
});

Deno.test("rejects unapproved calls, forged panel receipts, and queued work without await", async () => {
  const { execute, calls } = setup();
  await assertRejects(
    () => execute({ code: "await api.runSnippet('cad','tool-outside-scope',{});" }),
    Error,
    "approved",
  );
  await assertRejects(() => execute({ code: "await api.panel('forged-id');" }), Error, "receipt");
  await assertRejects(
    () => execute({ code: "api.runSnippet('cad','plate-stl',{});" }),
    Error,
    "Await every",
  );
  assertEquals(calls, []);
  const check = await execute({ code: "return [typeof fetch, typeof Deno, typeof process];" });
  assertEquals(check.structuredContent, {
    value: ["undefined", "undefined", "undefined"],
    panels: [],
  });
});

Deno.test("validates local provider bindings and discovers a third configured alias", async () => {
  const cad = { alias: "cad", port: 9991, snippets: ["plate-stl"] };
  const slicer = { alias: "slicer", port: 9992, snippets: ["pla-print-estimate"] };
  const finish = { alias: "finish", port: 9993, snippets: ["finish-report"] };
  assertEquals(parseProviders([cad, slicer, finish]), [cad, slicer, finish]);
  assertThrows(() => parseProviders([cad, { ...slicer, alias: "cad" }]), Error, "unique");
  assertThrows(() => parseProviders([cad, { ...slicer, port: 9991 }]), Error, "unique");
  assertThrows(() => parseProviders([{ ...cad, url: "https://example.com" }]));
  assertThrows(() => parseProviders([{ ...cad, port: "9991" }]));
  assertThrows(() => parseProviders([{ ...cad, snippets: ["plate-stl", "plate-stl"] }]));
  const execute = createChain(
    new Map([[finish.alias, {
      names: finish.snippets,
      call: () =>
        Promise.resolve({
          content: [],
          structuredContent: { snippets: [{ name: "finish-report" }] },
        }),
    }]]),
  );
  const result = await execute({ code: 'return await api.listSnippets("finish");' });
  assertEquals(result.structuredContent, { value: [{ name: "finish-report" }], panels: [] });
});

Deno.test("can reload the catalog from a single-user durable store without persisted receipts", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = createChain(new Map(), createFileSnippetStore(directory));
    await first({ code: "return api.params.value + 1;", params: { value: 1 }, saveAs: "add" });
    const reloaded = createChain(new Map(), createFileSnippetStore(directory));
    const result = await reloaded({ replay: "add", params: { value: 8 } });
    assertEquals(result.structuredContent, { value: 9, panels: [] });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("applies the saved-chain cap to entries inherited from storage", async () => {
  const execute = createChain(new Map(), {
    list: () =>
      Promise.resolve(
        Array.from({ length: 64 }, (_, index) => ({ id: `old-${index}`, name: `old-${index}` })),
      ),
    get: () => Promise.resolve(undefined),
    putIfAbsent: (_scope, snippet) => Promise.resolve(snippet),
  });
  await assertRejects(
    () => execute({ code: "return 42;", saveAs: "new-chain" }),
    Error,
    "catalog is full",
  );
});

Deno.test("distinguishes typed provider failures from malformed results without leaking details", async () => {
  const content = [{ type: "text" as const, text: "Internal path /private/profile.ini" }];
  const responses = [
    {
      isError: true,
      content,
      structuredContent: { error: { code: "PROFILE_INVALID", message: "Internal profile path" } },
    },
    {
      isError: true,
      content,
      structuredContent: { error: { code: "unknown code with private information" } },
    },
    { content },
  ];
  const execute = createChain(
    new Map([["slicer", {
      names: ["estimate"],
      call: () => Promise.resolve(responses.shift()!),
    }]]),
  );
  const run = () => execute({ code: 'return await api.runSnippet("slicer", "estimate", {});' });
  for (
    const message of [
      "Snippet estimate: The configured slicer profile is invalid or unavailable.",
      "Snippet estimate: The provider reported an execution error.",
      "Snippet estimate returned an invalid result.",
    ]
  ) {
    const error = await assertRejects(run, Error);
    assertEquals(error.message, message);
  }
});

Deno.test("rejects a pre-aborted request before a provider call or catalog write", async () => {
  const { execute, calls } = setup();
  const signal = AbortSignal.abort();
  await assertRejects(
    () => execute({ code, params: { thicknessMm: 2 }, saveAs: "cancelled" }, signal),
    DOMException,
  );
  assertEquals(calls, []);
  assertEquals((await execute({ listSaved: true })).structuredContent, {
    value: { snippets: [] },
    panels: [],
  });
});

Deno.test("passes cancellation to the provider and skips saving an aborted run", async () => {
  const controller = new AbortController();
  let providerSignal: AbortSignal | undefined;
  const execute = createChain(
    new Map([["cad", {
      names: ["plate-stl"],
      call: (_tool, _args, signal) => {
        providerSignal = signal;
        controller.abort();
        return Promise.resolve({ content: [], structuredContent: { value: 42 } });
      },
    }]]),
  );
  await assertRejects(
    () =>
      execute({
        code: 'return await api.runSnippet("cad", "plate-stl", {});',
        saveAs: "interrupted",
      }, controller.signal),
    DOMException,
  );
  assertEquals(providerSignal?.aborted, true);
  assertEquals((await execute({ listSaved: true })).structuredContent, {
    value: { snippets: [] },
    panels: [],
  });
});
