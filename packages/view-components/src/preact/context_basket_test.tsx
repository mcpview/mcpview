/** @jsxImportSource preact */

import { assertEquals, assertStrictEquals } from "@std/assert";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { contextBasketLabels } from "../context-basket-labels.ts";
import {
  ActiveContextChip,
  type ActiveContextChipProps,
  type ContextBasketSelection,
} from "./context-basket.tsx";

const selections = ["Alpha", "Beta", "Gamma"].map((label) => ({
  scopeKey: "root",
  item: { id: label, label, view: "Examples" },
}));
const labels = contextBasketLabels();

async function withDom(fn: (root: HTMLElement) => Promise<void> | void) {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const dom = parseHTML(
    '<html><body><button id="before">Before</button><div id="root"></div><button id="after">After</button></body></html>',
  );
  const previous = globalThis.document;
  const proto = dom.window.HTMLElement.prototype;
  const originalFocus = proto.focus;
  let active: Element = dom.document.body;
  Object.defineProperty(dom.document, "activeElement", {
    configurable: true,
    get: () => active.isConnected ? active : dom.document.body,
  });
  // linkedom has no focus model. Retain its real event/DOM behavior and supply only focus().
  proto.focus = function () {
    active = this;
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  const root = dom.document.getElementById("root") as unknown as HTMLElement;
  try {
    await fn(root);
  } finally {
    await act(() => render(null, root));
    proto.focus = originalFocus;
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
}

function button(root: ParentNode, selector: string): HTMLButtonElement {
  const node = root.querySelector<HTMLButtonElement>(selector);
  if (!node) throw new Error(`Button missing: ${selector}`);
  return node;
}
function click(node: HTMLElement) {
  node.dispatchEvent(new document.defaultView!.Event("click", { bubbles: true }));
}
function keyboardActivate(node: HTMLElement) {
  node.focus();
  const key = new document.defaultView!.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(key, "key", { value: "Enter" });
  node.dispatchEvent(key);
  // Native buttons produce a detail=0 click for keyboard activation. linkedom
  // does not implement that browser default action, so dispatch it explicitly.
  const event = new document.defaultView!.Event("click", { bubbles: true });
  Object.defineProperty(event, "detail", { value: 0 });
  node.dispatchEvent(event);
}
function open(root: HTMLElement) {
  const trigger = button(root, ".mcp-view-context-trigger");
  act(() => click(trigger));
  return trigger;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function props(extra: Partial<ActiveContextChipProps> = {}): ActiveContextChipProps {
  return { selections, labels, onClear: () => "cleared", onRemove: () => "shared", ...extra };
}

Deno.test("basket counter, list and caller text follow locale without changing identity", async () => {
  await withDom((root) => {
    act(() => render(<ActiveContextChip {...props()} />, root));
    open(root);
    assertEquals(root.querySelectorAll('[role="listitem"]').length, 3);
    assertEquals(button(root, ".mcp-view-context-trigger").textContent, "Active context · 3▴");
    act(() =>
      render(<ActiveContextChip {...props({ labels: contextBasketLabels("fr-TW") })} />, root)
    );
    assertEquals(
      root.querySelector('[role="dialog"]')?.getAttribute("aria-label"),
      "Éléments du contexte",
    );
    assertEquals(
      button(root, ".mcp-view-context-remove").getAttribute("aria-label"),
      "Retirer Alpha du contexte",
    );
    assertEquals(root.querySelectorAll('[role="listitem"]').length, 3);
    assertEquals(button(root, ".mcp-view-context-trigger").textContent, "Contexte actif · 3▴");
  });
});

Deno.test("basket clear keeps popover and focus until acceptance; rejection keeps context", async () => {
  await withDom(async (root) => {
    for (const result of ["error", "unsupported", "superseded"]) {
      const ack = deferred<string>();
      act(() => render(<ActiveContextChip {...props({ onClear: () => ack.promise })} />, root));
      if (!root.querySelector('[role="dialog"]')) open(root);
      const clear = button(root, ".mcp-view-context-clearAll");
      clear.focus();
      act(() => click(clear));
      assertStrictEquals(document.activeElement, clear);
      assertEquals(!!root.querySelector('[role="dialog"]'), true);
      await act(async () => {
        ack.resolve(result);
        await ack.promise;
      });
      assertStrictEquals(document.activeElement, clear);
      assertEquals(root.querySelectorAll('[role="listitem"]').length, 3);
    }
  });
});

Deno.test("basket accepted clear closes popover and restores outside focus after ACK", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    const base = props({ onClear: () => ack.promise });
    act(() => render(<ActiveContextChip {...base} />, root));
    open(root);
    const clear = button(root, ".mcp-view-context-clearAll");
    clear.focus();
    act(() => click(clear));
    await act(async () => {
      render(<ActiveContextChip {...base} selections={[]} />, root);
      ack.resolve("cleared");
      await ack.promise;
    });
    assertEquals(root.textContent, "");
    assertStrictEquals(document.activeElement, document.getElementById("after"));
  });
});

