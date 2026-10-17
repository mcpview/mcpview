import { assert, assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";

import { CASYS_SURFACE_CONTEXT_KEY } from "@mcpview/contracts";
import {
  componentCatalogCapabilities,
  defineComponentRegistry,
  defineViewComponent,
} from "./components.ts";
import { createTranslator } from "./i18n.ts";
import { startSurfaceApp, SurfaceAppError, type SurfaceAppOptions } from "./surface-app.ts";
import {
  type Data,
  fakeApp,
  type Mounts,
  PERMISSIONS,
  registry,
  renderStatus,
  statusOf,
  until,
  withDocument,
} from "./testing/surface-app-double.ts";

function options(
  root: HTMLElement,
  registryValue: ReturnType<typeof registry>,
  extra: Partial<SurfaceAppOptions<Data, unknown>> = {},
): SurfaceAppOptions<Data, unknown> {
  return {
    root,
    info: { name: "Surface test", version: "1.0.0" },
    registry: registryValue,
    renderStatus,
    theme: false,
    ...extra,
  };
}

Deno.test({
  name: "generic interface messages follow the host locale, including visible statuses",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root, { hostContext: { locale: "fr-CA" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] })),
        fake.runtime,
      );
      await until(() => statusOf(root).title === "Chargement", "localized handshake loading");
      assertEquals(statusOf(root).message, "En attente des données…");
      await handle.show({ kind: "empty" });
      assertEquals(statusOf(root).title, "Aucune donnée");
      fake.hostContextChanged({ locale: "en-US" });
      await until(() => statusOf(root).title === "Empty", "localized visible status");
      await handle.show({
        kind: "notice",
        title: "unresolved",
        message: "TRACE GAP",
        code: "missing-proof",
      });
      fake.hostContextChanged({ locale: "fr" });
      await fake.idle();
      assertEquals(statusOf(root).title, "unresolved");
      assertEquals(statusOf(root).message, "TRACE GAP");
      assertEquals(statusOf(root).code, "missing-proof");
      await handle.dispose();
    }),
});

Deno.test({
  name: "localized label callbacks override only interface wording",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root, { hostContext: { locale: "fr" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] }), {
          loadingLabel: (locale) => locale === "fr" ? "Réception du modèle…" : "Receiving model…",
        }),
        fake.runtime,
      );
      await until(
        () => statusOf(root).message === "Réception du modèle…",
        "provider loading label",
      );
      fake.hostContextChanged({ locale: "en" });
      await until(
        () => statusOf(root).message === "Receiving model…",
        "changed provider loading label",
      );
      await handle.dispose();
    }),
});

Deno.test({
  name:
    "in-place theme updates retain the mounted renderer but locale and dimensions still remount",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, { hostContext: { theme: "light", locale: "en" } });
      const handle = await startSurfaceApp(
        options(root, registry(mounts), {
          themeUpdates: "in-place",
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      const element = root.querySelector(".mcp-view-component");
      fake.hostContextChanged({ theme: "dark" });
      await fake.idle();
      fake.hostContextChanged({ theme: "light" });
      await fake.idle();
      assertStrictEquals(root.querySelector(".mcp-view-component"), element);
      assertEquals(mounts.mounted.length, 1);
      assertEquals(mounts.cleaned.length, 0);
      fake.hostContextChanged({ locale: "fr" });
      await until(() => mounts.mounted.length === 2, "locale remount");
      fake.hostContextChanged({ containerDimensions: { width: 420 } });
      await until(() => mounts.mounted.length === 3, "dimensions remount");
      await handle.dispose();
      assertEquals(mounts.cleaned.length, 3);
    }),
});

Deno.test({
  name: "default theme changes still remount components that read the theme at mount",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, {
        hostContext: {
          theme: "light",
          locale: "en",
          containerDimensions: { width: 800, height: 600 },
        },
      });
      const handle = await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      fake.hostContextChanged({
        theme: "dark",
        locale: "en",
        containerDimensions: { height: 600, width: 800 },
      });
      await until(() => mounts.mounted.length === 2, "default theme remount");
      await handle.dispose();
    }),
});

