/**
 * Track B — MRTR over the wire.
 *
 * The pure module proves seal/verify in isolation. This proves the transport
 * actually calls it: that a tampered, expired or cross-request token is refused
 * before the handler runs, that `resultType` survives as `"input_required"`, and
 * that the retry fields are read from `params` rather than `params._meta`.
 *
 * @module lib/server/mrtr/mrtr-integration_test
 */

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import type { AuthProvider } from "../auth/provider.ts";
import { createStaticTokenAuthProvider } from "../auth/static-token-provider.ts";
import { McpApp } from "../mcp-app.ts";
import type { ToolHandler } from "../types.ts";
import { MemoryMrtrReplayStore, type MrtrReplayStore } from "./replay-store.ts";

const PROTO_KEY = "io.modelcontextprotocol/protocolVersion";
const CAPS_KEY = "io.modelcontextprotocol/clientCapabilities";
const V = "2026-07-28";

/** 32 bytes of hex — a deterministic key keeps these tests reproducible. */
const KEY = "a".repeat(64);

/** Client capabilities declaring elicitation support. */
const WITH_ELICITATION = { elicitation: {} };

interface Seen {
  calls?: number;
  inputResponses?: Record<string, unknown>;
  retryVerified?: boolean;
}

function buildServer(
  opts: {
    signingKey?: string;
    replayStore?: MrtrReplayStore;
    authProvider?: AuthProvider;
  } = {},
) {
  const seen: Seen = {};
  const server = new McpApp({
    name: "mrtr-integration",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    ...(opts.authProvider !== undefined
      ? { auth: { provider: opts.authProvider } }
      : {}),
    ...(opts.signingKey !== undefined
      ? {
        mrtr: {
          signingKey: opts.signingKey,
          ...(opts.replayStore !== undefined
            ? { replayStore: opts.replayStore }
            : {}),
        },
      }
      : {}),
  });

  const askThenAnswer: ToolHandler = (_args, ctx) => {
    seen.calls = (seen.calls ?? 0) + 1;
    seen.inputResponses = ctx?.inputResponses;
    seen.retryVerified = ctx?.retryVerified;

    // Second leg: the client came back with answers.
    if (ctx?.inputResponses !== undefined) {
      return `got ${JSON.stringify(ctx.inputResponses)}`;
    }
    // First leg: ask for a username.
    return {
      resultType: "input_required",
      inputRequests: {
        github_login: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: "Your GitHub username?",
            requestedSchema: {
              type: "object",
              properties: { name: { type: "string" } },
              required: ["name"],
            },
          },
        },
      },
    };
  };

  server.registerTools(
    [
      {
        name: "ask",
        description: "Asks for input",
        inputSchema: { type: "object" },
      },
      {
        name: "bad_signal",
        description: "Empty signal",
        inputSchema: { type: "object" },
      },
      {
        name: "needs_sampling",
        description: "Wants sampling",
        inputSchema: { type: "object" },
      },
    ],
    new Map<string, ToolHandler>([
      ["ask", askThenAnswer],
      // Violates server rule 6: neither inputRequests nor requestState.
      ["bad_signal", () => ({ resultType: "input_required" })],
      // Asks for a capability the test client will not declare.
      ["needs_sampling", () => ({
        resultType: "input_required",
        inputRequests: {
          summary: {
            method: "sampling/createMessage",
            params: { messages: [], maxTokens: 10 },
          },
        },
      })],
    ]),
  );
  return { server, seen };
}

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({ port, onListen: () => {} });
  return { http, url: `http://localhost:${port}/mcp` };
}

function call(
  url: string,
  toolName: string,
  extra: Record<string, unknown> = {},
  caps: Record<string, unknown> = WITH_ELICITATION,
  id = 1,
  token?: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "MCP-Protocol-Version": V,
    "Mcp-Method": "tools/call",
    "Mcp-Name": toolName,
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: toolName,
        arguments: {},
        // MRTR fields sit HERE, beside _meta — not inside it.
        ...extra,
        _meta: { [PROTO_KEY]: V, [CAPS_KEY]: caps },
      },
    }),
  });
}

