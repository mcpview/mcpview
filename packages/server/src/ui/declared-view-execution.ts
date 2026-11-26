/**
 * Preserve the origin of an MCP tool result returned through a code executor.
 * The executor supplies its own sandbox, authorization and tool dispatch.
 *
 * @module lib/server/ui/declared-view-execution
 */
import {
  DECLARED_VIEW_META_KEY,
  isExactUiResourceUri,
} from "@mcpview/contracts";
import { isRecord } from "../http/wire.ts";

/** Result received by the trusted adapter from its upstream MCP server. */
export interface DeclaredViewNativeResult {
  readonly content?: unknown;
  readonly structuredContent?: unknown;
  readonly _meta?: Record<string, unknown>;
  readonly isError?: boolean;
  readonly resultType?: string;
}

export interface DeclaredViewExecutionOptions<
  R extends DeclaredViewNativeResult,
> {
  /** Descriptors from the current, authorized upstream tool catalog. */
  readonly tools: Iterable<{ readonly name: string; readonly _meta?: unknown }>;
  /** Exact published resource URIs for which this App has a mountable module. */
  readonly mountableResourceUris: Iterable<string>;
  /** Additional per-resource compatibility check, e.g. for a versioned result schema. */
  readonly acceptsResult?: (resourceUri: string, result: R) => boolean;
}

/** Private adapter message. Only `data` is returned to the user program. */
export interface DeclaredViewCapture {
  readonly reference: string;
  readonly data: unknown;
}

export interface DeclaredViewResolution<R extends DeclaredViewNativeResult> {
  readonly result: R;
  readonly resourceUri?: string;
}

export interface DeclaredViewExecution<R extends DeclaredViewNativeResult> {
  /**
   * Record an authorized dispatcher response before returning its business data to
   * the program. By default the binding exposes structuredContent, then content.
   * An adapter may supply its usual JSON projection, such as an array of rows.
   */
  capture(
    toolName: string,
    result: R,
    data?: unknown,
  ): DeclaredViewCapture;
  /** Resolve a reference supplied by the trusted return adapter for this invocation. */
  resolve(reference: string): DeclaredViewResolution<R> | undefined;
}

function resourceOf(meta: unknown): unknown {
  return isRecord(meta) && isRecord(meta.ui) ? meta.ui.resourceUri : undefined;
}

/**
 * Create once per top-level execute invocation. Keep the registry on the
 * server and discard it when the invocation ends. The trusted executor retains
 * each reference alongside its immutable guest object handle. On return it
 * compares the actual guest handle by identity before serializing any data.
 * Only an unchanged object returned by a binding can yield its private
 * reference. Copied values, scalars and computed outputs are ordinary data.
 * Never obtain the reference from properties or JSON supplied by a program.
 */
export function createDeclaredViewExecution<
  R extends DeclaredViewNativeResult = DeclaredViewNativeResult,
>(
  options: DeclaredViewExecutionOptions<R>,
): DeclaredViewExecution<R> {
  const declared = new Map<string, unknown>();
  for (const tool of options.tools) {
    if (declared.has(tool.name)) {
      throw new TypeError(`Duplicate upstream tool: ${tool.name}`);
    }
    declared.set(tool.name, resourceOf(tool._meta));
  }
  const mountable = new Set(options.mountableResourceUris);
  const records = new Map<string, DeclaredViewResolution<R>>();

  function selectedUri(toolName: string, result: R): string | undefined {
    if (
      !declared.has(toolName) || result.isError ||
      (result.resultType !== undefined && result.resultType !== "complete") ||
      !Array.isArray(result.content)
    ) return undefined;
    const explicit = resourceOf(result._meta);
    const uri = explicit === undefined ? declared.get(toolName) : explicit;
    if (
      !isExactUiResourceUri(uri) || !mountable.has(uri)
    ) return undefined;
    if (options.acceptsResult && !options.acceptsResult(uri, result)) {
      return undefined;
    }
    return uri;
  }

  return {
    capture(
      toolName,
      result,
      data = result.structuredContent === undefined
        ? result.content ?? {}
        : result.structuredContent,
    ) {
      const snapshot = structuredClone(result);
      // Only the current executor can vouch for a route on its outer App.
      if (snapshot._meta) delete snapshot._meta[DECLARED_VIEW_META_KEY];
      const resourceUri = selectedUri(toolName, snapshot);
      const reference = crypto.randomUUID();
      if (records.has(reference)) {
        throw new Error("Duplicate execution reference");
      }
      records.set(
        reference,
        resourceUri ? { result: snapshot, resourceUri } : { result: snapshot },
      );
      return { data: structuredClone(data), reference };
    },
    resolve(reference) {
      return records.get(reference);
    },
  };
}
