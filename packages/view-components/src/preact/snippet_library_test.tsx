/** @jsxImportSource preact */

import { assert, assertEquals } from "@std/assert";
import { render } from "preact";
import { act } from "npm:preact@^10.28.3/test-utils";
import { SnippetLibrary, type SnippetLibraryEntry } from "../../preact-components.ts";

Deno.test("SnippetLibrary searches metadata and restores the filter after viewing exact source", async () => {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const dom = parseHTML("<html><body><div id=root></div></body></html>");
  const root = dom.document.getElementById("root") as unknown as HTMLElement;
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });

  const entries = [
    { id: "invoices", name: "Outstanding invoices", description: "Customer balances" },
    { id: "stock", name: "Stock" },
  ];
  const code = '\n  return "<script>&</script>";\r\n  ';
  const labels = {
    title: "My snippets",
    search: "Search",
    view: "View script",
    viewNamed: (name: string) => `View script: ${name}`,
    back: "Back",
    noMatch: "No matches",
    empty: "No saved snippets",
  };
  let selected: SnippetLibraryEntry | undefined;
  let busy = false;
  function update() {
    act(() =>
      render(
        <SnippetLibrary
          entries={entries}
          source={selected ? { ...selected, code } : undefined}
          labels={labels}
          busy={busy}
          onInspect={(entry) => {
            selected = entry;
          }}
          onBack={() => {
            selected = undefined;
          }}
        />,
        root,
      )
    );
  }
  function filter(query: string) {
    const input = root.querySelector("input")!;
    act(() => {
      input.value = query;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  try {
    update();
    assertEquals(root.querySelectorAll("li").length, 2);
    filter("unknown");
    assertEquals(root.querySelector('[role="status"]')?.textContent, labels.noMatch);
    filter(" CUSTOMER ");
    assertEquals(root.querySelectorAll("li").length, 1);
    const open = root.querySelector("li button")!;
    assertEquals(open.getAttribute("aria-label"), "View script: Outstanding invoices");
    busy = true;
    update();
    assert(open.hasAttribute("disabled"));
    busy = false;
    update();
    open.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    update();

    assertEquals(root.querySelector("code")?.textContent, code);
    assertEquals(root.querySelector("script"), null);
    assertEquals(root.querySelector("input"), null);
    const back = root.querySelector(".mcp-view-snippet-source button")!;
    assertEquals(back.textContent, labels.back);
    back.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
    update();
    assertEquals(root.querySelector("input")?.value, " CUSTOMER ");
    assertEquals(root.querySelectorAll("li").length, 1);
  } finally {
    act(() => render(null, root));
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
