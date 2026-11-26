import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { withDeclaredViewUri } from "@mcpview/contracts";
import {
  createDeclaredViewDispatcher,
  type DeclaredViewModule,
  type MountedDeclaredView,
} from "./declared-view.ts";
import type { ToolResult } from "./types.ts";

const list = "ui://erp/list";
const detail = "ui://erp/detail";
const host = { connection: "shell" };
type Module = DeclaredViewModule<typeof host>;

function result(uri: string, value = ""): ToolResult {
  const native: ToolResult = {
    content: [{ type: "text", text: value }],
    structuredContent: { value },
    _meta: { navigation: { tool: "get" }, ui: { resourceUri: uri } },
  };
  return withDeclaredViewUri(native, uri);
}

function fixture(loaders: Map<string, () => Promise<Module>>) {
  // Only the three DOM operations used by the dispatcher need a test double.
  let child: HTMLElement | undefined;
  const root = {
    ownerDocument: {
      createElement() {
        const target = {
          remove() {
            if (child === target) child = undefined;
          },
        } as HTMLElement;
        return target;
      },
    },
    replaceChildren(target: HTMLElement) {
      child = target;
    },
  } as unknown as HTMLElement;
  return { ...createDeclaredViewDispatcher({ root, host, loaders }), child: () => child };
}

Deno.test("dispatcher keeps the native result and shares the host across mounts and updates", async () => {
  const first = result(list, "1");
  const second = result(list, "2");
  const seen: ToolResult[] = [];
  let target: HTMLElement | undefined;
  let activeSignal: AbortSignal | undefined;
  let released = 0;
  const view = fixture(
    new Map([[list, () =>
      Promise.resolve({
        mount(root, connection, value, signal) {
          assertStrictEquals(connection, host);
          activeSignal = signal;
          target = root;
          seen.push(value);
          return {
            update(next) {
              seen.push(next);
            },
            dispose() {
              released++;
            },
          };
        },
      })]]),
  );
  assertEquals(await view.dispatch(first), true);
  assertStrictEquals(view.child(), target);
  assertEquals(await view.dispatch(second), true);
  assertStrictEquals(seen[0], first);
  assertStrictEquals(seen[1], second);
  view.dispose();
  view.dispose();
  assertEquals(released, 1);
  assertEquals(activeSignal?.aborted, true);
  assertEquals(view.child(), undefined);
  assertEquals(await view.dispatch(first), false);
});

Deno.test("dispatcher only loads registered modules with explicit route metadata on successful results", async () => {
  let mounts = 0;
  let disposed = 0;
  const loaders = new Map<string, () => Promise<Module>>([[list, () =>
    Promise.resolve({
      mount() {
        mounts++;
        return {
          dispose() {
            disposed++;
          },
        };
      },
    })]]);
  const view = fixture(loaders);
  const native = result(list);
  // A remote or session-only resource may exist on the server and still
  // lack a mountable result module in this shell.
  const remoteOnly = "ui://erp/recorded-session";
  loaders.set(remoteOnly, loaders.get(list)!);
  assertEquals(await view.dispatch(native), true);
  for (
    const unsupported of [
      { ...native, _meta: { ui: { resourceUri: list } } },
      { ...native, _meta: { "dev.mcpview/declared-view": { version: 2, resourceUri: list } } },
      result(remoteOnly),
      { ...native, isError: true },
    ]
  ) {
    assertEquals(await view.dispatch(unsupported), false);
    assertEquals(view.child(), undefined);
  }
  assertEquals({ mounts, disposed }, { mounts: 1, disposed: 1 });
});

Deno.test("a slow import cannot mount after a newer result, and a module without update remounts", async () => {
  const slow = Promise.withResolvers<Module>();
  const events: string[] = [];
  const module: Module = {
    mount() {
      events.push("mount");
      return {
        dispose() {
          events.push("dispose");
        },
      };
    },
  };
  const view = fixture(
    new Map([[list, () => slow.promise], [detail, () => Promise.resolve(module)]]),
  );
  const obsolete = view.dispatch(result(list));
  await view.dispatch(result(detail));
  const initial = view.child();
  slow.resolve(module);
  assertEquals(await obsolete, true);
  assertStrictEquals(view.child(), initial);
  await view.dispatch(result(detail));
  view.dispose();
  assertEquals(events, ["mount", "dispose", "mount", "dispose"]);
});

Deno.test("teardown aborts an asynchronous mount and disposes its eventual instance once", async () => {
  const entered = Promise.withResolvers<AbortSignal>();
  const handle = Promise.withResolvers<MountedDeclaredView>();
  let disposed = 0;
  const view = fixture(
    new Map([[list, () =>
      Promise.resolve({
        mount(_root, _host, _result, signal) {
          entered.resolve(signal);
          return handle.promise;
        },
      })]]),
  );
  const delivery = view.dispatch(result(list));
  const signal = await entered.promise;
  view.dispose();
  assertEquals(signal.aborted, true);
  assertEquals(view.child(), undefined);
  handle.resolve({
    dispose() {
      disposed++;
    },
  });
  await delivery;
  view.dispose();
  assertEquals(disposed, 1);
});

Deno.test("async updates stay in order and queued updates cannot cross route boundaries", async () => {
  const entered = Promise.withResolvers<void>();
  const wait = Promise.withResolvers<void>();
  const updates: ToolResult[] = [];
  const firstResult = result(list, "first");
  const view = fixture(
    new Map([[list, () =>
      Promise.resolve({
        mount() {
          return {
            dispose() {},
            async update(value) {
              updates.push(value);
              entered.resolve();
              await wait.promise;
            },
          };
        },
      })]]),
  );
  await view.dispatch(result(list));
  const first = view.dispatch(firstResult);
  const pending = view.dispatch(result(list, "second"));
  await entered.promise;
  assertEquals(updates, [firstResult]);
  assertEquals(await view.dispatch(result(detail)), false);
  wait.resolve();
  await Promise.all([first, pending]);
  assertEquals(updates, [firstResult]);
});

Deno.test("an active loader or mount failure clears the view and leaves the next result usable", async () => {
  let attempts = 0;
  const view = fixture(
    new Map([[list, () => {
      if (++attempts === 1) return Promise.reject(new Error("import failed"));
      return Promise.resolve({
        mount() {
          if (attempts === 2) throw new Error("mount failed");
          return {
            dispose() {},
            update() {
              throw new Error("update failed");
            },
          };
        },
      });
    }]]),
  );
  const next = () => view.dispatch(result(list));
  await assertRejects(next, Error, "import failed");
  await assertRejects(next, Error, "mount failed");
  assertEquals(view.child(), undefined);
  await next();
  await assertRejects(next, Error, "update failed");
  assertEquals(view.child(), undefined);
  assertEquals(await next(), true);
});

Deno.test("an HTML-only entry or an invalid module instance fails without retaining a root", async () => {
  const view = fixture(
    new Map([
      [list, () => Promise.resolve({ default: "<html></html>" } as unknown as Module)],
      [detail, () => Promise.resolve({ mount() {} } as unknown as Module)],
    ]),
  );
  await assertRejects(() => view.dispatch(result(list)), TypeError, "must export mount()");
  await assertRejects(() => view.dispatch(result(detail)), TypeError, "instance with dispose()");
  assertEquals(view.child(), undefined);
});