Deno.test("mrtr - a handler asking for input yields resultType 'input_required'", async () => {
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const data = await (await call(url, "ask")).json();

    // stampResult() would have overwritten this with "complete".
    assertEquals(data.result.resultType, "input_required");
    // `input_required` is still a 2026 Result. It must carry the server's
    // identity just like a completed result; otherwise the only result that
    // asks the client to continue is uniquely anonymous.
    assertEquals(data.result._meta?.["io.modelcontextprotocol/serverInfo"], {
      name: "mrtr-integration",
      version: "1.0.0",
    });
    assertExists(data.result.inputRequests.github_login);
    assertEquals(
      data.result.inputRequests.github_login.method,
      "elicitation/create",
    );
    // Sealed because a signing key is configured.
    assertEquals(typeof data.result.requestState, "string");
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - the retry round-trips and reaches the handler", async () => {
  const { server, seen } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const requestState = first.result.requestState as string;

    const retry = await (await call(
      url,
      "ask",
      {
        requestState,
        inputResponses: {
          github_login: { action: "accept", content: { name: "octocat" } },
        },
      },
      WITH_ELICITATION,
      2,
    )).json();

    assertEquals(retry.result.resultType, "complete");
    assertStringIncludes(retry.result.content[0].text, "octocat");
    // Read from params, not params._meta — the silent-undefined trap.
    assertExists(seen.inputResponses);
    assertEquals(seen.retryVerified, true);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - identity-aware static credentials reject a different principal", async () => {
  const authProvider = createStaticTokenAuthProvider(
    [
      { token: "token-a", subject: "alice", scopes: ["read"] },
      { token: "token-b", subject: "automation", scopes: ["read"] },
    ],
    { resource: "https://mcp.example.com/mcp" },
  );
  const { server, seen } = buildServer({ signingKey: KEY, authProvider });
  const { http, url } = await start(server);
  try {
    const firstResponse = await call(
      url,
      "ask",
      {},
      WITH_ELICITATION,
      1,
      "token-a",
    );
    assertEquals(firstResponse.status, 200);
    const first = await firstResponse.json();
    const requestState = first.result.requestState as string;

    const retry = await call(
      url,
      "ask",
      {
        requestState,
        inputResponses: {
          github_login: { action: "accept", content: { name: "octocat" } },
        },
      },
      WITH_ELICITATION,
      2,
      "token-b",
    );
    const retryData = await retry.json();

    assertEquals(retry.status, 400);
    assertEquals(retryData.error.code, -32602);
    assertEquals(retryData.error.data.reason, "wrong_principal");
    assertEquals(seen.calls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - string static allowlists retain shared authority", async () => {
  const authProvider = createStaticTokenAuthProvider(
    ["token-a", "token-b"],
    { resource: "https://mcp.example.com/mcp" },
  );
  const { server, seen } = buildServer({ signingKey: KEY, authProvider });
  const { http, url } = await start(server);
  try {
    const first = await (await call(
      url,
      "ask",
      {},
      WITH_ELICITATION,
      1,
      "token-a",
    )).json();
    const requestState = first.result.requestState as string;

    const retry = await call(
      url,
      "ask",
      {
        requestState,
        inputResponses: {
          github_login: { action: "accept", content: { name: "octocat" } },
        },
      },
      WITH_ELICITATION,
      2,
      "token-b",
    );
    const retryData = await retry.json();

    assertEquals(retry.status, 200);
    assertEquals(retryData.result.resultType, "complete");
    assertEquals(seen.calls, 2);
    assertEquals(seen.retryVerified, true);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a signed requestState is single-use within one process by default", async () => {
  const { server, seen } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const requestState = first.result.requestState as string;
    const retryFields = {
      requestState,
      inputResponses: {
        github_login: { action: "accept", content: { name: "octocat" } },
      },
    };

    const accepted = await call(
      url,
      "ask",
      retryFields,
      WITH_ELICITATION,
      2,
    );
    assertEquals(accepted.status, 200);

    const replay = await call(
      url,
      "ask",
      retryFields,
      WITH_ELICITATION,
      3,
    );
    const replayData = await replay.json();
    assertEquals(replay.status, 400);
    assertEquals(replayData.error.code, -32602);
    assertEquals(replayData.error.data.reason, "replayed");
    assertEquals(replay.headers.get("mcp-protocol-version"), V);
    assertEquals(seen.calls, 2);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - one shared store admits one concurrent retry across instances", async () => {
  const sharedStore = new MemoryMrtrReplayStore();
  const firstServer = buildServer({
    signingKey: KEY,
    replayStore: sharedStore,
  });
  const secondServer = buildServer({
    signingKey: KEY,
    replayStore: sharedStore,
  });
  const firstHttp = await start(firstServer.server);
  const secondHttp = await start(secondServer.server);
  try {
    const first = await (await call(firstHttp.url, "ask")).json();
    const requestState = first.result.requestState as string;
    const retryFields = {
      requestState,
      inputResponses: {
        github_login: { action: "accept", content: { name: "octocat" } },
      },
    };

    const responses = await Promise.all([
      call(firstHttp.url, "ask", retryFields, WITH_ELICITATION, 2),
      call(secondHttp.url, "ask", retryFields, WITH_ELICITATION, 3),
    ]);
    assertEquals(responses.map((response) => response.status).sort(), [
      200,
      400,
    ]);

    const payloads = await Promise.all(
      responses.map((response) => response.json()),
    );
    assertEquals(
      payloads.filter((payload) => payload.result?.resultType === "complete")
        .length,
      1,
    );
    assertEquals(
      payloads.filter((payload) => payload.error?.data?.reason === "replayed")
        .length,
      1,
    );
    assertEquals(
      (firstServer.seen.calls ?? 0) + (secondServer.seen.calls ?? 0),
      2,
    );
  } finally {
    await Promise.all([
      firstHttp.http.shutdown(),
      secondHttp.http.shutdown(),
    ]);
  }
});

Deno.test("mrtr - replay store failure is fail-closed before the handler", async () => {
  const replayStore: MrtrReplayStore = {
    consume: () => {
      throw new Error("redis unavailable");
    },
  };
  const { server, seen } = buildServer({ signingKey: KEY, replayStore });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const requestState = first.result.requestState as string;

    const retry = await call(
      url,
      "ask",
      {
        requestState,
        inputResponses: {
          github_login: { action: "accept", content: { name: "octocat" } },
        },
      },
      WITH_ELICITATION,
      2,
    );
    const retryData = await retry.json();

    assertEquals(retry.status, 500);
    assertEquals(retryData.error.code, -32603);
    assertEquals(
      retryData.error.data.problem,
      "mrtr_replay_store_unavailable",
    );
    assertEquals(retryData.error.data.detail, undefined);
    assertEquals(retry.headers.get("mcp-protocol-version"), V);
    assertEquals(seen.calls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a forged token never reaches the replay store", async () => {
  let consumeCalls = 0;
  const replayStore: MrtrReplayStore = {
    consume: () => {
      consumeCalls++;
      return true;
    },
  };
  const { server, seen } = buildServer({ signingKey: KEY, replayStore });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const token = first.result.requestState as string;
    const [payload, mac] = token.split(".");
    const tampered = `${payload.slice(0, -1)}${
      payload.at(-1) === "A" ? "B" : "A"
    }.${mac}`;

    const response = await call(
      url,
      "ask",
      {
        requestState: tampered,
        inputResponses: {
          github_login: { action: "accept", content: { name: "mallory" } },
        },
      },
      WITH_ELICITATION,
      2,
    );
    const data = await response.json();

    assertEquals(response.status, 400);
    assertEquals(data.error.data.reason, "tampered");
    assertEquals(consumeCalls, 0);
    assertEquals(seen.calls, 1);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a replay store without a signing key is rejected at boot", () => {
  assertThrows(
    () =>
      new McpApp({
        name: "invalid-replay-store",
        version: "1.0.0",
        logger: () => {},
        transport: "stateless",
        mrtr: { replayStore: new MemoryMrtrReplayStore() },
      }),
    Error,
    "requires mrtr.signingKey",
  );
});

Deno.test("mrtr - a tampered requestState is refused before the handler runs", async () => {
  const { server, seen } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const token = first.result.requestState as string;
    seen.inputResponses = undefined; // reset the observation

    // Flip a byte of the payload half.
    const [payload, mac] = token.split(".");
    const tampered = `${payload.slice(0, -1)}${
      payload.at(-1) === "A" ? "B" : "A"
    }.${mac}`;

    const res = await call(
      url,
      "ask",
      {
        requestState: tampered,
        inputResponses: {
          github_login: { action: "accept", content: { name: "attacker" } },
        },
      },
      WITH_ELICITATION,
      2,
    );
    const data = await res.json();

    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32602);
    assertEquals(data.error.data.reason, "tampered");
    // The handler must never have seen the forged answers.
    assertEquals(seen.inputResponses, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a token minted for one tool is refused on another", async () => {
  // Cross-request replay: the paramsDigest binding is what stops a token issued
  // for a harmless call being spent on a different one.
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const token = first.result.requestState as string;

    const res = await call(
      url,
      "needs_sampling",
      {
        requestState: token,
      },
      WITH_ELICITATION,
      2,
    );
    const data = await res.json();

    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32602);
    assertEquals(data.error.data.reason, "wrong_params");
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a signal with neither inputRequests nor requestState is a server error", async () => {
  // Server rule 6. Surfaces as -32603 rather than being emitted as an invalid
  // MRTR result for the client to puzzle over: it is the server author's bug.
  const { server } = buildServer({ signingKey: KEY });
  const { http } = await start(server);
  try {
    // No signing key path would add a requestState, so run this one unsigned.
    const bare = buildServer();
    const other = await start(bare.server);
    try {
      const res = await call(other.url, "bad_signal");
      const data = await res.json();
      assertEquals(res.status, 500);
      assertEquals(data.error.code, -32603);
      assertStringIncludes(data.error.message, "at least one of");
    } finally {
      await other.http.shutdown();
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - input cannot be requested for an undeclared capability", async () => {
  // Spec rule 7 is a MUST NOT on the server: asking for sampling from a client
  // that never declared it would strand the request.
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const res = await call(url, "needs_sampling", {}, WITH_ELICITATION);
    const data = await res.json();
    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32021);
    assertStringIncludes(data.error.message, "sampling");
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - without a signing key the handler is told the retry is unverified", async () => {
  // Rather than being handed a false assurance. The startup warning covers the
  // operator; this covers the handler.
  const { server, seen } = buildServer();
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    assertEquals(first.result.resultType, "input_required");
    // Nothing to seal, so nothing is emitted.
    assertEquals(first.result.requestState, undefined);

    const retry = await (await call(
      url,
      "ask",
      {
        requestState: "anything-at-all",
        inputResponses: { github_login: { action: "accept" } },
      },
      WITH_ELICITATION,
      2,
    )).json();

    assertEquals(retry.result.resultType, "complete");
    assertEquals(seen.retryVerified, false);
  } finally {
    await http.shutdown();
  }
});

// ── Findings from the final adversarial review ───────────────────────────────

Deno.test("mrtr - inputResponses without a requestState is refused, not forwarded", async () => {
  // This was a real bypass: the two fields were read independently, so a caller
  // could supply answers with no token and the handler received them unverified.
  // The server always issues a token when it holds a key, so this combination is
  // either a confused client or an injection attempt.
  const { server, seen } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const res = await call(url, "ask", {
      inputResponses: {
        github_login: { action: "accept", content: { name: "mallory" } },
      },
    });
    const data = await res.json();

    assertEquals(res.status, 400);
    assertEquals(data.error.code, -32602);
    assertEquals(data.error.data.problem, "missing_request_state");
    // Never reached the handler.
    assertEquals(seen.inputResponses, undefined);
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - the capability error names the capability as ClientCapabilities", async () => {
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const data = await (await call(url, "needs_sampling", {}, WITH_ELICITATION))
      .json();
    assertEquals(data.error.code, -32021);
    // Object, not an array of names: the schema types this as ClientCapabilities.
    assertEquals(data.error.data.requiredCapabilities, { sampling: {} });
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - an argument-normalising middleware does not break a legitimate retry", async () => {
  // The digest was re-derived at seal time from the same mutable `args` object
  // the pipeline had already touched, so a client replaying its request
  // byte-for-byte could fail `wrong_params` through no fault of its own. The
  // digest is now snapshotted at ingress.
  const server = new McpApp({
    name: "mrtr-normalising",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    mrtr: { signingKey: KEY },
  });
  // Mutates the arguments in place, as a validation or defaulting layer would.
  server.use((ctx, next) => {
    (ctx.args as Record<string, unknown>).injectedByMiddleware = true;
    return next();
  });
  server.registerTool(
    { name: "ask", description: "Asks", inputSchema: { type: "object" } },
    (_args, ctx) =>
      ctx?.inputResponses !== undefined ? "done" : {
        resultType: "input_required",
        inputRequests: {
          k: {
            method: "elicitation/create",
            params: { mode: "form", message: "?", requestedSchema: {} },
          },
        },
      },
  );

  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const requestState = first.result.requestState as string;

    const retry = await (await call(
      url,
      "ask",
      {
        requestState,
        inputResponses: { k: { action: "accept" } },
      },
      WITH_ELICITATION,
      2,
    )).json();

    // Would be -32602 wrong_params if the digest had been taken after the
    // middleware mutated the arguments.
    assertEquals(retry.result?.resultType, "complete");
  } finally {
    await http.shutdown();
  }
});

Deno.test("mrtr - a malformed inputResponses is rejected rather than ignored", async () => {
  // Silently dropping the wrong shape meant a client saw its answers ignored and
  // the same InputRequiredResult come back, with nothing to indicate why.
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const first = await (await call(url, "ask")).json();
    const requestState = first.result.requestState as string;

    for (const bad of ["answers", 42, ["a"], true]) {
      const res = await call(
        url,
        "ask",
        {
          requestState,
          inputResponses: bad,
        },
        WITH_ELICITATION,
        2,
      );
      const data = await res.json();
      assertEquals(res.status, 400, `${JSON.stringify(bad)} must be refused`);
      assertEquals(data.error.data.problem, "malformed_field");
      assertEquals(data.error.data.bodyField, "params.inputResponses");
    }
  } finally {
    await http.shutdown();
  }
});

Deno.test("round5 - an inputRequests map emptied by serialisation is refused", async () => {
  // JSON drops keys whose value is `undefined`, so `{ ask: undefined }`
  // canonicalises to `{}`. The at-least-one rule was checked against the original,
  // so this emitted an InputRequiredResult with an empty map — and where no signing
  // key is configured, no requestState either. The client had nothing to answer and
  // no reason to retry.
  const server = new McpApp({
    name: "mrtr-empty-map",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    // No signing key, so no requestState is added to paper over the empty map.
  });
  server.registerTools(
    [{ name: "ask", description: "Asks", inputSchema: { type: "object" } }],
    new Map<string, ToolHandler>([
      ["ask", () => ({
        resultType: "input_required",
        // deno-lint-ignore no-explicit-any
        inputRequests: { ask: undefined as any },
      })],
    ]),
  );

  const { http, url } = await start(server);
  try {
    const res = await call(url, "ask");
    const data = await res.json();
    // 500, not 400: an InternalError is a server fault, and telling the client to
    // fix its request would send it looking for a problem it does not have.
    assertEquals(res.status, 500);
    assertEquals(data.error.code, -32603);
    assertStringIncludes(data.error.message, "no serialisable entries");
    // Post-negotiation responses carry the version even on error paths.
    assertEquals(res.headers.get("mcp-protocol-version"), V);
  } finally {
    await http.shutdown();
  }
});

Deno.test("round5 - post-negotiation task errors carry the protocol version", async () => {
  // noOwnerKeyError took a `version` argument and never used it: the exact string
  // my patch expected had been reflowed, so the replacement silently did nothing.
  // Verified by grep after writing this time, and pinned here.
  const server = new McpApp({
    name: "mrtr-header-echo",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    extensions: { "io.modelcontextprotocol/tasks": {} },
    taskOwnerKey: () => "",
  });
  server.registerTools(
    [{ name: "ask", description: "Asks", inputSchema: { type: "object" } }],
    new Map<string, ToolHandler>([["ask", () => "ok"]]),
  );

  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  const http = await server.startHttp({
    port,
    cors: false,
    onListen: () => {},
  });
  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "MCP-Protocol-Version": V,
        "Mcp-Method": "tasks/get",
        "Mcp-Name": "x",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tasks/get",
        params: {
          taskId: "x",
          _meta: {
            [PROTO_KEY]: V,
            [CAPS_KEY]: {
              extensions: { "io.modelcontextprotocol/tasks": {} },
            },
          },
        },
      }),
    });
    await res.json();
    assertEquals(res.headers.get("mcp-protocol-version"), V);
  } finally {
    await http.shutdown();
  }
});

