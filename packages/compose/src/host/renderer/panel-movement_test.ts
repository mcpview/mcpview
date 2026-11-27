/// <reference lib="dom" />

import { assertEquals, assertStrictEquals } from "@std/assert";
import { parseHTML } from "npm:linkedom@0.18.12";
import { capturePanelLayout, restorePanelLayout } from "./panel-controls.js";
import { installPanelMovement } from "./panel-movement.js";

function board(markup: string) {
  const { document, Event, CustomEvent } = parseHTML(
    "<html><body><main>" + markup + "</main></body></html>",
  );
  const container = document.querySelector("main")!;
  // Exercise the same serialized function as the standalone HTML, in the DOM's realm.
  const install = new Function(
    "Event",
    "CustomEvent",
    "return (" + installPanelMovement.toString() + ")",
  )(Event, CustomEvent);
  install(container);
  install(container);
  return { container, Event };
}

Deno.test("swapping named areas by grip leaves both iframe nodes and slot identities in place", () => {
  const { container } = board(
    '<section data-compose-panel data-area="cad" data-panel-label="CAD"><iframe data-slot="0"></iframe></section>' +
      '<section data-compose-panel data-area="report" data-panel-label="Report"><iframe data-slot="1"></iframe></section>',
  );
  const [cad, report] = Array.from(container.querySelectorAll("section"));
  const frames = Array.from(container.querySelectorAll("iframe"));
  const [first, second] = Array.from(container.querySelectorAll("button"));
  let changes = 0;
  container.addEventListener("compose-layout-change", () => ++changes);
  first.click();
  assertEquals(first.getAttribute("aria-pressed"), "true");
  second.click();
  assertEquals([cad.dataset.area, report.dataset.area], ["report", "cad"]);
  assertEquals(first.getAttribute("aria-pressed"), "false");
  assertStrictEquals(cad.querySelector("iframe"), frames[0]);
  assertStrictEquals(report.querySelector("iframe"), frames[1]);
  assertEquals(frames.map((frame) => frame.dataset.slot), ["0", "1"]);
  assertEquals(changes, 1);
});

Deno.test("arrow keys swap CSS order along the visible axis, including in an existing tab bar", () => {
  const { container, Event } = board(
    '<div data-compose-panel data-panel-label="Table"><button data-compose-grip></button></div>' +
      '<div data-compose-panel data-panel-label="Chart"><button data-compose-grip></button></div>',
  );
  const [first, second] = Array.from(container.querySelectorAll("div"));
  for (const panel of [first, second]) {
    panel.getBoundingClientRect = () => {
      const left = Number(panel.style.order) * 100;
      return { left, right: left + 90, top: 0, bottom: 30, width: 90, height: 30 } as DOMRect;
    };
  }
  const grip = first.querySelector("button")!;
  const arrow = (key: string) => grip.dispatchEvent(Object.assign(new Event("keydown"), { key }));
  arrow("ArrowDown");
  assertEquals([first.style.order, second.style.order], ["0", "1"]);
  arrow("ArrowRight");
  assertEquals([first.style.order, second.style.order], ["1", "0"]);
  arrow("ArrowLeft");
  assertEquals([first.style.order, second.style.order], ["0", "1"]);
  assertEquals(container.querySelectorAll("button").length, 2);
});

function dragBoard() {
  const { container, Event } = board(
    '<section data-compose-panel data-area="table"><iframe></iframe></section>' +
      '<section data-compose-panel data-area="chart"><iframe></iframe></section>',
  );
  const [first, second] = Array.from(container.querySelectorAll("section"));
  container.getBoundingClientRect = () =>
    ({ left: 0, right: 195, top: 0, bottom: 88, width: 195, height: 88 }) as DOMRect;
  for (const panel of [first, second]) {
    panel.getBoundingClientRect = () => {
      const left = panel.dataset.area === "table" ? 0 : 100;
      const height = panel === first ? 40 : 80;
      return { left, right: left + 90, top: 0, bottom: height, width: 90, height } as DOMRect;
    };
  }
  const grip = first.querySelector("button")!;
  let captured: number | undefined;
  grip.setPointerCapture = (id) => {
    captured = id;
  };
  grip.hasPointerCapture = (id) => captured === id;
  grip.releasePointerCapture = () => {
    captured = undefined;
  };
  const pointer = (type: string, x: number, y = 8) =>
    grip.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), {
      pointerId: 7,
      button: 0,
      isPrimary: true,
      clientX: x,
      clientY: y,
    }));
  const escape = () => grip.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  const escapeDocument = () =>
    container.ownerDocument.dispatchEvent(Object.assign(new Event("keydown"), { key: "Escape" }));
  const preview = () => container.querySelector("[data-compose-drop-preview]");
  return { container, first, second, pointer, escape, escapeDocument, preview };
}

