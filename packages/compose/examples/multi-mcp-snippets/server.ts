import { McpApp } from "@mcpview/server";
import { createFileSnippetStore, createSnippetCatalog } from "@mcpview/server/snippets";
import {
  connectSnippetProviders,
  createSnippetChain,
  createSnippetExecuteTool,
} from "@mcpview/compose/code-mode";
import { parseProviders } from "./config.ts";

const boardUri = "ui://multi-mcp-snippets/board";
const mimeType = "text/html;profile=mcp-app";
function readPort(variable: string, fallback: number) {
  const port = Number(Deno.env.get(variable) ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid TCP port in ${variable}.`);
  }
  return port;
}

const configPath = Deno.env.get("PILOT_PROVIDERS_FILE");
const bindings = parseProviders(
  configPath ? JSON.parse(await Deno.readTextFile(configPath)) : [
    { alias: "cad", port: readPort("PILOT_CAD_SNIPPET_PORT", 3614), snippets: ["plate-stl"] },
    {
      alias: "slicer",
      port: readPort("PILOT_SLICER_SNIPPET_PORT", 3622),
      snippets: ["pla-print-estimate"],
    },
  ],
);
const serverPort = readPort("PILOT_CHAIN_PORT", 3630);
if (bindings.some(({ port }) => port === serverPort)) {
  throw new Error("The chain server requires a separate loopback port.");
}
const connections = await connectSnippetProviders(bindings.map(({ alias, snippets, port }) => ({
  alias,
  snippets,
  url: new URL(`http://127.0.0.1:${port}/mcp`),
})));
const storePath = Deno.env.get("PILOT_SNIPPET_STORE");
const catalog = createSnippetCatalog({
  store: storePath ? createFileSnippetStore(storePath) : undefined,
});
const execute = createSnippetChain(connections.providers, catalog);

const app = new McpApp({
  name: "multi-mcp-snippets",
  version: "0.1.0",
  extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [mimeType] } },
  maxConcurrent: 2,
  backpressureStrategy: "reject",
  validateSchema: true,
  toolErrorMapper: (error) => error instanceof Error ? error.message : "Chain execution failed.",
  instructions: "Compose approved saved MCP snippets in one JavaScript execution.",
});

app.registerTool(
  createSnippetExecuteTool({
    resourceUri: boardUri,
    providers: connections.providers,
    savedChains: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: Boolean(configPath),
      openWorldHint: Boolean(configPath),
      idempotentHint: false,
    },
  }),
  (args, context) =>
    execute(args, {
      scope: "single-user-loopback-pilot",
      signal: context?.request?.signal,
    }),
);

const htmlPath = Deno.env.get("PILOT_BOARD_HTML") ??
  new URL("./ui/dist/index.html", import.meta.url);
const resourceMeta = {
  ui: { csp: { resourceDomains: [], connectDomains: [] } },
  "openai/widgetCSP": { resource_domains: [], connect_domains: [] },
};
app.registerResource(
  {
    uri: boardUri,
    name: "CAD and slicer results",
    mimeType,
    _meta: resourceMeta,
  },
  async () => ({
    uri: boardUri,
    mimeType,
    text: await Deno.readTextFile(htmlPath),
    _meta: resourceMeta,
  }),
);

const handler = await app.getFetchHandler({ maxBodyBytes: 131_072 });
const server = Deno.serve(
  {
    hostname: "127.0.0.1",
    port: serverPort,
  },
  (request) =>
    new URL(request.url).pathname === "/mcp"
      ? handler(request)
      : new Response(null, { status: 404 }),
);
try {
  await server.finished;
} finally {
  await connections.close();
}
