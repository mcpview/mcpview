import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  isSnippetIdentifier,
  isSnippetName,
  type SnippetChainContext,
  type SnippetProvider,
} from "./providers.ts";

/** The MCP operation used by a snippet binding. The host retains ownership of supplied clients. */
export type SnippetMcpClient = Pick<Client, "callTool">;

/** Use an explicit HTTP endpoint or a client already authorized by the host. */
export type SnippetProviderBinding =
  & {
    readonly alias: string;
    readonly snippets: readonly string[];
    readonly events?: SnippetProvider["events"];
  }
  & ({
    readonly url: URL | string;
    readonly requestInit?: RequestInit;
    readonly client?: never;
  } | {
    /** A resolver can select a borrowed client using the trusted request scope. */
    readonly client:
      | SnippetMcpClient
      | ((context: SnippetChainContext) => SnippetMcpClient | Promise<SnippetMcpClient>);
    readonly url?: never;
    readonly requestInit?: never;
  });

/** Connections available to a snippet chain. Close once the containing MCP server is stopped. */
export interface SnippetProviderConnections {
  readonly providers: ReadonlyMap<string, SnippetProvider>;
  close(): Promise<void>;
}

/**
 * Connect the explicitly configured upstream MCPs. HTTP bindings share one host-owned
 * upstream identity for the lifetime of this pool. For different authorities in a
 * multi-user server, supply a client resolver keyed by the authenticated request context.
 * A partial startup closes every connection opened by the pool.
 */
export async function connectSnippetProviders(
  bindings: readonly SnippetProviderBinding[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<SnippetProviderConnections> {
  options.signal?.throwIfAborted();
  if (!bindings.length) throw new Error("Configure at least one snippet provider.");
  const aliases = new Set<string>();
  const prepared = bindings.map((binding) => {
    const { alias, snippets } = binding;
    if (!isSnippetIdentifier(alias) || aliases.has(alias)) {
      throw new Error("Provider aliases must be valid and unique.");
    }
    aliases.add(alias);
    if (
      !Array.isArray(snippets) || !snippets.length || !snippets.every(isSnippetName) ||
      new Set(snippets).size !== snippets.length
    ) throw new Error("A provider needs a list of unique approved snippet names.");
    if ((binding.url === undefined) === (binding.client === undefined)) {
      throw new Error("Supply exactly one provider URL or client.");
    }
    let url: URL | undefined;
    if (binding.url !== undefined) {
      url = new URL(binding.url);
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Expected an HTTP endpoint.");
      }
    } else if (
      typeof binding.client !== "function" && typeof binding.client?.callTool !== "function"
    ) {
      throw new Error("Expected an MCP client or client resolver.");
    }
    return { alias, names: Object.freeze([...snippets]), url, binding };
  });

  const owned: Array<() => Promise<void>> = [];
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return closing ??= (async () => {
      const attempts = await Promise.allSettled(owned.map((release) => release()));
      const errors = attempts.flatMap((a) => a.status === "rejected" ? [a.reason] : []);
      if (errors.length) {
        throw new AggregateError(errors, "Failed to close upstream MCP connections.");
      }
    })();
  }

  const opened = await Promise.allSettled(prepared.map(async ({ alias, names, url, binding }) => {
    let source = binding.client;
    if (url !== undefined) {
      const client = new Client({ name: "mcpview-compose-snippet-client", version: "1.0" }, {
        capabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] },
          },
        },
        versionNegotiation: { mode: "auto" },
      });
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { ...binding.requestInit, redirect: "error" },
      });
      owned.push(async () => {
        // Closing the client also aborts the HTTP request if DELETE never returns.
        const timer = setTimeout(() => {
          void client.close().catch(() => {});
        }, 3000);
        try {
          await transport.terminateSession();
        } finally {
          clearTimeout(timer);
          await client.close();
        }
      });
      await client.connect(transport, { timeout: 15_000, signal: options.signal });
      source = client;
    }
    if (!source) throw new Error("Missing snippet provider client.");
    const clientSource = source;
    const provider: SnippetProvider = {
      names,
      events: binding.events,
      async call(tool, args, signal, context) {
        signal.throwIfAborted();
        if (closing) throw new Error("Upstream MCP connections are closed.");
        if (
          tool !== "list_snippets" &&
          !(tool === "run_snippet" && typeof args.name === "string" && names.includes(args.name))
        ) {
          throw new Error("Choose an approved provider snippet.");
        }
        try {
          const client = typeof clientSource === "function"
            ? await clientSource(context)
            : clientSource;
          signal.throwIfAborted();
          if (closing) throw new Error("Upstream MCP connections are closed.");
          return await client.callTool({ name: tool, arguments: args }, {
            signal,
            timeout: 25_000,
          });
        } catch {
          signal.throwIfAborted();
          throw new Error(`The ${alias} snippet provider could not complete the request.`);
        }
      },
    };
    return [alias, provider] as const;
  }));
  const failure = opened.find((entry) => entry.status === "rejected");
  if (failure || options.signal?.aborted) {
    await close().catch(() => {});
    options.signal?.throwIfAborted();
    throw failure?.reason;
  }
  const providers = new Map(
    opened.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : []),
  );
  return { providers, close };
}