Deno.test("a drag projects the moving viewer's own footprint and commits once on drop", () => {
  const { container, first, second, pointer, preview } = dragBoard();
  const frames = [first.querySelector("iframe"), second.querySelector("iframe")];
  let commits = 0;
  const layouts: Array<string | undefined> = [];
  container.addEventListener("compose-layout-change", () => commits++);
  container.addEventListener("compose-layout-preview", () => layouts.push(first.dataset.area));
  pointer("pointerdown", 4);
  pointer("pointermove", 6);
  assertEquals(preview(), null);
  pointer("pointermove", 16);
  const skeleton = preview();
  assertStrictEquals(skeleton?.parentElement, first);
  assertEquals(skeleton?.getAttribute("aria-hidden"), "true");
  pointer("pointermove", 120, 65);
  assertStrictEquals(preview(), skeleton);
  assertStrictEquals(skeleton?.parentElement, first);
  const projected = first.getBoundingClientRect();
  assertEquals([projected.left, projected.height], [100, 40]);
  assertEquals(second.getBoundingClientRect().left, 0);
  assertEquals(commits, 0);
  pointer("pointerup", 120, 65);
  assertEquals(preview(), null);
  assertEquals([first.dataset.area, second.dataset.area], ["chart", "table"]);
  assertEquals(first.getBoundingClientRect(), projected);
  assertEquals(commits, 1);
  assertEquals(layouts, ["chart"]);
  assertStrictEquals(first.querySelector("iframe"), frames[0]);
  assertStrictEquals(second.querySelector("iframe"), frames[1]);
});

Deno.test("Escape, a cancelled pointer and dropping outside clear the skeleton without swapping", () => {
  const { container, first, second, pointer, escape, escapeDocument, preview } = dragBoard();
  const layouts: Array<string | undefined> = [];
  container.addEventListener("compose-layout-preview", () => layouts.push(first.dataset.area));
  for (
    const finish of ["escape", "escapeDocument", "pointercancel", "lostpointercapture", "outside"]
  ) {
    pointer("pointerdown", 4);
    pointer("pointermove", 120);
    assertStrictEquals(preview()?.parentElement, first);
    if (finish === "escape") escape();
    else if (finish === "escapeDocument") escapeDocument();
    else if (finish === "outside") {
      pointer("pointermove", 210);
      assertStrictEquals(preview()?.parentElement, first);
      pointer("pointerup", 210);
    } else pointer(finish, 120);
    assertEquals(preview(), null);
    assertEquals([first.dataset.area, second.dataset.area], ["table", "chart"]);
    assertEquals(layouts.splice(0), ["chart", "table"]);
  }
});

Deno.test("a drag across a gutter proposes the adjacent free space and keeps the anchor fixed", () => {
  const { container, first, second, pointer, escape, preview } = dragBoard();
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  container.getBoundingClientRect = () => box(0, 0, 195, 180);
  second.getBoundingClientRect = () => box(0, 0, 90, 80);
  let placed = false;
  let fits = true;
  first.getBoundingClientRect = () => placed ? box(98, 0, 90, 40) : box(0, 88, 90, 40);
  let commits = 0;
  const events: string[] = [];
  container.addEventListener("compose-layout-change", () => commits++);
  container.addEventListener("compose-panel-place", (event) => {
    const detail = (event as CustomEvent).detail;
    assertStrictEquals(detail.panel, first);
    assertStrictEquals(detail.beside, second);
    assertEquals(detail.side, "right");
    events.push(detail.phase);
    placed = fits && detail.phase !== "cancel";
    detail.placed = placed;
  });
  function hoverFreeSpace() {
    pointer("pointerdown", 5, 94);
    pointer("pointermove", 9, 84); // Between rows, before any viewer can be hit.
    assertStrictEquals(preview()?.parentElement, first);
    pointer("pointermove", 110, 35);
    pointer("pointermove", 106, 35);
    assertStrictEquals(preview()?.parentElement, first);
    assertEquals([first.dataset.area, second.dataset.area], ["table", "chart"]);
  }
  hoverFreeSpace();
  assertEquals(first.getBoundingClientRect().left, 98);
  escape();
  assertEquals(events.splice(0), ["preview", "cancel"]);
  assertEquals(first.getBoundingClientRect().top, 88);
  fits = false;
  hoverFreeSpace();
  pointer("pointerup", 106, 35);
  assertEquals(events.splice(0), ["preview"]);
  assertEquals([placed, commits], [false, 0]);
  fits = true;
  hoverFreeSpace();
  pointer("pointerup", 106, 35);
  assertEquals(events, ["preview", "commit"]);
  assertEquals([placed, commits], [true, 1]);
  assertEquals(preview(), null);
  assertEquals(second.getBoundingClientRect(), box(0, 0, 90, 80));
});

