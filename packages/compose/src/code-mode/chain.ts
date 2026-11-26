import type { CallToolResult } from "@modelcontextprotocol/client";
import type { SnippetCatalog, SnippetParameters } from "@mcpview/server/snippets";
import { SNIPPET_PANELS_META_KEY } from "./board.ts";
import { isSnippetName, type SnippetChainContext, type SnippetProvider } from "./providers.ts";
import { encodeValue, runProgram } from "./sandbox.ts";

type RecordValue = Record<string, unknown>;
/** Selected native result, available only to the MCP App in result metadata. */
export interface SnippetPanelReceipt {
  id: string;
  provider: string;
  name: string;
  title: string;
  result: CallToolResult;
}

const maxNativeSize = 4 * 1024 * 1024;
const maxNativeBytes = 6 * 1024 * 1024;
const maxSavedChains = 64;
const afterDispatch =
  "One or more upstream operations may have completed. Check their effects before replaying the chain.";
interface ExecutionStatus {
  dispatched: boolean;
  saving: boolean;
  diagnostic?: string;
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const providerErrors = new Map([
  ["INVALID_INPUT", "Check the snippet input against its declared schema."],
  ["ARTIFACT_UNAVAILABLE", "The input artifact is unavailable. Regenerate it before retrying."],
  ["PROFILE_INVALID", "The configured provider profile is invalid or unavailable."],
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

function output(
  value: unknown,
  panels: SnippetPanelReceipt[] = [],
  saved?: string,
): CallToolResult {
  const visible = {
    value,
    panels: panels.map(({ result: _result, ...panel }) => panel),
    ...(saved === undefined ? {} : { saved }),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(visible) }],
    structuredContent: visible,
    _meta: { [SNIPPET_PANELS_META_KEY]: panels },
  };
}

/** Execute input from the MCP tool using trusted context supplied separately by the host. */
export type SnippetChainExecutor = (
  input: Record<string, unknown>,
  context?: SnippetChainContext,
) => Promise<CallToolResult>;

/**
 * Run JavaScript against host-configured snippet providers. Selected results stay
 * out of guest memory except for their declared JSON value. Supplying a catalog
 * enables named chains for calls with a trusted scope.
 */
export function createSnippetChain(
  providers: ReadonlyMap<string, SnippetProvider>,
  catalog?: SnippetCatalog,
): SnippetChainExecutor {
  // Keep admission state only while saves overlap. Persistent catalogs are read again
  // on the next save so a completed tenant leaves no resident quota state here.
  const activeSaves = new Map<string, {
    users: number;
    stored: Promise<Set<string>>;
    saving: Set<string>;
  }>();

  async function execute(
    code: string,
    params: RecordValue,
    context: SnippetChainContext,
    status: ExecutionStatus,
  ) {
    const receipts = new Map<string, SnippetPanelReceipt>();
    const selected = new Map<string, SnippetPanelReceipt>();
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
        const catalog = await provider.call("list_snippets", {}, signal, context);
        signal.throwIfAborted();
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
      status.dispatched = true;
      status.diagnostic = undefined;
      const result = await provider.call("run_snippet", { name: second, input }, signal, context);
      signal.throwIfAborted();
      if (result.isError) {
        status.diagnostic = `Snippet ${second}: ${providerError(result)}`;
        throw new Error(status.diagnostic);
      }
      if (
        !isRecord(result.structuredContent) || !Object.hasOwn(result.structuredContent, "value")
      ) {
        status.diagnostic = `Snippet ${second} returned an invalid result.`;
        throw new Error(status.diagnostic);
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
    }, context.signal);
    return { value, panels: [...selected.values()] };
  }