Deno.test("round7 - a malformed inputRequest is a server fault, not a missing capability", async () => {
  // -32021 means "the client did not declare a capability". Telling a client that
  // when the SERVER emitted a structurally invalid request is useless advice — it
  // sends them to declare something they already have, and hides the real bug.
  const server = new McpApp({
    name: "mrtr-malformed-kind",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerTools(
    [{ name: "ask", description: "Asks", inputSchema: { type: "object" } }],
    new Map<string, ToolHandler>([
      // elicitation/create requires params; omitting it is malformed server output.
      ["ask", () => ({
        resultType: "input_required",
        // deno-lint-ignore no-explicit-any
        inputRequests: { k: { method: "elicitation/create" } as any },
      })],
    ]),
  );

  const { http, url } = await start(server);
  try {
    // The client DOES declare elicitation, so a capability error would be a lie.
    const res = await call(url, "ask", {}, WITH_ELICITATION);
    const data = await res.json();
    assertEquals(res.status, 500, "a server fault, not a client one");
    assertEquals(data.error.code, -32603);
    assertStringIncludes(data.error.message, "Malformed inputRequest");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round7 - a genuine missing capability is still the client's to fix", async () => {
  const { server } = buildServer({ signingKey: KEY });
  const { http, url } = await start(server);
  try {
    const res = await call(url, "needs_sampling", {}, WITH_ELICITATION);
    const data = await res.json();
    assertEquals(res.status, 400, "the client's fault");
    assertEquals(data.error.code, -32021);
    assertEquals(data.error.data.requiredCapabilities, { sampling: {} });
  } finally {
    await http.shutdown();
  }
});

Deno.test("round8 - a null inputRequests value yields 500, not a 200 tool error", async () => {
  // It canonicalised cleanly and then threw on dereference, so it fell through to
  // the generic tool-error path: -32603 at HTTP 200. A malformed server output must
  // be a server fault on the wire, not something the client reads as a completed
  // call that happened to fail.
  const server = new McpApp({
    name: "mrtr-null-entry",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerTools(
    [{ name: "ask", description: "Asks", inputSchema: { type: "object" } }],
    new Map<string, ToolHandler>([
      ["ask", () => ({
        resultType: "input_required",
        // deno-lint-ignore no-explicit-any
        inputRequests: { k: null as any },
      })],
    ]),
  );

  const { http, url } = await start(server);
  try {
    const res = await call(url, "ask", {}, WITH_ELICITATION);
    const data = await res.json();
    assertEquals(res.status, 500);
    assertEquals(data.error.code, -32603);
    assertStringIncludes(data.error.message, "Malformed inputRequest");
  } finally {
    await http.shutdown();
  }
});

Deno.test("round9 - a null inputRequests map is classified, not thrown on", async () => {
  // `Object.keys(null)` throws, and `inputRequests: null` survives JSON — so the
  // map reached the generic tool-error path as a 200 rather than the 500 a
  // malformed server output requires.
  const server = new McpApp({
    name: "mrtr-null-map",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerTools(
    [{ name: "ask", description: "Asks", inputSchema: { type: "object" } }],
    new Map<string, ToolHandler>([
      ["ask", () => ({
        resultType: "input_required",
        // deno-lint-ignore no-explicit-any
        inputRequests: null as any,
        requestState: "opaque",
      })],
    ]),
  );

  const { http, url } = await start(server);
  try {
    const res = await call(url, "ask", {}, WITH_ELICITATION);
    const data = await res.json();
    assertEquals(res.status, 500);
    assertStringIncludes(data.error.message, "must be an object");
  } finally {
    await http.shutdown();
  }
});