Deno.test({
  name: "the App opens on a busy loading status and a structured result mounts the default surface",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), { loadingLabel: "Receiving…" }),
        fake.runtime,
      );
      assertEquals(statusOf(root), {
        kind: "loading",
        tone: "info",
        busy: "true",
        title: "Loading",
        message: "Receiving…",
      });
      assertEquals(fake.config().initialView, "status");
      // The host learns the catalog during the handshake, nowhere else.
      assertEquals(
        fake.config().capabilities?.experimental,
        componentCatalogCapabilities(registry(mounts)),
      );

      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the first mount");
      assertEquals(mounts.mounted, ["Boiler"]);
      assertEquals(root.querySelector(".mcp-view-component")?.textContent, "Boiler");
      assertEquals(root.firstElementChild?.className, "mcp-view-surface-shell");
      assertEquals(fake.handle().currentView, "surface");
    }),
});

Deno.test({
  name:
    "a result without data shows the empty status and leaving the surface disposes its components",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), { emptyLabel: "Nothing came back." }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await fake.toolResult({ content: [{ type: "text", text: "plain prose" }] });
      assertEquals(statusOf(root).kind, "empty");
      assertEquals(statusOf(root).message, "Nothing came back.");
      assertEquals(mounts.cleaned, ["Boiler"]);
      assertEquals(fake.handle().ctx.state.currentData, undefined);
    }),
});

Deno.test({
  name: "the default projection reports data rejected by validate as empty, never as a result",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), {
          validate: (value): value is Data =>
            typeof (value as { title?: unknown }).title === "string",
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: 42 } });
      assertEquals(statusOf(root).kind, "empty");
      assertEquals(mounts.mounted, []);
    }),
});

Deno.test("fromToolResult and validate are two projections, so the App refuses both at once", async () => {
  const error = await assertRejects(
    () =>
      startSurfaceApp<Data>({
        root: {} as HTMLElement,
        info: { name: "Surface test", version: "1.0.0" },
        registry: registry({ mounted: [], cleaned: [] }),
        renderStatus,
        theme: false,
        validate: (value): value is Data => typeof value === "object",
        fromToolResult: () => ({ kind: "empty" }),
      }),
    SurfaceAppError,
    "either fromToolResult or validate",
  );
  assertEquals(error.code, "SURFACE_APP_PROJECTION_CONFLICT");
  assertEquals(typeof error.data.recovery, "string");
});

Deno.test({
  name:
    "a projection that throws shows the rejected result, reports it and keeps the lifecycle alive",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), {
          onError: (error) => errors.push(error),
          fromToolResult: (result) => {
            const data = (result as { structuredContent?: { title?: string } })
              .structuredContent;
            if (!data?.title) throw new Error("no title in result");
            return { kind: "result", result: { title: data.title } };
          },
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [] });
      assertEquals(statusOf(root), {
        kind: "error",
        tone: "danger",
        busy: "false",
        title: "Result rejected",
        message: "no title in result",
      });
      assertEquals(errors.length, 1);

      await fake.toolResult({ content: [], structuredContent: { title: "After" } });
      assertEquals(mounts.mounted, ["After"]);
    }),
});

Deno.test({
  name: "a projection reads server resources through the host it is handed",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), {
          fromToolResult: async (_result, host) => {
            const resource = await host.readServerResource("casys://result/1");
            const text = (resource.contents[0] as { text?: string }).text ?? "";
            return { kind: "result", result: { title: text } };
          },
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [] });
      assertEquals(fake.reads, ["casys://result/1"]);
      assertEquals(mounts.mounted, ["resource"]);
    }),
});

Deno.test({
  name: "complete tool input returns the App to loading too, for hosts that never stream",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await fake.toolInput();
      assertEquals(statusOf(root).kind, "loading");
      assertEquals(mounts.cleaned, ["Boiler"]);
      assertEquals(fake.handle().ctx.state.currentData, undefined);
    }),
});

Deno.test({
  name: "partial tool input returns the App to loading and drops the remembered result",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await fake.toolInputPartial();
      assertEquals(statusOf(root).kind, "loading");
      assertEquals(mounts.cleaned, ["Boiler"]);
      assertEquals(fake.handle().ctx.state.currentData, undefined);
    }),
});

const CAPTION_SURFACE = {
  layout: { type: "stack", gap: "sm" },
  components: [{ id: "caption", component: "test.caption" }],
} as const;

function surfaceSelection(instanceId: string, surface: unknown) {
  return { [CASYS_SURFACE_CONTEXT_KEY]: { instanceId, status: "ready", surface } };
}

