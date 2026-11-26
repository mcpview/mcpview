/**
 * Preserve the origin of an MCP tool result returned through a code executor.
 * The executor supplies its own sandbox, authorization and tool dispatch.
 *
 * @module lib/server/ui/declared-view-execution
 */
import {
  DECLARED_VIEW_META_KEY,
  isExactSchemaIdentity,
  isExactUiResourceUri,
  type ViewAppManifestResource,
  VIEWER_SESSION_APPLY_ACTION,
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
  /** Exact published resource URIs for which this App can mount a direct tool result. */
  readonly mountableResourceUris: Iterable<string>;
  /** Resources from validated publisher manifests with a built session-action module. */
  readonly sessionResources?: Iterable<ViewAppManifestResource>;
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
  /** A private copy of the recorded session, present only for a matched session route. */
  readonly session?: Record<string, unknown>;
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
  /**
   * Attach a recording read and validated by the trusted binding for this
   * operation. Its business result is exposed to the guest as usual. The
   * recording is private to the host. Presentation declarations only establish
   * compatibility; they cannot authorize access or validate the evidence.
   */
  captureSession(
    toolName: string,
    result: R,
    session: unknown,
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
  const sessionSchemas = new Map<string, ReadonlySet<string>>();
  for (const resource of options.sessionResources ?? []) {
    if (
      !isExactUiResourceUri(resource.uri) ||
      !resource.acceptedActions?.includes(VIEWER_SESSION_APPLY_ACTION) ||
      !resource.sessionSchemas?.length ||
      !resource.sessionSchemas.every(isExactSchemaIdentity)
    ) {
      throw new TypeError(
        "Expected a mountable resource declaring the recorded session action and exact schemas",
      );
    }
    if (sessionSchemas.has(resource.uri)) {
      throw new TypeError(`Duplicate session resource: ${resource.uri}`);
    }
    sessionSchemas.set(resource.uri, new Set(resource.sessionSchemas));
  }
  const records = new Map<string, DeclaredViewResolution<R>>();

  function resolveSessionUri(
    hint: unknown,
    session: unknown,
  ): string | undefined {
    if (!isRecord(session) || typeof session.schemaVersion !== "string") return;
    const schema = session.schemaVersion;
    if (hint !== undefined) {
      return typeof hint === "string" && sessionSchemas.get(hint)?.has(schema)
        ? hint
        : undefined;
    }
    // With no upstream hint, the contract must identify exactly one compatible module.
    let matched: string | undefined;
    for (const [uri, schemas] of sessionSchemas) {
      if (!schemas.has(schema)) continue;
      if (matched !== undefined) return;
      matched = uri;
    }
    return matched;
  }

  function selectedUri(
    toolName: string,
    result: R,
    recorded?: { session: unknown },
  ): string | undefined {
    if (
      !declared.has(toolName) || result.isError ||
      (result.resultType !== undefined && result.resultType !== "complete") ||
      !Array.isArray(result.content)
    ) return undefined;
    const explicit = resourceOf(result._meta);
    const hint = explicit === undefined ? declared.get(toolName) : explicit;
    const uri = recorded
      ? resolveSessionUri(hint, recorded.session)
      : (isExactUiResourceUri(hint) && mountable.has(hint) ? hint : undefined);
    if (
      !uri || (options.acceptsResult && !options.acceptsResult(uri, result))
    ) return undefined;
    return uri;
  }

  function capture(
    toolName: string,
    result: R,
    data?: unknown,
    recorded?: { session: unknown },
  ): DeclaredViewCapture {
    const snapshot = structuredClone(result);
    // Only the current executor can vouch for a route on its outer App.
    if (snapshot._meta) delete snapshot._meta[DECLARED_VIEW_META_KEY];
    const resourceUri = selectedUri(toolName, snapshot, recorded);
    const reference = crypto.randomUUID();
    if (records.has(reference)) {
      throw new Error("Duplicate execution reference");
    }
    const resolution: DeclaredViewResolution<R> = {
      result: snapshot,
      ...(resourceUri && { resourceUri }),
      ...(resourceUri && isRecord(recorded?.session) &&
        { session: structuredClone(recorded.session) }),
    };
    records.set(reference, resolution);
    const projection = data === undefined ? result.structuredContent : data;
    return {
      data: structuredClone(
        projection === undefined ? result.content ?? {} : projection,
      ),
      reference,
    };
  }

  return {
    capture(toolName, result, data) {
      return capture(toolName, result, data);
    },
    captureSession(toolName, result, session) {
      return capture(toolName, result, undefined, { session });
    },
    resolve(reference) {
      return records.get(reference);
    },
  };
}
