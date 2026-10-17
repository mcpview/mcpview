import { assert, assertEquals, assertStrictEquals } from "@std/assert";

import type { AppContext } from "@mcpview/view";
import {
  type Data,
  fakeApp,
  type Mounts,
  PERMISSIONS,
  registry,
  until,
  withDocument,
} from "../testing/surface-app-double.ts";
import {
  definePreactComponent,
  type PreactComponentRenderer,
  type PreactSurfaceAppOptions,
  type PreactSurfaceAppState,
  type PreactSurfaceComponentProps,
  startPreactSurfaceApp,
} from "./surface.ts";

type TestAppContext = AppContext<PreactSurfaceAppState<Data>>;

Deno.test("definePreactComponent forwards component surface context and cleans up", async () => {
  const events: string[] = [];
  let receivedProps: PreactSurfaceComponentProps<Data, TestAppContext> | undefined;
  const renderer: PreactComponentRenderer = {
    mount(_component, props, target) {
      events.push("mount");
      receivedProps = props as PreactSurfaceComponentProps<Data, TestAppContext>;
      assertStrictEquals(target, targetNode);
    },
    unmount(target) {
      events.push("unmount");
      assertStrictEquals(target, targetNode);
    },
  };
  const targetNode = {} as HTMLElement;
  const appContext = {} as TestAppContext;
  const data = { title: "Boiler" };
  const Component = (_props: PreactSurfaceComponentProps<Data, TestAppContext>) => null;
  const definition = definePreactComponent<Data, TestAppContext>(
    { title: "Identity" },
    Component,
    renderer,
  );

  const cleanup = await definition.mount(targetNode, {
    data,
    props: { compact: true },
    instanceId: "identity-1",
    appContext,
    hostContext: {},
  });

  assertStrictEquals(receivedProps?.data, data);
  assertStrictEquals(receivedProps?.context, appContext);
  assertEquals(receivedProps?.props, { compact: true });
  assertEquals(receivedProps?.instanceId, "identity-1");
  assertEquals(events, ["mount"]);

  await cleanup?.();
  assertEquals(events, ["mount", "unmount"]);
});

Deno.test({
  name: "statuses render through StateMessage, carrying tone, busy state and the viewer's class",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root);
      await startPreactSurfaceApp<Data>({
        root,
        info: { name: "Preact surface", version: "1.0.0" },
        registry: registry({ mounted: [], cleaned: [] }),
        loadingLabel: "Receiving the run…",
        statusClassName: "acme-viewer-state",
        theme: false,
      }, fake.runtime);

      const status = root.querySelector(".mcp-view-state") as HTMLElement | null;
      assert(status, `expected a StateMessage, got ${root.innerHTML}`);
      assertEquals(status.getAttribute("data-tone"), "info");
      assertEquals(status.getAttribute("aria-busy"), "true");
      assertEquals(status.getAttribute("role"), "status");
      assert(status.classList.contains("acme-viewer-state"));
      assertEquals(status.querySelector("strong")?.textContent, "Loading");
      assertEquals(
        status.querySelector(".mcp-view-state-detail")?.textContent,
        "Receiving the run…",
      );

      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => root.querySelector(".mcp-view-component") !== null, "the mount");
      // 0.5 viewers style this class; the facade keeps it over the core default.
      assertEquals(root.firstElementChild?.className, "mcp-view-preact-surface");
    }),
});

Deno.test({
  name: "a recorded session projects to a result through the Preact facade",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      type Session = { readonly schema: "test/1.0"; readonly title: string };
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const invalid: unknown[] = [];
      const fake = fakeApp(root);
      await startPreactSurfaceApp<Data, Session>({
        root,
        info: { name: "Preact surface", version: "1.0.0" },
        registry: registry(mounts),
        theme: false,
        viewerSession: {
          validate: (value): value is Session =>
            (value as { schema?: unknown })?.schema === "test/1.0",
          toState: (session) => ({ kind: "result", result: { title: session.title } }),
          onInvalid: (value) => invalid.push(value),
        },
      }, fake.runtime);

      await fake.session({ schema: "nope" });
      assertEquals(invalid, [{ schema: "nope" }]);
      await fake.session({ schema: "test/1.0", title: "Recorded" });
      await until(() => mounts.mounted.length === 1, "the session mount");
      assertEquals(mounts.mounted, ["Recorded"]);
    }),
});

Deno.test("the 0.6 validateSession/mapSessionToData pair is gone from the options type", () => {
  type Session = { readonly schema: "test/1.0" };
  const base = {
    root: {} as HTMLElement,
    info: { name: "Preact surface", version: "1.0.0" },
    registry: registry({ mounted: [], cleaned: [] }),
  };
  // One literal per option: TypeScript reports only the first excess property of a literal.
  const validate = {
    ...base,
    // @ts-expect-error removed in 0.7.0: use viewerSession.validate
    validateSession: (value: unknown): value is Session => value !== null,
  } satisfies PreactSurfaceAppOptions<Data, Session>;
  const map = {
    ...base,
    // @ts-expect-error removed in 0.7.0: use viewerSession.toState
    mapSessionToData: (): Data => ({ title: "x" }),
  } satisfies PreactSurfaceAppOptions<Data, Session>;
  const invalid = {
    ...base,
    // @ts-expect-error removed in 0.7.0: use viewerSession.onInvalid
    onInvalidSession: () => {},
  } satisfies PreactSurfaceAppOptions<Data, Session>;
  assertEquals(
    [validate.validateSession, map.mapSessionToData, invalid.onInvalidSession].map((option) =>
      typeof option
    ),
    ["function", "function", "function"],
  );
});

Deno.test({
  name: "a viewer-owned shell class replaces the facade default",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root);
      await startPreactSurfaceApp<Data>({
        root,
        info: { name: "Preact surface", version: "1.0.0" },
        registry: registry({ mounted: [], cleaned: [] }),
        surfaceClassName: "acme-viewer",
        theme: false,
      }, fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => root.querySelector(".mcp-view-component") !== null, "the mount");
      assertEquals(root.firstElementChild?.className, "acme-viewer");
    }),
});
