/** End-to-end MRTR verification through the real v2 stdio serving entry. */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";

const FIXTURE = new URL(
  "./testdata/stdio-mrtr-e2e-server.ts",
  import.meta.url,
).pathname;
const PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_KEY = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

interface WireResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
}

function modernCall(
  id: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: {
      name: "ask_then_answer",
      arguments: { subject: "same-arguments" },
      ...extra,
      _meta: {
        [PROTOCOL_VERSION_KEY]: PROTOCOL_VERSION,
        [CLIENT_INFO_KEY]: { name: "mrtr-e2e", version: "1.0.0" },
        [CLIENT_CAPABILITIES_KEY]: { elicitation: {} },
      },
    },
  };
}

Deno.test("stdio e2e - MRTR verifies, preserves, then consumes requestState", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-check", FIXTURE],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const writer = child.stdin.getWriter();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const encoder = new TextEncoder();
  let buffered = "";

  const send = async (
    request: Record<string, unknown>,
  ): Promise<WireResponse> => {
    await writer.write(encoder.encode(`${JSON.stringify(request)}\n`));
    const expectedId = request.id;
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim().length === 0) continue;
        const response = JSON.parse(line) as WireResponse;
        if (response.id === expectedId) return response;
        continue;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("MRTR fixture exited before replying");
      buffered += value;
    }
  };

  try {
    const first = await send(modernCall(1));
    assertExists(first.result);
    assertEquals(first.result.resultType, "input_required");
    assertEquals(
      (first.result._meta as Record<string, unknown>)[SERVER_INFO_KEY],
      { name: "e2e-stdio-mrtr", version: "1.0.0" },
    );
    assertExists(
      (first.result.inputRequests as Record<string, unknown>).github_login,
    );
    const requestState = first.result.requestState;
    assertEquals(typeof requestState, "string");

    // A wrapped response is malformed. It must be rejected before the replay
    // nonce is consumed, so the same state can still be retried correctly.
    const malformed = await send(modernCall(2, {
      requestState,
      inputResponses: {
        github_login: {
          method: "elicitation/create",
          result: { action: "accept", content: { name: "octocat" } },
        },
      },
    }));
    assertEquals(malformed.error?.code, -32602);
    assertEquals(malformed.error?.data?.problem, "malformed_input_responses");
    assertEquals(malformed.error?.data?.droppedKeys, ["github_login"]);

    const retryFields = {
      requestState,
      inputResponses: {
        github_login: { action: "accept", content: { name: "octocat" } },
      },
    };
    const completed = await send(modernCall(3, retryFields));
    assertExists(completed.result);
    assertEquals(completed.result.resultType, "complete");
    const text = (completed.result.content as Array<{ text: string }>)[0].text;
    assertStringIncludes(text, "subject=same-arguments");
    assertStringIncludes(text, "verified=true");
    assertStringIncludes(text, "octocat");

    const replay = await send(modernCall(4, retryFields));
    assertEquals(replay.error?.code, -32602);
    assertEquals(replay.error?.data?.reason, "replayed");
  } finally {
    await writer.close();
    await child.status;
    await reader.cancel();
  }
});

Deno.test("stdio e2e - legacy shim re-enters the same verified MRTR handler", async () => {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--no-check", FIXTURE],
    stdin: "piped",
    stdout: "piped",
    stderr: "null",
  }).spawn();
  const writer = child.stdin.getWriter();
  const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
  const encoder = new TextEncoder();
  let buffered = "";

  const write = (message: Record<string, unknown>) =>
    writer.write(encoder.encode(`${JSON.stringify(message)}\n`));
  const read = async (): Promise<Record<string, unknown>> => {
    while (true) {
      const newline = buffered.indexOf("\n");
      if (newline >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.trim().length > 0) {
          return JSON.parse(line) as Record<string, unknown>;
        }
        continue;
      }
      const { done, value } = await reader.read();
      if (done) throw new Error("legacy MRTR fixture exited before replying");
      buffered += value;
    }
  };

  try {
    await write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: {} },
        clientInfo: { name: "legacy-mrtr-e2e", version: "1.0.0" },
      },
    });
    const initialized = await read();
    assertEquals(
      (initialized.result as Record<string, unknown>).protocolVersion,
      "2025-11-25",
    );
    await write({ jsonrpc: "2.0", method: "notifications/initialized" });
    await write({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "ask_then_answer",
        arguments: { subject: "same-arguments" },
      },
    });

    let elicitationCount = 0;
    let completed: Record<string, unknown> | undefined;
    while (completed === undefined) {
      const message = await read();
      if (message.method === "elicitation/create") {
        elicitationCount += 1;
        await write({
          jsonrpc: "2.0",
          id: message.id,
          result: { action: "accept", content: { name: "legacy-octocat" } },
        });
      } else if (message.id === 2) {
        completed = message;
      }
    }

    assertEquals(elicitationCount, 1);
    const result = completed.result as Record<string, unknown>;
    assertEquals(result.resultType, undefined);
    const text = (result.content as Array<{ text: string }>)[0].text;
    assertStringIncludes(text, "verified=true");
    assertStringIncludes(text, "legacy-octocat");
  } finally {
    await writer.close();
    await child.status;
    await reader.cancel();
  }
});
