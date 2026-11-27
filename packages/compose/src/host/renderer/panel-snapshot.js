import { isPanelLayoutSnapshot } from "../../code-mode/layout.ts";

const slotState = Symbol.for("@mcpview/compose/panel-layout-controls/v1");

/** @param {HTMLElement} board */
function panelSlots(board) {
  const panels = Array.from(
    /** @type {NodeListOf<HTMLElement>} */ (
      board.querySelectorAll(":scope > [data-compose-panel]")
    ),
  );

  const ids = panels.map((node) => node.dataset.composePanelId);
  if (!ids.every(Boolean) || new Set(ids).size !== ids.length) return;
  const named = panels.every((node) => node.dataset.area);
  // Named areas follow the template even when the viewport changes its number of columns.
  const slots = panels.map((node, i) =>
    named ? node.dataset.composeTemplateArea ?? node.dataset.area ?? "" : String(i)
  );
  if (new Set(slots).size !== slots.length) return;
  return { panels, slots, named, byId: new Map(panels.map((p) => [p.dataset.composePanelId, p])) };
}

/** Read only the last committed layout preferences.
 * @param {HTMLElement} board
 * @returns {import("../../code-mode/layout.ts").PanelLayoutSnapshot | undefined}
 */
export function capturePanelLayout(board) {
  if (board.hasAttribute("data-compose-dragging")) return;
  const table = panelSlots(board);
  if (!table) return;
  const { panels, named, slots } = table;
  const occupants = new Map(panels.map((panel, i) => [
    named ? panel.dataset.area : (panel.style.order || String(i)),
    panel.dataset.composePanelId,
  ]));
  const controls = Reflect.get(board, slotState);
  const geometry = controls?.read() ?? { widths: [], placements: [] };
  const snapshot = { version: 1, order: slots.map((slot) => occupants.get(slot)), ...geometry };
  return isPanelLayoutSnapshot(snapshot) ? snapshot : undefined;
}

/** Apply a saved preference only to matching panels and current viewer width declarations.
 * @param {HTMLElement} board
 * @param {unknown} snapshot
 */
export function restorePanelLayout(board, snapshot) {
  if (!isPanelLayoutSnapshot(snapshot) || board.hasAttribute("data-compose-dragging")) return false;
  const table = panelSlots(board);
  if (
    !table || snapshot.order.length !== table.panels.length ||
    !snapshot.order.every((id) => table.byId.has(id))
  ) return false;
  const controls = Reflect.get(board, slotState);
  if ((snapshot.widths.length || snapshot.placements.length) && !controls) return false;
  if (
    !snapshot.widths.every(({ panel, width }) => controls?.supports(table.byId.get(panel), width))
  ) return false;
  snapshot.order.forEach((id, index) => {
    const panel = /** @type {HTMLElement} */ (table.byId.get(id));
    if (table.named) panel.dataset.area = table.slots[index];
    else panel.style.order = table.slots[index];
  });
  controls?.restore(
    snapshot.widths.map(({ panel, width }) => [table.byId.get(panel), width]),
    snapshot.placements.map(({ panel, beside, side }) => [
      table.byId.get(panel),
      { beside: table.byId.get(beside), side },
    ]),
  );
  return true;
}
