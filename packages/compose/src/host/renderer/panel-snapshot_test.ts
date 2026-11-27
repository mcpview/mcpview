import { assertEquals } from "@std/assert";
import { isPanelLayoutSnapshot } from "../../code-mode/layout.ts";

Deno.test("saved layout accepts only geometry with unique IDs, valid widths and acyclic placement anchors", () => {
  const base = { version: 1, order: ["a", "b", "c"], widths: [], placements: [] };
  assertEquals(isPanelLayoutSnapshot(base), true);
  for (
    const patch of [
      { version: 2 },
      { context: "October" },
      { order: [] },
      { order: ["a", "b", "b"] },
      { order: ["a".repeat(257)] },
      { order: Array.from({ length: 129 }, (_, i) => String(i)) },
      { widths: [{ panel: "d", width: 100 }] },
      { widths: [{ panel: "a", width: 0 }] },
      { widths: [{ panel: "a", width: 1.5 }] },
      { widths: [{ panel: "a", width: 100, invoice: "INV-001" }] },
      { widths: [{ panel: "a", width: 100 }, { panel: "a", width: 300 }] },
      { placements: [{ panel: "a", beside: "b", side: "top" }] },
      { placements: [{ panel: "a", beside: "absent", side: "right" }] },
      {
        placements: [{ panel: "a", beside: "b", side: "right" }, {
          panel: "b",
          beside: "a",
          side: "below",
        }],
      },
      { placements: [{ panel: "a", beside: "a", side: "below" }] },
      { placements: [{ panel: "a", beside: "b", side: "below", result: [] }] },
    ]
  ) assertEquals(isPanelLayoutSnapshot({ ...base, ...patch }), false);
});
