import type { MCPTool } from "@mcpview/server";
import type { SnippetProvider } from "./providers.ts";
import { maxCodeLength } from "./sandbox.ts";

/** Configure the single model-facing tool and its MCP Apps board resource. */
export interface SnippetExecuteToolOptions {
  readonly resourceUri: string;
  readonly providers: ReadonlyMap<string, Pick<SnippetProvider, "names">>;
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
  return {
    name: "execute",
    description: [
      "Run a JavaScript function body with api.params (the supplied JSON object).",
      "Use await api.listSnippets(provider) to discover approved snippets.",
      "Configured provider aliases: " + JSON.stringify(available) + ".",
      "await api.runSnippet(provider, name, input) returns a receipt {id, value}.",
      "Pass values between calls. Use await api.panel(receipt.id, optionalTitle) for each result to display, in display order. Return a JSON summary.",
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
