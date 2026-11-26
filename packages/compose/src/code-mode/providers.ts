import type { CallToolResult } from "@modelcontextprotocol/client";
import type { ViewComponentEventPorts } from "../core/types/components.ts";

/** Trusted, per-request server context, supplied by the host rather than guest code. */
export interface SnippetChainContext {
  /** Catalog partition derived from the authenticated principal and integration. */
  readonly scope?: string;
  /** Cancellation of the incoming MCP request. */
  readonly signal?: AbortSignal;
}

/** A configured MCP binding. The host resolves the caller's upstream authority on every call. */
export interface SnippetProvider {
  /** The subset of this provider's snippets reachable by a program. */
  readonly names: readonly string[];
  /** Board event ports declared by the host for exact snippet names. */
  readonly events?: Readonly<Record<string, ViewComponentEventPorts>>;
  /** Forward only these protocol operations with host-owned transport credentials. */
  call(
    tool: "list_snippets" | "run_snippet",
    args: Record<string, unknown>,
    signal: AbortSignal,
    context: SnippetChainContext,
  ): Promise<CallToolResult>;
}

/** Configured aliases identifying providers in a program. */
export function isSnippetIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

/** MCPView catalog names are exact, nonblank strings of at most 256 UTF-8 bytes. */
export function isSnippetName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 &&
    value === value.trim() && new TextEncoder().encode(value).byteLength <= 256;
}
