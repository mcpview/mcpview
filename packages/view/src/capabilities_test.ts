import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/client";

import { callServerToolGated } from "./capabilities.ts";
import { MCPViewError } from "./errors.ts";

function fakeApp(
  callServerTool: (params: {
    name: string;
    arguments?: Record<string, unknown>;
  }) => Promise<CallToolResult>,
): App {
  // deno-lint-ignore no-explicit-any
  return { callServerTool } as any as App;
}

Deno.test("callServerToolGated throws when serverTools capability absent", () => {
  const app = fakeApp(() => {
    throw new Error("should not be called");
  });
  const caps: McpUiHostCapabilities = {};

  const err = assertThrows(
    () => {
      // Note: sync throw before the Promise is constructed.
      callServerToolGated(app, caps, "do_thing", { x: 1 });
    },
    MCPViewError,
  );
  // Error message names the tool.
  assertEquals((err as MCPViewError).code, "MISSING_SERVER_TOOLS_CAPABILITY");
  assertEquals(err.message.includes("do_thing"), true);
  assertEquals(err.message.includes("serverTools"), true);
});

Deno.test("callServerToolGated delegates to app.callServerTool when capability present", async () => {
  const calls: Array<{ name: string; arguments?: Record<string, unknown> }> = [];
  const result: CallToolResult = {
    content: [{ type: "text", text: "ok" }],
  };
  const app = fakeApp((params) => {
    calls.push(params);
    return Promise.resolve(result);
  });
  const caps: McpUiHostCapabilities = { serverTools: {} };

  const got = await callServerToolGated(app, caps, "foo", { a: 2 });
  assertEquals(got, result);
  assertEquals(calls, [{ name: "foo", arguments: { a: 2 } }]);
});

Deno.test("callServerToolGated passes tool-level isError result through (no throw)", async () => {
  const errResult: CallToolResult = {
    isError: true,
    content: [{ type: "text", text: "tool failed" }],
  };
  const app = fakeApp(() => Promise.resolve(errResult));
  const caps: McpUiHostCapabilities = { serverTools: {} };

  const got = await callServerToolGated(app, caps, "foo");
  assertEquals(got.isError, true);
});

Deno.test("callServerToolGated rethrows transport errors", async () => {
  const app = fakeApp(() => Promise.reject(new Error("transport lost")));
  const caps: McpUiHostCapabilities = { serverTools: {} };

  await assertRejects(
    () => callServerToolGated(app, caps, "foo"),
    Error,
    "transport lost",
  );
});
