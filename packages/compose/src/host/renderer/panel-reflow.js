/**
 * Fit each viewer's chosen width into the authored grid. Keep the actual
 * iframe mounted, and move a neighbor below when it cannot fit on its row.
 * This function is also embedded in the standalone host.
 * @param {HTMLElement} container
 */
export function createPanelReflow(container) {
  const browser = /** @type {Window} */ (container.ownerDocument.defaultView);
  const panels = Array.from(
    /** @type {NodeListOf<HTMLElement>} */ (
      container.querySelectorAll(":scope > [data-compose-panel]")
    ),
  );
  /** @type {(() => void) | undefined} */
  let undo;

  function reset() {
    undo?.();
    undo = undefined;
  }

  /** @param {string} css @param {number} origin @param {number} gap @param {boolean} rtl */
  function tracks(css, origin, gap, rtl) {
    const sizes = Array.from(css.matchAll(/([\d.]+)px/g), (m) => Number(m[1])).filter((v) => v > 0);
    if (rtl) sizes.reverse();
    return sizes.map((size) => {
      const start = origin;
      origin += size + gap;
      return { start, end: start + size };
    });
  }

  /**
   * @param {ReadonlyMap<HTMLElement, number>} choices
   * @param {{panel: HTMLElement, skeleton: HTMLElement}} [preview]
   * @param {ReadonlyMap<HTMLElement, {beside: HTMLElement, side: "left" | "right" | "below"}>} [placements]
   * @returns {boolean} Whether the last requested placement fits. Older preferences
   * can be temporarily unavailable at the current board width.
   */
  function layout(choices, preview, placements) {
    // Start from the authored placement each time. This reclaims vacated
    // spaces and keeps another panel's choice when one viewer is narrowed.
    const frame = preview?.panel.getBoundingClientRect();
    reset();
    if (!choices.size && !placements?.size) return true;
    if (!panels.length) return false;
    const style = browser.getComputedStyle(container);
    const rect = container.getBoundingClientRect();
    const rtl = style.direction === "rtl";
    const gap = parseFloat(style.columnGap) || 0;
    const rowGap = parseFloat(style.rowGap) || 0;
    const left = rect.left + container.clientLeft - container.scrollLeft +
      (parseFloat(style.paddingLeft) || 0);
    const top = rect.top + container.clientTop - container.scrollTop +
      (parseFloat(style.paddingTop) || 0);
    const cols = tracks(style.gridTemplateColumns, left, gap, rtl);
    const rows = tracks(style.gridTemplateRows, top, rowGap, false);
    if (!cols.length || !rows.length) return false;
    const right = cols[cols.length - 1].end;
    const names = Array.from(style.gridTemplateAreas.matchAll(/"([^"]+)"/g), (match) => {
      const row = match[1].trim().split(/\s+/);
      return rtl ? row.reverse() : row;
    });
    const items = panels.map((node) => {
      const box = node.getBoundingClientRect();
      const name = node.dataset.area;
      const areaY = name ? names.findIndex((row) => row.includes(name)) : -1;
      const y = areaY >= 0
        ? areaY
        : rows.findIndex((row) => box.top < row.end - .5 && box.bottom > row.start + .5);
      const span = areaY >= 0 ? names.filter((row) => row.includes(name ?? "")).length : 1;
      const selected = choices.get(node);
      const width = Math.min(right - left, selected ?? box.width);
      return {
        node,
        x: rtl ? Math.max(left, box.right - width) : Math.min(box.left, right - width),
        originalStart: rtl ? right - box.right : box.left - left,
        originalWidth: box.width,
        y,
        span,
        width,
        height: box.height,
        grown: width > box.width + .5,
      };
    });
    if (items.some((item) => item.y < 0 || item.width <= 0 || !Number.isFinite(item.width))) {
      return false;
    }
    const original = panels.map(({ style }) => ({
      gridRow: style.gridRow,
      gridColumn: style.gridColumn,
      width: style.width,
      marginLeft: style.marginLeft,
      justifySelf: style.justifySelf,
    }));
    const { alignContent, gridTemplateRows, gridTemplateColumns, gridTemplateAreas, position } =
      container.style;
    undo = () => {
      if (preview) {
        preview.skeleton.remove();
        // Restore individual positioning properties. Native measurements can
        // arrive from an iframe during a drag and must survive the preview.
        for (const [key, value] of previewPosition) preview.panel.style.setProperty(key, value);
      }
      Object.assign(container.style, {
        alignContent,
        gridTemplateRows,
        gridTemplateColumns,
        gridTemplateAreas,
        position,
      });
      panels.forEach(({ style }, i) => Object.assign(style, original[i]));
    };
    const previewPosition = [
      "position",
      "top",
      "left",
      "right",
      "bottom",
      "height",
      "box-sizing",
      "opacity",
    ]
      .map(
        (property) => [property, preview?.panel.style.getPropertyValue(property) ?? ""],
      );
    if (preview && frame) {
      if (style.position === "static") container.style.position = "relative";
      container.append(preview.skeleton);
      // Keep this iframe's browsing context and actual viewport untouched.
      // Only the inert skeleton participates in the proposed grid layout.
      Object.assign(preview.panel.style, {
        position: "absolute",
        gridRow: "auto",
        gridColumn: "auto",
        right: "auto",
        bottom: "auto",
        left: frame.left - rect.left - container.clientLeft + container.scrollLeft + "px",
        top: frame.top - rect.top - container.clientTop + container.scrollTop + "px",
        width: frame.width + "px",
        height: frame.height + "px",
        marginLeft: "0px",
        justifySelf: "left",
        boxSizing: "border-box",
      });
      Object.assign(preview.skeleton.style, {
        position: "relative",
        alignSelf: "start",
        height: frame.height + "px",
        boxSizing: "border-box",
      });
    }

    /** @typedef {typeof items[number]} Item */
    /** @type {Item[]} */
    const placed = [];
    let changedRows = false;
    /** @param {Item} a @param {Item} b */
    function sameRows(a, b) {
      return a.y < b.y + b.span && a.y + a.span > b.y;
    }
    /** @param {Item} a @param {Item} b */
    function overlaps(a, b) {
      return sameRows(a, b) && a.x < b.x + b.width + gap - .5 && a.x + a.width + gap > b.x + .5;
    }
    // Follow a shrinking neighbor only across an actual authored gutter.
    // A spanning viewer stays anchored if any of its rows had a blank area.
    for (const item of [...items].sort((a, b) => a.originalStart - b.originalStart)) {
      const previous = items.filter((other) =>
        sameRows(item, other) &&
        Math.abs(other.originalStart + other.originalWidth + gap - item.originalStart) <= .5
      );
      let nextStart = 0;
      for (let y = item.y; y < item.y + item.span; y++) {
        const neighbor = previous.find((other) => other.y <= y && y < other.y + other.span);
        if (!neighbor) {
          nextStart = item.originalStart;
          break;
        }
        const end = rtl ? right - neighbor.x : neighbor.x + neighbor.width - left;
        nextStart = Math.max(nextStart, end + gap);
      }
      const start = rtl ? right - item.x - item.width : item.x - left;
      if (nextStart < start - .5) item.x = rtl ? right - nextStart - item.width : left + nextStart;
    }
    /** @param {Item} item @param {number} preferred */
    function fitOnRow(item, preferred) {
      const neighbors = placed.filter((other) => sameRows(item, other)).sort((a, b) => a.x - b.x);
      let start = left, nearest = Infinity;
      /** @param {number} end */
      function consider(end) {
        if (end - start < item.width - .5) return;
        const x = Math.max(start, Math.min(preferred, end - item.width));
        if (Math.abs(preferred - x) < Math.abs(preferred - nearest)) nearest = x;
      }
      for (const other of neighbors) {
        consider(other.x - gap);
        start = Math.max(start, other.x + other.width + gap);
      }
      consider(right);
      return nearest;
    }

    /** @param {Item[]} group */
    function placeGroup(group) {
      // Reserve unaffected positions before searching for new places. A
      // collision next to the active viewer need not ripple across a row.
      const pending = [];
      for (const item of group) {
        if (placed.some((other) => overlaps(item, other))) pending.push(item);
        else placed.push(item);
      }
      for (const item of pending) {
        let x = fitOnRow(item, item.x);
        if (!Number.isFinite(x)) {
          const blockers = placed.filter((other) => overlaps(item, other));
          item.y = Math.max(...blockers.map((other) => other.y + other.span));
          changedRows = true;
          while (!Number.isFinite(x = fitOnRow(item, left))) item.y++;
        }
        item.x = x;
        placed.push(item);
      }
    }
    // Preserve the priority of earlier selections when two large viewers need
    // the same space, including across repeated preview and commit layouts.
    const chosen = Array.from(choices.keys());
    const grown = items.filter((item) => item.grown).sort((a, b) =>
      chosen.indexOf(a.node) - chosen.indexOf(b.node)
    );
    placeGroup(grown);
    placeGroup(items.filter((item) => !item.grown));

    // A horizontal drop needs free space. A drop below a viewer can insert a
    // new grid row, keeping the order and widths of the following rows.
    /** @type {Map<HTMLElement, boolean>} */
    const applied = new Map();
    /** @type {Set<number>} */
    const vacated = new Set();
    /** @param {HTMLElement} node */
    function placeBeside(node) {
      if (applied.has(node)) return;
      const preference = placements?.get(node);
      if (!preference) return;
      applied.set(node, false);
      const { beside, side } = preference;
      // An anchor can itself have moved beside another viewer.
      placeBeside(beside);
      const item = placed.find((item) => item.node === node);
      const anchor = placed.find((item) => item.node === beside);
      if (!item || !anchor || anchor === item) return;
      const below = side === "below";
      const y = below ? anchor.y + anchor.span : anchor.y;
      const x = below
        ? Math.min(anchor.x, right - item.width)
        : side === "left"
        ? anchor.x - gap - item.width
        : anchor.x + anchor.width + gap;
      if (x < left - .5 || x + item.width > right + .5) return;
      const position = { ...item, x, y };
      const blockers = placed.filter((other) => other !== item && overlaps(position, other));
      if (blockers.length && !below) return;
      if (item.y !== y || blockers.length) {
        for (let row = item.y; row < item.y + item.span; row++) vacated.add(row);
        changedRows = true;
      }
      if (blockers.length) {
        const shift = y + item.span - Math.min(y, ...blockers.map((other) => other.y));
        for (const row of [...vacated].sort((a, b) => b - a)) {
          if (row < y) break;
          vacated.delete(row);
          vacated.add(row + shift);
        }
        for (const other of placed) {
          if (other !== item && (other.y >= y || blockers.includes(other))) other.y += shift;
        }
      }
      Object.assign(item, { x, y });
      applied.set(node, true);
    }
    let fits = true;
    for (const node of placements?.keys() ?? []) {
      placeBeside(node);
      fits = applied.get(node) === true;
    }
    // Remove only rows emptied by this gesture. Explicit holes elsewhere in
    // the authored grid retain their coordinates.
    for (const row of [...vacated].sort((a, b) => b - a)) {
      if (placed.some((item) => item.y <= row && row < item.y + item.span)) continue;
      for (const item of placed) if (item.y > row) item.y--;
    }
    /** @type {number[]} */
    const heights = [];
    for (const item of placed) {
      // Preserve pixels even on unequal tracks. A displaced viewer may need a
      // different column span to keep the same viewport on its new row.
      const from = Math.max(0, cols.findLastIndex((track) => track.start <= item.x + .5));
      const to = cols.findIndex((track) => track.end >= item.x + item.width - .5);
      const start = rtl ? cols.length - to : from + 1;
      const s = (preview?.panel === item.node ? preview.skeleton : item.node).style;
      s.gridColumn = start + " / span " + (to - from + 1);
      s.gridRow = (item.y + 1) + " / span " + item.span;
      s.width = item.width + "px";
      s.marginLeft = Math.max(0, item.x - cols[from].start) + "px";
      s.justifySelf = "left";
      const intrinsic = preview?.panel === item.node ||
        container.hasAttribute("data-compose-intrinsic") ||
        s.getPropertyValue("--compose-native-height");
      const floor = intrinsic
        ? 0
        : Math.max(1, (item.height - (item.span - 1) * rowGap) / item.span);
      for (let y = item.y; y < item.y + item.span; y++) {
        heights[y] = Math.max(heights[y] ?? 0, floor);
      }
    }
    if (changedRows) {
      container.style.alignContent = "start";
      // An auto-fit column collapses when its last viewer moves below another
      // one. Freeze the measured tracks until the next natural layout pass.
      const widths = cols.map((track) => (track.end - track.start) + "px");
      container.style.gridTemplateColumns = (rtl ? widths.reverse() : widths).join(" ");
      container.style.gridTemplateAreas = "none";
      container.style.gridTemplateRows = Array.from(
        heights,
        (v) => "minmax(" + Math.ceil(v ?? 0) + "px, auto)",
      ).join(" ");
    }
    if (preview && frame) {
      const destination = preview.skeleton.getBoundingClientRect();
      if (
        frame.left < destination.left - .5 || frame.right > destination.right + .5 ||
        Math.abs(destination.top - frame.top) > .5
      ) {
        preview.panel.style.opacity = "0";
      }
    }
    return fits;
  }
  return { layout, reset };
}