Deno.test({
  name:
    "in-place theme updates keep the mount across equal JSON snapshots and remount real context changes",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, {
        hostContext: {
          theme: "light",
          locale: "en",
          containerDimensions: { width: 800, height: 600 },
          styles: { color: "navy", padding: "8px" },
          availableDisplayModes: ["inline", ["pip", "fullscreen"]],
          extra: { nested: ["a", "b"] },
          ...surfaceSelection("i-1", CAPTION_SURFACE),
        },
      });
      const handle = await startSurfaceApp(
        options(root, registry(mounts), { themeUpdates: "in-place" }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the first mount");
      const element = root.querySelector(".mcp-view-component");
      assertEquals(mounts.mounted, ["caption:Boiler"]);

      fake.hostContextChanged({
        extra: { nested: ["a", "b"] },
        availableDisplayModes: ["inline", ["pip", "fullscreen"]],
        styles: { padding: "8px", color: "navy" },
        locale: "en",
        containerDimensions: { height: 600, width: 800 },
        theme: "dark",
        ...surfaceSelection("i-1", {
          components: [{ component: "test.caption", id: "caption" }],
          layout: { gap: "sm", type: "stack" },
        }),
      });
      await fake.idle();
      assertStrictEquals(root.querySelector(".mcp-view-component"), element);
      assertEquals(mounts.mounted.length, 1);
      assertEquals(mounts.cleaned.length, 0);

      fake.hostContextChanged({ containerDimensions: { width: 420, height: 600 } });
      await until(() => mounts.mounted.length === 2, "dimensions remount");
      fake.hostContextChanged({ locale: "fr" });
      await until(() => mounts.mounted.length === 3, "locale remount");
      fake.hostContextChanged(surfaceSelection("i-2", {
        layout: { type: "stack", gap: "sm" },
        components: [{ id: "title", component: "test.title" }],
      }));
      await until(() => mounts.mounted.length === 4, "surface remount");
      assertEquals(mounts.mounted.at(-1), "Boiler");
      fake.hostContextChanged({ styles: { color: "navy", padding: "16px" } });
      await until(() => mounts.mounted.length === 5, "styles remount");
      await handle.dispose();
      assertEquals(mounts.cleaned.length, 5);
    }),
});

Deno.test({
  name: "a host context change remounts the host-selected surface only while a result is displayed",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      const html = document.documentElement.dataset;
      assertEquals(html.casysSurfaceInstance, undefined);
      fake.hostContextChanged(surfaceSelection("i-1", CAPTION_SURFACE));
      await fake.idle();
      assertEquals(mounts.mounted, []);
      assertEquals(html.casysSurfaceInstance, "i-1");
      assertEquals(html.casysSurfaceStatus, "ready");

      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the selected surface");
      assertEquals(mounts.mounted, ["caption:Boiler"]);

      fake.hostContextChanged(surfaceSelection("i-2", {
        layout: { type: "stack", gap: "sm" },
        components: [{ id: "title", component: "test.title" }],
      }));
      await fake.idle();
      await until(() => mounts.mounted.length === 2, "the remount");
      assertEquals(mounts.mounted, ["caption:Boiler", "Boiler"]);
      assertEquals(mounts.cleaned, ["caption:Boiler"]);
      assertEquals(html.casysSurfaceInstance, "i-2");
      assertEquals(root.querySelector(".mcp-view-component")?.textContent, "Boiler");
    }),
});

Deno.test({
  name: "a data-owned surface composes the result over the host selection and its default",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, { hostContext: surfaceSelection("i-1", CAPTION_SURFACE) });
      const seen: string[] = [];
      await startSurfaceApp(
        options(root, registry(mounts), {
          surfaceFor: (data) => {
            seen.push(data.title);
            // A recorded result owns its composition; a live one follows the host.
            return data.title.startsWith("recorded:") ? CAPTION_SURFACE : undefined;
          },
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "recorded:Boiler" } });
      await until(() => mounts.mounted.length === 1, "the owned mount");
      assertEquals(mounts.mounted, ["caption:recorded:Boiler"]);

      // The host moves its selection: the owned surface is asked again and still wins.
      fake.hostContextChanged(surfaceSelection("i-2", {
        layout: { type: "stack", gap: "sm" },
        components: [{ id: "title", component: "test.title" }],
      }));
      await fake.idle();
      await until(() => mounts.mounted.length === 2, "the remount");
      assertEquals(mounts.mounted, ["caption:recorded:Boiler", "caption:recorded:Boiler"]);
      assertEquals(seen, ["recorded:Boiler", "recorded:Boiler"]);

      // `undefined` hands the result back to the host flow — and it is the host
      // selection that composes it, not the registry default.
      fake.hostContextChanged(surfaceSelection("i-3", CAPTION_SURFACE));
      await fake.idle();
      await until(() => mounts.mounted.length === 3, "the remount");
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 4, "the host-selected mount");
      assertEquals(mounts.mounted.at(-1), "caption:Boiler");
      assertEquals(seen.at(-1), "Boiler");
    }),
});

