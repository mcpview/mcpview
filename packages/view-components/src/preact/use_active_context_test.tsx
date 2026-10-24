/** @jsxImportSource preact */

import { assertEquals } from "@std/assert";
import { createActiveContextController, createActiveContextPolicy } from "@mcpview/view/context";
import { render } from "preact";
import { act } from "preact/test-utils";
import { type ActiveContextHook, useActiveContext } from "./use-active-context.ts";

const policy = createActiveContextPolicy({
  schema: "example.context",
  version: 1,
  maxItems: 8,
  maxResourceBytes: 100,
  maxTextFallbackBytes: 100,
  limits: { id: 180, view: 120, label: 240, value: 240, resourceUri: 240, resourceMimeType: 100 },
});
const item = { id: "sample", label: "Sample", view: "Examples" };

async function withDom(fn: (root: HTMLElement) => Promise<void>) {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const dom = parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  const root = dom.document.getElementById("root") as unknown as HTMLElement;
  try {
    await fn(root);
  } finally {
    await act(() => render(null, root));
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
}

Deno.test("context hook remount preserves external controller, confirmed selection and in-flight queue", async () => {
  await withDom(async (root) => {
    let acknowledge!: () => void;
    const writes: unknown[] = [];
    const controller = createActiveContextController(
      {
        getHostCapabilities: () => ({ updateModelContext: { structuredContent: {} } }),
        updateModelContext(payload) {
          writes.push(payload);
          return new Promise<void>((resolve) => {
            acknowledge = resolve;
          });
        },
      },
      "root",
      policy,
    );
    let latest!: ActiveContextHook;
    function Viewer() {
      latest = useActiveContext(controller, "root");
      return <span>{latest.selections.length}:{String(latest.pending)}</span>;
    }
    act(() => render(<Viewer />, root));
    let result!: Promise<unknown>;
    await act(async () => {
      result = latest.activate(item);
      await Promise.resolve();
    });
    assertEquals(root.textContent, "0:true");
    act(() => render(null, root));
    act(() => render(<Viewer />, root));
    assertEquals(root.textContent, "0:true");
    await act(async () => {
      acknowledge();
      await result;
    });
    assertEquals(root.textContent, "1:false");
    act(() => render(null, root));
    act(() => render(<Viewer />, root));
    assertEquals(root.textContent, "1:false");
    assertEquals(writes.length, 1);
  });
});

Deno.test("context hook scope switch supersedes old handlers and retains rejected state for retry", async () => {
  await withDom(async (root) => {
    let fail = false;
    const writes: unknown[] = [];
    const controller = createActiveContextController(
      {
        getHostCapabilities: () => ({ updateModelContext: { structuredContent: {} } }),
        updateModelContext(payload) {
          writes.push(payload);
          return fail ? Promise.reject(new Error("host rejected")) : Promise.resolve();
        },
      },
      "root",
      policy,
    );
    let latest!: ActiveContextHook;
    function Viewer({ scope }: { scope: string }) {
      latest = useActiveContext(controller, scope);
      return <span>{latest.selections.length}:{String(latest.failed)}</span>;
    }
    act(() => render(<Viewer scope="root" />, root));
    const old = latest;
    await act(async () => {
      await latest.activate(item);
    });
    assertEquals(root.textContent, "1:false");
    fail = true;
    await act(async () => {
      render(<Viewer scope="another" />, root);
      await controller.settled();
    });
    assertEquals(root.textContent, "1:true");
    const before = writes.length;
    assertEquals(await old.activate({ ...item, id: "stale" }), "superseded");
    assertEquals(writes.length, before);
    fail = false;
    await act(async () => {
      await latest.retry();
    });
    assertEquals(root.textContent, "0:false");
  });
});

Deno.test("context hook controller replacement never renders previous controller state", async () => {
  await withDom(async (root) => {
    const host = () => ({
      getHostCapabilities: () => ({ updateModelContext: { structuredContent: {} } }),
      updateModelContext: () => Promise.resolve(),
    });
    const first = createActiveContextController(host(), "root", policy);
    const second = createActiveContextController(host(), "root", policy);
    await first.actionsForScope("root").activate(item);
    const renders: number[] = [];
    function Viewer({ controller }: { controller: typeof first }) {
      const state = useActiveContext(controller, "root");
      renders.push(state.selections.length);
      return <span>{state.selections.length}</span>;
    }
    act(() => render(<Viewer controller={first} />, root));
    renders.length = 0;
    act(() => render(<Viewer controller={second} />, root));
    assertEquals(renders.every((count) => count === 0), true);
  });
});

Deno.test("context hook exposes immediate provisional row state while basket stays ACK-confirmed", async () => {
  await withDom(async (root) => {
    let acknowledge!: () => void;
    const writes: unknown[] = [];
    const controller = createActiveContextController(
      {
        getHostCapabilities: () => ({ updateModelContext: { structuredContent: {} } }),
        updateModelContext(payload) {
          writes.push(payload);
          return new Promise<void>((resolve) => {
            acknowledge = resolve;
          });
        },
      },
      "root",
      policy,
    );
    let latest!: ActiveContextHook;
    function Viewer() {
      latest = useActiveContext(controller, "root");
      return (
        <span>
          {latest.selectionState(item)}:{String(latest.isSelected(item))}:{latest.selections
            .length}:
          {String(latest.pending)}
        </span>
      );
    }
    act(() => render(<Viewer />, root));
    assertEquals(root.textContent, "none:false:0:false");
    let preview!: ReturnType<ActiveContextHook["previewToggle"]>;
    act(() => {
      preview = latest.previewToggle(item);
    });
    assertEquals(root.textContent, "adding:false:0:true");
    assertEquals(latest.selectionState(item.id), "adding");
    assertEquals(writes.length, 0);
    act(() => preview.cancel());
    assertEquals(root.textContent, "none:false:0:false");
    assertEquals(writes.length, 0);

    act(() => {
      preview = latest.previewToggle(item);
    });
    let committed!: ReturnType<typeof preview.commit>;
    await act(async () => {
      committed = preview.commit();
      await Promise.resolve();
    });
    assertEquals(root.textContent, "adding:false:0:true");
    assertEquals(writes.length, 1);
    await act(async () => {
      acknowledge();
      await committed;
    });
    assertEquals(root.textContent, "selected:true:1:false");
    act(() => {
      preview = latest.previewToggle(item);
    });
    assertEquals(root.textContent, "removing:true:1:true");
    assertEquals(writes.length, 1);
    act(() => preview.cancel());
    assertEquals(root.textContent, "selected:true:1:false");
  });
});
