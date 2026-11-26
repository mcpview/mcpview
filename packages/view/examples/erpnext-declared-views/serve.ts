import {
  createDeclaredViewExecution,
  type DeclaredViewNativeResult,
  McpApp,
  type MCPTool,
} from "@mcpview/server";
import { withDeclaredViewUri } from "@mcpview/contracts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runReadProgram } from "./sandbox.ts";
import { discoverSessionResources, rpc, uiCapability, uiMime } from "./upstream.ts";
import { buyEvidenceTool, createBuyEvidenceReader } from "./buy-archive.ts";

// Explicit capabilities of this synthetic invoice workspace. Descriptors and results select the UI.
const readScope = new Set(["erpnext_doc_list", "erpnext_kpi_overdue", "erpnext_sales_invoice_get"]);
const backend = Deno.env.get("ERP_MCP_URL");
if (!backend || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(backend).hostname)) {
  throw new Error("Set ERP_MCP_URL to the loopback synthetic ERPNext MCP endpoint.");
}
const port = Number(Deno.env.get("PORT") ?? 45289);
const traceProgram = Deno.env.get("TRACE_PROGRAM") === "1";
const origin = new URL(Deno.env.get("PUBLIC_ORIGIN") ?? `http://127.0.0.1:${port}`).origin;
const assets = pathToFileURL(resolve(Deno.env.get("VIEW_ASSETS_DIR") ?? "dist") + "/");
type ViewEntry = {
  resourceUri: string;
  module: string;
  delivery: "tool-result" | "viewer.session.apply";
};
const manifest: { views: ViewEntry[] } = JSON.parse(
  await Deno.readTextFile(new URL("manifest.json", assets)),
);
const directUris = manifest.views.filter((v) => v.delivery === "tool-result").map((v) =>
  v.resourceUri
);
const sessionUris = new Set(
  manifest.views.filter((v) => v.delivery === "viewer.session.apply").map((v) => v.resourceUri),
);
const sessionResources = await discoverSessionResources(backend, sessionUris);
const readBuyEvidence = createBuyEvidenceReader(assets);
const shell = await Deno.readFile(new URL("shell.js", assets));
const assetFiles = new Set([
  "loaders.js",
  "adapter.js",
  ...manifest.views.map((view) => view.module.replace(/^\.\//, "")),
]);
const declarations: MCPTool[] = [];
let cursor: string | undefined;
do {
  const page: { tools: MCPTool[]; nextCursor?: string } = await rpc(
    backend,
    "tools/list",
    cursor ? { cursor } : {},
  );
  declarations.push(
    ...page.tools.filter((t) => readScope.has(t.name) && t.annotations?.readOnlyHint === true),
  );
  cursor = page.nextCursor;
} while (cursor);
function permits(tool: MCPTool, actor: "model" | "app") {
  return tool._meta?.ui?.visibility?.includes(actor) ?? true;
}
const appTools = declarations.filter((t) => permits(t, "app"));
// The archive supplies the recorded artifact. ERPNext supplies its display contract.
const modelTools = [...declarations.filter((t) => permits(t, "model")), buyEvidenceTool];
const shellUri = "ui://declared-views/workspace-v1";
const app = new McpApp({
  name: "erpnext-declared-views",
  version: "1.0.0",
  extensions: uiCapability,
  advertiseAppOnlyTools: true,
  validateSchema: true,
  maxConcurrent: 4,
  backpressureStrategy: "reject",
  toolErrorMapper: (error) => String(error instanceof Error ? error.message : error),
  instructions:
    "Read the synthetic ERPNext workspace. Its execute tool lists the available business operations.",
});
async function callRead(
  name: string,
  args: Record<string, unknown>,
  allowed: readonly { name: string }[],
) {
  if (
    !allowed.some((t) => t.name === name) ||
    (name === "erpnext_doc_list" && args.doctype !== "Sales Invoice")
  ) {
    throw new Error("This operation is outside the invoice workspace read scope.");
  }
  return await rpc<DeclaredViewNativeResult>(backend!, "tools/call", { name, arguments: args });
}
app.registerTool({
  name: "execute",
  description: [
    "Run a read-only JavaScript function body. Use erp.call(name, args) and return the original response to open a record.",
    "Available business operations: " + modelTools.map((t) => t.name).join(", ") + ".",
    `${buyEvidenceTool.name}: ${buyEvidenceTool.description} Arguments: ${
      JSON.stringify(buyEvidenceTool.inputSchema)
    }.`,
  ].join(" "),
  inputSchema: {
    type: "object",
    properties: { code: { type: "string", minLength: 1, maxLength: 16384 } },
    required: ["code"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ui: { resourceUri: shellUri, visibility: ["model"] },
    ...{ "openai/outputTemplate": shellUri },
  },
}, async ({ code }) => {
  if (traceProgram) console.info(JSON.stringify({ event: "program", code }));
  const execution = createDeclaredViewExecution({
    tools: modelTools,
    mountableResourceUris: directUris,
    sessionResources,
  });
  const trace: string[] = [];
  const output = await runReadProgram(String(code), async (name, args) => {
    if (name === buyEvidenceTool.name) {
      const { result, session } = await readBuyEvidence(args);
      trace.push(name);
      return execution.captureSession(name, result, session);
    }
    const native = await callRead(name, args, modelTools);
    trace.push(name);
    return execution.capture(name, native);
  });
  if ("native" in output) {
    const selected = execution.resolve(output.native.reference);
    if (!selected) throw new Error("Unknown result from the current execution.");
    console.info(JSON.stringify({
      event: "execute",
      trace,
      resourceUri: selected.resourceUri,
      ...(selected.session ? { action: "viewer.session.apply" } : {}),
    }));
    return selected.resourceUri
      ? withDeclaredViewUri(selected.result, selected.resourceUri, selected.session)
      : selected.result;
  }
  console.info(JSON.stringify({ event: "execute", trace, computed: true }));
  return {
    content: [{ type: "text", text: JSON.stringify(output.value) }],
    structuredContent: { value: output.value },
  };
});
for (const declaration of appTools) {
  app.registerAppOnlyTool(declaration, async (args) => {
    console.info(JSON.stringify({ event: "view-callback", tool: declaration.name }));
    return await callRead(declaration.name, args, appTools);
  });
}
const html =
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0}pre{white-space:pre-wrap}</style></head><body><main id="root" aria-live="polite"></main><script type="module">import {start} from ${
    JSON.stringify(origin + "/assets/shell.js")
  }; import {loaders} from ${
    JSON.stringify(origin + "/assets/loaders.js")
  }; start(loaders).catch(e=>document.getElementById("root").textContent=String(e));</script></body></html>`;
const resourceMeta = {
  ui: { domain: origin, csp: { resourceDomains: [origin], connectDomains: [] } },
  "openai/widgetDomain": origin,
  "openai/widgetCSP": { resource_domains: [origin], connect_domains: [] },
};
app.registerResource({
  uri: shellUri,
  name: "ERPNext workspace",
  mimeType: uiMime,
  _meta: resourceMeta,
}, (uri) => ({ uri: uri.toString(), mimeType: uiMime, text: html, _meta: resourceMeta }));
const handler = await app.getFetchHandler({ maxBodyBytes: 32768 });
Deno.serve({ hostname: "127.0.0.1", port }, async (req) => {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/assets/") && req.method === "GET") {
    const file = path.slice("/assets/".length);
    if (file !== "shell.js" && !assetFiles.has(file)) return new Response(null, { status: 404 });
    console.info(JSON.stringify({ event: "asset", file, ua: req.headers.get("user-agent") }));
    return new Response(file === "shell.js" ? shell : await Deno.readFile(new URL(file, assets)), {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  if (path !== "/mcp") return new Response(null, { status: 404 });
  const method = req.headers.get("Mcp-Method");
  const ua = req.headers.get("user-agent");
  console.info(JSON.stringify({ event: "request", method, name: req.headers.get("Mcp-Name"), ua }));
  return await handler(req);
});
