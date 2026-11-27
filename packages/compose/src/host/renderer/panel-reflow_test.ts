/// <reference lib="dom" />

import { assertEquals } from "@std/assert";
import { parseHTML } from "npm:linkedom@0.18.12";
import { createPanelReflow } from "./panel-reflow.js";

Deno.test("a wide viewer displaces only intersecting named areas and restores their placement on shrink", () => {
  const { document } = parseHTML(
    "<main>" +
      ["cad", "cut", "cost", "print"].map((name) =>
        '<section data-compose-panel data-area="' + name + '"><iframe></iframe></section>'
      ).join("") + "</main>",
  );
  const container = document.querySelector("main")!;
  Object.defineProperty(document, "defaultView", {
    value: {
      getComputedStyle: () => ({
        direction: "ltr",
        columnGap: "8px",
        rowGap: "8px",
        paddingLeft: "0",
        paddingTop: "0",
        gridTemplateColumns: "400px 400px 400px",
        gridTemplateRows: "120px 160px",
        gridTemplateAreas: '"cad cut cost" "cad print print"',
      }),
    },
  });
  for (const key of ["scrollTop", "scrollLeft", "clientTop", "clientLeft"]) {
    Object.defineProperty(container, key, { value: 0 });
  }
  const panels = Array.from(container.querySelectorAll("section"));
  const [cad, cut, cost, print] = panels;
  const frames = panels.map((node) => node.firstElementChild);
  const rect = (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => ({ left, top, width, height, right: left + width, bottom: top + height } as DOMRect);
  container.getBoundingClientRect = () => rect(0, 0, 1216, 288);
  cad.getBoundingClientRect = () => rect(0, 0, 400, 268);
  cut.getBoundingClientRect = () => rect(408, 0, 400, 96);
  cost.getBoundingClientRect = () => rect(816, 0, 400, 118);
  print.getBoundingClientRect = () => rect(408, 128, 808, 146);
  const flow = createPanelReflow(container);
  const choices = new Map<HTMLElement, number>([[cad, 384]]);
  flow.layout(choices);
  assertEquals(cad.style.width, "384px");
  assertEquals(cut.style.gridRow, "1 / span 1");

  choices.set(cad, 640);
  const skeleton = document.createElement("div");
  flow.layout(choices, { panel: cad, skeleton });
  assertEquals(skeleton.parentNode === container, true);
  assertEquals(skeleton.style.width, "640px");
  assertEquals(cad.style.position, "absolute");
  assertEquals(cut.style.gridRow, "3 / span 1");
  assertEquals(cut.style.width, "400px");
  assertEquals(print.style.width, "808px");
  choices.set(cad, 384);
  flow.layout(choices);
  assertEquals(skeleton.isConnected, false);
  assertEquals(cut.style.gridRow, "1 / span 1");

  choices.set(cad, 640);
  flow.layout(choices);
  assertEquals(cad.style.gridColumn, "1 / span 2");
  assertEquals(cad.style.gridRow, "1 / span 2");
  assertEquals(cut.style.gridRow, "3 / span 1");
  assertEquals(cost.style.gridColumn, "3 / span 1");
  assertEquals(cost.style.gridRow, "1 / span 1");
  assertEquals(print.style.gridRow, "3 / span 1");
  assertEquals(panels.every((node, i) => node.firstElementChild === frames[i]), true);

  choices.set(cut, 320);
  flow.layout(choices);
  assertEquals(cut.style.width, "320px");
  choices.set(cad, 384);
  flow.layout(choices);
  assertEquals(cut.style.gridRow, "1 / span 1");
  assertEquals(cut.style.width, "320px");
  flow.reset();
  assertEquals(panels.map((node) => node.style.gridRow || ""), ["", "", "", ""]);
  // The rightmost viewer can grow into the board from its single bottom-right corner.
  flow.layout(new Map([[cost, 768]]));
  assertEquals(cost.style.gridColumn, "2 / span 2");
  assertEquals(cost.style.marginLeft, "40px");
  assertEquals(cut.style.gridRow, "3 / span 1");
  flow.layout(new Map());
  assertEquals(cut.style.gridRow || "", "");
});

Deno.test("moving a viewer up into an occupied row reclaims its old row", () => {
  const { document } = parseHTML(
    "<main>" + "<section data-compose-panel></section>".repeat(4) + "</main>",
  );
  const container = document.querySelector("main")!;
  const panels = Array.from(container.querySelectorAll("section"));
  Object.defineProperty(document, "defaultView", {
    value: {
      getComputedStyle: () => ({
        direction: "ltr",
        columnGap: "8px",
        rowGap: "8px",
        gridTemplateAreas: "none",
        gridTemplateColumns: "400px",
        gridTemplateRows: "100px 100px 100px 100px",
      }),
    },
  });
  for (const key of ["scrollTop", "scrollLeft", "clientTop", "clientLeft"]) {
    Object.defineProperty(container, key, { value: 0 });
  }
  const box = (top: number, height: number) => ({
    left: 0,
    right: 400,
    width: 400,
    top,
    bottom: top + height,
    height,
  } as DOMRect);
  container.getBoundingClientRect = () => box(0, 424);
  panels.forEach((panel, index) => panel.getBoundingClientRect = () => box(index * 108, 100));
  const flow = createPanelReflow(container);
  const [revenue, previous, stock, last] = panels;
  assertEquals(
    flow.layout(new Map(), undefined, new Map([[stock, { beside: revenue, side: "below" }]])),
    true,
  );
  assertEquals([revenue, stock, previous, last].map((panel) => panel.style.gridRow), [
    "1 / span 1",
    "2 / span 1",
    "3 / span 1",
    "4 / span 1",
  ]);
  flow.reset();
  assertEquals(container.style.gridTemplateRows || "", "");
});

Deno.test("the next preset first slides a compact neighbor on the same row, also during preview", () => {
  const { document } = parseHTML(
    "<main><section data-compose-panel></section><section data-compose-panel></section></main>",
  );
  const container = document.querySelector("main")!;
  const [stock, kpi] = Array.from(container.querySelectorAll("section"));
  Object.defineProperty(document, "defaultView", {
    value: {
      getComputedStyle: () => ({
        direction: "ltr",
        columnGap: "8px",
        rowGap: "8px",
        paddingLeft: "0",
        paddingTop: "0",
        gridTemplateColumns: "606px 606px",
        gridTemplateRows: "250px",
        gridTemplateAreas: "none",
      }),
    },
  });
  for (const prop of ["clientLeft", "clientTop", "scrollLeft", "scrollTop"]) {
    Object.defineProperty(container, prop, { value: 0 });
  }
  const bounds = (
    x: number,
    width: number,
    height: number,
  ) => ({ left: x, top: 0, right: x + width, bottom: height, width, height } as DOMRect);
  container.getBoundingClientRect = () => bounds(0, 1220, 250);
  stock.getBoundingClientRect = () => bounds(0, parseFloat(stock.style.width) || 606, 250);
  kpi.getBoundingClientRect = () => bounds(614, parseFloat(kpi.style.width) || 606, 243);
  const flow = createPanelReflow(container);
  const choices = new Map([[stock, 380], [kpi, 380]]);
  flow.layout(choices);
  const skeleton = document.createElement("div");
  choices.set(stock, 640);
  flow.layout(choices, { panel: stock, skeleton });
  assertEquals(stock.style.width, "380px");
  assertEquals(skeleton.style.width, "640px");
  assertEquals(kpi.style.width, "380px");
  assertEquals(kpi.style.marginLeft, "34px");
  assertEquals(kpi.style.gridRow, "1 / span 1");
  flow.layout(choices);
  assertEquals(stock.style.width, "640px");
  assertEquals(kpi.style.marginLeft, "34px");
  assertEquals(kpi.style.gridRow, "1 / span 1");
  choices.set(kpi, 640);
  flow.layout(choices);
  assertEquals(stock.style.gridRow, "1 / span 1");
  assertEquals(kpi.style.gridRow, "2 / span 1");
  choices.set(stock, 380);
  flow.layout(choices);
  assertEquals(kpi.style.gridRow, "1 / span 1");
  assertEquals(kpi.style.width, "640px");

  // A compact first viewer keeps its native neighbor snug, both when the
  // neighbor starts alongside it and when it returns from the row below.
  const stockOnly = new Map([[stock, 380]]);
  flow.layout(stockOnly);
  assertEquals(kpi.style.gridRow, "1 / span 1");
  assertEquals(kpi.style.marginLeft, "388px");
  assertEquals(kpi.style.width, "606px");
  stockOnly.set(stock, 640);
  flow.layout(stockOnly);
  assertEquals(kpi.style.gridRow, "2 / span 1");
  stockOnly.set(stock, 380);
  flow.layout(stockOnly, { panel: stock, skeleton });
  assertEquals(stock.style.width, "640px");
  assertEquals(kpi.style.gridRow, "1 / span 1");
  assertEquals(kpi.style.marginLeft, "388px");
  flow.layout(stockOnly);
  assertEquals(kpi.style.marginLeft, "388px");
  assertEquals(kpi.style.width, "606px");
});

Deno.test("a drop can fill an authored gap while preserving the anchor and other areas in LTR and RTL", () => {
  for (const rtl of [false, true]) {
    const { document } = parseHTML(
      "<main>" +
        ["a", "b", "c"].map((name) =>
          '<section data-compose-panel data-area="' + name + '"><iframe></iframe></section>'
        ).join("") + "</main>",
    );
    const container = document.querySelector("main")!;
    const [a, b, c] = Array.from(container.querySelectorAll("section"));
    const frame = c.firstElementChild;
    Object.defineProperty(document, "defaultView", {
      value: {
        getComputedStyle: () => ({
          direction: rtl ? "rtl" : "ltr",
          columnGap: "8px",
          rowGap: "8px",
          gridTemplateColumns: "400px 400px 400px",
          gridTemplateRows: "100px 100px",
          gridTemplateAreas: '"a . b" "c c ."',
        }),
      },
    });
    for (const key of ["scrollTop", "scrollLeft", "clientTop", "clientLeft"]) {
      Object.defineProperty(container, key, { value: 0 });
    }
    const bounds = (start: number, width: number, top: number) => {
      const left = rtl ? 1216 - start - width : start;
      return { left, right: left + width, width, top, bottom: top + 100, height: 100 } as DOMRect;
    };
    container.getBoundingClientRect = () => bounds(0, 1216, 0);
    a.getBoundingClientRect = () => bounds(0, 400, 0);
    b.getBoundingClientRect = () => bounds(816, 400, 0);
    c.getBoundingClientRect = () => bounds(0, 808, 108);
    const flow = createPanelReflow(container);
    const choices = new Map([[a, 380], [c, 384]]);
    const after = rtl ? "left" : "right";
    const before = rtl ? "right" : "left";
    flow.layout(choices);
    // The hole was explicit; simply narrowing A does not pull B across it.
    assertEquals(b.style.gridColumn, "3 / span 1");
    assertEquals(b.style.marginLeft, "0px");
    assertEquals(c.style.gridRow, "2 / span 1");
    assertEquals(flow.layout(choices, undefined, new Map([[c, { beside: a, side: after }]])), true);
    assertEquals(c.style.gridRow, "1 / span 1");
    assertEquals(c.style.gridColumn, "1 / span 2");
    assertEquals(c.style.marginLeft, rtl ? "36px" : "388px");
    assertEquals(a.style.width, "380px");
    assertEquals(c.style.width, "384px");
    assertEquals(c.firstElementChild === frame, true);
    // C follows A even though A was moved beside B after the choice for C.
    assertEquals(
      flow.layout(
        choices,
        undefined,
        new Map([
          [c, { beside: a, side: before }],
          [a, { beside: b, side: before }],
        ]),
      ),
      true,
    );
    assertEquals(c.style.gridRow, "1 / span 1");
    assertEquals(c.style.marginLeft, rtl ? "388px" : "36px");
    // An older, now impossible placement does not block a valid new one.
    assertEquals(
      flow.layout(
        choices,
        undefined,
        new Map([
          [c, { beside: b, side: after }],
          [a, { beside: b, side: before }],
        ]),
      ),
      true,
    );
    assertEquals(c.style.gridRow, "2 / span 1");
    assertEquals(
      flow.layout(choices, undefined, new Map([[c, { beside: b, side: after }]])),
      false,
    );
    assertEquals(b.style.gridColumn, "3 / span 1");
    assertEquals(c.style.gridRow, "2 / span 1");
    const skeleton = document.createElement("div");
    const below = new Map([[b, { beside: a, side: "below" as const }]]);
    // Insert the new row between A and C; C has a real view in the desired
    // space. The source keeps its iframe while the preview shows the new row.
    assertEquals(flow.layout(choices, { panel: b, skeleton }, below), true);
    assertEquals(skeleton.style.gridRow, "2 / span 1");
    assertEquals(skeleton.style.width, "400px");
    assertEquals(a.style.gridRow, "1 / span 1");
    assertEquals(c.style.gridRow, "3 / span 1");
    flow.layout(choices);
    assertEquals(skeleton.isConnected, false);
    assertEquals(b.style.gridRow, "1 / span 1");
    assertEquals(c.style.gridRow, "2 / span 1");
    below.set(c, { beside: b, side: "below" });
    assertEquals(flow.layout(choices, undefined, below), true);
    assertEquals(b.style.gridRow, "2 / span 1");
    assertEquals(c.style.gridRow, "3 / span 1");
    assertEquals(c.firstElementChild === frame, true);
    // The other side of the existing lower row is free: reuse it.
    assertEquals(
      flow.layout(choices, undefined, new Map([[a, { beside: b, side: "below" }]])),
      true,
    );
    assertEquals(a.style.gridRow, "2 / span 1");
    assertEquals(c.style.gridRow, "2 / span 1");
    flow.reset();
    assertEquals(c.style.gridRow || "", "");
  }
});