Deno.test({
  name: "a malformed data-owned surface keeps the surface route and names its owner",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), {
          onError: (error) => errors.push(error),
          surfaceFor: () => ({ layout: { type: "stack" }, components: [] }),
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      assertEquals(statusOf(root).title, "Surface invalid");
      assertEquals(
        statusOf(root).message,
        "The data-owned component surface is invalid: " +
          "Component surface must contain at least one component",
      );
      assertEquals(fake.handle().currentView, "surface");
      assertEquals(errors.length, 1);
      assertEquals(mounts.mounted, []);
    }),
});

Deno.test({
  name: "a `surfaceFor` that throws is reported against the data-owned owner",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      // The host has a valid selection: only the owner naming distinguishes them.
      const fake = fakeApp(root, { hostContext: surfaceSelection("i-1", CAPTION_SURFACE) });
      await startSurfaceApp(
        options(root, registry(mounts), {
          onError: (error) => errors.push(error),
          surfaceFor: () => {
            throw new TypeError("the recorded session has no anchor");
          },
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      assertEquals(statusOf(root).title, "Surface invalid");
      assertEquals(
        statusOf(root).message,
        "The data-owned component surface is invalid: the recorded session has no anchor",
      );
      assertEquals(fake.handle().currentView, "surface");
      assertEquals(errors.length, 1);
      assertEquals(mounts.mounted, []);
    }),
});

Deno.test({
  name: "a malformed host selection keeps the surface route and says why nothing is composed",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      const fake = fakeApp(root, {
        hostContext: surfaceSelection("i-1", { layout: { type: "stack" }, components: [] }),
      });
      await startSurfaceApp(
        options(root, registry(mounts), { onError: (error) => errors.push(error) }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      assertEquals(statusOf(root).title, "Surface invalid");
      assertEquals(
        statusOf(root).message,
        "The host-selected component surface is invalid: " +
          "Component surface must contain at least one component",
      );
      assertEquals(fake.handle().currentView, "surface");
      assertEquals(errors.length, 1);
      assertEquals(mounts.mounted, []);

      // A corrected selection recovers on the same route.
      fake.hostContextChanged(surfaceSelection("i-1", CAPTION_SURFACE));
      await fake.idle();
      await until(() => mounts.mounted.length === 1, "the corrected mount");
      assertEquals(mounts.mounted, ["caption:Boiler"]);
    }),
});

Deno.test({
  name:
    "a host context change during a transition neither throws nor remounts a result on its way out",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      const handle = await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the first mount");

      const leaving = handle.show({ kind: "empty" });
      await until(() => fake.log.includes("leave surface"), "the transition to start");
      // The router has no current view here; the runtime getter throws.
      assertThrows(() => fake.handle().currentView);
      fake.hostContextChanged({ locale: "fr" });
      await leaving;
      await fake.idle();
      assertEquals(statusOf(root).kind, "empty");
      assertEquals(mounts.mounted, ["Boiler"]);
      assertEquals(mounts.cleaned, ["Boiler"]);
    }),
});

Deno.test({
  name: "a result and a host context change replayed during the handshake remount once at boot",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, {
        replay: async (app) => {
          await app.toolResult({ content: [], structuredContent: { title: "Boiler" } });
          await until(() => mounts.mounted.length === 1, "the replayed mount");
          // Arrives before the surface App could listen: only the runtime saw it.
          app.hostContextChanged(surfaceSelection("i-1", CAPTION_SURFACE));
        },
      });
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.idle();
      await until(() => mounts.mounted.length === 2, "the boot remount");
      assertEquals(mounts.mounted, ["Boiler", "caption:Boiler"]);
      assertEquals(document.documentElement.dataset.casysSurfaceInstance, "i-1");

      // Without a change since the last render, boot remounts nothing.
      const again: Mounts = { mounted: [], cleaned: [] };
      const settled = fakeApp(root, {
        replay: async (app) => {
          await app.toolResult({ content: [], structuredContent: { title: "Still" } });
          await until(() => again.mounted.length === 1, "the replayed mount");
        },
      });
      await startSurfaceApp(options(root, registry(again)), settled.runtime);
      await settled.idle();
      assertEquals(again.mounted, ["Still"]);
    }),
});

