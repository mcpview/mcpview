/** Result metadata understood by mcpview's single-resource view dispatcher. */
export const DECLARED_VIEW_META_KEY = "dev.mcpview/declared-view";
export const VIEWER_SESSION_APPLY_ACTION = "viewer.session.apply" as const;

/** Shared by declarations and the result that selects one of their resources. */
export function isExactUiResourceUri(value: unknown): value is string {
  return typeof value === "string" &&
    /^ui:\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$/.test(value) &&
    !value.split(/[/?#]/).some((segment) => segment.toLowerCase() === "latest");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exact identities used in publisher manifests and recorded sessions. */
export function isExactSchemaIdentity(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() !== value) return false;
  const separator = value.lastIndexOf("/");
  const name = value.slice(0, separator);
  const version = value.slice(separator + 1);
  const mutableAlias = /(?:^|\/)(latest|stable|current|next|head|v\d+)(?=$|\/)/i;
  return separator > 0 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(name) && !mutableAlias.test(name) &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(version);
}

export type DeclaredViewSelection =
  | { resourceUri: string; action: "tool-result" }
  | {
    resourceUri: string;
    action: typeof VIEWER_SESSION_APPLY_ACTION;
    session: Record<string, unknown>;
  };

/** Read the delivery mode. The receiver must also know the exact module and its contract. */
export function readDeclaredViewSelection(result: unknown): DeclaredViewSelection | undefined {
  if (!record(result) || !record(result._meta)) return;
  const selection = result._meta[DECLARED_VIEW_META_KEY];
  if (!record(selection) || !isExactUiResourceUri(selection.resourceUri)) return;
  const resourceUri = selection.resourceUri;
  if (
    selection.version === 1 && selection.action === undefined && selection.session === undefined
  ) {
    return { resourceUri, action: "tool-result" };
  }
  if (
    selection.version === 2 && selection.action === VIEWER_SESSION_APPLY_ACTION &&
    record(selection.session) && isExactSchemaIdentity(selection.session.schemaVersion)
  ) {
    return { resourceUri, action: VIEWER_SESSION_APPLY_ACTION, session: selection.session };
  }
}

/** Read only direct tool-result routes (v1). Session-aware consumers use readDeclaredViewSelection. */
export function readDeclaredViewUri(result: unknown): string | undefined {
  const selection = readDeclaredViewSelection(result);
  return selection?.action === "tool-result" ? selection.resourceUri : undefined;
}

/** Add the trusted server's selection without changing the native result or its metadata. */
export function withDeclaredViewUri<T extends object>(
  result: T & { _meta?: Record<string, unknown> },
  resourceUri: string,
  session?: unknown,
): T & { _meta: Record<string, unknown> } {
  if (!isExactUiResourceUri(resourceUri)) throw new TypeError("Expected an exact ui:// URI");
  if (
    session !== undefined && (!record(session) || !isExactSchemaIdentity(session.schemaVersion))
  ) {
    throw new TypeError("Expected a recorded session with an exact schemaVersion");
  }
  const selection = session === undefined
    ? { version: 1, resourceUri }
    : { version: 2, resourceUri, action: VIEWER_SESSION_APPLY_ACTION, session };
  return {
    ...result,
    _meta: { ...result._meta, [DECLARED_VIEW_META_KEY]: selection },
  };
}
