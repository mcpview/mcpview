import { assertEquals, assertRejects } from "@std/assert";
import {
  createFileSnippetStore,
  createSnippetCatalog,
  type SnippetStore,
} from "@mcpview/server/snippets";
import { createSnippetChain } from "./chain.ts";
import {
  readSnippetPanels,
  readSnippetSyncRules,
  SNIPPET_PANELS_META_KEY as panelMetaKey,
  SNIPPET_SYNC_META_KEY,
} from "./board.ts";
import { createSnippetExecuteTool } from "./tool.ts";
import type { SnippetProvider } from "./providers.ts";

function forTestAccount(providers: ReadonlyMap<string, SnippetProvider>, store?: SnippetStore) {
  const run = createSnippetChain(providers, createSnippetCatalog({ store }));
  return (args: Record<string, unknown>, signal?: AbortSignal) =>
    run(args, { scope: "account", signal });
}

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
  const execute = forTestAccount(
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

Deno.test("can reload the catalog from a single-user durable store without persisted receipts", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = forTestAccount(new Map(), createFileSnippetStore(directory));
    await first({ code: "return api.params.value + 1;", params: { value: 1 }, saveAs: "add" });
    const reloaded = forTestAccount(new Map(), createFileSnippetStore(directory));
    const result = await reloaded({ replay: "add", params: { value: 8 } });
    assertEquals(result.structuredContent, { value: 9, panels: [] });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("applies the saved-chain cap to entries inherited from storage", async () => {
  const execute = forTestAccount(new Map(), {
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
  const execute = forTestAccount(
    new Map([["slicer", {
      names: ["estimate"],
      call: () => Promise.resolve(responses.shift()!),
    }]]),
  );
  const run = () => execute({ code: 'return await api.runSnippet("slicer", "estimate", {});' });
  for (
    const message of [
      "Snippet estimate: The configured provider profile is invalid or unavailable.",
      "Snippet estimate: The provider reported an execution error.",
      "Snippet estimate returned an invalid result.",
    ]
  ) {
    const error = await assertRejects(run, Error);
    assertEquals(
      error.message,
      `${message} One or more upstream operations may have completed. Check their effects before replaying the chain.`,
    );
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
  const execute = forTestAccount(
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

Deno.test("catalog operations require an independently authenticated scope, including replay", async () => {
  const observed: (string | undefined)[] = [];
  const run = createSnippetChain(
    new Map([["reporting", {
      names: ["snapshot"],
      call: (_tool, _args, _signal, context) => {
        observed.push(context.scope);
        return Promise.resolve({ content: [], structuredContent: { value: context.scope } });
      },
    }]]),
    createSnippetCatalog(),
  );
  const code = 'const x = await api.runSnippet("reporting","snapshot",{}); return x.value;';
  for (
    const args of [{ code, saveAs: "report" }, { listSaved: true }, { replay: "report" }, {
      code,
      saveAs: "report",
      scope: "forged",
    }]
  ) {
    await assertRejects(() => run(args), Error, "trusted scope");
  }
  assertEquals(observed, []);
  const alice = { scope: "tenant-A/alice" }, bob = { scope: "tenant-B/bob" };
  await run({ code, saveAs: "report" }, alice);
  assertEquals((await run({ listSaved: true }, bob)).structuredContent, {
    value: { snippets: [] },
    panels: [],
  });
  await assertRejects(() => run({ replay: "report" }, bob), Error, "not found");
  await run({ replay: "report" }, alice);
  await run({ code, saveAs: "report" }, bob);
  assertEquals(observed, [alice.scope, alice.scope, bob.scope]);
});

Deno.test("a transient script can select two receipts of the same provider in reverse order", async () => {
  const run = createSnippetChain(
    new Map([["parts", {
      names: ["part"],
      call: (_tool, args) =>
        Promise.resolve({ content: [], structuredContent: { value: args.input } }),
    }]]),
  );
  const result = await run({
    code: `
    const a = await api.runSnippet("parts","part",{id:1});
    const b = await api.runSnippet("parts","part",{id:2});
    await api.panel(b.id); await api.panel(a.id);
    return 2;
  `,
  });
  const panels = result._meta?.[panelMetaKey] as {
    id: string;
    result: { structuredContent: { value: { id: number } } };
  }[];
  assertEquals(panels.map((p) => p.result.structuredContent.value.id), [2, 1]);
  assertEquals(new Set(panels.map((p) => p.id)).size, 2);
  await assertRejects(
    () => run({ listSaved: true }, { scope: "user" }),
    Error,
    "configured catalog",
  );
});

Deno.test("cancellation releases a VM waiting for an uncooperative provider", async () => {
  const controller = new AbortController();
  const run = createSnippetChain(
    new Map([["reports", {
      names: ["poll"],
      call: () => {
        controller.abort();
        return new Promise(() => {});
      },
    }]]),
  );
  await assertRejects(
    () =>
      run({ code: 'return await api.runSnippet("reports", "poll", {});' }, {
        signal: controller.signal,
      }),
    DOMException,
  );
});

Deno.test("discovers, invokes, and saves international human-readable snippet names exactly", async () => {
  const name = "État des échéances";
  const calls: Record<string, unknown>[] = [];
  const run = forTestAccount(
    new Map([["erp", {
      names: [name],
      call: (tool, args) => {
        calls.push(args);
        return Promise.resolve({
          content: [],
          structuredContent: tool === "list_snippets" ? { snippets: [{ name }] } : { value: 12 },
        });
      },
    }]]),
  );
  const code =
    'const list = await api.listSnippets("erp"); return (await api.runSnippet("erp",list[0].name,{})).value;';
  const saved = "Ma revue du lundi – 台灣";
  await run({ code, saveAs: saved });
  const result = await run({ replay: saved });
  assertEquals(result.structuredContent, { value: 12, panels: [] });
  assertEquals(calls, [{}, { name, input: {} }, {}, { name, input: {} }]);
  await assertRejects(() => run({ code, saveAs: "日".repeat(86) }), Error, "UTF-8");
});

Deno.test("a late guest, provider or persistence failure reports possible upstream effects", async () => {
  let calls = 0;
  const providers = new Map<string, SnippetProvider>([["erp", {
    names: ["commit"],
    call: () => {
      calls++;
      if (calls === 3) throw new Error("private-host-transport-diagnostic");
      return Promise.resolve({ content: [], structuredContent: { value: "finished" } });
    },
  }]]);
  const run = forTestAccount(providers, {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(undefined),
    putIfAbsent: () => Promise.reject(new Error("private-store-diagnostic")),
  });
  const step = 'await api.runSnippet("erp","commit",{});';
  for (
    const args of [{ code: step + 'throw "private-guest-diagnostic";' }, { code: step + step }, {
      code: step,
      saveAs: "month-end",
    }]
  ) {
    const error = await assertRejects(
      () => run(args),
      Error,
      "Check their effects before replaying",
    );
    assertEquals(error.message.includes("private-"), false);
    if (args.saveAs) assertEquals(error.message.includes("saved"), true);
  }
  assertEquals(calls, 4);
});

Deno.test("declares Compose sync only for selected receipts and rebinds on saved replay", async () => {
  const ports = { emits: ["invoice.selected"], accepts: ["invoice.focus"] };
  const provider: SnippetProvider = {
    names: ["invoice"],
    events: { invoice: ports },
    call: () => Promise.resolve({ content: [], structuredContent: { value: null } }),
  };
  const execute = forTestAccount(new Map([["erp", provider]]));
  const setup = `
const a = await api.runSnippet("erp", "invoice", {});
const b = await api.runSnippet("erp", "invoice", {});
await api.panel(a.id);
await api.panel(b.id);
const rule = {from: a.id, event: "invoice.selected", to: b.id, action: "invoice.focus"};
`;
  const code = setup + "await api.sync(rule); await api.sync(rule); return 2;";
  const first = await execute({ code, saveAs: "sync" });
  const replay = await execute({ replay: "sync" });
  const firstRules = readSnippetSyncRules(first);
  const replayRules = readSnippetSyncRules(replay);
  assertEquals(firstRules.length, 1);
  assertEquals(replayRules.length, 1);
  assertEquals(firstRules[0].from, readSnippetPanels(first)[0].id);
  assertEquals(replayRules[0].from, readSnippetPanels(replay)[0].id);
  assertEquals(firstRules[0].from === replayRules[0].from, false);
  assertEquals(Object.hasOwn(first.structuredContent ?? {}, SNIPPET_SYNC_META_KEY), false);
  const description = createSnippetExecuteTool({
    resourceUri: "ui://erp/board",
    providers: new Map([["erp", provider]]),
  }).description ?? "";
  assertEquals(
    description.includes("await api.sync") && description.includes("invoice.focus"),
    true,
  );

  for (
    const invalid of [
      "await api.sync({...rule, to: a.id});",
      'await api.sync({...rule, to: "*"});',
      'await api.sync({...rule, from: "previous-execution"});',
      'await api.sync({...rule, event: "*"});',
      'await api.sync({...rule, action: "unadvertised"});',
      'await api.sync({...rule, payload: { id: "INV-1" }});',
      'const c = await api.runSnippet("erp", "invoice", {}); await api.sync({...rule, to: c.id});',
    ]
  ) {
    await assertRejects(() => execute({ code: setup + invalid }), Error, "selected panel receipts");
  }
});
