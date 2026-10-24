import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { App, type RegisteredAppTool } from "@modelcontextprotocol/ext-apps";
import type { BaseContext, CallToolResult } from "@modelcontextprotocol/client";
import { z } from "zod";

import { ToolRegistry, viewsDeclareTools, type ViewToolDef } from "./tools.ts";
import { MCPViewError } from "./errors.ts";
import type { AppContext } from "./types.ts";

// ---- helpers ---------------------------------------------------------------

interface FakeRegisteredAppTool extends RegisteredAppTool {
  removed: boolean;
  /** Snapshot of the (name, config, cb) triple at registration time. */
  registeredAs: { name: string; config: Record<string, unknown> };
}

function fakeApp(): {
  app: App;
  registered: FakeRegisteredAppTool[];
  toolListChangedCount: number;
  // deno-lint-ignore no-explicit-any
  invoke: (name: string, args: any) => Promise<CallToolResult>;
} {
  const registered: FakeRegisteredAppTool[] = [];
  let toolListChangedCount = 0;
  // deno-lint-ignore no-explicit-any
  const callbacks = new Map<string, (args: any) => Promise<CallToolResult>>();

  // Mirrors ext-apps 2.x: registerTool / handle.{enable,disable,update,remove}
  // each emit `tools/list_changed` automatically (via the internal `D()` lambda
  // gated on `app.options.tools?.listChanged`). The fake reproduces this so
  // the wrapper's tests can detect double-notifications.
  const bumpListChanged = () => {
    toolListChangedCount++;
  };

  const app = {
    // deno-lint-ignore no-explicit-any
    registerTool(name: string, config: any, cb: any): RegisteredAppTool {
      callbacks.set(name, cb);
      const handle = {
        title: config.title,
        description: config.description,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        annotations: config.annotations,
        _meta: config._meta,
        enabled: true,
        removed: false,
        registeredAs: { name, config },
        enable() {
          this.enabled = true;
          bumpListChanged();
        },
        disable() {
          this.enabled = false;
          bumpListChanged();
        },
        remove() {
          this.removed = true;
          callbacks.delete(name);
          bumpListChanged();
        },
        // deno-lint-ignore no-explicit-any
        update(updates: any) {
          Object.assign(this, updates);
          bumpListChanged();
        },
        // deno-lint-ignore no-explicit-any
        handler: cb as any,
      } as FakeRegisteredAppTool;
      registered.push(handle);
      bumpListChanged();
      return handle;
    },
    sendToolListChanged() {
      bumpListChanged();
      return Promise.resolve();
    },
    // deno-lint-ignore no-explicit-any
  } as any as App;

  // deno-lint-ignore no-explicit-any
  const invoke = (name: string, args: any) => {
    const cb = callbacks.get(name);
    if (!cb) throw new Error(`no callback for ${name}`);
    return cb(args);
  };

  return {
    app,
    registered,
    get toolListChangedCount() {
      return toolListChangedCount;
    },
    invoke,
  };
}

function fakeContext<S>(state: S): AppContext<S> {
  return {
    navigate: () => Promise.resolve(),
    callTool: () => Promise.reject(new Error("not used")),
    sample: () => Promise.reject(new Error("not used")),
    // deno-lint-ignore no-explicit-any
    capabilities: {} as any,
    // deno-lint-ignore no-explicit-any
    hostContext: {} as any,
    state,
    tools: {
      enable: () => {},
      disable: () => {},
      update: () => {},
      remove: () => {},
    },
    // deno-lint-ignore no-explicit-any
    app: {} as any,
  };
}

// ---- viewsDeclareTools -----------------------------------------------------

Deno.test("viewsDeclareTools returns false when no view declares tools", () => {
  const views = {
    a: { render: () => "" },
    b: { render: () => "", tools: {} },
  };
  assertEquals(viewsDeclareTools(views), false);
});

Deno.test("viewsDeclareTools returns true when at least one view has tools", () => {
  const views = {
    a: { render: () => "" },
    b: {
      render: () => "",
      tools: { foo: { description: "x", handler: () => ({} as CallToolResult) } },
    },
  };
  assertEquals(viewsDeclareTools(views), true);
});

