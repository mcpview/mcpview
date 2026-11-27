/// <reference lib="dom" />

import { assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import { parseHTML } from "npm:linkedom@0.18.12";
import { installPanelResizing } from "./panel-resizing.js";

function board(options: { noWidths?: boolean } = {}) {
  const { document, Event } = parseHTML(
    '<main><section data-compose-panel data-panel-label="Stock" data-compose-widths="768 380 640 640 bad -5 550.5 0 3000"><iframe></iframe></section>' +
      '<section data-compose-panel data-compose-widths="380 640"></section>' +
      '<section data-compose-panel></section><section data-compose-panel data-compose-widths="500"></section></main>',
  );
  const root = document.querySelector("main")!;
  const panels = Array.from(root.querySelectorAll<HTMLElement>("section"));
  panels.forEach((panel) => {
    if (options.noWidths) panel.removeAttribute("data-compose-widths");
  });
  const browserEvents = document.createElement("span");
  let available = 1100;
  let frame: FrameRequestCallback | undefined;
  Object.defineProperty(root, "clientWidth", { get: () => available });
  Object.defineProperty(document, "defaultView", {
    value: {
      innerWidth: 1100,
      addEventListener: browserEvents.addEventListener.bind(browserEvents),
      getComputedStyle: () => ({ display: "grid", paddingLeft: "0", paddingRight: "0" }),
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
      requestAnimationFrame: (fn: FrameRequestCallback) => {
        frame = fn;
        return 1;
      },
      cancelAnimationFrame: () => {
        frame = undefined;
      },
    },
  });
  const widths = new Map<HTMLElement, number>();
  const calls: number[][] = [];
  const positions: [number, number, string][][] = [];
  let skeleton: HTMLElement | undefined;
  // The layout planner has its own geometry tests. Simulate its contract to
  // check which exact widths get previewed or committed by each real input.
  function reset() {
    skeleton?.remove();
    skeleton = undefined;
    widths.clear();
  }
  const planner = () => ({
    layout(
      choices: ReadonlyMap<HTMLElement, number>,
      preview?: { panel: HTMLElement; skeleton: HTMLElement },
      placements?: ReadonlyMap<
        HTMLElement,
        { beside: HTMLElement; side: "left" | "right" | "below" }
      >,
    ) {
      const frozen = preview ? (widths.get(preview.panel) ?? 500) : 0;
      reset();
      for (const [node, width] of choices) widths.set(node, width);
      calls.push([...choices.values()]);
      positions.push(
        Array.from(
          placements ?? [],
          ([node, anchor]) => [panels.indexOf(node), panels.indexOf(anchor.beside), anchor.side],
        ),
      );
      if (preview) {
        widths.set(preview.panel, frozen);
        skeleton = preview.skeleton;
        skeleton.style.width = choices.get(preview.panel) + "px";
        root.append(skeleton);
      }
      return [...(placements?.values() ?? [])].at(-1)?.side !== "left";
    },
    reset,
  });
  for (const panel of panels) {
    panel.getBoundingClientRect = () =>
      ({ width: widths.get(panel) ?? 500, height: 160 }) as DOMRect;
  }
  const ctrl = new AbortController();
  installPanelResizing(root, ctrl.signal, planner);
  installPanelResizing(root, ctrl.signal, planner);
  const grip = (i: number) =>
    panels[i].querySelector<HTMLButtonElement>('[data-compose-corner="right"]')!;
  function fire(el: HTMLElement, type: string, props: object = {}) {
    el.dispatchEvent(Object.assign(new Event(type), props));
  }
  const key = (i: number, key: string) => fire(grip(i), "keydown", { key });
  const first = grip(0);
  if (first) {
    first.focus = () => {};
    first.setPointerCapture = () => {};
    first.hasPointerCapture = () => false;
  }
  const pointer = (type: string, x: number, y = 100) =>
    fire(first, type, {
      isPrimary: true,
      button: 0,
      pointerId: 7,
      clientX: x,
      clientY: y,
    });
  const resize = (room: number) => {
    available = room;
    fire(browserEvents, "resize");
    frame?.(0);
  };
  const place = (phase: string, panel: number, beside: number, side = "right") => {
    const detail = { phase, panel: panels[panel], beside: panels[beside], side, placed: false };
    fire(root, "compose-panel-place", { detail });
    return detail.placed;
  };
  return {
    root,
    panels,
    grip,
    key,
    pointer,
    calls,
    ctrl,
    widths,
    fire,
    browserEvents,
    resize,
    place,
    positions,
  };
}

Deno.test("a single corner chooses declared widths and keeps other viewers' choices", () => {
  const b = board();
  assertEquals(b.root.querySelectorAll("[data-compose-corner]").length, 2);
  assertEquals(b.root.querySelector('[data-compose-corner="left"]'), null);
  assertEquals(b.grip(2), null); // No declaration.
  assertEquals(b.grip(3), null); // The only option is already the native size.
  assertStringIncludes(b.grip(0).getAttribute("aria-description")!, "380, 640, 768");
  const iframe = b.panels[0].querySelector("iframe");
  b.key(0, "ArrowRight");
  b.key(0, "ArrowRight");
  b.key(1, "ArrowLeft");
  assertEquals(b.calls.at(-1), [768, 380]);
  b.key(0, "ArrowUp");
  assertEquals(b.calls.at(-1), [768, 380]);
  b.key(0, "Home");
  assertEquals(b.calls.at(-1), [380, 380]);
  b.key(0, "End");
  b.resize(600);
  assertEquals(b.calls.at(-1), [380, 380]);
  b.resize(1100);
  assertEquals(b.calls.at(-1), [768, 380]);
  assertStrictEquals(b.panels[0].querySelector("iframe"), iframe);
  assertEquals(b.panels[0].style.getPropertyValue("--compose-user-height"), undefined);
  b.ctrl.abort();
  assertEquals(b.root.querySelectorAll("[data-compose-corner]").length, 0);
});

Deno.test("pointer travels freely but only the skeleton takes an allowed width until release", () => {
  const b = board(), panel = b.panels[0];
  const preview = () => b.root.querySelector<HTMLElement>("[data-compose-resize-preview]");
  b.pointer("pointerdown", 100);
  b.pointer("pointermove", 100, 900);
  b.pointer("pointermove", 104);
  assertEquals(preview(), null);
  b.pointer("pointermove", 185); // past 500/640 midpoint + 6px hysteresis
  assertEquals(preview()?.style.width, "640px");
  assertEquals(preview()?.getAttribute("aria-hidden"), "true");
  assertEquals(panel.getBoundingClientRect().width, 500);
  const calls = b.calls.length;
  b.pointer("pointermove", 169); // jitter inside the dead band
  assertEquals(b.calls.length, calls);
  b.pointer("pointermove", 400);
  assertEquals(preview()?.style.width, "768px");
  assertEquals(panel.getBoundingClientRect().width, 500);
  b.pointer("pointerup", 400);
  assertEquals(preview(), null);
  assertEquals(b.widths.get(panel), 768);
  assertEquals(b.root.querySelector('[role="status"]')?.textContent, "Stock width 768 pixels.");
  b.ctrl.abort();
});

for (const type of ["Escape", "pointercancel", "lostpointercapture", "blur"]) {
  Deno.test(type + " cancels the resize preview and restores the prior selections", () => {
    const b = board();
    b.key(0, "ArrowRight");
    b.key(1, "ArrowLeft");
    b.pointer("pointerdown", 300);
    b.pointer("pointermove", 10);
    assertEquals(
      b.root.querySelector<HTMLElement>("[data-compose-resize-preview]")?.style.width,
      "380px",
    );
    if (type === "Escape") b.key(0, "Escape");
    else if (type === "blur") b.fire(b.browserEvents, "blur");
    else b.pointer(type, 10);
    assertEquals(b.root.querySelector("[data-compose-resize-preview]"), null);
    assertEquals(b.calls.at(-1), [640, 380]);
    assertEquals(b.root.hasAttribute("data-compose-dragging"), false);
    b.ctrl.abort();
  });
}

Deno.test("at the physical right edge a downward pull previews wider widths and returning cancels", () => {
  const b = board();
  b.panels[0].getBoundingClientRect = () => ({ width: 500, height: 160, right: 1100 }) as DOMRect;
  b.pointer("pointerdown", 1090, 100);
  b.pointer("pointermove", 1090, 140);
  const ghost = () => b.root.querySelector<HTMLElement>("[data-compose-resize-preview]");
  assertEquals(ghost()?.style.width, "640px");
  b.pointer("pointermove", 1090, 180);
  assertEquals(ghost()?.style.width, "768px");
  b.pointer("pointermove", 1090, 100);
  assertEquals(ghost(), null);
  b.pointer("pointerup", 1090, 100);
  assertEquals(b.calls.at(-1), []);
  assertEquals(b.panels[0].getBoundingClientRect().height, 160);
  b.ctrl.abort();
});

Deno.test("dropping a viewer beside another in free space preserves their sizes and rolls back rejected targets", () => {
  const b = board({ noWidths: true });
  assertEquals(b.root.querySelector("[data-compose-corner]"), null);
  assertEquals(b.place("preview", 0, 1), true);
  assertEquals(b.positions.at(-1), [[0, 1, "right"]]);
  b.place("cancel", 0, 1);
  assertEquals(b.positions.at(-1), []);
  assertEquals(b.place("commit", 0, 1), true);
  b.fire(b.root, "compose-layout-change");
  assertEquals(b.place("preview", 0, 2, "left"), false);
  assertEquals(b.positions.at(-1), [[0, 1, "right"]]);
  assertEquals(b.calls.at(-1), []);
  // Choosing the opposite anchoring direction replaces the old relation
  // only after a successful drop; it cannot produce a cycle.
  assertEquals(b.place("commit", 1, 0), true);
  assertEquals(b.positions.at(-1), [[1, 0, "right"]]);
  b.ctrl.abort();
});

Deno.test("a canceled swap restores a manual placement and a committed swap supersedes it", () => {
  const b = board();
  b.place("commit", 0, 1);
  const a = b.panels[0], c = b.panels[2];
  const oldA = a.style.order, oldC = c.style.order;
  a.style.order = "2";
  c.style.order = "0";
  b.fire(b.root, "compose-layout-preview");
  assertEquals(b.positions.at(-1), []);
  a.style.order = oldA;
  c.style.order = oldC;
  b.fire(b.root, "compose-layout-preview");
  assertEquals(b.positions.at(-1), [[0, 1, "right"]]);
  a.style.order = "2";
  c.style.order = "0";
  b.fire(b.root, "compose-layout-change");
  assertEquals(b.positions.at(-1), []);
  b.ctrl.abort();
});

Deno.test("a projected row survives a scrollbar, and returning beside the anchor replaces it", () => {
  const b = board();
  b.key(0, "ArrowLeft");
  assertEquals(b.place("preview", 0, 1, "below"), true);
  b.resize(1085);
  assertEquals(b.positions.at(-1), [[0, 1, "below"]]);
  b.place("cancel", 0, 1, "below");
  assertEquals(b.positions.at(-1), []);
  assertEquals(b.place("commit", 0, 1, "below"), true);
  b.fire(b.root, "compose-layout-change");
  assertEquals(b.place("preview", 0, 1, "right"), true);
  b.place("cancel", 0, 1, "right");
  assertEquals(b.positions.at(-1), [[0, 1, "below"]]);
  assertEquals(b.place("commit", 0, 1, "right"), true);
  b.resize(1100);
  assertEquals(b.positions.at(-1), [[0, 1, "right"]]);
  assertEquals(b.calls.at(-1), [380]);
  b.ctrl.abort();
});

Deno.test("the scrollbar created by a resize preview keeps the gesture and its valid preset", () => {
  const b = board();
  b.pointer("pointerdown", 100);
  b.pointer("pointermove", 185);
  const ghost = () => b.root.querySelector<HTMLElement>("[data-compose-resize-preview]");
  assertEquals(ghost()?.style.width, "640px");
  b.resize(1085);
  assertEquals(ghost()?.style.width, "640px");
  assertEquals(b.root.hasAttribute("data-compose-dragging"), true);
  b.resize(600); // The host itself became too narrow for this preset.
  assertEquals(ghost(), null);
  assertEquals(b.root.hasAttribute("data-compose-dragging"), true);
  b.pointer("pointerup", 185);
  assertEquals(b.calls.at(-1), []);
  b.ctrl.abort();
});