Deno.test({
  name: "a host teardown buffered during the handshake leaves no listener behind",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root, { replay: (app) => app.teardown() });
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      assertEquals(fake.listeners.get("hostcontextchanged")?.size ?? 0, 0);
      assertEquals(fake.log, ["enter status", "leave status"]);
    }),
});

Deno.test({
  name: "only the latest mount survives when a remount overtakes a slow one",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const gates = new Map<string, () => void>();
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(
          root,
          registry(mounts, (target, data) =>
            new Promise<void>((resolve) => {
              gates.set(data.title, () => {
                target.textContent = data.title;
                resolve();
              });
            })),
        ),
        fake.runtime,
      );
      const first = fake.toolResult({ content: [], structuredContent: { title: "First" } });
      await until(() => gates.has("First"), "the first mount to start");
      // The route is mounted while its component is still mounting.
      await first;
      const second = fake.handle().navigate("surface", { title: "Second" });
      // The second navigation waits for the first mount inside onLeave.
      await until(() => fake.log.includes("leave surface"), "onLeave to start");
      // The queue is blocked, so give the event loop a turn rather than awaiting idle().
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(fake.log, ["enter status", "leave status", "enter surface", "leave surface"]);
      assertEquals(gates.has("Second"), false);
      assertEquals(mounts.cleaned, []);
      gates.get("First")!();
      await until(() => gates.has("Second"), "the second mount to start");
      assertEquals(mounts.cleaned, ["First"]);
      gates.get("Second")!();
      await second;
      await until(() => mounts.mounted.length === 2, "the second mount");
      assertEquals(mounts.mounted, ["First", "Second"]);
      assertEquals(mounts.cleaned, ["First"]);
      assertEquals(root.querySelector(".mcp-view-component")?.textContent, "Second");
    }),
});

Deno.test({
  name: "a superseded mount that fails does not overwrite the newer route",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      const gates = new Map<string, (error?: Error) => void>();
      const fake = fakeApp(root);
      const handle = await startSurfaceApp(
        options(
          root,
          registry(mounts, (target, data) =>
            new Promise<void>((resolve, reject) => {
              gates.set(data.title, (error) => {
                if (error) reject(error);
                else {
                  target.textContent = data.title;
                  resolve();
                }
              });
            })),
          { onError: (error) => errors.push(error) },
        ),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Slow" } });
      await until(() => gates.has("Slow"), "the slow mount to start");
      const next = handle.show({ kind: "empty" });
      await until(() => fake.log.includes("leave surface"), "onLeave to start");
      gates.get("Slow")!(new Error("too late"));
      await next;
      await fake.idle();
      assertEquals(errors.map((error) => (error as Error).message), ["too late"]);
      assertEquals(statusOf(root).kind, "empty");
      assertEquals(mounts.mounted, []);
    }),
});

Deno.test({
  name: "a failed mount shows the failure and a later result recovers from it",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const errors: unknown[] = [];
      let fail = true;
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(
          root,
          registry(mounts, (target, data) => {
            if (fail) throw new Error("renderer exploded");
            target.textContent = data.title;
          }),
          { onError: (error) => errors.push(error) },
        ),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Broken" } });
      await until(() => errors.length === 1, "the mount failure");
      assertEquals(statusOf(root).title, "Surface failed");
      assertEquals(statusOf(root).message, "Component surface failed: renderer exploded");
      assertEquals(errors.length, 1);

      fail = false;
      await fake.toolResult({ content: [], structuredContent: { title: "Fixed" } });
      await until(() => mounts.mounted.length === 1, "the recovery mount");
      assertEquals(mounts.mounted, ["Fixed"]);
    }),
});

Deno.test({
  name: "a component-only registry without a host surface says so instead of inventing one",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root);
      const componentOnly = defineComponentRegistry<Data>({
        components: {
          "test.title": defineViewComponent<Data>({
            descriptor: { title: "Title" },
            mount(target, context) {
              target.textContent = context.data.title;
            },
          }),
        },
      });
      await startSurfaceApp(
        options(root, componentOnly, { surfaceRequiredLabel: "Pick a surface first." }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      assertEquals(statusOf(root), {
        kind: "surface-required",
        tone: "warning",
        busy: "false",
        title: "Surface required",
        message: "Pick a surface first.",
      });
      assertEquals(fake.handle().currentView, "surface");
    }),
});