Deno.test("basket removal focus follows latest rendered list after projection changes", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    const base = props({ onRemove: () => ack.promise });
    act(() => render(<ActiveContextChip {...base} />, root));
    open(root);
    const remove = button(root, ".mcp-view-context-remove");
    remove.focus();
    act(() => click(remove));
    assertStrictEquals(document.activeElement, remove);
    // An ACK can change projection cardinality; this list is deliberately not the captured list minus Alpha.
    const next = ["Delta", "Epsilon", "Zeta"].map((label) => ({
      scopeKey: "root",
      item: { id: label, label },
    }));
    await act(async () => {
      render(<ActiveContextChip {...base} selections={next} />, root);
      ack.resolve("shared");
      await ack.promise;
    });
    assertEquals(
      (document.activeElement as HTMLElement).getAttribute("aria-label"),
      "Remove Delta from context",
    );
  });
});

Deno.test("basket accepted removal from two items targets the surviving single", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    const base = props({ selections: selections.slice(0, 2), onRemove: () => ack.promise });
    act(() => render(<ActiveContextChip {...base} />, root));
    open(root);
    act(() => click(button(root, ".mcp-view-context-remove")));
    await act(async () => {
      render(<ActiveContextChip {...base} selections={[selections[1]]} />, root);
      ack.resolve("shared");
      await ack.promise;
    });
    assertEquals(
      (document.activeElement as HTMLElement).getAttribute("aria-label"),
      "Remove Beta from context",
    );
    assertEquals(root.querySelector('[role="dialog"]'), null);
  });
});

Deno.test("basket targeted group removal uses caller group identity and summary", async () => {
  await withDom(async (root) => {
    const group = {
      scopeKey: "root",
      id: "batch",
      label: "12 examples",
      summary: "A selected range",
    };
    const removed: unknown[] = [];
    const base = props({
      entries: [{ kind: "group", group }, { kind: "single", selection: selections[0] }],
      onRemoveGroup: (value) => {
        removed.push(value);
        return "shared";
      },
    });
    act(() => render(<ActiveContextChip {...base} />, root));
    open(root);
    assertEquals(root.querySelectorAll('[role="listitem"]').length, 2);
    assertEquals(root.querySelector(".mcp-view-context-itemDetail")?.textContent, group.summary);
    await act(async () => {
      click(button(root, ".mcp-view-context-remove"));
      await Promise.resolve();
    });
    assertStrictEquals(removed[0], group);
  });
});

Deno.test("basket Escape returns focus, outside pointer closes without stealing it", async () => {
  await withDom((root) => {
    act(() => render(<ActiveContextChip {...props()} />, root));
    const trigger = open(root);
    button(root, ".mcp-view-context-remove").focus();
    const escape = new document.defaultView!.Event("keydown", { bubbles: true, cancelable: true });
    Object.defineProperty(escape, "key", { value: "Escape" });
    act(() => {
      document.dispatchEvent(escape);
    });
    assertEquals(root.querySelector('[role="dialog"]'), null);
    assertStrictEquals(document.activeElement, trigger);
    open(root);
    const outside = document.getElementById("after")!;
    outside.focus();
    act(() => {
      outside.dispatchEvent(new document.defaultView!.Event("pointerdown", { bubbles: true }));
    });
    assertEquals(root.querySelector('[role="dialog"]'), null);
    assertStrictEquals(document.activeElement, outside);
  });
});

Deno.test("basket Escape while pending prevents a late ACK stealing focus", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    const base = props({ onClear: () => ack.promise });
    act(() => render(<ActiveContextChip {...base} />, root));
    const trigger = open(root);
    act(() => click(button(root, ".mcp-view-context-clearAll")));
    const escape = new document.defaultView!.Event("keydown", { bubbles: true });
    Object.defineProperty(escape, "key", { value: "Escape" });
    act(() => {
      document.dispatchEvent(escape);
    });
    await act(async () => {
      ack.resolve("cleared");
      await ack.promise;
    });
    assertStrictEquals(document.activeElement, trigger);
  });
});

Deno.test("basket pending disables mutations and exposes error/retry including an empty basket", async () => {
  await withDom(async (root) => {
    let retries = 0;
    const base = props({
      selections: [] as ContextBasketSelection[],
      pending: true,
      failed: true,
      onRetry: () => {
        retries++;
        return "shared";
      },
    });
    act(() => render(<ActiveContextChip {...base} />, root));
    assertEquals(root.firstElementChild?.getAttribute("aria-busy"), "true");
    assertEquals(button(root, ".mcp-view-context-retry").disabled, true);
    assertEquals(root.textContent?.includes(labels.pending), true);
    act(() => render(<ActiveContextChip {...base} pending={false} />, root));
    await act(async () => {
      click(button(root, ".mcp-view-context-retry"));
      await Promise.resolve();
    });
    assertEquals(retries, 1);
    assertEquals(root.textContent?.includes(labels.error), true);
  });
});