// ---- ToolRegistry: lifecycle ----------------------------------------------

Deno.test("registerForView is a no-op when tools map is undefined or empty", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));

  reg.registerForView(undefined);
  reg.registerForView({});

  assertEquals(fake.registered.length, 0);
  assertEquals(fake.toolListChangedCount, 0);
});

Deno.test("registerForView throws if called before setContext", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);

  const tools: Record<string, ViewToolDef<unknown>> = {
    foo: { description: "x", handler: () => ({ content: [] } as CallToolResult) },
  };

  const err = assertThrows(
    () => reg.registerForView(tools),
    MCPViewError,
  );
  assertEquals((err as MCPViewError).code, "ROUTER_NOT_INITIALIZED");
});

Deno.test("registerForView delegates to ext-apps' registerTool (no extra notification)", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));

  reg.registerForView({
    foo: { description: "Foo", handler: () => ({ content: [] } as CallToolResult) },
    bar: {
      description: "Bar",
      title: "Bar Tool",
      handler: () => ({ content: [] } as CallToolResult),
    },
  });

  assertEquals(fake.registered.length, 2);
  assertEquals(fake.registered[0].registeredAs.name, "foo");
  assertEquals(fake.registered[1].registeredAs.name, "bar");
  assertEquals(fake.registered[1].registeredAs.config.title, "Bar Tool");
  // ext-apps emits one tools/list_changed per registerTool call (its own
  // internal D() lambda); the wrapper does NOT add an extra batched one.
  // Two registers → exactly 2 notifications, not 3.
  assertEquals(fake.toolListChangedCount, 2);
});

Deno.test("unregisterAll removes every handle without adding a batched notification", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));

  reg.registerForView({
    foo: { description: "x", handler: () => ({ content: [] } as CallToolResult) },
    bar: { description: "y", handler: () => ({ content: [] } as CallToolResult) },
  });
  // 2 registers → 2 notifications.
  assertEquals(fake.toolListChangedCount, 2);

  reg.unregisterAll();

  assertEquals(fake.registered.every((h) => h.removed), true);
  // 2 registers + 2 removes (each handle.remove() emits) = 4. The wrapper
  // does NOT add a 5th batched notification.
  assertEquals(fake.toolListChangedCount, 4);
});

Deno.test("unregisterAll is a no-op when nothing is registered", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));

  reg.unregisterAll();
  assertEquals(fake.toolListChangedCount, 0);
});

// ---- ToolRegistry: handler wiring ----------------------------------------

Deno.test("registered handler receives the AppContext and forwards args", async () => {
  type State = { count: number };
  const fake = fakeApp();
  const reg = new ToolRegistry<State>(fake.app);
  const seen: Array<{ ctx: AppContext<State>; args: unknown }> = [];
  const ctx = fakeContext<State>({ count: 42 });
  reg.setContext(ctx);

  reg.registerForView({
    inc: {
      description: "increment",
      handler: (innerCtx, args) => {
        seen.push({ ctx: innerCtx, args });
        return { content: [{ type: "text", text: "ok" }] } as CallToolResult;
      },
    },
  });

  const result = await fake.invoke("inc", { delta: 1 });
  assertEquals(result.content, [{ type: "text", text: "ok" }]);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].ctx.state.count, 42);
  assertEquals(seen[0].args, { delta: 1 });
});

// ---- ToolsHandle: enable / disable / update / remove ---------------------

Deno.test("ctx.tools.disable / enable flip the underlying handle's enabled flag", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));
  reg.registerForView({
    foo: { description: "x", handler: () => ({ content: [] } as CallToolResult) },
  });

  reg.disable("foo");
  assertEquals(fake.registered[0].enabled, false);
  reg.enable("foo");
  assertEquals(fake.registered[0].enabled, true);
});

Deno.test("ctx.tools.update mutates description without touching schemas", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));
  reg.registerForView({
    foo: { description: "old", handler: () => ({ content: [] } as CallToolResult) },
  });

  reg.update("foo", { description: "new" });
  // deno-lint-ignore no-explicit-any
  assertEquals((fake.registered[0] as any).description, "new");
});

