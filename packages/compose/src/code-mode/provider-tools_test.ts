import { assertEquals, assertStrictEquals } from "@std/assert";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { MCPTool, ToolHandler, ToolHandlerContext } from "@mcpview/server";
import { createSnippetCatalog } from "@mcpview/server/snippets";
import { composeSnippetBoard, readSnippetPanels } from "./board.ts";
import { createSnippetChain } from "./chain.ts";
import { runProgram } from "./sandbox.ts";
import { registerSnippetProvider } from "./provider-tools.ts";

function captureTools() {
  const tools = new Map<string, { tool: MCPTool; run: ToolHandler }>();
  const host = {
    registerTool(tool: MCPTool, run: ToolHandler) {
      tools.set(tool.name, { tool, run });
    },
    getToolNames() {
      return [...tools.keys()];
    },
  };
  return { host, tools };
}

Deno.test("upstream rechecks principal authorization on replay, validates the selected schema, and preserves native metadata", async () => {
  const { host, tools } = captureTools();
  const context = (subject: string, toolName: string): ToolHandlerContext => ({
    toolName,
    authInfo: { subject, scopes: ["snippets"] },
  });
  const editor = context("editor", "run_snippet");
  const guest = context("guest", "run_snippet");
  const native = {
    content: [{ type: "text", text: "OK" }],
    structuredContent: { value: 2 },
    _meta: { ui: { resourceUri: "ui://app/example" } },
  };
  let count = 0;
  registerSnippetProvider(host, {
    requiredScopes: ["snippets"],
    runResourceUri: "ui://app/default",
    authorize: (name, ctx) => name === "public" || ctx?.authInfo?.subject === "editor",
    snippets: [
      { name: "public", description: "Read", inputSchema: { type: "object" }, run: () => native },
      {
        name: "private",
        description: "Private",
        inputSchema: {
          type: "object",
          properties: { quantity: { type: "integer", minimum: 1 } },
          required: ["quantity"],
          additionalProperties: false,
        },
        run(input, ctx) {
          assertStrictEquals(ctx, editor);
          assertEquals(input, { quantity: 2 });
          count++;
          return native;
        },
      },
    ],
  });
  const list = tools.get("list_snippets")!;
  const run = tools.get("run_snippet")!;
  assertEquals(run.tool.requiredScopes, ["snippets"]);
  assertEquals(JSON.stringify(run.tool.inputSchema).includes("private"), false);
  assertEquals(
    (await list.run({}, context("guest", "list_snippets")) as {
      structuredContent: { snippets: { name: string }[] };
    }).structuredContent.snippets.map((x) => x.name),
    ["public"],
  );
  assertEquals(
    (await list.run({}, context("editor", "list_snippets")) as {
      structuredContent: { snippets: { name: string }[] };
    }).structuredContent.snippets.map((x) => x.name),
    ["public", "private"],
  );
  const denied = await run.run({ name: "private", input: { quantity: 2 } }, guest);
  assertEquals(denied, await run.run({ name: "missing", input: { quantity: 2 } }, guest));
  assertEquals((denied as { isError: boolean }).isError, true);
  assertEquals(
    (await run.run({ name: "private", input: { quantity: 0 } }, editor) as { isError: boolean })
      .isError,
    true,
  );
  assertEquals(await run.run({ name: "private", input: { quantity: 2 } }, editor), native);
  assertEquals(count, 1);
});

Deno.test("a saved human-named snippet inherits its registered viewer across the chain", async () => {
  const catalog = createSnippetCatalog();
  const source = "return api.params.amount;";
  const scope = "qa";
  const entry = await catalog.save(
    scope,
    catalog.recordSuccess(scope, source, { amount: 2 }),
    "Mes factures échues du lundi",
  );
  const resourceUri = "ui://app/invoices";
  const { host, tools } = captureTools();
  let runs = 0;
  const perRunMeta = { tenant: "qa", ui: { theme: "light" } };
  registerSnippetProvider(host, {
    runResourceUri: resourceUri,
    snippets: [{
      name: entry.name,
      description: "Invoices",
      inputSchema: {
        type: "object",
        properties: { amount: { type: "number" } },
        required: ["amount"],
      },
      run: (input) =>
        catalog.run(scope, entry.name, input, {
          validate: () => input,
          execute: async (code, params) => {
            runs++;
            const value = await runProgram(code, params, () =>
              Promise.reject(new Error("Unexpected call")));
            return { content: [], structuredContent: { value }, _meta: perRunMeta };
          },
        }),
    }],
  });
  const chain = createSnippetChain(
    new Map([["erp", {
      names: [entry.name],
      call: async (tool, args) => await tools.get(tool)!.run(args) as CallToolResult,
    }]]),
  );
  const result = await chain({
    code: `
const names = await api.listSnippets("erp");
const receipt = await api.runSnippet("erp", names[0].name, { amount: 91 });
await api.panel(receipt.id);
return receipt.value;`,
  });
  assertEquals((result.structuredContent as { value: number }).value, 91);
  assertEquals(readSnippetPanels(result)[0].result._meta, {
    tenant: "qa",
    ui: { theme: "light", resourceUri },
  });
  assertEquals(composeSnippetBoard(result).children.map((child) => child.resourceUri), [
    resourceUri,
  ]);
  assertEquals(perRunMeta, { tenant: "qa", ui: { theme: "light" } });
  assertEquals(runs, 1);
});
