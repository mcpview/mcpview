import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  createSnippetCatalog,
  type SnippetParameters,
  type SnippetStore,
} from "../../../server/snippets.ts";
import { encodeValue, runProgram } from "./sandbox.ts";

export const panelMetaKey = "io.mcpview/snippet-panels";
export const boardUri = "ui://multi-mcp-snippets/board";

type RecordValue = Record<string, unknown>;
type Provider = {
  names: readonly string[];
  call: (
    tool: "list_snippets" | "run_snippet",
    args: RecordValue,
    signal: AbortSignal,
  ) => Promise<CallToolResult>;
};

interface Panel {
  id: string;
  provider: string;
  name: string;
  title: string;
  result: CallToolResult;
}

const maxNativeSize = 4 * 1024 * 1024;
const maxNativeBytes = 6 * 1024 * 1024;
const maxSavedChains = 64;

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const providerErrors = new Map([
  ["INVALID_INPUT", "Check the snippet input against its declared schema."],
  ["ARTIFACT_UNAVAILABLE", "The input artifact is unavailable. Regenerate it before retrying."],
  ["PROFILE_INVALID", "The configured slicer profile is invalid or unavailable."],
  ["UPSTREAM_ERROR", "The upstream operation failed."],
  ["TIMEOUT", "The upstream operation timed out."],
]);

function providerError(result: CallToolResult): string {
  const data = result.structuredContent;
  const error = isRecord(data) ? data.error : undefined;
  const code = isRecord(error) ? error.code : undefined;
  return (typeof code === "string" ? providerErrors.get(code) : undefined) ??
    "The provider reported an execution error.";
}

function validateParams(input: unknown, shape?: SnippetParameters): RecordValue {
  if (!isRecord(input)) throw new Error("Supply params as a JSON object.");
  encodeValue(input, 8192);
  if (shape) {
    const keys = Object.keys(input);
    if (
      keys.length !== Object.keys(shape).length ||
      keys.some((key) => {
        const value = input[key];
        const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
        return !Object.hasOwn(shape, key) || shape[key] !== kind;
      })
    ) {
      throw new Error("Replay parameters must match the saved key names and JSON types.");
    }
  }
  return input;
}

function output(value: unknown, panels: Panel[] = [], saved?: string): CallToolResult {
  const visible = {
    value,
    panels: panels.map(({ result: _result, ...panel }) => panel),
    ...(saved === undefined ? {} : { saved }),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(visible) }],
    structuredContent: visible,
    _meta: { [panelMetaKey]: panels },
  };
}

export function createChain(providers: ReadonlyMap<string, Provider>, store?: SnippetStore) {
  const localScope = "single-user-loopback-pilot";
  const catalog = createSnippetCatalog({ maxPendingReferences: maxSavedChains, store });
  type Reservation = { pending: number; saved: boolean };
  let reservations: Promise<Map<string, Reservation>> | undefined;

  async function execute(code: string, params: RecordValue, callerSignal?: AbortSignal) {
    const receipts = new Map<string, Panel>();
    const selected = new Map<string, Panel>();
    let totalBytes = 0;
    const value = await runProgram(code, params, async (operation, args, signal) => {
      signal.throwIfAborted();
      const [first, second, input] = args;
      if (operation === "panel") {
        const panel = typeof first === "string" ? receipts.get(first) : undefined;
        if (!panel || args.length > 2) throw new Error("Select a receipt from this execution.");
        if (second !== undefined && (typeof second !== "string" || second.length > 120)) {
          throw new Error("Panel titles may contain at most 120 characters.");
        }
        selected.set(panel.id, { ...panel, title: second ?? panel.title });
        return null;
      }
      const provider = typeof first === "string" ? providers.get(first) : undefined;
      if (!provider) throw new Error("Unknown snippet provider.");
      if (operation === "listSnippets" && args.length === 1) {
        const catalog = await provider.call("list_snippets", {}, signal);
        const snippets = isRecord(catalog.structuredContent)
          ? catalog.structuredContent.snippets
          : undefined;
        if (catalog.isError || !Array.isArray(snippets)) {
          throw new Error("Provider snippet catalog is unavailable.");
        }
        return snippets.filter((item) =>
          isRecord(item) && typeof item.name === "string" && provider.names.includes(item.name)
        ).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      }
      if (
        operation !== "runSnippet" || args.length !== 3 || typeof second !== "string" ||
        !provider.names.includes(second) || !isRecord(input)
      ) {
        throw new Error("Choose an approved named snippet and supply its input object.");
      }
      const result = await provider.call("run_snippet", { name: second, input }, signal);
      if (result.isError) throw new Error(`Snippet ${second}: ${providerError(result)}`);
      if (
        !isRecord(result.structuredContent) || !Object.hasOwn(result.structuredContent, "value")
      ) {
        throw new Error(`Snippet ${second} returned an invalid result.`);
      }
      const value = result.structuredContent.value;
      encodeValue(value);
      totalBytes += new TextEncoder().encode(encodeValue(result, maxNativeSize)).byteLength;
      if (totalBytes > maxNativeBytes) {
        throw new Error("Native snippet receipts exceed the board size limit.");
      }
      const id = crypto.randomUUID();
      receipts.set(id, { id, provider: first as string, name: second, title: second, result });
      return { id, value };
    }, callerSignal);
    return { value, panels: [...selected.values()] };
  }

  return async function call(input: RecordValue, signal?: AbortSignal): Promise<CallToolResult> {
    signal?.throwIfAborted();
    if (
      input.listSaved === true &&
      !("code" in input || "replay" in input || "saveAs" in input || "params" in input)
    ) {
      const snippets = await catalog.list(localScope);
      signal?.throwIfAborted();
      return output({ snippets });
    }
    if (
      typeof input.replay === "string" &&
      !("code" in input || "saveAs" in input || "listSaved" in input)
    ) {
      const { value, panels } = await catalog.run(
        localScope,
        input.replay,
        input.params === undefined ? {} : input.params,
        {
          validate: validateParams,
          execute: (code, params) => execute(code, params, signal),
        },
      );
      signal?.throwIfAborted();
      return output(value, panels);
    }
    if (typeof input.code !== "string" || "replay" in input || "listSaved" in input) {
      throw new Error("Supply code, replay, or listSaved.");
    }
    const params = validateParams(input.params === undefined ? {} : input.params);
    if (input.saveAs === undefined) {
      const { value, panels } = await execute(input.code, params, signal);
      signal?.throwIfAborted();
      return output(value, panels);
    }
    const name = input.saveAs;
    if (
      typeof name !== "string" || name.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
    ) {
      throw new Error(
        "Supply a saved chain name using letters, digits, periods, underscores, or hyphens.",
      );
    }
    const reservedNames =
      await (reservations ??= catalog.list(localScope).then((entries) =>
        new Map(entries.map(({ name }) => [name, { pending: 0, saved: true }]))
      ));
    signal?.throwIfAborted();
    const existing = reservedNames.get(name);
    if (!existing && reservedNames.size >= maxSavedChains) {
      throw new Error("The local saved chain catalog is full.");
    }
    const reservation = existing ?? { pending: 0, saved: false };
    reservation.pending++;
    reservedNames.set(name, reservation);
    try {
      const { value, panels } = await execute(input.code, params, signal);
      signal?.throwIfAborted();
      const ref = catalog.recordSuccess(localScope, input.code, params);
      const entry = await catalog.save(localScope, ref, name);
      reservation.saved = true;
      return output(value, panels, entry.name);
    } finally {
      reservation.pending--;
      if (!reservation.pending && !reservation.saved) reservedNames.delete(name);
    }
  };
}
