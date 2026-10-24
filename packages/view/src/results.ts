/** Narrow helpers for reading MCP tool-result application data. @module */

import type { CallToolResult } from "@modelcontextprotocol/client";

export type ResultData = Record<string, unknown>;

export interface ReadResultDataOptions<T extends ResultData> {
  /** Explicitly opt into parsing a text content block as JSON. */
  fallback?: "json-text";

  /** Optional domain guard. Invalid data is reported as absent. */
  validate?: (value: unknown) => value is T;
}

/**
 * Read record-shaped `structuredContent`. Text blocks are never inspected.
 * The SDK also permits arrays, primitives and null; read those from the raw result.
 *
 * Supply a domain type parameter for ergonomics and validate untrusted domain
 * shapes with `readResultData(..., { validate })` when runtime proof matters.
 */
export function readStructuredContent<T extends ResultData = ResultData>(
  result: Pick<CallToolResult, "structuredContent">,
): T | undefined {
  return isRecord(result.structuredContent) ? result.structuredContent as T : undefined;
}

/**
 * Read application data from an MCP tool result, preferring
 * `structuredContent`. Legacy JSON-in-text parsing occurs only when the
 * caller explicitly passes `{ fallback: "json-text" }`.
 */
export function readResultData<T extends ResultData = ResultData>(
  result: CallToolResult,
  options: ReadResultDataOptions<T> = {},
): T | undefined {
  if (options.fallback !== undefined && options.fallback !== "json-text") {
    throw new TypeError('readResultData: fallback must be "json-text" when provided');
  }

  if (result.structuredContent !== undefined) {
    const structured = readStructuredContent<ResultData>(result);
    return structured === undefined ? undefined : validate(structured, options.validate);
  }
  if (options.fallback !== "json-text") return undefined;

  for (const block of result.content) {
    if (block.type !== "text") continue;
    try {
      const parsed: unknown = JSON.parse(block.text);
      if (!isRecord(parsed)) continue;
      return validate(parsed, options.validate);
    } catch {
      // A human-readable summary is a legitimate text block. Continue to a
      // later block instead of treating it as malformed application data.
    }
  }
  return undefined;
}

function validate<T extends ResultData>(
  value: ResultData,
  guard?: (value: unknown) => value is T,
): T | undefined {
  return guard && !guard(value) ? undefined : value as T;
}

function isRecord(value: unknown): value is ResultData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
