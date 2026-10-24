import { assertEquals, assertRejects } from "@std/assert";
import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import type { CreateMessageRequest, CreateMessageResult } from "@modelcontextprotocol/client";

import { sampleGated } from "./sample.ts";
import { MCPViewError } from "./errors.ts";

function fakeApp(
  createSamplingMessage: (
    params: CreateMessageRequest["params"],
  ) => Promise<CreateMessageResult>,
): App {
  // deno-lint-ignore no-explicit-any
  return { createSamplingMessage } as any as App;
}

const SAMPLING_CAPS: McpUiHostCapabilities = { sampling: {} };

Deno.test("sampleGated throws when sampling capability absent", async () => {
  const app = fakeApp(() => {
    throw new Error("should not be called");
  });
  const caps: McpUiHostCapabilities = {};

  const err = await assertRejects(
    () => sampleGated(app, caps, { prompt: "hi" }),
    MCPViewError,
  );
  assertEquals((err as MCPViewError).code, "MISSING_SAMPLING_CAPABILITY");
  assertEquals((err as MCPViewError).data.capability, "sampling");
});

Deno.test("sampleGated rejects when both prompt and messages are missing", async () => {
  const app = fakeApp(() => {
    throw new Error("should not be called");
  });
  // deno-lint-ignore no-explicit-any
  const empty = {} as any;
  const err = await assertRejects(
    () => sampleGated(app, SAMPLING_CAPS, empty),
    MCPViewError,
  );
  assertEquals((err as MCPViewError).code, "INVALID_SAMPLE_ARGS");
});

Deno.test("sampleGated rejects when both prompt and messages are provided", async () => {
  const app = fakeApp(() => {
    throw new Error("should not be called");
  });
  const both = {
    prompt: "hi",
    messages: [{ role: "user", content: { type: "text", text: "hello" } }],
    // deno-lint-ignore no-explicit-any
  } as any;
  const err = await assertRejects(
    () => sampleGated(app, SAMPLING_CAPS, both),
    MCPViewError,
  );
  assertEquals((err as MCPViewError).code, "INVALID_SAMPLE_ARGS");
});

Deno.test("sampleGated builds messages from prompt sugar form", async () => {
  let received: CreateMessageRequest["params"] | undefined;
  const result: CreateMessageResult = {
    role: "assistant",
    model: "test-model",
    content: { type: "text", text: "hi back" },
    stopReason: "endTurn",
  };
  const app = fakeApp((params) => {
    received = params;
    return Promise.resolve(result);
  });

  const got = await sampleGated(app, SAMPLING_CAPS, {
    prompt: "hello",
    systemPrompt: "be terse",
    maxTokens: 50,
    temperature: 0.2,
  });

  assertEquals(received?.messages, [{
    role: "user",
    content: { type: "text", text: "hello" },
  }]);
  assertEquals(received?.systemPrompt, "be terse");
  assertEquals(received?.maxTokens, 50);
  assertEquals(received?.temperature, 0.2);
  assertEquals(got.text, "hi back");
  assertEquals(got.model, "test-model");
  assertEquals(got.stopReason, "endTurn");
  assertEquals(got.raw, result);
});

Deno.test("sampleGated forwards explicit messages array unchanged", async () => {
  let received: CreateMessageRequest["params"] | undefined;
  const result: CreateMessageResult = {
    role: "assistant",
    model: "test-model",
    content: { type: "text", text: "ok" },
  };
  const app = fakeApp((params) => {
    received = params;
    return Promise.resolve(result);
  });

  const messages = [
    { role: "user" as const, content: { type: "text" as const, text: "a" } },
    { role: "assistant" as const, content: { type: "text" as const, text: "b" } },
    { role: "user" as const, content: { type: "text" as const, text: "c" } },
  ];

  await sampleGated(app, SAMPLING_CAPS, { messages });
  assertEquals(received?.messages, messages);
});

Deno.test("sampleGated defaults maxTokens to 1024 when omitted", async () => {
  let received: CreateMessageRequest["params"] | undefined;
  const app = fakeApp((params) => {
    received = params;
    return Promise.resolve(
      {
        role: "assistant",
        model: "test-model",
        content: { type: "text", text: "" },
      } satisfies CreateMessageResult,
    );
  });

  await sampleGated(app, SAMPLING_CAPS, { prompt: "x" });
  assertEquals(received?.maxTokens, 1024);
});

Deno.test("sampleGated extracts text from a content block array", async () => {
  const result: CreateMessageResult = {
    role: "assistant",
    model: "test-model",
    content: [
      { type: "text", text: "hello " },
      { type: "image", data: "base64==", mimeType: "image/png" },
      { type: "text", text: "world" },
      // deno-lint-ignore no-explicit-any
    ] as any,
  };
  const app = fakeApp(() => Promise.resolve(result));

  const got = await sampleGated(app, SAMPLING_CAPS, { prompt: "x" });
  // Text concatenated, image block silently dropped.
  assertEquals(got.text, "hello world");
});

Deno.test("sampleGated yields empty text when response is non-text only", async () => {
  const result: CreateMessageResult = {
    role: "assistant",
    model: "test-model",
    // deno-lint-ignore no-explicit-any
    content: { type: "image", data: "base64==", mimeType: "image/png" } as any,
  };
  const app = fakeApp(() => Promise.resolve(result));

  const got = await sampleGated(app, SAMPLING_CAPS, { prompt: "x" });
  assertEquals(got.text, "");
  // raw still exposes the full payload.
  assertEquals(got.raw, result);
});