Deno.test({
  name: "a recorded session is projected like a tool result and a rejected session shows why",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      type Session = { readonly schema: "test/1.0"; readonly title?: string };
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const invalid: unknown[] = [];
      const errors: unknown[] = [];
      const fake = fakeApp(root);
      await startSurfaceApp<Data, Session>(
        {
          ...options(root, registry(mounts), { onError: (error) => errors.push(error) }),
          viewerSession: {
            validate: (value): value is Session =>
              (value as { schema?: unknown })?.schema === "test/1.0",
            toState: (session) => {
              if (!session.title) throw new Error("session carries no title");
              return session.title === "pending"
                ? {
                  kind: "notice",
                  title: "Unresolved",
                  message: "Still recording.",
                  tone: "warning",
                  busy: true,
                }
                : { kind: "result", result: { title: session.title } };
            },
            onInvalid: (value) => invalid.push(value),
          },
        },
        fake.runtime,
      );
      assert(fake.config().viewerSession, "the session subscription is installed before connect");

      await fake.session({ schema: "other" });
      assertEquals(invalid, [{ schema: "other" }]);

      await fake.session({ schema: "test/1.0", title: "pending" });
      assertEquals(statusOf(root), {
        kind: "notice",
        tone: "warning",
        busy: "true",
        title: "Unresolved",
        message: "Still recording.",
      });

      await fake.session({ schema: "test/1.0" });
      assertEquals(statusOf(root).title, "Session rejected");
      assertEquals(statusOf(root).message, "session carries no title");
      assertEquals(errors.length, 1);

      await fake.session({ schema: "test/1.0", title: "Recorded" });
      assertEquals(mounts.mounted, ["Recorded"]);
    }),
});

Deno.test({
  name:
    "notice and error label callbacks rerender on locale change without repeating projection I/O",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      let toolProjections = 0;
      let sessionProjections = 0;
      const fake = fakeApp(root, { hostContext: { locale: "fr" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] }), {
          fromToolResult: async (_result, host) => {
            toolProjections += 1;
            await host.readServerResource("casys://result/1");
            return {
              kind: "notice",
              title: (locale) => locale === "fr" ? "Preuve ouverte" : "Open proof",
              message: (locale) => locale === "fr" ? "Enregistrement en cours" : "Still recording",
              code: "TRACE_GAP",
              tone: "warning",
            };
          },
          viewerSession: {
            validate: (value): value is { schema: "test/1.0" } =>
              (value as { schema?: unknown })?.schema === "test/1.0",
            toState: async (_session, host) => {
              sessionProjections += 1;
              await host.readServerResource("casys://session/1");
              return {
                kind: "error",
                title: (locale) => locale === "fr" ? "Session incomplète" : "Incomplete session",
                message: (locale) => locale === "fr" ? "Preuve manquante" : "Proof missing",
                code: "E_SESSION",
              };
            },
          },
        }),
        fake.runtime,
      );

      await fake.toolResult({ content: [] });
      assertEquals(statusOf(root).title, "Preuve ouverte");
      assertEquals(statusOf(root).message, "Enregistrement en cours");
      assertEquals(statusOf(root).code, "TRACE_GAP");
      assertEquals(toolProjections, 1);
      assertEquals(fake.reads, ["casys://result/1"]);

      fake.hostContextChanged({ locale: "en" });
      await until(() => statusOf(root).title === "Open proof", "translated notice title");
      assertEquals(statusOf(root).message, "Still recording");
      assertEquals(statusOf(root).code, "TRACE_GAP");
      assertEquals(toolProjections, 1);
      assertEquals(sessionProjections, 0);
      assertEquals(fake.reads, ["casys://result/1"]);

      await handle.show({
        kind: "error",
        title: "Fournisseur",
        message: "RAW_DIAG",
        code: "E_VENDOR",
      });
      fake.hostContextChanged({ locale: "fr" });
      await fake.idle();
      assertEquals(statusOf(root).title, "Fournisseur");
      assertEquals(statusOf(root).message, "RAW_DIAG");
      assertEquals(statusOf(root).code, "E_VENDOR");

      await fake.session({ schema: "test/1.0" });
      assertEquals(statusOf(root).title, "Session incomplète");
      assertEquals(statusOf(root).message, "Preuve manquante");
      assertEquals(statusOf(root).code, "E_SESSION");
      assertEquals(sessionProjections, 1);
      assertEquals(fake.reads, ["casys://result/1", "casys://session/1"]);

      fake.hostContextChanged({ locale: "en" });
      await until(() => statusOf(root).title === "Incomplete session", "translated error title");
      assertEquals(statusOf(root).message, "Proof missing");
      assertEquals(statusOf(root).code, "E_SESSION");
      assertEquals(toolProjections, 1);
      assertEquals(sessionProjections, 1);
      assertEquals(fake.reads, ["casys://result/1", "casys://session/1"]);
    }),
});