  async function call(input: RecordValue, context: SnippetChainContext, status: ExecutionStatus) {
    const { signal, scope } = context;
    signal?.throwIfAborted();
    if (!isRecord(input)) throw new Error("Supply execute inputs as a JSON object.");
    const has = (key: string) => Object.hasOwn(input, key);
    const keysAllowed = (...keys: string[]) =>
      Object.keys(input).every((key) => keys.includes(key));
    if (has("code") && !has("saveAs") && keysAllowed("code", "params")) {
      if (typeof input.code !== "string") throw new Error("Supply a JavaScript function body.");
      const result = await execute(
        input.code,
        validateParams(input.params === undefined ? {} : input.params),
        context,
        status,
      );
      signal?.throwIfAborted();
      return output(result.value, result.panels);
    }
    if (!catalog || typeof scope !== "string" || !scope.trim()) {
      throw new Error("Saved chains require a configured catalog and a trusted scope.");
    }
    if (input.listSaved === true && keysAllowed("listSaved")) {
      const snippets = await catalog.list(scope);
      signal?.throwIfAborted();
      return output({ snippets });
    }
    if (isSnippetName(input.replay) && keysAllowed("replay", "params")) {
      const result = await catalog.run(
        scope,
        input.replay,
        input.params === undefined ? {} : input.params,
        {
          validate: validateParams,
          execute: (code, params) => execute(code, params, context, status),
        },
      );
      signal?.throwIfAborted();
      return output(result.value, result.panels);
    }
    if (
      typeof input.code !== "string" || !has("saveAs") || !keysAllowed("code", "saveAs", "params")
    ) {
      throw new Error("Supply code, replay, or listSaved.");
    }
    const name = input.saveAs;
    if (!isSnippetName(name)) {
      throw new Error(
        "Supply a nonempty saved chain name of up to 256 UTF-8 bytes without surrounding whitespace.",
      );
    }
    const params = validateParams(input.params === undefined ? {} : input.params);
    const keys = Object.keys(params);
    if (keys.length > 32 || keys.some((key) => new TextEncoder().encode(key).byteLength > 128)) {
      throw new Error("Saved chain parameter contract exceeds its size limit.");
    }
    let usage = activeSaves.get(scope);
    if (!usage) {
      usage = {
        users: 0,
        stored: catalog.list(scope).then((entries) => new Set(entries.map((entry) => entry.name))),
        saving: new Set(),
      };
      activeSaves.set(scope, usage);
    }
    usage.users++;
    let reserved = false;
    try {
      const savedNames = await usage.stored;
      signal?.throwIfAborted();
      if (usage.saving.has(name)) throw new Error("A save for this chain is already in progress.");
      if (!savedNames.has(name)) {
        if (savedNames.size >= maxSavedChains) throw new Error("The saved chain catalog is full.");
        savedNames.add(name);
        reserved = true;
      }
      // Serialize writes to this name within an executor, without blocking other names.
      usage.saving.add(name);
      try {
        if (!reserved) {
          const previous = await catalog.inspect(scope, name);
          if (previous.code !== input.code) throw new Error("Snippet name already in use.");
          validateParams(params, previous.parameters);
        }
        signal?.throwIfAborted();
        const result = await execute(input.code, params, context, status);
        signal?.throwIfAborted();
        status.saving = true;
        const ref = catalog.recordSuccess(scope, input.code, params);
        const saved = await catalog.save(scope, ref, name);
        reserved = false;
        return output(result.value, result.panels, saved.name);
      } finally {
        usage.saving.delete(name);
        if (reserved) savedNames.delete(name);
      }
    } finally {
      if (--usage.users === 0) activeSaves.delete(scope);
    }
  }

  return async (input, context = {}) => {
    const status: ExecutionStatus = { dispatched: false, saving: false };
    try {
      return await call(input, context, status);
    } catch (error) {
      if (!status.dispatched) throw error;
      if (context.signal?.aborted) {
        const reason = context.signal.reason;
        const name = reason instanceof DOMException && reason.name === "TimeoutError"
          ? "TimeoutError"
          : "AbortError";
        throw new DOMException(`Chain interrupted. ${afterDispatch}`, name);
      }
      // Preserve only diagnostics derived from known provider codes. A transport,
      // guest or storage exception may contain credentials, paths or native data.
      const message = status.saving
        ? "Failed to confirm that the chain was saved."
        : status.diagnostic && error instanceof Error && error.message === status.diagnostic
        ? status.diagnostic
        : "Chain execution failed.";
      throw new Error(`${message} ${afterDispatch}`);
    }
  };
}