Deno.test("basket keyboard Retry accepts a rejected clear and restores focus after controlled removal", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    function ControlledBasket() {
      const [current, setCurrent] = useState(selections);
      const [failed, setFailed] = useState(false);
      const [pending, setPending] = useState(false);
      return (
        <ActiveContextChip
          {...props()}
          selections={current}
          failed={failed}
          pending={pending}
          onClear={() => {
            setFailed(true);
            return "error";
          }}
          onRetry={async () => {
            setPending(true);
            const result = await ack.promise;
            setPending(false);
            if (result === "cleared") {
              setCurrent([]);
              setFailed(false);
            }
            return result;
          }}
        />
      );
    }
    act(() => render(<ControlledBasket />, root));
    open(root);
    await act(async () => {
      keyboardActivate(button(root, ".mcp-view-context-clearAll"));
      await Promise.resolve();
    });
    assertEquals(root.querySelectorAll('[role="listitem"]').length, 3);
    const retry = button(root, ".mcp-view-context-retry");
    act(() => keyboardActivate(retry));
    assertStrictEquals(document.activeElement, retry);
    await act(async () => {
      ack.resolve("cleared");
      await ack.promise;
    });
    assertEquals(root.textContent, "");
    assertStrictEquals(document.activeElement, document.getElementById("after"));
  });
});

Deno.test("basket Retry focuses retained controls only after acceptance and respects moved focus", async () => {
  await withDom(async (root) => {
    for (const result of ["error", "unsupported", "superseded", "shared"]) {
      const ack = deferred<string>();
      const base = props({ failed: true, onRetry: () => ack.promise });
      act(() => render(<ActiveContextChip {...base} />, root));
      const retry = button(root, ".mcp-view-context-retry");
      act(() => keyboardActivate(retry));
      await act(async () => {
        if (result === "shared") render(<ActiveContextChip {...base} failed={false} />, root);
        ack.resolve(result);
        await ack.promise;
      });
      assertStrictEquals(
        document.activeElement,
        result === "shared" ? button(root, ".mcp-view-context-trigger") : retry,
      );
    }
    const ack = deferred<string>();
    const base = props({ failed: true, onRetry: () => ack.promise });
    act(() => render(<ActiveContextChip {...base} />, root));
    act(() => keyboardActivate(button(root, ".mcp-view-context-retry")));
    document.getElementById("before")!.focus();
    await act(async () => {
      render(<ActiveContextChip {...base} selections={[]} failed={false} />, root);
      ack.resolve("cleared");
      await ack.promise;
    });
    assertStrictEquals(document.activeElement, document.getElementById("before"));
  });
});

Deno.test("basket rejected promises preserve focus and never clear unrelated items", async () => {
  await withDom(async (root) => {
    act(() =>
      render(
        <ActiveContextChip
          {...props({
            onRemove: undefined,
            onClear: () => {
              throw new Error("reject");
            },
          })}
        />,
        root,
      )
    );
    open(root);
    assertEquals(button(root, ".mcp-view-context-remove").disabled, true);
    const clear = button(root, ".mcp-view-context-clearAll");
    clear.focus();
    await act(async () => {
      click(clear);
      await Promise.resolve();
    });
    assertStrictEquals(document.activeElement, clear);
    assertEquals(root.querySelectorAll('[role="listitem"]').length, 3);
  });
});

Deno.test("basket pending single and clear preserve deliberate outside keyboard focus", async () => {
  await withDom(async (root) => {
    for (const single of [false, true]) {
      const ack = deferred<string>();
      const base = props({
        selections: single ? [selections[0]] : selections,
        onClear: () => ack.promise,
        onRemove: () => ack.promise,
      });
      act(() => render(<ActiveContextChip {...base} />, root));
      if (!single) open(root);
      const action = button(
        root,
        single ? ".mcp-view-context-remove" : ".mcp-view-context-clearAll",
      );
      action.focus();
      act(() => click(action));
      const outside = document.getElementById("before")!;
      // Browser Tab moves focus without pointerdown; ACK must respect that choice.
      outside.focus();
      await act(async () => {
        ack.resolve(single ? "shared" : "cleared");
        await ack.promise;
      });
      assertStrictEquals(document.activeElement, outside);
      act(() => render(null, root));
    }
  });
});

Deno.test("basket unmount before pending acceptance never moves focus", async () => {
  await withDom(async (root) => {
    const ack = deferred<string>();
    act(() =>
      render(
        <ActiveContextChip
          {...props({
            selections: [selections[0]],
            onRemove: () => ack.promise,
          })}
        />,
        root,
      )
    );
    const remove = button(root, ".mcp-view-context-remove");
    remove.focus();
    act(() => click(remove));
    // Unmount synchronously, before passive effects or the promise continuation.
    render(null, root);
    const outside = document.getElementById("before")!;
    outside.focus();
    await act(async () => {
      ack.resolve("shared");
      await ack.promise;
    });
    assertStrictEquals(document.activeElement, outside);
  });
});
