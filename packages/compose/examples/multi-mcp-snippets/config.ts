export interface ProviderConfig {
  alias: string;
  port: number;
  snippets: string[];
}

const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseProviders(value: unknown): ProviderConfig[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) {
    throw new Error("Configure between one and eight MCP snippet providers.");
  }
  const providers = new Map<string, ProviderConfig>();
  const ports = new Set<number>();
  for (const item of value) {
    if (!item || Array.isArray(item) || typeof item !== "object") {
      throw new Error("Expected each provider to have alias, port, and snippets.");
    }
    const { alias, port, snippets } = item;
    if (
      Object.keys(item).some((key) => !["alias", "port", "snippets"].includes(key)) ||
      typeof alias !== "string" || !identifier.test(alias) ||
      !Number.isInteger(port) || port < 1 || port > 65_535 ||
      !Array.isArray(snippets) || snippets.length < 1 || snippets.length > 32 ||
      !snippets.every((name) => typeof name === "string" && identifier.test(name)) ||
      new Set(snippets).size !== snippets.length
    ) {
      throw new Error(
        "Each provider needs a valid alias, TCP port, and unique approved snippet names.",
      );
    }
    if (providers.has(alias) || ports.has(port)) {
      throw new Error("Provider aliases and loopback ports must be unique.");
    }
    providers.set(alias, { alias, port, snippets: [...snippets] });
    ports.add(port);
  }
  return [...providers.values()];
}
