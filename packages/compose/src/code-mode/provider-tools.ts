/** Register the discovery and replay protocol on a snippet-owning MCP server. @module */
import { Ajv2020 } from "npm:ajv@^8.17.1/dist/2020.js";
import type { McpApp, MCPTool, ToolHandlerContext } from "@mcpview/server";
import { extractUiMeta } from "../core/collector/extractor.ts";
import { isSnippetName } from "./providers.ts";

/** A named, host-owned snippet. The runner replays it using the current caller's authority. */
export interface ProviderSnippetDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly run: (
    input: Record<string, unknown>,
    context?: ToolHandlerContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** Discovery and replay policy for one upstream Code Mode provider. */
export interface SnippetProviderOptions {
  readonly snippets: readonly ProviderSnippetDefinition[];
  /** Evaluated for each listing and again for each replay, before reading the snippet input. */
  readonly authorize?: (name: string, context?: ToolHandlerContext) => boolean | Promise<boolean>;
  /** OAuth scopes enforced on both discovery and replay by the MCPView host. */
  readonly requiredScopes?: readonly string[];
  readonly runAnnotations?: MCPTool["annotations"];
  /** Static native MCP App resource if all served snippets use the same viewer. */
  readonly runResourceUri?: string;
}

function failure(code: string, text: string) {
  return {
    isError: true,
    content: [{ type: "text", text }],
    structuredContent: { error: { code } },
  };
}

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/**
 * Register `list_snippets` and `run_snippet`. Expose selected saved programs by name.
 * A successful runner returns its native MCP response with a JSON projection at
 * `structuredContent.value`. Provider-only view metadata is forwarded intact.
 *
 * @example
 * ```ts
 * registerSnippetProvider(app, {
 *   snippets: [{
 *     name: "overdue", description: "List overdue invoices",
 *     inputSchema: { type: "object" },
 *     run: (input, context) => replayInvoiceSnippet("overdue", input, context),
 *   }],
 *   requiredScopes: ["invoices:read"],
 * });
 * ```
 */
export function registerSnippetProvider(
  server: Pick<McpApp, "registerTool" | "getToolNames">,
  options: SnippetProviderOptions,
): void {
  if (server.getToolNames().some((name) => name === "list_snippets" || name === "run_snippet")) {
    throw new Error("Snippet discovery or replay tools are already registered.");
  }
  const resourceUri = options.runResourceUri;
  const schemas = new Ajv2020({ strict: false, useDefaults: true });
  const definitions = options.snippets.map(({ name, description, inputSchema, run }) => {
    if (!isSnippetName(name) || !object(inputSchema) || inputSchema.type !== "object") {
      throw new TypeError("Each snippet needs a valid name and an object input schema.");
    }
    const schema = structuredClone(inputSchema);
    const validate = schemas.compile(schema);
    if ("$async" in validate) throw new TypeError("Snippet input schemas must be synchronous.");
    return { descriptor: { name, description, inputSchema: schema }, validate, run };
  });
  const byName = new Map(definitions.map((def) => [def.descriptor.name, def]));
  if (byName.size !== definitions.length) throw new Error("Snippet names must be unique.");
  const authorized = async (name: string, context?: ToolHandlerContext) =>
    !options.authorize || (await options.authorize(name, context)) === true;
  const scopes = options.requiredScopes ? [...options.requiredScopes] : undefined;
  server.registerTool({
    name: "list_snippets",
    description: "List the saved snippets available to this caller and their input schemas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredScopes: scopes,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  }, async (_args, context) => {
    const snippets = [];
    for (const { descriptor } of definitions) {
      if (await authorized(descriptor.name, context)) snippets.push(descriptor);
    }
    return {
      content: snippets.map(({ name }) => name).join(", "),
      structuredContent: { snippets },
    };
  });
  server.registerTool({
    name: "run_snippet",
    description: "Replay a saved snippet using its declared input.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, input: { type: "object" } },
      required: ["name", "input"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
      idempotentHint: false,
      ...options.runAnnotations,
    },
    requiredScopes: scopes,
    ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
  }, async (args, context) => {
    const def = typeof args.name === "string" ? byName.get(args.name) : undefined;
    if (!def || !await authorized(def.descriptor.name, context)) {
      return failure("UNAVAILABLE", "The requested snippet is unavailable.");
    }
    if (!object(args.input) || Object.keys(args).length !== 2 || !def.validate(args.input)) {
      return failure("INVALID_INPUT", "Supply the snippet's declared input.");
    }
    const result = await def.run(args.input, context);
    if (result.isError === true) return result;
    if (!object(result.structuredContent) || !Object.hasOwn(result.structuredContent, "value")) {
      return failure("UPSTREAM_ERROR", "The saved snippet returned no value.");
    }
    if (!resourceUri || extractUiMeta(result)) return result;
    const meta = object(result._meta) ? result._meta : {};
    const ui = object(meta.ui) ? meta.ui : {};
    return { ...result, _meta: { ...meta, ui: { ...ui, resourceUri } } };
  });
}
