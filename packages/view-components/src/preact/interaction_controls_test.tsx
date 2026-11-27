/** @jsxImportSource preact */
import { assert, assertEquals, assertFalse } from "@std/assert";
import { render } from "preact";
import {
  installMcpViewInteractionStyles,
  MCP_VIEW_INTERACTION_CSS,
} from "../interaction-styles.ts";
import { MCP_VIEW_CONTEXT_ROW_CSS } from "../../preact-controls.ts";
import { PERMISSIONS, withDocument } from "../testing/surface-app-double.ts";
import { DataTable } from "./components.tsx";
import { ContextPinButton, DisclosureChevron } from "./interaction-controls.tsx";

Deno.test({
  name: "the pin is controlled, tri-state, disabled and independent of the containing row",
  permissions: PERMISSIONS,
  async fn() {
    await withDocument((root) => {
      const toggles: boolean[] = [];
      const bubbled: string[] = [];
      const send = (target: Element, type: string, fields: Record<string, unknown> = {}) => {
        const EventClass = target.ownerDocument.defaultView!.Event;
        const event = new EventClass(type, { bubbles: true, cancelable: true });
        Object.assign(event, fields);
        target.dispatchEvent(event);
        return event;
      };
      const draw = (pressed: boolean | "mixed", group = false, disabled = false) => {
        render(
          <div
            onClick={() => bubbled.push("click")}
            onDblClick={() => bubbled.push("dblclick")}
            onDragStart={() => bubbled.push("drag")}
            onPointerDown={() => bubbled.push("pointerdown")}
            onPointerUp={() => bubbled.push("pointerup")}
            onKeyDown={() => bubbled.push("keydown")}
            onKeyUp={() => bubbled.push("keyup")}
          >
            <ContextPinButton
              label="Pin winter"
              pressed={pressed}
              group={group}
              disabled={disabled}
              onToggle={(shiftKey) => toggles.push(shiftKey)}
            />
          </div>,
          root,
        );
        return root.querySelector<HTMLButtonElement>("button")!;
      };
      const one = draw(false);
      assertEquals(one.getAttribute("aria-label"), "Pin winter");
      assertEquals(one.getAttribute("aria-pressed"), "false");
      assertEquals(one.querySelectorAll("path").length, 1);
      send(one, "pointerdown");
      send(one, "pointerup");
      send(one, "click", { detail: 1, shiftKey: true });
      send(one, "click", { detail: 2 });
      send(one, "dblclick", { detail: 2 });
      send(one, "keydown", { key: "Enter" });
      send(one, "keyup", { key: "Enter" });
      assert(send(one, "keydown", { key: " ", repeat: true }).defaultPrevented);
      send(one, "click", { detail: 0 });
      assert(send(one, "dragstart").defaultPrevented);
      assertEquals(toggles, [true, false]);
      assertEquals(bubbled, []);
      assertEquals(one.getAttribute("aria-pressed"), "false");
      const individual = draw("mixed");
      assertEquals(individual.querySelectorAll("path").length, 1);
      assertEquals(individual.getAttribute("aria-pressed"), "mixed");
      const group = draw("mixed", true);
      assertEquals(group.querySelectorAll("path").length, 2);
      assertEquals(group.getAttribute("aria-pressed"), "mixed");
      const pinned = draw(true, true);
      assertEquals(pinned.getAttribute("aria-pressed"), "true");
      const disabled = draw(false, false, true);
      assert(disabled.disabled);
      send(disabled, "click", { detail: 1 });
      assertEquals(toggles, [true, false]);
    });
  },
});

Deno.test({
  name: "disclosure and style installation work without the application theme",
  permissions: PERMISSIONS,
  async fn() {
    await withDocument((root) => {
      render(<DisclosureChevron expanded />, root);
      const chevron = root.querySelector("svg")!;
      assertEquals(chevron.getAttribute("aria-hidden"), "true");
      assertEquals(chevron.getAttribute("focusable"), "false");
      assertEquals(chevron.getAttribute("data-expanded"), "true");
      const style = installMcpViewInteractionStyles(root.ownerDocument);
      assertEquals(installMcpViewInteractionStyles(root.ownerDocument), style);
      assertEquals(root.ownerDocument.querySelectorAll("style").length, 1);
      assertEquals(style.textContent, MCP_VIEW_INTERACTION_CSS);
      assertFalse(MCP_VIEW_INTERACTION_CSS.includes(":root"));
      assert(MCP_VIEW_INTERACTION_CSS.includes("(pointer: coarse)"));
      assert(MCP_VIEW_INTERACTION_CSS.includes("44px"));
      assert(MCP_VIEW_INTERACTION_CSS.includes(MCP_VIEW_CONTEXT_ROW_CSS));
      assert(MCP_VIEW_CONTEXT_ROW_CSS.includes("[data-mcp-view-context-row-break]"));
      assert(MCP_VIEW_CONTEXT_ROW_CSS.includes("tr[data-mcp-view-context-row="));
      assertFalse(MCP_VIEW_CONTEXT_ROW_CSS.includes("[data-context-row"));
      assertFalse(MCP_VIEW_CONTEXT_ROW_CSS.includes("--color-accent"));
    });
  },
});

Deno.test({
  name:
    "a table opens disclosed rows through the leading control or row, with an independent trailing pin",
  permissions: PERMISSIONS,
  async fn() {
    await withDocument((root) => {
      const opened: string[] = [];
      const selected: string[] = [];
      const pinned: string[] = [];
      render(
        <DataTable
          label="Invoices"
          rows={["INV-1", "INV-2"]}
          rowKey={(id) => id}
          onSelect={(id) => selected.push(id)}
          getDisclosure={(id) =>
            id === "INV-1"
              ? {
                label: "Open INV-1",
                expanded: false,
                controls: "detail",
                onOpen: () => opened.push(id),
              }
              : undefined}
          columns={[
            { id: "id", label: "Invoice", render: (id) => id },
            {
              id: "pin",
              label: "Context",
              render: (id) => (
                <ContextPinButton
                  label={`Pin ${id}`}
                  pressed={false}
                  onToggle={() => pinned.push(id)}
                />
              ),
            },
          ]}
        />,
        root,
      );
      const [first, second] = root.querySelectorAll<HTMLTableRowElement>("tbody tr");
      const open = first.cells?.[0]?.firstElementChild ?? first.querySelector("td > button")!;
      assertEquals(open.getAttribute("aria-label"), "Open INV-1");
      assertEquals(open.getAttribute("aria-controls"), "detail");
      assertEquals(open.getAttribute("aria-expanded"), "false");
      (open as HTMLButtonElement).click();
      first.click();
      first.querySelector<HTMLButtonElement>("[data-context-pin]")!.click();
      second.click();
      assertEquals(opened, ["INV-1", "INV-1"]);
      assertEquals(selected, ["INV-2"]);
      assertEquals(pinned, ["INV-1"]);
    });
  },
});
