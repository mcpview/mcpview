import type { MCPTool } from "@mcpview/server";

/** Business capability of the local archive. Its source is separate from the live ERP tools. */
export const buyEvidenceTool: MCPTool = {
  name: "buy_evidence_read",
  description: "Read the recorded cost evidence for the synthetic purchase configuration.",
  inputSchema: {
    type: "object",
    properties: { record: { type: "string", enum: ["complete", "unavailable"] } },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

interface RecordedSession extends Record<string, unknown> {
  projection:
    | { status: "available"; result: Record<string, unknown> }
    | { status: "unavailable" | "unresolved"; reason: string };
}

/** Only the trusted executor sees the session. The guest receives the business projection. */
export function createBuyEvidenceReader(assets: URL) {
  const archive = new URL("buy-archive/", assets);
  return async (args: Record<string, unknown>) => {
    const record = args.record === undefined ? "complete" : args.record;
    if (
      Object.keys(args).some((key) => key !== "record") ||
      (record !== "complete" && record !== "unavailable")
    ) throw new TypeError("Unknown purchase evidence record.");
    const { parseBuyViewerSession } = await import(new URL("session-parser.mjs", archive).href) as {
      parseBuyViewerSession(input: unknown): Promise<RecordedSession>;
    };
    const bytes = await Deno.readTextFile(new URL(`${record}.json`, archive));
    // Parse the archived envelope as received. The publisher checks its digest, anchor and joins.
    const session = await parseBuyViewerSession(JSON.parse(bytes));
    const data = session.projection;
    const result = {
      content: [{ type: "text" as const, text: JSON.stringify(data) }],
      structuredContent: data,
    };
    return { result, session };
  };
}
