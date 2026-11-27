import { assertEquals } from "@std/assert";
import { visualItemProps } from "./visual-item-props.ts";

Deno.test("visual item attributes keep detail, context and group selection independent", () => {
  assertEquals(
    visualItemProps({
      id: "a",
      activation: { label: "Read record", expanded: false, controls: "detail-a" },
      pressed: "mixed",
      selectionStart: false,
    }),
    {
      "data-visual-item": "a",
      "data-visual-no-activate": undefined,
      "data-visual-no-toggle": undefined,
      "data-visual-selection-start": undefined,
      role: "button",
      tabIndex: 0,
      "aria-label": "Read record",
      "aria-pressed": "mixed",
      "aria-keyshortcuts": "Shift+Space",
      "aria-expanded": false,
      "aria-controls": "detail-a",
      title: "Read record",
    },
  );

  const contextOnly = visualItemProps({ id: "b", pressed: false });
  assertEquals(contextOnly["data-visual-item"], "b");
  assertEquals(contextOnly["data-visual-no-activate"], "");
  assertEquals(contextOnly["data-visual-no-toggle"], undefined);
  assertEquals(contextOnly["data-visual-selection-start"], "");
  assertEquals(contextOnly["aria-expanded"], undefined);

  const readOnly = visualItemProps({ id: "c", activation: { label: "Read" } });
  assertEquals(readOnly["data-visual-item"], "c");
  assertEquals(readOnly["data-visual-no-toggle"], "");
  assertEquals(readOnly["data-visual-selection-start"], undefined);
  assertEquals(readOnly["aria-keyshortcuts"], undefined);
  assertEquals(visualItemProps({ id: "d" })["data-visual-item"], undefined);
});
