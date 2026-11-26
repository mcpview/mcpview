import {
  defineViewAppManifest,
  isExactUiResourceUri,
  VIEW_APP_MANIFEST_SCHEMA,
  type ViewAppManifestResource,
} from "@mcpview/contracts";

export const revision = "2026-07-28";
export const uiMime = "text/html;profile=mcp-app";
export const uiCapability = { "io.modelcontextprotocol/ui": { mimeTypes: [uiMime] } };
let requestId = 0;

/** Discover the publisher's manifest through MCP and intersect it with this build's session modules. */
export async function discoverSessionResources(
  url: string,
  sessionModules: ReadonlySet<string>,
): Promise<ViewAppManifestResource[]> {
  const declarations: ViewAppManifestResource[] = [];
  if (!sessionModules.size) return declarations;
  let cursor: string | undefined;
  do {
    const page: { resources: { uri: string; mimeType?: string }[]; nextCursor?: string } =
      await rpc(
        url,
        "resources/list",
        cursor ? { cursor } : {},
      );
    for (const resource of page.resources) {
      if (resource.mimeType !== "application/json" || !isExactUiResourceUri(resource.uri)) continue;
      const { contents } = await rpc<{ contents: { uri: string; text?: string }[] }>(
        url,
        "resources/read",
        { uri: resource.uri },
      );
      for (const item of contents) {
        if (item.uri !== resource.uri || !item.text) continue;
        const json = JSON.parse(item.text);
        if (json?.schemaVersion !== VIEW_APP_MANIFEST_SCHEMA) continue;
        const manifest = defineViewAppManifest(json);
        declarations.push(...manifest.resources.filter((r) => sessionModules.has(r.uri)));
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return declarations;
}

/** This example targets the stateless HTTP transport and its per-request metadata. */
export async function rpc<T>(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "MCP-Protocol-Version": revision,
    "Mcp-Method": method,
  };
  if (method === "tools/call") headers["Mcp-Name"] = String(params.name);
  if (method === "resources/read") headers["Mcp-Name"] = String(params.uri);
  const meta = {
    "io.modelcontextprotocol/protocolVersion": revision,
    "io.modelcontextprotocol/clientInfo": {
      name: "ERPNext declared-view example",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": { extensions: uiCapability },
  };
  const response = await fetch(url, {
    method: "POST",
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(3000),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++requestId,
      method,
      params: { ...params, _meta: meta },
    }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message || `ERPNext HTTP ${response.status}`);
  }
  return envelope.result;
}
