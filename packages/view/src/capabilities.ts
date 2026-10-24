/**
 * Capability-gated proxy for `App.callServerTool`.
 *
 * The view-side SDK refuses to call server tools when the host did not
 * advertise the `serverTools` capability during `ui/initialize`. Doing the
 * check here (pre-flight) gives the caller a precise error message instead
 * of a cryptic JSON-RPC failure deep inside ext-apps.
 *
 * @module
 */

import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { MCPViewError } from "./errors.ts";

export function missingServerToolsError(toolName: string): MCPViewError {
  return new MCPViewError(
    "MISSING_SERVER_TOOLS_CAPABILITY",
    `Cannot call tool "${toolName}": host did not advertise \`serverTools\` capability during ui/initialize. Either the host does not support server tool calls, or the MCP server is not reachable through this host.`,
    { tool: toolName },
  );
}

/**
 * Call a tool on the originating MCP server, gated on `capabilities.serverTools`.
 *
 * Throws {@link MissingServerToolsCapabilityError} if the capability is
 * absent. Otherwise delegates to `app.callServerTool`, letting transport
 * errors propagate and tool-level errors (`isError: true`) flow back in
 * the result — per the spec's error contract.
 *
 * @param app - The ext-apps App instance (post-handshake).
 * @param capabilities - Snapshot of host capabilities from `app.getHostCapabilities()`.
 * @param name - Tool name to invoke on the MCP server.
 * @param args - Arguments passed to the tool.
 */
export function callServerToolGated(
  app: App,
  capabilities: McpUiHostCapabilities,
  name: string,
  args?: Record<string, unknown>,
): Promise<CallToolResult> {
  if (!capabilities.serverTools) {
    throw missingServerToolsError(name);
  }
  return app.callServerTool({ name, arguments: args });
}
