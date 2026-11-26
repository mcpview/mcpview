import { assertEquals, assertThrows } from "@std/assert";
import { createSnippetChain } from "@mcpview/compose/code-mode";
import { parseProviders } from "./config.ts";

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
  const execute = createSnippetChain(
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
