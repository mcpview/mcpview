import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { McpApp } from "../../../server/mod.ts";
import { createFileSnippetStore } from "../../../server/snippets.ts";
import { parseProviders } from "./config.ts";
import { boardUri, createChain } from "./chain.ts";
import { maxCodeLength } from "./sandbox.ts";

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
const connected = await Promise.allSettled(bindings.map(async ({ alias, port, snippets }) => {
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const client = new Client({ name: "multi-mcp-snippets", version: "0.1.0" }, {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
  });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { redirect: "error" },
      }),
      { timeout: 3000 },
    );
    return [alias, snippets, client] as const;
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}));
const providers = connected.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []);
const failure = connected.find((entry) => entry.status === "rejected");
if (failure) {
  await Promise.allSettled(providers.map(([, , client]) => client.close()));
  throw failure.reason;
}

const storePath = Deno.env.get("PILOT_SNIPPET_STORE");
const execute = createChain(
  new Map(providers.map(([provider, names, client]) => [provider, {
    names,
    call: async (
      tool: "list_snippets" | "run_snippet",
      args: Record<string, unknown>,
      signal: AbortSignal,
    ) => {
      try {
        return await client.callTool({ name: tool, arguments: args }, { signal, timeout: 25_000 });
      } catch {
        signal.throwIfAborted();
        throw new Error(`The ${provider} snippet service could not complete the request.`);
      }
    },
  }])),
  storePath ? createFileSnippetStore(storePath) : undefined,
);

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

app.registerTool({
  name: "execute",
  description: [
    "Run a JavaScript function body with api.params (the supplied JSON object).",
    "Discover approved snippets with await api.listSnippets(provider).",
    "Configured providers and approved snippets are " +
    JSON.stringify(Object.fromEntries(bindings.map(({ alias, snippets }) => [alias, snippets]))) +
    ".",
    "Call await api.runSnippet(provider, name, input) to get a receipt {id, value}.",
    "Add a result panel with await api.panel(receipt.id, optionalTitle). Return a JSON summary.",
    "Supply saveAs to save a successful chain in the local catalog. Use listSaved to discover saved chains, or replay with the saved name and a params object matching its parameter types.",
  ].join(" "),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      code: { type: "string", minLength: 1, maxLength: maxCodeLength },
      params: { type: "object" },
      saveAs: { type: "string", minLength: 1, maxLength: 64 },
      replay: { type: "string", minLength: 1, maxLength: 64 },
      listSaved: { type: "boolean", const: true },
    },
    oneOf: [
      { required: ["code"] },
      { required: ["replay"] },
      { required: ["listSaved"] },
    ],
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: Boolean(configPath),
    idempotentHint: false,
    openWorldHint: Boolean(configPath),
  },
  _meta: {
    ui: { resourceUri: boardUri, visibility: ["model"] },
    ...{ "openai/outputTemplate": boardUri },
  },
}, (args, context) => execute(args, context?.request?.signal));

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
  await Promise.allSettled(providers.map(([, , client]) => client.close()));
}
