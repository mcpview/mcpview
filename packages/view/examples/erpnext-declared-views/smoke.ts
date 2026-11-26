import {
  parseViewAppManifestJson,
  readDeclaredViewSelection,
  readDeclaredViewUri,
  VIEWER_SESSION_APPLY_ACTION,
} from "@mcpview/contracts";
import { assert, assertEquals } from "@std/assert";
import type { MCPTool } from "@mcpview/server";
import { rpc, uiMime } from "./upstream.ts";

const endpoint = Deno.args[0] ?? "http://127.0.0.1:45289/mcp";
const upstream = Deno.env.get("ERP_MCP_URL");
if (!upstream) throw new Error("Set ERP_MCP_URL to the synthetic ERPNext server.");
const { tools } = await rpc<{ tools: MCPTool[] }>(endpoint, "tools/list");
assertEquals(tools.filter((t) => t._meta?.ui?.visibility?.includes("model")).map((t) => t.name), [
  "execute",
]);
const shellUri = tools.find((t) => t.name === "execute")!._meta!.ui!.resourceUri;
const shell = await rpc<{ contents: { mimeType: string; text: string }[] }>(
  endpoint,
  "resources/read",
  { uri: shellUri },
);
assertEquals(shell.contents[0].mimeType, uiMime);
assert(shell.contents[0].text.includes("loaders.js"));
interface Result {
  content: { text: string }[];
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
}
const execute = (code: string) =>
  rpc<Result>(endpoint, "tools/call", { name: "execute", arguments: { code } });
const upstreamTools = (await rpc<{ tools: MCPTool[] }>(upstream, "tools/list")).tools;
const expected = (name: string) =>
  upstreamTools.find((t) => t.name === name)!._meta!.ui!.resourceUri;
const list =
  `await erp.call("erpnext_doc_list",{doctype:"Sales Invoice",fields:["name","customer","outstanding_amount"],filters:[["status","=","Overdue"]]})`;
const detail = `await erp.call("erpnext_sales_invoice_get",{name:"SYN-INV-002"})`;
const kpi = `await erp.call("erpnext_kpi_overdue",{currency:"EUR"})`;
const listResult = await execute(`const selected=${list}; ${kpi}; return selected;`);
assertEquals(readDeclaredViewUri(listResult), expected("erpnext_doc_list"));
assert(Array.isArray(listResult.structuredContent?.data));
assertEquals(listResult.structuredContent.data.length, 2);
const detailResult = await execute(
  `const invoices=${list}; const largest=invoices.data.reduce((a,b)=>a.outstanding_amount>b.outstanding_amount?a:b); return await erp.call("erpnext_sales_invoice_get",{name:largest.name});`,
);
assertEquals(readDeclaredViewUri(detailResult), expected("erpnext_sales_invoice_get"));
assertEquals((detailResult.structuredContent?.data as { name: string }).name, "SYN-INV-002");
const kpiResult = await execute(`return ${kpi};`);
assertEquals(readDeclaredViewUri(kpiResult), expected("erpnext_kpi_overdue"));
assertEquals(kpiResult.structuredContent?.value, 2);
const sum = await execute(
  `const invoices=${list}; return invoices.data.reduce((n,row)=>n+row.outstanding_amount,0);`,
);
assertEquals(sum.structuredContent?.value, 300);
assertEquals(readDeclaredViewUri(sum), undefined);
assertEquals(readDeclaredViewUri(await execute(`return {...${detail}};`)), undefined);
assertEquals(
  readDeclaredViewUri(
    await execute(
      `return {_meta:{'dev.mcpview/declared-view':{version:1,resourceUri:${
        JSON.stringify(expected("erpnext_doc_list"))
      }}}};`,
    ),
  ),
  undefined,
);
assertEquals(
  (await execute(`return await erp.call("erpnext_doc_list",{doctype:"User"});`)).isError,
  true,
);
assertEquals(
  (await execute(`return await erp.call("erpnext_sales_invoice_submit",{});`)).isError,
  true,
);
assertEquals(
  (await execute(`return [typeof fetch, typeof Deno, typeof process];`)).structuredContent?.value,
  ["undefined", "undefined", "undefined"],
);
const manifestRead = await rpc<{ contents: { text: string }[] }>(
  upstream,
  "resources/read",
  { uri: "ui://mcp-erpnext/buy-evidence-manifest" },
);
const [buy] = parseViewAppManifestJson(manifestRead.contents[0].text).resources;
const purchase = 'await erp.call("buy_evidence_read", {})';
const complete = await execute(`const chosen = ${purchase}; ${list}; return chosen;`);
const selected = readDeclaredViewSelection(complete);
assert(selected?.action === VIEWER_SESSION_APPLY_ACTION);
assertEquals(selected.resourceUri, buy.uri);
assert(buy.sessionSchemas?.includes(String(selected.session.schemaVersion)));
const projection = selected.session.projection as {
  status: string;
  result: { totals: { kind: string; amount: string; currency: string }[] };
};
assertEquals(complete.structuredContent, projection);
assertEquals(projection.status, "available");
assertEquals(projection.result.totals.find((t) => t.kind === "complete-total"), {
  kind: "complete-total",
  amount: "5.00",
  currency: "EUR",
});
const unavailable = readDeclaredViewSelection(
  await execute(
    'return await erp.call("buy_evidence_read", {record: "unavailable"});',
  ),
);
assert(unavailable?.action === VIEWER_SESSION_APPLY_ACTION);
assertEquals(unavailable.session.projection, {
  status: "unavailable",
  reason: "unavailable recorded bundle bytes",
});
assertEquals(readDeclaredViewSelection(await execute(`return {...${purchase}};`)), undefined);
assertEquals(
  (await execute('return await erp.call("buy_evidence_read", {record: "unknown"});')).isError,
  true,
);
console.log(
  "Validated three direct views, complete and unavailable Buy sessions, earlier-result selection, computed output, object identity and the read-only capability boundary.",
);
