export interface VisualItemGestureOptions {
  onActivate?: (id: string) => void;
  onToggle?: (id: string) => void;
  onAdd?: (ids: readonly string[]) => void;
  getItemBounds?: (item: Element) => DOMRectReadOnly;
  intersectsItem?: (item: Element, rect: DOMRectReadOnly) => boolean;
}

const itemSelector = "[data-visual-item]";
const surfaceSelector = "[data-visual-selection-surface]";
const nativeControl = "button, a[href], input, select, textarea, summary, [contenteditable=true]";
const interactiveControl = `${nativeControl}, [role=button], [role=link]`;
const excluded = "[data-visual-ignore], [disabled], [aria-disabled=true]";
const ordinaryClickDelay = 500;
const holdDelay = 550;
const movementThreshold = 8;
const boundRoots = new WeakSet<Element>();

interface Point {
  x: number;
  y: number;
}

interface Press {
  pointerId: number;
  pointerType: string;
  start: Point;
  item: Element | null;
  surface: Element | null;
  hold?: ReturnType<typeof setTimeout>;
  drawing: boolean;
}

interface PendingClick {
  item: Element;
  id: string;
  timer: ReturnType<typeof setTimeout>;
}

function isModified(event: MouseEvent | KeyboardEvent): boolean {
  return event.shiftKey || event.ctrlKey || event.altKey || event.metaKey;
}

function point(event: MouseEvent): Point {
  return { x: event.clientX, y: event.clientY };
}

type RectEdges = Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">;

function clipRect(rect: DOMRectReadOnly, clip: RectEdges): DOMRectReadOnly | undefined {
  if (clip.right <= clip.left || clip.bottom <= clip.top) return undefined;
  const left = Math.max(rect.left, clip.left);
  const top = Math.max(rect.top, clip.top);
  const right = Math.min(rect.right, clip.right);
  const bottom = Math.min(rect.bottom, clip.bottom);
  if (
    left > right || top > bottom || (left === right && rect.width > 0) ||
    (top === bottom && rect.height > 0)
  ) return undefined;
  return new DOMRect(left, top, right - left, bottom - top);
}

function scrollport(element: Element): RectEdges | undefined {
  const document = element.ownerDocument;
  if (element === document.documentElement) return undefined;
  const style = document.defaultView?.getComputedStyle?.(element);
  if (!style || style.display === "contents" || style.display === "inline") return undefined;
  const clips = /^(auto|scroll|hidden|clip|overlay)$/;
  const clipX = clips.test(style.overflowX);
  const clipY = clips.test(style.overflowY);
  if (!clipX && !clipY) return undefined;
  const bounds = element.getBoundingClientRect();
  let { left, top, right, bottom } = bounds;
  if ("offsetWidth" in element && "offsetHeight" in element) {
    const layout = element as HTMLElement;
    const scaleX = layout.offsetWidth > 0 ? bounds.width / layout.offsetWidth : 1;
    const scaleY = layout.offsetHeight > 0 ? bounds.height / layout.offsetHeight : 1;
    left += element.clientLeft * scaleX;
    top += element.clientTop * scaleY;
    right = left + element.clientWidth * scaleX;
    bottom = top + element.clientHeight * scaleY;
  }
  return {
    left: clipX ? left : -Infinity,
    right: clipX ? right : Infinity,
    top: clipY ? top : -Infinity,
    bottom: clipY ? bottom : Infinity,
  };
}

function clipToScrollports(
  rect: DOMRectReadOnly | undefined,
  element: Element | null,
  stopBefore?: Element,
  cache?: Map<Element, RectEdges | undefined>,
): DOMRectReadOnly | undefined {
  for (
    let ancestor = element;
    ancestor && ancestor !== stopBefore && rect;
    ancestor = ancestor.parentElement
  ) {
    const clip = cache?.has(ancestor) ? cache.get(ancestor) : scrollport(ancestor);
    cache?.set(ancestor, clip);
    if (clip) rect = clipRect(rect, clip);
  }
  return rect;
}

function selectionRect(start: Point, end: Point, surface: Element): DOMRectReadOnly | undefined {
  const doc = surface.ownerDocument;
  const viewport = doc.defaultView?.visualViewport;
  const viewportLeft = viewport?.offsetLeft ?? 0;
  const viewportTop = viewport?.offsetTop ?? 0;
  const rect = new DOMRect(
    Math.min(start.x, end.x),
    Math.min(start.y, end.y),
    Math.abs(end.x - start.x),
    Math.abs(end.y - start.y),
  );
  const inSurface = clipRect(rect, surface.getBoundingClientRect());
  const inViewport = inSurface && clipRect(inSurface, {
    left: viewportLeft,
    top: viewportTop,
    right: viewportLeft + (viewport?.width ?? doc.documentElement.clientWidth ?? Infinity),
    bottom: viewportTop + (viewport?.height ?? doc.documentElement.clientHeight ?? Infinity),
  });
  return clipToScrollports(inViewport, surface);
}

