/** Run selected snippets across host-configured MCP providers in one Code Mode call. */
export {
  createSnippetChain,
  type SnippetChainExecutor,
  type SnippetPanelReceipt,
} from "./chain.ts";
export {
  connectSnippetProviders,
  type SnippetMcpClient,
  type SnippetProviderBinding,
  type SnippetProviderConnections,
} from "./connections.ts";
export type { SnippetChainContext, SnippetProvider } from "./providers.ts";
export { createSnippetExecuteTool, type SnippetExecuteToolOptions } from "./tool.ts";
export {
  type ProviderSnippetDefinition,
  registerSnippetProvider,
  type SnippetProviderOptions,
} from "./provider-tools.ts";
