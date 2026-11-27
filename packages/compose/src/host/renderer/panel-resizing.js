import { createPanelReflow } from "./panel-reflow.js";

/**
 * Choose one of a viewer's declared viewport widths from its bottom-right corner.
 * The standalone host embeds this function as JavaScript and supplies the layout
 * factory as the third argument. A viewer always owns its intrinsic height.
 * @param {HTMLElement} container
 * @param {AbortSignal} [signal]
 * @param {typeof createPanelReflow} [createReflow]
 */
export function installPanelResizing(container, signal, createReflow = createPanelReflow) {
  const doc = container.ownerDocument;
  if (
    !doc.defaultView || signal?.aborted || container.hasAttribute("data-compose-resizing-ready")
  ) return;
  const browser = doc.defaultView;
  if (browser.getComputedStyle(container).display !== "grid") return;
  const panels = Array.from(
    /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll(
      ":scope > [data-compose-panel]",
    )),
  );
  if (!panels.length) return;

  /** @type {Map<HTMLElement, number[]>} */
  const declared = new Map();
  for (const panel of panels) {
    const widths = (panel.dataset.composeWidths ?? "").trim().split(/\s+/)
      .filter((s) => /^\d+$/.test(s)).map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0);
    if (widths.length) declared.set(panel, [...new Set(widths)].sort((a, b) => a - b));
  }
  if (!declared.size && panels.length < 2) return;
  container.setAttribute("data-compose-resizing-ready", "");
  const reflow = createReflow(container);
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  if (declared.size) container.append(status);
  /** @type {Map<HTMLElement, number>} */
  const choices = new Map();
  /** @typedef {{beside:HTMLElement, side:"left"|"right"|"below"}} Placement */
  /** @type {Map<HTMLElement, Placement>} */
  let placements = new Map();
  /** @type {Map<HTMLElement, Placement> | undefined} */
  let manualPreview;
  let lastSlots = panels.map(slot);
  /** @type {Map<HTMLElement, HTMLButtonElement>} */
  const handles = new Map();
  /** @type {(() => void) | undefined} */
  let cancelDrag;
  /** @type {(() => void) | undefined} */
  let projectDrag;
  let available = -1, viewport = -1, pending = 0;

  /** Return the chosen widths that fit now; a wider choice survives a temporary narrow viewport. */
  function fittingChoices() {
    /** @type {Map<HTMLElement, number>} */
    const fitting = new Map();
    for (const [panel, wanted] of choices) {
      const widths = /** @type {number[]} */ (declared.get(panel));
      const width = widths.filter((n) => n <= available && n <= wanted).at(-1);
      if (width !== undefined) fitting.set(panel, width);
    }
    return fitting;
  }

  /** @param {HTMLElement} panel */
  function slot(panel) {
    return panel.dataset.area ?? panel.style.order;
  }

  // Swapping a viewer supersedes its previous manual drop. During a swap
  // preview keep the previous placement so canceling restores it.
  function placementsAfterSwap() {
    const result = new Map(placements);
    panels.forEach((panel, i) => {
      if (slot(panel) !== lastSlots[i]) result.delete(panel);
    });
    return result;
  }

  function place() {
    reflow.layout(fittingChoices(), undefined, manualPreview ?? placementsAfterSwap());
  }

  /** @param {HTMLElement} panel @param {number} width */
  function commitWidth(panel, width) {
    choices.set(panel, width);
    place();
    status.textContent = (panel.dataset.panelLabel || "Viewer") + " width " + width + " pixels.";
  }

  /** @param {KeyboardEvent} event @param {HTMLElement} panel @param {number[]} widths */
  function keyboard(event, panel, widths) {
    if (cancelDrag) return;
    const options = widths.filter((n) => n <= available);
    const current = panel.getBoundingClientRect().width;
    let next;
    switch (event.key) {
      case "ArrowLeft":
        next = options.filter((n) => n < current - 0.5).at(-1);
        break;
      case "ArrowRight":
        next = options.find((n) => n > current + 0.5);
        break;
      case "Home":
        next = options[0];
        break;
      case "End":
        next = options.at(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next === undefined || Math.abs(next - current) < 0.5) return;
    commitWidth(panel, next);
    schedule();
  }

  /**
   * @param {PointerEvent} event @param {HTMLElement} panel
   * @param {HTMLButtonElement} handle @param {number[]} widths
   */
  function start(event, panel, handle, widths) {
    if (container.hasAttribute("data-compose-dragging") || !event.isPrimary || event.button !== 0) {
      return;
    }
    const options = widths.filter((n) => n <= available);
    const bounds = panel.getBoundingClientRect();
    const initial = bounds.width;
    // The authored (possibly fluid) width is the gesture's neutral position.
    const stops = [...options.filter((n) => Math.abs(n - initial) > 0.5), initial].sort((a, b) =>
      a - b
    );
    if (stops.length < 2) return;
    const horizontal = new Map(stops.map((width) => [width, width - initial]));
    const wider = stops.filter((width) => width > initial);
    const down = new Map([initial, ...wider].map((width, i) => [width, i * 40]));
    // At the physical edge the pointer cannot reach the next horizontal midpoint.
    // Pulling down there steps through wider presets without changing height.
    const firstGap = wider[0] - initial;
    const edgeFallback = viewport - bounds.right <= 28 &&
      viewport - event.clientX < firstGap / 2 + Math.min(6, firstGap / 8);
    event.preventDefault();
    const skeleton = doc.createElement("div");
    skeleton.dataset.composeDropPreview = "";
    skeleton.dataset.composeResizePreview = "";
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.inert = true;
    const drag = new AbortController();
    let preview = initial;
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    container.setAttribute("data-compose-dragging", "");
    panel.setAttribute("data-compose-resizing", "");

    /** @param {boolean} commit */
    function finish(commit) {
      drag.abort();
      cancelDrag = undefined;
      projectDrag = undefined;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      container.removeAttribute("data-compose-dragging");
      panel.removeAttribute("data-compose-resizing");
      if (preview !== initial) {
        if (commit) commitWidth(panel, preview);
        else place();
      }
      schedule();
    }
    cancelDrag = () => finish(false);
    projectDrag = () => {
      // A new row can introduce a vertical scrollbar. Keep the gesture alive
      // and project the same preset into the board's available width.
      if (preview > available) preview = initial;
      const fitting = fittingChoices();
      if (preview === initial) reflow.layout(fitting, undefined, placements);
      else {
        fitting.set(panel, preview);
        reflow.layout(fitting, { panel, skeleton }, placements);
      }
    };
    browser.addEventListener("blur", cancelDrag, { signal: drag.signal });
    handle.addEventListener("keydown", (key) => {
      if (key.key === "Escape") {
        key.preventDefault();
        finish(false);
      }
    }, { signal: drag.signal });
    handle.addEventListener("pointermove", (move) => {
      if (move.pointerId !== event.pointerId) return;
      const dx = move.clientX - event.clientX;
      const dy = move.clientY - event.clientY;
      const pullDown = edgeFallback && dy > Math.abs(dx);
      const positions = pullDown ? down : horizontal;
      const delta = pullDown ? dy : dx;
      let next = initial;
      if (Math.abs(delta) >= 5) {
        let nearest = 0;
        for (const [width, offset] of positions) {
          if (width !== initial && width > available) continue;
          if (Math.abs(delta - offset) < Math.abs(delta - nearest)) {
            next = width;
            nearest = offset;
          }
        }
        // A small band around the midpoint prevents jitter from moving neighbors.
        const previous = positions.get(preview) ?? 0;
        const hysteresis = Math.min(6, Math.abs(nearest - previous) / 8);
        if (Math.abs(delta - previous) - Math.abs(delta - nearest) < 2 * hysteresis) return;
      }
      if (next === preview) return;
      preview = next;
      projectDrag?.();
    }, { signal: drag.signal });
    for (
      const type of /** @type {const} */ (["pointerup", "pointercancel", "lostpointercapture"])
    ) {
      handle.addEventListener(type, (end) => {
        if (end.pointerId === event.pointerId) finish(type === "pointerup");
      }, { signal: drag.signal });
    }
  }

  function refresh() {
    pending = 0;
    const style = browser.getComputedStyle(container);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const room = container.clientWidth - padding;
    if (room !== available || viewport !== browser.innerWidth) {
      available = room;
      viewport = browser.innerWidth;
      if (projectDrag) projectDrag();
      else place();
    }
    for (const [panel, widths] of declared) {
      const options = widths.filter((n) => n <= available);
      const bounds = panel.getBoundingClientRect();
      const current = bounds.width;
      let handle = handles.get(panel);
      if (
        !panel.hasAttribute("data-compose-resizing") &&
        !options.some((n) => Math.abs(n - current) > 0.5)
      ) {
        handle?.remove();
        handles.delete(panel);
        continue;
      }
      if (!handle) {
        handle = doc.createElement("button");
        handle.type = "button";
        handle.dataset.composeResize = "";
        handle.dataset.composeCorner = "right";
        handle.setAttribute(
          "aria-label",
          "Resize " + (panel.dataset.panelLabel || "viewer") + " from bottom right",
        );
        handle.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight Home End");
        const grip = handle;
        grip.addEventListener("keydown", (e) => keyboard(e, panel, widths), { signal });
        grip.addEventListener("pointerdown", (e) => start(e, panel, grip, widths), { signal });
        panel.append(grip);
        handles.set(panel, grip);
      }
      handle.setAttribute(
        "aria-description",
        "Current width " + Math.round(current) +
          " pixels. Available widths: " + options.join(", ") +
          " pixels. Use Left or Right to choose." +
          (viewport - bounds.right <= 28 && options.some((width) => width > current)
            ? " At the screen edge, pull down to choose a wider size."
            : ""),
      );
    }
  }

  function schedule() {
    if (!pending && !signal?.aborted) pending = browser.requestAnimationFrame(refresh);
  }

  const observer = new browser.ResizeObserver(schedule);
  observer.observe(container);
  for (const panel of declared.keys()) observer.observe(panel);
  browser.addEventListener("resize", schedule, { signal });
  container.addEventListener("compose-layout-preview", () => {
    place();
    schedule();
  }, { signal });
  container.addEventListener("compose-layout-change", () => {
    placements = placementsAfterSwap();
    manualPreview = undefined;
    lastSlots = panels.map(slot);
    place();
    schedule();
  }, { signal });
  container.addEventListener("compose-panel-place", (event) => {
    const d =
      /** @type {CustomEvent<{phase:string, panel:HTMLElement, beside:HTMLElement, side:Placement["side"], placed:boolean}>} */ (event)
        .detail;
    if (!d) return;
    d.placed = false;
    manualPreview = undefined;
    if (d.phase === "cancel") {
      place();
      schedule();
      return;
    }
    if (
      (d.phase !== "preview" && d.phase !== "commit") || !panels.includes(d.panel) ||
      !panels.includes(d.beside) || d.panel === d.beside ||
      (d.side !== "left" && d.side !== "right" && d.side !== "below")
    ) {
      place();
      return;
    }
    const proposed = new Map(placements);
    proposed.delete(d.panel);
    // A new anchor cannot remain a dependent of the moved viewer. Reverse
    // that old relation only if the new drop is successfully committed.
    let anchor = d.beside;
    while (proposed.has(anchor)) {
      const next = /** @type {Placement} */ (proposed.get(anchor)).beside;
      if (next === d.panel) {
        proposed.delete(d.beside);
        break;
      }
      anchor = next;
    }
    proposed.set(d.panel, { beside: d.beside, side: d.side });
    d.placed = reflow.layout(fittingChoices(), undefined, proposed);
    if (!d.placed) place();
    else if (d.phase === "commit") placements = proposed;
    else manualPreview = proposed;
    schedule();
  }, { signal });

  signal?.addEventListener("abort", () => {
    cancelDrag?.();
    observer.disconnect();
    browser.cancelAnimationFrame(pending);
    reflow.reset();
    for (const handle of handles.values()) handle.remove();
    status.remove();
    container.removeAttribute("data-compose-resizing-ready");
  }, { once: true });
  refresh();
}
