/** Result metadata understood by mcpview's single-resource view dispatcher. */
export const DECLARED_VIEW_META_KEY = "dev.mcpview/declared-view";

/** Shared by declarations and the result that selects one of their resources. */
export function isExactUiResourceUri(value: unknown): value is string {
  return typeof value === "string" &&
    /^ui:\/\/[A-Za-z0-9][A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*$/.test(value) &&
    !value.split(/[/?#]/).some((segment) => segment.toLowerCase() === "latest");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a v1 selection. The receiving dispatcher must also know the exact URI. */
export function readDeclaredViewUri(result: unknown): string | undefined {
  if (!record(result) || !record(result._meta)) return;
  const selection = result._meta[DECLARED_VIEW_META_KEY];
  if (record(selection) && selection.version === 1 && isExactUiResourceUri(selection.resourceUri)) {
    return selection.resourceUri;
  }
}

/** Add the trusted server's selection without changing the native result or its metadata. */
export function withDeclaredViewUri<T extends object>(
  result: T & { _meta?: Record<string, unknown> },
  resourceUri: string,
): T & { _meta: Record<string, unknown> } {
  if (!isExactUiResourceUri(resourceUri)) throw new TypeError("Expected an exact ui:// URI");
  return {
    ...result,
    _meta: { ...result._meta, [DECLARED_VIEW_META_KEY]: { version: 1, resourceUri } },
  };
}