Deno.test({
  name: "documentLanguage sets the document language at boot and on locale change",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const messages = createTranslator({
        defaultLocale: "en",
        messages: { title: "Model" },
        translations: {
          fr: { title: "Modèle" },
          "fr-CA": { title: "Modèle canadien" },
        },
      });
      document.documentElement.lang = "de";
      const fake = fakeApp(root, { hostContext: { locale: "fr-CA" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] }), {
          documentLanguage: messages.locale,
          themeUpdates: "in-place",
        }),
        fake.runtime,
      );
      await fake.idle();
      assertEquals(document.documentElement.lang, "fr-ca");
      assertEquals(statusOf(root).title, "Chargement");

      fake.hostContextChanged({ locale: "fr-FR" });
      await fake.idle();
      assertEquals(document.documentElement.lang, "fr");
      assertEquals(statusOf(root).title, "Chargement");
      fake.hostContextChanged({ theme: "dark" });
      await fake.idle();
      assertEquals(document.documentElement.lang, "fr");
      fake.hostContextChanged({ locale: "not a locale" });
      await until(() => statusOf(root).title === "Loading", "fallback dictionary loading");
      assertEquals(document.documentElement.lang, "en");
      await handle.dispose();
    }),
});

Deno.test({
  name: "without documentLanguage the document language is left unchanged",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      document.documentElement.lang = "de";
      const fake = fakeApp(root, { hostContext: { locale: "fr" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] })),
        fake.runtime,
      );
      await until(() => statusOf(root).title === "Chargement", "french loading");
      assertEquals(document.documentElement.lang, "de");
      fake.hostContextChanged({ locale: "en" });
      await until(() => statusOf(root).title === "Loading", "english loading");
      assertEquals(document.documentElement.lang, "de");
      await handle.dispose();
    }),
});

Deno.test({
  name:
    "rejected projections retranslate their generic title after a locale change and keep caller titles literal",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const errors: unknown[] = [];
      const fake = fakeApp(root, { hostContext: { locale: "fr" } });
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] }), {
          onError: (error) => errors.push(error),
          fromToolResult: () => {
            throw new Error("CAD_AXIS_LOCKED");
          },
          viewerSession: {
            validate: (value): value is { schema: "test/1.0" } =>
              (value as { schema?: unknown })?.schema === "test/1.0",
            toState: () => {
              throw new Error("SESSION_PROOF_MISSING");
            },
          },
        }),
        fake.runtime,
      );

      await fake.toolResult({ content: [] });
      assertEquals(statusOf(root).title, "Résultat rejeté");
      assertEquals(statusOf(root).message, "CAD_AXIS_LOCKED");
      assertEquals(statusOf(root).code, undefined);
      fake.hostContextChanged({ locale: "en" });
      await until(() => statusOf(root).title === "Result rejected", "translated result rejection");
      assertEquals(statusOf(root).message, "CAD_AXIS_LOCKED");
      assertEquals(statusOf(root).code, undefined);

      fake.hostContextChanged({ locale: "fr" });
      await until(() => statusOf(root).title === "Résultat rejeté", "French result rejection");
      await fake.session({ schema: "test/1.0" });
      assertEquals(statusOf(root).title, "Session rejetée");
      assertEquals(statusOf(root).message, "SESSION_PROOF_MISSING");
      assertEquals(statusOf(root).code, undefined);
      fake.hostContextChanged({ locale: "en" });
      await until(
        () => statusOf(root).title === "Session rejected",
        "translated session rejection",
      );
      assertEquals(statusOf(root).message, "SESSION_PROOF_MISSING");
      assertEquals(statusOf(root).code, undefined);

      await handle.show({
        kind: "error",
        title: "Fournisseur",
        message: "RAW_DIAG",
        code: "E_VENDOR",
      });
      fake.hostContextChanged({ locale: "fr" });
      await fake.idle();
      assertEquals(statusOf(root).title, "Fournisseur");
      assertEquals(statusOf(root).message, "RAW_DIAG");
      assertEquals(statusOf(root).code, "E_VENDOR");
      assertEquals(errors.length, 2);
    }),
});