function intersects(bounds: DOMRectReadOnly, rect: DOMRectReadOnly): boolean {
  return bounds.width > 0 && bounds.height > 0 &&
    bounds.left < rect.right && bounds.right > rect.left &&
    bounds.top < rect.bottom && bounds.bottom > rect.top;
}

/**
 * Delegate drill and context gestures to descendants marked with `data-visual-item`.
 * Mark rectangle surfaces with `data-visual-selection-surface` and use `touch-action: pan-y`
 * there to allow horizontal touch selection alongside vertical scrolling.
 * Mark items where a rectangle can start with `data-visual-selection-start`.
 * Use native buttons or focusable equivalents and expose Shift+Space in their keyboard help.
 * Returns the listener cleanup function.
 */
export function bindVisualItemGestures(
  root: Element,
  options: VisualItemGestureOptions,
): () => void {
  const doc = root.ownerDocument;
  const listeners = new AbortController();
  const capture = { capture: true, signal: listeners.signal };
  const passiveCapture = { ...capture, passive: true };
  boundRoots.add(root);
  let press: Press | undefined;
  let pending: PendingClick | undefined;
  let suppressClick = false;
  let pointerType = "";
  let overlay: HTMLDivElement | undefined;

  function owns(element: Element | null): element is Element {
    for (let node = element; node; node = node.parentElement) {
      if (boundRoots.has(node)) return node === root;
    }
    return false;
  }

  function target(event: Event): Element | null {
    const node = event.target;
    if (!node || !("nodeType" in node) || node.nodeType !== 1) return null;
    const element = node as Element;
    return owns(element) && !element.closest(excluded) ? element : null;
  }

  function itemFor(element: Element): Element | null {
    const item = element.closest(itemSelector);
    const control = element.closest(interactiveControl);
    if (
      !owns(item) || (control && control !== item && item.contains(control) &&
        !control.hasAttribute("data-visual-activate"))
    ) return null;
    return item;
  }

  function canToggle(item: Element): boolean {
    return options.onToggle !== undefined && !item.hasAttribute("data-visual-no-toggle");
  }

  function canActivate(item: Element): boolean {
    return options.onActivate !== undefined && !item.hasAttribute("data-visual-no-activate");
  }

  function id(item: Element): string {
    return item.getAttribute("data-visual-item") ?? "";
  }

  function clearPending(activate = false) {
    const click = pending;
    pending = undefined;
    if (!click) return;
    clearTimeout(click.timer);
    if (activate && owns(click.item) && id(click.item) === click.id && canActivate(click.item)) {
      options.onActivate?.(click.id);
    }
  }

  function clearPress() {
    clearTimeout(press?.hold);
    press = undefined;
    overlay?.remove();
    overlay = undefined;
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0 || isModified(event)) return;
    const element = target(event);
    if (!element) return;
    clearPress();
    suppressClick = false;
    pointerType = event.pointerType;
    const item = itemFor(element);
    const surface = element.closest(surfaceSelector);
    const rectangle = options.onAdd && owns(surface) &&
      !element.closest("[draggable=true]") &&
      (item
        ? item.hasAttribute("data-visual-selection-start")
        : !element.closest(interactiveControl));
    if (!item && !rectangle) return;
    const active: Press = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: point(event),
      item,
      surface: rectangle ? surface : null,
      drawing: false,
    };
    press = active;
    if (item && canToggle(item)) {
      const pressedId = id(item);
      active.hold = setTimeout(() => {
        if (press !== active || !owns(item) || id(item) !== pressedId || !canToggle(item)) return;
        clearPending();
        suppressClick = true;
        options.onToggle?.(pressedId);
      }, holdDelay);
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    const end = point(event);
    const dx = Math.abs(end.x - press.start.x);
    const dy = Math.abs(end.y - press.start.y);
    if (!press.drawing && Math.max(dx, dy) < movementThreshold) return;
    clearTimeout(press.hold);
    if (
      !press.drawing && (suppressClick || !press.surface ||
        (press.pointerType === "touch" && dx <= dy))
    ) {
      suppressClick = true;
      clearPress();
      return;
    }
    event.preventDefault();
    if (!press.surface) return;
    if (!press.drawing) {
      press.drawing = true;
      clearPending();
      overlay = doc.createElement("div");
      overlay.setAttribute("aria-hidden", "true");
      Object.assign(overlay.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483647",
        boxSizing: "border-box",
        border: "1px solid Highlight",
        background: "color-mix(in srgb, Highlight 15%, transparent)",
      });
      doc.body.append(overlay);
    }
    const rect = selectionRect(press.start, end, press.surface);
    if (!overlay) return;
    overlay.hidden = !rect;
    if (!rect) return;
    Object.assign(overlay.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  function onPointerUp(event: PointerEvent) {
    if (!press || event.pointerId !== press.pointerId) return;
    const { drawing, surface, start } = press;
    clearPress();
    if (!drawing || !surface || !owns(surface)) return;
    suppressClick = true;
    const rect = selectionRect(start, point(event), surface);
    if (!rect) return;
    const matches = new Set<string>();
    const scrollports = new Map<Element, RectEdges | undefined>();
    for (const item of surface.querySelectorAll(itemSelector)) {
      if (
        !owns(item) || item.closest(surfaceSelector) !== surface ||
        item.hasAttribute("data-visual-no-toggle") || item.closest(excluded)
      ) continue;
      const visibility = doc.defaultView?.getComputedStyle?.(item).visibility;
      if (visibility === "hidden" || visibility === "collapse") continue;
      const visibleRect = clipToScrollports(rect, item.parentElement, surface, scrollports);
      if (!visibleRect) continue;
      const bounds = options.getItemBounds?.(item) ?? item.getBoundingClientRect();
      if (
        intersects(bounds, visibleRect) && (options.intersectsItem?.(item, visibleRect) ?? true)
      ) {
        matches.add(id(item));
      }
    }
    if (matches.size > 0) options.onAdd?.([...matches]);
  }

  function onCancel(event: PointerEvent | DragEvent) {
    if (!press || ("pointerId" in event && event.pointerId !== press.pointerId)) return;
    suppressClick = true;
    clearPress();
  }

  function onDragStart(event: DragEvent) {
    const element = target(event);
    if (
      press?.surface && element?.localName === "img" &&
      !element.closest("[draggable=true], a[href], [role=link]")
    ) {
      event.preventDefault();
      return;
    }
    onCancel(event);
  }

  function consume(event: Event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event: MouseEvent) {
    const element = target(event);
    if (!element) return;
    const immediate = element.closest("[data-visual-immediate-activate]");
    if (immediate) {
      // The native control owns activation. Discard its row's pending click
      // before that control receives the event.
      if (pending && immediate.closest(itemSelector) === pending.item) clearPending();
      return;
    }
    const item = itemFor(element);
    if (isModified(event)) {
      if (item) clearPending();
      return;
    }
    if (event.detail > 0 && suppressClick && (item || element.closest(surfaceSelector))) {
      consume(event);
      return;
    }
    if (!item || (!canActivate(item) && !canToggle(item))) return;
    consume(event);
    if (event.detail === 0 || pointerType === "touch" || !canToggle(item)) {
      clearPending(pending?.item !== item);
      if (canActivate(item)) options.onActivate?.(id(item));
    } else if (pending?.item === item && pending.id === id(item)) {
      clearPending();
      options.onToggle?.(id(item));
    } else {
      clearPending(true);
      pending = {
        item,
        id: id(item),
        timer: setTimeout(() => clearPending(true), ordinaryClickDelay),
      };
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const element = target(event);
    if (!element) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = itemFor(element);
    if (!item) return;
    if (
      event.key === " " && event.shiftKey && !event.altKey && !event.ctrlKey &&
      !event.metaKey && canToggle(item)
    ) {
      consume(event);
      clearPending();
      if (!event.repeat) options.onToggle?.(id(item));
    } else if (!isModified(event) && !element.closest(nativeControl) && canActivate(item)) {
      consume(event);
      clearPending(pending?.item !== item);
      if (!event.repeat) options.onActivate?.(id(item));
    }
  }

  root.addEventListener("pointerdown", onPointerDown as EventListener, passiveCapture);
  doc.addEventListener("pointerdown", (event) => {
    if (!press || event.isPrimary || event.pointerType !== "touch") return;
    suppressClick = true;
    clearPress();
    clearPending();
  }, passiveCapture);
  doc.addEventListener("pointermove", onPointerMove, capture);
  doc.addEventListener("pointerup", onPointerUp, passiveCapture);
  doc.addEventListener("pointercancel", onCancel, passiveCapture);
  doc.addEventListener("dragstart", onDragStart, capture);
  root.addEventListener("click", onClick as EventListener, capture);
  root.addEventListener("keydown", onKeyDown as EventListener, capture);
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !press?.drawing) return;
    consume(event);
    suppressClick = true;
    clearPress();
  }, capture);
  root.addEventListener("contextmenu", (event) => {
    if (press?.pointerType !== "mouse" && press?.item && canToggle(press.item)) {
      event.preventDefault();
    }
  }, capture);
  root.addEventListener("selectstart", (event) => {
    if (press?.surface) event.preventDefault();
  }, capture);
  doc.defaultView?.addEventListener("blur", () => {
    clearPress();
    clearPending();
  }, { signal: listeners.signal });

  return () => {
    listeners.abort();
    boundRoots.delete(root);
    clearPress();
    clearPending();
  };
}
