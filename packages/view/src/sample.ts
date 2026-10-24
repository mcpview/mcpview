/**
 * `ctx.sample()` — wrap around `App.createSamplingMessage` from
 * `@modelcontextprotocol/ext-apps`.
 *
 * `sampling` in MCP terminology means: the View asks the host to run an LLM
 * inference on its behalf. The host owns the model connection (and may
 * modify, reject, or substitute the request — human-in-the-loop). Useful
 * when a View needs lightweight intelligence (auto-titles, summaries,
 * suggestions) without round-tripping through a server-side tool.
 *
 * Capability-gated on `host.capabilities.sampling`. Throws
 * `MCPViewError("MISSING_SAMPLING_CAPABILITY")` if the host did not
 * advertise it.
 *
 * For advanced use (`tools` in agentic loops, multimodal output, custom
 * `RequestOptions`), reach for `ctx.app.createSamplingMessage(...)` directly.
 *
 * @module
 */

import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ModelPreferences,
  SamplingMessage,
} from "@modelcontextprotocol/client";

import { MCPViewError } from "./errors.ts";

/** Default `maxTokens` when the caller does not specify one. */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * Args for `ctx.sample()`. Discriminated union: pass *exactly one* of
 * `prompt` (a single user message, the common case) or `messages` (full
 * multi-turn control). The TS compiler enforces this — it is not a runtime
 * convenience.
 */
export type SampleArgs =
  & (SampleArgsPrompt | SampleArgsMessages)
  & SampleCommon;

/** Sugar form: a single user message built from the `prompt` string. */
export interface SampleArgsPrompt {
  prompt: string;
  messages?: never;
}

/** Explicit form: caller provides the full message array. */
export interface SampleArgsMessages {
  prompt?: never;
  messages: SamplingMessage[];
}

/** Fields shared by both forms. */
export interface SampleCommon {
  /** Optional system prompt prepended to the conversation. */
  systemPrompt?: string;
  /** Default 1024. */
  maxTokens?: number;
  temperature?: number;
  modelPreferences?: ModelPreferences;
  stopSequences?: string[];
  metadata?: CreateMessageRequest["params"]["metadata"];
}

/**
 * Result of `ctx.sample()`.
 *
 * `text` is a convenience: the concatenation of every `type: "text"` block
 * in the response content. **It is empty when the host returned multimodal
 * (image/audio) or tool-use blocks.** Callers that need full fidelity must
 * read `raw.content` directly. Use `ctx.app.createSamplingMessage(...)`
 * straight when working with tools or non-text outputs.
 */
export interface SampleResult {
  /** Concatenated text from `raw.content` blocks of `type: "text"`. */
  readonly text: string;
  /** Why the model stopped: `"endTurn"`, `"stopSequence"`, `"maxTokens"`, … */
  readonly stopReason?: string;
  /** Model id the host actually selected (may differ from `modelPreferences`). */
  readonly model?: string;
  /** Raw ext-apps response — read this for multimodal or tool-use output. */
  readonly raw: CreateMessageResult;
}

/**
 * Internal: gated wrapper around `app.createSamplingMessage`.
 *
 * Validates args (mutual exclusion is enforced at type level, but a runtime
 * check guards against `as any` casts), checks the host capability, then
 * forwards to ext-apps with sensible defaults.
 */
export async function sampleGated(
  app: App,
  capabilities: McpUiHostCapabilities,
  args: SampleArgs,
): Promise<SampleResult> {
  if (!capabilities.sampling) {
    throw new MCPViewError(
      "MISSING_SAMPLING_CAPABILITY",
      "Host did not advertise the `sampling` capability — ctx.sample() unavailable. " +
        "Either negotiate the capability with the host, or fall back to a server-side " +
        "tool that performs the inference.",
      { capability: "sampling" },
    );
  }

  const hasPrompt = args.prompt !== undefined;
  const hasMessages = args.messages !== undefined;
  if (hasPrompt === hasMessages) {
    throw new MCPViewError(
      "INVALID_SAMPLE_ARGS",
      "ctx.sample() requires exactly one of `prompt` or `messages` (got " +
        (hasPrompt ? "both" : "neither") + ").",
      { hasPrompt, hasMessages },
    );
  }

  const messages: SamplingMessage[] = hasPrompt
    ? [{ role: "user", content: { type: "text", text: args.prompt as string } }]
    : args.messages as SamplingMessage[];

  const raw = await app.createSamplingMessage({
    messages,
    maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    systemPrompt: args.systemPrompt,
    temperature: args.temperature,
    modelPreferences: args.modelPreferences,
    stopSequences: args.stopSequences,
    metadata: args.metadata,
  });

  return {
    text: extractText(raw.content),
    stopReason: raw.stopReason,
    model: raw.model,
    raw,
  };
}

/**
 * Concatenate text from a `CreateMessageResult.content` payload. The result
 * type allows either a single content block or an array; we normalise to
 * an array and pull the `type: "text"` blocks. Non-text blocks are skipped
 * silently — callers that care must read `raw.content`.
 */
function extractText(content: CreateMessageResult["content"]): string {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}