Deno.test("ctx.tools.remove drops the handle (ext-apps emits tools/list_changed itself)", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));
  reg.registerForView({
    foo: { description: "x", handler: () => ({ content: [] } as CallToolResult) },
  });
  const beforeCount = fake.toolListChangedCount;

  reg.remove("foo");

  assertEquals(fake.registered[0].removed, true);
  // The fake's handle.remove() bumps the counter (mirroring ext-apps); the
  // wrapper does NOT call sendToolListChanged itself anymore. So beforeCount
  // + 1 (from the underlying remove), not + 2.
  assertEquals(fake.toolListChangedCount, beforeCount + 1);
  // After removal, ctx.tools.disable("foo") must throw UNKNOWN_TOOL.
  const err = assertThrows(() => reg.disable("foo"), MCPViewError);
  assertEquals((err as MCPViewError).code, "UNKNOWN_TOOL");
});

Deno.test("ctx.tools.{enable,disable,update,remove} throw UNKNOWN_TOOL on unknown name", () => {
  const fake = fakeApp();
  const reg = new ToolRegistry(fake.app);
  reg.setContext(fakeContext({}));

  for (const op of ["enable", "disable"] as const) {
    const err = assertThrows(() => reg[op]("nope"), MCPViewError);
    assertEquals((err as MCPViewError).code, "UNKNOWN_TOOL");
  }
  const updateErr = assertThrows(
    () => reg.update("nope", { description: "x" }),
    MCPViewError,
  );
  assertEquals((updateErr as MCPViewError).code, "UNKNOWN_TOOL");

  const removeErr = assertThrows(() => reg.remove("nope"), MCPViewError);
  assertEquals((removeErr as MCPViewError).code, "UNKNOWN_TOOL");
});

Deno.test("View tools use official v2 registration for loose args, schemas and JSON results", async () => {
  const app = new App({ name: "tool-test", version: "1.0.0" }, {}, { strict: true });
  const registry = new ToolRegistry(app);
  const ctx = fakeContext({ count: 1 });
  registry.setContext(ctx);
  let looseArgs: unknown;
  registry.registerForView({
    loose: {
      description: "Accept a loose record",
      handler(innerCtx, args) {
        assertEquals(innerCtx, ctx);
        looseArgs = args;
        return { content: [], structuredContent: null };
      },
    },
    validated: {
      description: "Validate input and return a JSON array",
      inputSchema: z.object({ delta: z.number() }),
      outputSchema: z.array(z.string()),
      handler: () => ({ content: [], structuredContent: ["ok"] }),
    },
  });
  const extra: BaseContext = {
    mcpReq: {
      id: 1,
      method: "tools/call",
      signal: new AbortController().signal,
      requestState: () => undefined,
      send: () => Promise.reject(new Error("unused")),
      notify: () => Promise.resolve(),
    },
  };
  assert(app.oncalltool);
  assert(app.onlisttools);
  const listing = await app.onlisttools({}, extra);
  assertEquals(listing.tools.map((tool) => tool.name), ["loose", "validated"]);
  assertEquals(listing.tools[0].inputSchema.type, "object");
  assertEquals(listing.tools[1].inputSchema.properties?.delta, { type: "number" });
  assertEquals(listing.tools[1].outputSchema?.type, "array");
  assertEquals(
    (await app.oncalltool({ name: "loose", arguments: { delta: 2 } }, extra)).structuredContent,
    null,
  );
  assertEquals(looseArgs, { delta: 2 });
  await app.oncalltool({ name: "loose" }, extra);
  assertEquals(looseArgs, {});
  assertEquals(
    (await app.oncalltool({ name: "validated", arguments: { delta: 2 } }, extra)).structuredContent,
    ["ok"],
  );
  await assertRejects(
    () => app.oncalltool!({ name: "validated", arguments: { delta: "invalid" } }, extra),
    Error,
    "Invalid input",
  );
  registry.unregisterAll();
  await app.close();
});
