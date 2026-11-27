/**
 * Wire the grips on a Compose board. The standalone host embeds this function
 * as JavaScript, so its implementation must not depend on module-level values.
 * @param {HTMLElement} container
 * @param {AbortSignal} [signal]
 */
export function installPanelMovement(container, signal) {
  if (signal?.aborted || container.hasAttribute("data-compose-movement-ready")) return;
  const panels = Array.from(
    /** @type {NodeListOf<HTMLElement>} */ (container.querySelectorAll(
      ":scope > [data-compose-panel]",
    )),
  );
  if (panels.length < 2) {
    for (const panel of panels) {
      const grip =
        /** @type {HTMLButtonElement | null} */ (panel.querySelector("[data-compose-grip]"));
      if (grip) grip.hidden = true;
    }
    return;
  }

  container.setAttribute("data-compose-movement-ready", "");
  const doc = container.ownerDocument;
  const status = doc.createElement("span");
  status.setAttribute("role", "status");
  status.style.cssText =
    "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)";
  container.append(status);
  const preview = doc.createElement("span");
  preview.setAttribute("data-compose-drop-preview", "");
  preview.setAttribute("aria-hidden", "true");
  /** @type {Map<HTMLElement, HTMLButtonElement>} */
  const grips = new Map();
  const namedAreas = panels.every((panel) => Boolean(panel.dataset.area));
  /** @param {HTMLElement} panel */
  const label = (panel) => panel.dataset.panelLabel || "panel";
  /** @type {HTMLElement | undefined} */
  let selected;
  /** @type {HTMLElement | undefined} */
  let target;
  /** @typedef {{beside: HTMLElement, side: "left" | "right" | "below"}} FreePlace */
  /** @type {FreePlace | undefined} */
  let free;
  /** @type {FreePlace | undefined} */
  let attempted;
  /** @type {ReturnType<typeof measureSlots> | undefined} */
  let slots;
  /** @type {{panel: HTMLElement, grip: HTMLButtonElement, id: number, x: number, y: number, dragged: boolean} | undefined} */
  let press;
  let suppressClick = false;

  /** @param {HTMLElement} [panel] */
  function select(panel) {
    selected?.removeAttribute("data-compose-moving");
    if (selected) grips.get(selected)?.setAttribute("aria-pressed", "false");
    selected = panel;
    if (panel) {
      panel.setAttribute("data-compose-moving", "");
      grips.get(panel)?.setAttribute("aria-pressed", "true");
    }
  }

  /** @param {HTMLElement} [panel] */
  function highlight(panel) {
    if (target === panel || !press) return;
    const source = press.panel;
    const previous = target;
    const undo = previous && previous !== source;
    if (undo) exchange(source, previous);
    target = panel;
    const project = panel && panel !== source;
    if (project) exchange(source, panel);
    if (panel) {
      // The actual viewer keeps its state and contributes its own intrinsic
      // size and responsive layout in the destination. Only its paint is covered.
      source.append(preview);
    } else {
      preview.remove();
    }
    if (undo || project) container.dispatchEvent(new Event("compose-layout-preview"));
  }

  /** @param {HTMLElement} from @param {HTMLElement} to */
  function exchange(from, to) {
    if (namedAreas) {
      const firstArea = from.dataset.area;
      from.dataset.area = to.dataset.area;
      to.dataset.area = firstArea;
    } else {
      const firstOrder = from.style.order;
      from.style.order = to.style.order;
      to.style.order = firstOrder;
    }
  }

  /** @param {HTMLElement} from @param {HTMLElement} to */
  function swap(from, to) {
    exchange(from, to);
    announceSwap(from, to);
  }

  /** @param {HTMLElement} from @param {HTMLElement} to */
  function announceSwap(from, to) {
    status.textContent = label(from) + " swapped with " + label(to) + ".";
    container.dispatchEvent(new Event("compose-layout-change"));
  }

  /** @param {"preview" | "commit" | "cancel"} phase @param {FreePlace} place */
  function placeBeside(phase, place) {
    if (!press) return false;
    const detail = { phase, panel: press.panel, ...place, placed: false };
    container.dispatchEvent(new CustomEvent("compose-panel-place", { detail }));
    return detail.placed;
  }

  function cancelFree() {
    if (free) placeBeside("cancel", free);
    free = undefined;
    attempted = undefined;
  }

  /** @param {FreePlace} place */
  function offer(place) {
    if (!press || (place.beside === attempted?.beside && place.side === attempted.side)) return;
    cancelFree();
    highlight(press.panel);
    attempted = place;
    if (placeBeside("preview", place)) free = place;
  }

  /** @param {HTMLElement} [destination] */
  function finishPress(destination) {
    const previous = press;
    const from = previous?.panel;
    cancelFree();
    const commit = from && destination && destination !== from;
    if (commit) {
      highlight(destination);
      preview.remove();
      target = undefined;
    } else highlight();
    press = undefined;
    slots = undefined;
    container.removeAttribute("data-compose-dragging");
    doc.removeEventListener("keydown", cancelWithEscape, true);
    if (previous?.grip.hasPointerCapture(previous.id)) {
      previous.grip.releasePointerCapture(previous.id);
    }
    if (commit) announceSwap(from, destination);
  }

  /** @param {KeyboardEvent} event */
  function cancelWithEscape(event) {
    if (event.key !== "Escape" || !press) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = true;
    finishPress();
    select();
    status.textContent = "";
  }

  function measureSlots() {
    const board = container.getBoundingClientRect();
    return {
      board,
      canPlaceBelow: container.hasAttribute("data-compose-resizing-ready") &&
        !container.classList.contains("tab-bar"),
      scrollLeft: container.scrollLeft || 0,
      scrollTop: container.scrollTop || 0,
      panels: panels.map((panel) => ({ panel, rect: panel.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0),
    };
  }

  /** @param {DOMRect} rect @param {number} x @param {number} y */
  function contains(rect, x, y) {
    return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
  }

  /** @param {number} pointerX @param {number} pointerY */
  function propose(pointerX, pointerY) {
    if (!press || !slots) return;
    const source = press.panel;
    const board = container.getBoundingClientRect();
    // Hit-test the original slots. The preview itself can move the source,
    // the neighbor and even a whole row; none should steal its own drop target.
    const x = pointerX + slots.board.left - board.left + (container.scrollLeft || 0) -
      slots.scrollLeft;
    const y = pointerY + slots.board.top - board.top + (container.scrollTop || 0) - slots.scrollTop;
    const inside = pointerX >= board.left && pointerX < board.right &&
      pointerY >= board.top && pointerY < board.top + Math.max(board.height, slots.board.height);
    const hit = inside && slots.panels.find(({ rect }) => contains(rect, x, y))?.panel;
    if (
      free?.side === "below" && contains(press.panel.getBoundingClientRect(), pointerX, pointerY)
    ) {
      return;
    }
    // The last native viewer can end exactly at the host iframe's edge. An
    // inner strip makes the new row reachable without pointing outside it.
    // Allow a small overshoot when the pointer continues across the border.
    if (slots.canPlaceBelow && pointerX >= board.left && pointerX < board.right) {
      const below = slots.panels.find(({ panel, rect }) =>
        panel !== source && (!hit || hit === panel || hit === source) &&
        x >= rect.left && x < rect.right &&
        y >= rect.bottom - Math.min(24, rect.height / 4) && y <= rect.bottom + 24
      );
      if (below) {
        offer({ beside: below.panel, side: "below" });
        return;
      }
    }
    if (hit && hit !== press.panel) {
      cancelFree();
      highlight(hit);
      return hit;
    }
    // In the empty part of a row, offer the nearest edge at the pointer's
    // height. The packer alone knows whether this viewer fits next to it.
    if (inside && !hit) {
      if (target && contains(press.panel.getBoundingClientRect(), pointerX, pointerY)) {
        return free || target === press.panel ? undefined : target;
      }
      let distance = Infinity;
      /** @type {FreePlace | undefined} */
      let nearest;
      for (const { panel, rect } of slots.panels) {
        if (panel === press.panel || y < rect.top || y >= rect.bottom) continue;
        const side = x < rect.left ? "left" : "right";
        const gap = side === "left" ? rect.left - x : x - rect.right;
        if (gap >= 0 && gap < distance) {
          distance = gap;
          nearest = { beside: panel, side };
        }
      }
      if (nearest) {
        offer(nearest);
        return;
      }
    }
    // The footprint remains visible across vertical gutters and outside the
    // board. Releasing there keeps the viewer in its original slot.
    cancelFree();
    highlight(press.panel);
  }

  /** @param {HTMLElement} from @param {string} key */
  function neighbor(from, key) {
    const current = from.getBoundingClientRect();
    const horizontal = key === "ArrowLeft" || key === "ArrowRight";
    const forward = key === "ArrowRight" || key === "ArrowDown";
    const [start, end, crossStart, crossEnd] = horizontal
      ? /** @type {const} */ (["left", "right", "top", "bottom"])
      : /** @type {const} */ (["top", "bottom", "left", "right"]);
    /** @type {HTMLElement | undefined} */
    let best;
    let bestDistance = Infinity;
    for (const panel of panels) {
      if (panel === from) continue;
      const rect = panel.getBoundingClientRect();
      const gap = forward ? rect[start] - current[end] : current[start] - rect[end];
      if (!rect.width || !rect.height || gap < -1) continue;
      if (rect[crossEnd] <= current[crossStart] || rect[crossStart] >= current[crossEnd]) continue;
      const offset = (rect[crossStart] + rect[crossEnd] - current[crossStart] - current[crossEnd]) /
        2;
      const distance = Math.hypot(gap, offset);
      if (distance < bestDistance) {
        best = panel;
        bestDistance = distance;
      }
    }
    return best;
  }

  for (const [index, panel] of panels.entries()) {
    if (!namedAreas) panel.style.order = String(index);
    let grip = /** @type {HTMLButtonElement | null} */ (panel.querySelector("[data-compose-grip]"));
    if (!grip) {
      grip = doc.createElement("button");
      grip.setAttribute("data-compose-grip", "");
      panel.prepend(grip);
    }
    grips.set(panel, grip);
    grip.type = "button";
    grip.hidden = false;
    grip.setAttribute("aria-pressed", "false");
    grip.setAttribute("aria-label", "Move " + label(panel));
    grip.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown Escape");
    grip.title = container.classList.contains("tab-bar")
      ? "Drag to swap tabs, use the arrow keys, or select two handles."
      : "Drag beside a viewer to share its row, onto its lower edge to place below, or onto its center to swap. Arrow keys or two handles also swap viewers.";

    grip.addEventListener("click", (event) => {
      if (suppressClick && event.detail !== 0) return;
      if (selected && selected !== panel) {
        swap(selected, panel);
        select();
      } else {
        select(selected === panel ? undefined : panel);
        status.textContent = selected
          ? "Select a destination handle for " + label(panel) + "."
          : "";
      }
    }, { signal });
    grip.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        suppressClick = !!press;
        finishPress();
        select();
        status.textContent = "";
      } else if (
        !press && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        const next = neighbor(panel, event.key);
        if (next) {
          swap(panel, next);
          select();
        }
      }
    }, { signal });
    grip.addEventListener("pointerdown", (event) => {
      if (
        container.hasAttribute("data-compose-dragging") || !event.isPrimary || event.button !== 0
      ) return;
      suppressClick = false;
      press = {
        panel,
        grip,
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragged: false,
      };
      container.setAttribute("data-compose-dragging", "");
      doc.addEventListener("keydown", cancelWithEscape, true);
      grip.focus({ preventScroll: true });
      grip.setPointerCapture(event.pointerId);
    }, { signal });
  }

  container.addEventListener("pointermove", (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (!press.dragged) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) return;
      press.dragged = true;
      slots = measureSlots();
      select(press.panel);
    }
    propose(event.clientX, event.clientY);
  }, { signal });
  container.addEventListener("pointerup", (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (press.dragged) {
      suppressClick = true;
      const over = propose(event.clientX, event.clientY);
      const placement = free;
      const from = press.panel;
      const placed = placement && placeBeside("commit", placement);
      if (placed) free = undefined;
      finishPress(over);
      if (placed) {
        const where = placement.side === "below" ? " below " : " beside ";
        status.textContent = label(from) + " placed" + where + label(placement.beside) + ".";
        container.dispatchEvent(new Event("compose-layout-change"));
      }
      select();
    } else finishPress();
  }, { signal });
  /** @param {PointerEvent} event */
  function cancelPointer(event) {
    if (press?.id !== event.pointerId) return;
    suppressClick = true;
    finishPress();
    select();
  }
  container.addEventListener("pointercancel", cancelPointer, { signal });
  container.addEventListener("lostpointercapture", cancelPointer, { signal });
  signal?.addEventListener("abort", () => {
    finishPress();
    select();
    status.remove();
    container.removeAttribute("data-compose-movement-ready");
  }, { once: true });
}
