import { assert, assertEquals } from "@std/assert";
import { bindVisualItemGestures } from "./visual-item-gestures.ts";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, left: x, top: y, right: x + width, bottom: y + height };
}

Deno.test("visual items distinguish activation, context and rectangle selection", async (test) => {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const dom = parseHTML(`
    <html><body>
      <button id="previous">Previous focus</button>
      <div id="scrollport"><section data-visual-selection-surface>
        <button data-visual-item="a" data-visual-selection-start><img alt="">A</button>
        <div id="inner"><div data-visual-item="b" data-visual-selection-start role="button" tabindex="0">B</div></div>
        <button data-visual-item="c">C</button>
        <button data-visual-item="d">D</button>
        <button data-visual-item="e">E</button>
      </section></div>
    </body></html>
  `);
  const document = dom.document as unknown as Document;
  const root = document.querySelector("section")!;
  const earlierFocus = document.querySelector("#previous")!;
  const a = root.querySelector('[data-visual-item="a"]')!;
  const b = root.querySelector('[data-visual-item="b"]')!;
  const setBounds = (element: Element, x: number, y: number, w: number, h: number) => {
    element.getBoundingClientRect = () => box(x, y, w, h) as DOMRect;
  };
  setBounds(root, 0, 0, 250, 180);
  setBounds(a, 10, 10, 120, 30);
  setBounds(b, 10, 55, 120, 40);
  setBounds(root.querySelector('[data-visual-item="c"]')!, 140, 10, 70, 60);

  // Linkedom does not provide browser layout or event capture through Window.
  // Recorded listener options independently guard against capturing element blur.
  const window = document.defaultView!;
  const windowAdd = window.addEventListener;
  const blurOptions: (boolean | AddEventListenerOptions | undefined)[] = [];
  window.addEventListener = function (
    ...[type, listener, options]: Parameters<EventTarget["addEventListener"]>
  ) {
    if (type === "blur") blurOptions.push(options);
    if (listener) windowAdd.call(this, type, listener, options);
  };
  const previousDOMRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");
  Object.defineProperty(globalThis, "DOMRect", {
    configurable: true,
    value: class {
      constructor(x: number, y: number, width: number, height: number) {
        Object.assign(this, box(x, y, width, height));
      }
    },
  });

  const observed: string[][] = [];
  const shapeRects: DOMRectReadOnly[] = [];
  let requireUnclippedShape = false;
  const detach = bindVisualItemGestures(root, {
    onActivate: (id) => observed.push(["activate", id]),
    onToggle: (id) => observed.push(["toggle", id]),
    onAdd: (ids) => observed.push(["add", ...ids]),
    getItemBounds: (item) => item.getBoundingClientRect(),
    intersectsItem(item, rect) {
      if (item !== b || !requireUnclippedShape) return true;
      shapeRects.push(rect);
      return rect.bottom > 85;
    },
  });
  const output = () => observed.splice(0);
  const dispatch = (
    element: EventTarget,
    type: string,
    data: Record<string, unknown> = {},
    bubbles = true,
  ) => {
    const event = new dom.Event(type, { bubbles, cancelable: true });
    element.dispatchEvent(Object.assign(event, data) as unknown as Event);
    return event;
  };
  const pointer = (
    element: EventTarget,
    type: string,
    clientX: number,
    clientY: number,
    pointerType = "mouse",
    pointerId = 1,
  ) =>
    dispatch(element, type, {
      button: 0,
      clientX,
      clientY,
      pointerId,
      pointerType,
      isPrimary: pointerId === 1,
    });
  const click = (element: Element, detail = 1) => dispatch(element, "click", { detail });

  try {
    await test.step("mouse single activates once and mouse double toggles once", async () => {
      click(a);
      assertEquals(output(), []);
      await wait(520);
      assertEquals(output(), [["activate", "a"]]);

      click(a);
      click(a, 2);
      assertEquals(output(), [["toggle", "a"]]);
      await wait(520);
      assertEquals(output(), []);
    });

    await test.step("touch tap activates immediately and touch hold never activates", async () => {
      pointer(a, "pointerdown", 20, 20, "touch");
      pointer(a, "pointerup", 20, 20, "touch");
      click(a);
      assertEquals(output(), [["activate", "a"]]);

      pointer(a, "pointerdown", 20, 20, "touch");
      await wait(570);
      assertEquals(output(), [["toggle", "a"]]);
      pointer(a, "pointerup", 20, 20, "touch");
      assert(click(a).defaultPrevented);
      assertEquals(output(), []);
    });

    await test.step("a second touch cancels a pending hold", async () => {
      pointer(a, "pointerdown", 20, 20, "touch");
      pointer(b, "pointerdown", 50, 65, "touch", 2);
      await wait(570);
      pointer(a, "pointerup", 20, 20, "touch");
      assert(click(a).defaultPrevented);
      assertEquals(output(), []);
    });

    await test.step("moving focus leaves the rectangle active and adds only overlaps", () => {
      assertEquals(blurOptions.length, 1);
      const options = blurOptions[0];
      assert(options !== true && !(typeof options === "object" && options.capture));

      pointer(a, "pointerdown", 20, 20);
      dispatch(earlierFocus, "blur", {}, false);
      assert(pointer(b, "pointermove", 90, 70).defaultPrevented);
      assert(document.body.querySelector('[aria-hidden="true"]'));
      pointer(b, "pointerup", 90, 70);
      assertEquals(output(), [["add", "a", "b"]]);
      assertEquals(document.body.querySelector('[aria-hidden="true"]'), null);
      assert(click(a).defaultPrevented);
      assertEquals(output(), []);
    });

    await test.step("native image drag only yields when a rectangle can start", () => {
      const image = a.querySelector("img")!;
      pointer(image, "pointerdown", 20, 20);
      assert(dispatch(image, "dragstart").defaultPrevented);
      pointer(b, "pointermove", 90, 70);
      pointer(b, "pointerup", 90, 70);
      assertEquals(output(), [["add", "a", "b"]]);

      image.setAttribute("draggable", "true");
      pointer(image, "pointerdown", 20, 20);
      assert(!dispatch(image, "dragstart").defaultPrevented);
      pointer(b, "pointermove", 90, 70);
      pointer(b, "pointerup", 90, 70);
      assertEquals(output(), []);
    });

    await test.step("the guide and custom hit tests use only the visible scrollports", () => {
      const outer = document.querySelector("#scrollport")!;
      const inner = document.querySelector("#inner")!;
      const hidden = root.querySelector('[data-visual-item="c"]')!;
      setBounds(outer, 0, 0, 230, 103);
      setBounds(inner, 10, 55, 130, 20);
      setBounds(root.querySelector('[data-visual-item="d"]')!, 190, 10, 35, 30);
      setBounds(root.querySelector('[data-visual-item="e"]')!, 10, 100, 90, 25);
      Object.defineProperties(outer, {
        offsetWidth: { value: 230 },
        offsetHeight: { value: 103 },
        clientTop: { value: 3 },
        clientLeft: { value: 3 },
        clientWidth: { value: 224 },
        clientHeight: { value: 87 },
      });
      Object.defineProperties(document.documentElement, {
        clientWidth: { value: 180 },
        clientHeight: { value: 160 },
      });
      const previousStyle = window.getComputedStyle;
      window.getComputedStyle = (item) =>
        ({
          display: "block",
          overflowX: item === inner ? "hidden" : "visible",
          overflowY: item === inner || item === outer ? "clip" : "visible",
          visibility: item === hidden ? "hidden" : "visible",
        }) as CSSStyleDeclaration;
      requireUnclippedShape = true;
      try {
        pointer(a, "pointerdown", 20, 20);
        pointer(b, "pointermove", 235, 140);
        const guide = document.body.querySelector<HTMLElement>('[aria-hidden="true"]')!;
        assertEquals(guide.style.width, "160px");
        assertEquals(guide.style.height, "70px");
        pointer(b, "pointerup", 235, 140);
        assertEquals(output(), [["add", "a"]]);
        assertEquals(shapeRects.map((rect) => rect.bottom), [75]);
      } finally {
        window.getComputedStyle = previousStyle;
      }
    });
  } finally {
    detach();
    window.addEventListener = windowAdd;
    if (previousDOMRect) Object.defineProperty(globalThis, "DOMRect", previousDOMRect);
    else Reflect.deleteProperty(globalThis, "DOMRect");
  }
});