Deno.test({
  name: "the handle routes display states like the host would and disposal releases the listener",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      const handle = await startSurfaceApp(
        options(root, registry(mounts), { strict: true }),
        fake.runtime,
      );
      assertStrictEquals(fake.config().strict, true);
      assertEquals(fake.listeners.get("hostcontextchanged")?.size, 1);

      await handle.show({ kind: "result", result: { title: "Shown" } });
      await until(() => mounts.mounted.length === 1, "the shown mount");
      assertEquals(mounts.mounted, ["Shown"]);
      await handle.show({ kind: "error", message: "gone", code: "E_GONE" });
      assertEquals(statusOf(root).title, "Error");
      assertEquals(statusOf(root).message, "gone");
      assertEquals(statusOf(root).code, "E_GONE");
      await handle.show({ kind: "notice", message: "pending", tone: "warning", code: "E_WAIT" });
      assertEquals(statusOf(root).code, "E_WAIT");
      await handle.show({ kind: "empty" });
      assertEquals(statusOf(root).code, undefined);

      await handle.show({ kind: "result", result: { title: "Last" } });
      await until(() => mounts.mounted.length === 2, "the last mount");
      await handle.dispose();
      assertEquals(fake.disposed, ["manual"]);
      assertEquals(mounts.cleaned, ["Shown", "Last"]);
      assertEquals(fake.listeners.get("hostcontextchanged")?.size, 0);
    }),
});

Deno.test({
  name: "host teardown detaches the host context listener and the router disposes the surface",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const fake = fakeApp(root);
      await startSurfaceApp(options(root, registry(mounts)), fake.runtime);
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the mount");
      await fake.teardown();
      assertEquals(fake.listeners.get("hostcontextchanged")?.size, 0);
      assertEquals(mounts.cleaned, ["Boiler"]);
      assertEquals(fake.config().strict, undefined);
    }),
});

Deno.test({
  name:
    "onTeardown runs once per App end of life, before the surface is disposed, and its throw is absorbed",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const mounts: Mounts = { mounted: [], cleaned: [] };
      const log: string[] = [];
      const errors: unknown[] = [];
      const fake = fakeApp(root);
      await startSurfaceApp(
        options(root, registry(mounts), {
          onError: (error) => errors.push(error),
          onTeardown: () => {
            log.push(`teardown cleaned=${mounts.cleaned.length}`);
            throw new Error("bridge already closed");
          },
        }),
        fake.runtime,
      );
      await fake.toolResult({ content: [], structuredContent: { title: "Boiler" } });
      await until(() => mounts.mounted.length === 1, "the mount");
      await fake.teardown();
      assertEquals(log, ["teardown cleaned=0"]);
      assertEquals(mounts.cleaned, ["Boiler"]);
      assertEquals(errors.length, 1);
      assertEquals((errors[0] as Error).message, "bridge already closed");

      // A second end of life on the same App runs nothing again.
      await fake.teardown();
      assertEquals(log, ["teardown cleaned=0"]);
      assertEquals(mounts.cleaned, ["Boiler"]);

      // Manual disposal is the other end of life; a torn-down App has none left.
      const manual = fakeApp(root);
      const calls: string[] = [];
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] }), {
          onTeardown: () => {
            calls.push("manual");
          },
        }),
        manual.runtime,
      );
      await handle.dispose();
      assertEquals(calls, ["manual"]);
    }),
});

Deno.test({
  name: "showing anything through a torn-down handle is refused with a stable code",
  permissions: PERMISSIONS,
  fn: () =>
    withDocument(async (root) => {
      const fake = fakeApp(root);
      const handle = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] })),
        fake.runtime,
      );
      await fake.teardown();
      const error = await assertRejects(
        () => handle.show({ kind: "empty" }),
        SurfaceAppError,
        "torn down",
      );
      assertEquals(error.code, "SURFACE_APP_CLOSED");

      // A handle returned after a handshake teardown is closed from the start.
      const early = fakeApp(root, { replay: (app) => app.teardown() });
      const closed = await startSurfaceApp(
        options(root, registry({ mounted: [], cleaned: [] })),
        early.runtime,
      );
      const again = await assertRejects(() => closed.show({ kind: "loading" }), SurfaceAppError);
      assertEquals(again.code, "SURFACE_APP_CLOSED");
    }),
});
