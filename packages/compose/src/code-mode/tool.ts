import type { MCPTool } from "@mcpview/server";
import type { SnippetProvider } from "./providers.ts";
import { snippetPorts } from "./sync.ts";
import { maxCodeLength } from "./sandbox.ts";

/** Configure the single model-facing tool and its MCP Apps board resource. */
export interface SnippetExecuteToolOptions {
  readonly resourceUri: string;
  readonly providers: ReadonlyMap<string, Pick<SnippetProvider, "names" | "events">>;
  /** Enable this when the chain uses a catalog and the host supplies a trusted scope. */
  readonly savedChains?: boolean;
  readonly annotations?: MCPTool["annotations"];
}

/** Build the tool declaration for registration with an MCPView server. */
export function createSnippetExecuteTool(options: SnippetExecuteToolOptions): MCPTool {
  if (
    !options.resourceUri.startsWith("ui://") || !URL.canParse(options.resourceUri) ||
    !new URL(options.resourceUri).host
  ) {
    throw new Error("Supply a ui:// resource URI for the board.");
  }
  const available = [...options.providers.keys()];
  const eventPorts = [...options.providers].flatMap(([provider, config]) =>
    config.names.flatMap((snippet) => {
      const ports = snippetPorts(config.events, snippet);
      return ports ? [{ provider, snippet, ...ports }] : [];
    })
  );
  return {
    name: "execute",
    description: [
      "Run a JavaScript function body with api.params (the supplied JSON object).",
      "Use await api.listSnippets(provider) to discover approved snippets.",
      "Configured provider aliases: " + JSON.stringify(available) + ".",
      "await api.runSnippet(provider, name, input) returns a receipt {id, value}.",
      "Pass values between calls. Use await api.panel(receipt.id, optionalTitle) for each result to display, in display order. Return a JSON summary.",
      ...(eventPorts.length
        ? [
          "After selecting both panels, use await api.sync({from: source.id, event, to: target.id, action}) to route a UI event between them.",
          "Use the source's declared emits and the target's declared accepts. Available panel event ports: " +
          JSON.stringify(eventPorts) + ".",
        ]
        : []),
      ...(options.savedChains
        ? [
          "Use saveAs to save a successful chain, listSaved to list your saved chains, or replay with the saved name and new params.",
        ]
        : []),
    ].join(" "),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string", minLength: 1, maxLength: maxCodeLength },
        params: { type: "object" },
        ...(options.savedChains
          ? {
            saveAs: { type: "string", minLength: 1, maxLength: 256 },
            replay: { type: "string", minLength: 1, maxLength: 256 },
            listSaved: { type: "boolean", const: true },
          }
          : {}),
      },
      ...(options.savedChains
        ? { oneOf: [{ required: ["code"] }, { required: ["replay"] }, { required: ["listSaved"] }] }
        : { required: ["code"] }),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
      ...options.annotations,
      ...(options.savedChains ? { readOnlyHint: false } : {}),
    },
    _meta: {
      ui: { resourceUri: options.resourceUri, visibility: ["model"] },
      ...{ "openai/outputTemplate": options.resourceUri },
    },
  };
}