Deno.test("the lower edge opens a row, and moving back beside the viewer releases it", () => {
  const { container, first: stock, second: revenue, pointer, escape, preview } = dragBoard();
  container.setAttribute("data-compose-resizing-ready", "");
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  let committed = "right";
  let projected = committed;
  let commits = 0;
  revenue.getBoundingClientRect = () => box(0, 0, 90, 80);
  stock.getBoundingClientRect = () =>
    projected === "below" ? box(0, 88, 90, 40) : box(98, 0, 90, 40);
  container.getBoundingClientRect = () => box(0, 0, 195, projected === "below" ? 128 : 80);
  container.addEventListener("compose-layout-change", () => commits++);
  container.addEventListener("compose-panel-place", (event) => {
    const d = (event as CustomEvent).detail;
    assertStrictEquals(d.panel, stock);
    assertStrictEquals(d.beside, revenue);
    if (d.phase === "commit") committed = d.side;
    projected = d.phase === "cancel" ? committed : d.side;
    d.placed = d.phase !== "cancel";
  });
  function grab() {
    const rect = stock.getBoundingClientRect();
    pointer("pointerdown", rect.left + 4, rect.top + 4);
  }
  grab();
  pointer("pointerup", 102, 4);
  assertEquals(preview(), null);
  grab();
  pointer("pointermove", 40, 79); // Last pixel inside an 80px-tall embedded board.
  assertEquals(stock.getBoundingClientRect().top, 88);
  assertStrictEquals(preview()?.parentElement, stock);
  pointer("pointermove", 40, 120); // Continue down into the new row.
  assertEquals(projected, "below");
  escape();
  assertEquals([projected, committed, commits], ["right", "right", 0]);
  grab();
  pointer("pointermove", 40, 79);
  pointer("pointercancel", 40, 79);
  assertEquals([projected, committed, commits], ["right", "right", 0]);
  assertEquals(preview(), null);
  grab();
  pointer("pointermove", 40, 81); // A small overshoot past the original bottom also works.
  pointer("pointerup", 40, 120);
  assertEquals([committed, commits], ["below", 1]);
  grab();
  pointer("pointermove", 110, 30);
  assertEquals(container.getBoundingClientRect().height, 80);
  pointer("pointermove", 40, 79);
  assertEquals(container.getBoundingClientRect().height, 128);
  pointer("pointermove", 110, 30);
  escape();
  assertEquals([projected, committed, commits], ["below", "below", 1]);
  grab();
  pointer("pointermove", 110, 30);
  pointer("pointerup", 110, 30);
  assertEquals([committed, commits], ["right", 2]);
  assertEquals(container.getBoundingClientRect().height, 80);
  assertEquals(revenue.getBoundingClientRect(), box(0, 0, 90, 80));
  grab();
  pointer("pointermove", 40, 35); // Center retains the ordinary swap.
  pointer("pointerup", 40, 35);
  assertEquals([stock.dataset.area, revenue.dataset.area], ["chart", "table"]);
});

Deno.test("named template restores by stable panel identity when fresh area names differ", () => {
  const html = (a: string, b: string) =>
    [a, b].map((slot, i) =>
      `<div data-compose-panel data-compose-panel-id="kpi:${i}" data-area="${slot}"><iframe></iframe></div>`
    ).join("");
  const first = board(html("top", "bottom")).container;
  let edits = 0;
  first.addEventListener("compose-panel-layout-committed", () => edits++);
  const [a, b] = first.querySelectorAll("button");
  a.click();
  b.click();
  assertEquals(edits, 1);
  const snapshot = capturePanelLayout(first);
  assertEquals(snapshot?.order, ["kpi:1", "kpi:0"]);
  const fresh = board(html("left", "right")).container;
  const [panelA, panelB] = fresh.querySelectorAll<HTMLElement>("[data-compose-panel]");
  const frame = panelA.querySelector("iframe");
  assertEquals(restorePanelLayout(fresh, snapshot), true);
  assertEquals([panelA.dataset.area, panelB.dataset.area], ["right", "left"]);
  assertStrictEquals(panelA.querySelector("iframe"), frame);
  assertEquals(capturePanelLayout(fresh), snapshot);
});
