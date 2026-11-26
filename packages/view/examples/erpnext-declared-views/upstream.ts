export const revision = "2026-07-28";
export const uiMime = "text/html;profile=mcp-app";
export const uiCapability = { "io.modelcontextprotocol/ui": { mimeTypes: [uiMime] } };
let requestId = 0;

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
