/** @jsxImportSource preact */

import { assert, assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { render } from "preact";
import {
  Badge,
  BadgeGroup,
  Button,
  Card,
  CodeBlock,
  CrossSelection,
  DataTable,
  EmptyState,
  InlineCode,
  KeyValueList,
  Message,
  Metric,
  MetricGrid,
  NoticeGroup,
  renderStatusMessage,
  Row,
  Skeleton,
  Stack,
  StateMessage,
  TextInput,
  Toolbar,
} from "./components.tsx";

Deno.test({
  name: "shared Preact components render one consistent semantic vocabulary",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML(
      "<html><body><div id=root></div></body></html>",
    );
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.document,
    });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <Card
          eyebrow="MCP / TEST"
          title="Qualification"
          actions={<Badge tone="success">Ready</Badge>}
        >
          <Stack gap="sm">
            <MetricGrid
              items={[{
                id: "temperature",
                label: "Temperature",
                value: "94",
                unit: "°C",
              }]}
            />
            <Metric label="Duration" value="148" unit="s" tone="info" />
          </Stack>
          <Row label="Execution state" responsive>
            <span>Simulation</span>
            <BadgeGroup label="Execution labels">
              <Badge tone="info">recorded</Badge>
              <Badge>read-only</Badge>
            </BadgeGroup>
          </Row>
          <KeyValueList
            items={[{ id: "model", label: "Model", value: "CM-01" }]}
          />
          <KeyValueList
            layout="facts"
            items={[{ id: "engine", label: "Engine", value: "ngspice 44" }]}
          />
          <Toolbar label="Qualification actions">
            <Button pressed>Pin</Button>
            <TextInput
              label="Filter qualification"
              value="thermal"
              onValueInput={() => {}}
            />
          </Toolbar>
          <CodeBlock label="Expression">self.temperature</CodeBlock>
          <InlineCode title="Recorded fingerprint">sha256:abc123</InlineCode>
          <CrossSelection label="Selection" value="MotorAssembly" status="linked" />
          <Message tone="warning">Recorded values may be stale</Message>
          <EmptyState>No secondary evidence</EmptyState>
          <StateMessage busy tone="danger" title="Invalid result">
            Check the solver log
          </StateMessage>
        </Card>,
        root,
      );

      assertEquals(root.querySelectorAll(".mcp-view-card").length, 1);
      assertEquals(root.querySelector(".mcp-view-card-title")?.textContent, "Qualification");
      assertEquals(root.querySelector(".mcp-view-badge")?.getAttribute("data-tone"), "success");
      assertEquals(root.querySelector("[data-metric=temperature]")?.textContent, "Temperature94°C");
      assertEquals(root.querySelector(".mcp-view-key-value")?.textContent, "ModelCM-01");
      // The inspector layout is the unmarked default; facts opt in by attribute.
      const [inspector, facts] = root.querySelectorAll(".mcp-view-key-values");
      assertEquals(inspector.getAttribute("data-layout"), null);
      assertEquals(facts.getAttribute("data-layout"), "facts");
      assertEquals(root.querySelector(".mcp-view-toolbar")?.getAttribute("role"), "group");
      assertEquals(root.querySelector(".mcp-view-button")?.getAttribute("aria-pressed"), "true");
      assertEquals(
        root.querySelector(".mcp-view-text-input")?.getAttribute("aria-label"),
        "Filter qualification",
      );
      assertEquals(root.querySelector(".mcp-view-code-block")?.textContent, "self.temperature");
      assertEquals(root.querySelector(".mcp-view-inline-code")?.textContent, "sha256:abc123");
      assertEquals(root.querySelector(".mcp-view-stack")?.getAttribute("data-gap"), "sm");
      assertEquals(root.querySelector(".mcp-view-row")?.getAttribute("role"), "group");
      assertEquals(
        root.querySelector(".mcp-view-row")?.classList.contains("mcp-view-row-responsive"),
        true,
      );
      assertEquals(
        root.querySelector(".mcp-view-badges")?.getAttribute("aria-label"),
        "Execution labels",
      );
      assertEquals(root.querySelectorAll(".mcp-view-metric").length, 2);
      assertEquals(root.querySelector(".mcp-view-cross-selection")?.getAttribute("role"), "status");
      assertEquals(root.querySelector(".mcp-view-message")?.getAttribute("data-tone"), "warning");
      assertEquals(root.querySelector(".mcp-view-empty")?.textContent, "No secondary evidence");
      assertEquals(root.querySelector(".mcp-view-state")?.getAttribute("role"), "alert");
      assertEquals(root.querySelector(".mcp-view-state")?.getAttribute("aria-busy"), "true");
      assertEquals(root.querySelectorAll(".mcp-view-state-busy").length, 1);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "DataTable only advertises interactive rows when selection exists",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML(
      "<html><body><div id=root></div></body></html>",
    );
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.document,
    });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const rows = [{ id: "boiler", name: "Boiler" }];
      render(
        <DataTable
          className="domain-table"
          label="Empty materials"
          rows={[] as typeof rows}
          columns={[{ id: "name", label: "Name", render: (row) => row.name }]}
          rowKey={(row) => row.id}
        />,
        root,
      );
      assertEquals(root.firstElementChild?.getAttribute("role"), "status");
      assertEquals(root.firstElementChild?.getAttribute("aria-label"), "Empty materials");
      assertEquals(root.firstElementChild?.classList.contains("domain-table"), true);

      render(
        <DataTable
          label="Materials"
          rows={rows}
          columns={[{ id: "name", label: "Name", render: (row) => row.name }]}
          rowKey={(row) => row.id}
        />,
        root,
      );
      assertEquals(root.querySelector("tbody tr")?.hasAttribute("data-interactive"), false);

      render(
        <DataTable
          label="Materials"
          rows={rows}
          columns={[{ id: "name", label: "Name", render: (row) => row.name }]}
          rowKey={(row) => row.id}
          selected={() => true}
          onSelect={() => {}}
        />,
        root,
      );
      assertEquals(
        root.querySelector("tbody tr")?.getAttribute("data-interactive"),
        "true",
      );
      assertEquals(root.querySelector("tbody tr")?.getAttribute("aria-selected"), "true");
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "Skeleton renders role=status aria-busy=true with caller label and N aria-hidden lines",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML(
      "<html><body><div id=root></div></body></html>",
    );
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: dom.document,
    });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;

      // Default: 3 lines
      render(<Skeleton label="Loading qualification results" />, root);

      const el = root.querySelector(".mcp-view-skeleton");
      assertEquals(el?.getAttribute("role"), "status");
      assertEquals(el?.getAttribute("aria-busy"), "true");
      assertEquals(el?.getAttribute("aria-label"), "Loading qualification results");
      const defaultLines = root.querySelectorAll(".mcp-view-skeleton-line");
      assertEquals(defaultLines.length, 3);
      assertEquals(defaultLines[0].getAttribute("aria-hidden"), "true");
      assertEquals(defaultLines[1].getAttribute("aria-hidden"), "true");
      assertEquals(defaultLines[2].getAttribute("aria-hidden"), "true");

      // Explicit line count
      render(<Skeleton label="Loading" lines={5} />, root);
      assertEquals(root.querySelectorAll(".mcp-view-skeleton-line").length, 5);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("Skeleton rejects non-integer or sub-one lines count", () => {
  assertThrows(() => Skeleton({ label: "Loading", lines: 0 }), RangeError, "positive integer");
  assertThrows(() => Skeleton({ label: "Loading", lines: -1 }), RangeError, "positive integer");
  assertThrows(() => Skeleton({ label: "Loading", lines: 1.5 }), RangeError, "positive integer");
});

Deno.test("NoticeGroup renders null when items is empty and omittedLabel is absent", () => {
  const result = NoticeGroup({ label: "Warnings", items: [] });
  assertEquals(result, null);
});

Deno.test({
  name: "NoticeGroup renders a section with label, data-tone, and one Message per item",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <NoticeGroup
          label="Validation warnings"
          items={["First notice", "Second notice"]}
          tone="warning"
        />,
        root,
      );

      const section = root.querySelector("section");
      assertEquals(section?.getAttribute("aria-label"), "Validation warnings");
      assertEquals(section?.getAttribute("data-tone"), "warning");
      assertEquals(
        root.querySelector(".mcp-view-notice-group-label")?.textContent,
        "Validation warnings",
      );
      const notices = root.querySelectorAll(".mcp-view-notice-group-item");
      assertEquals(notices.length, 2);
      const messages = root.querySelectorAll(".mcp-view-message");
      // Les notices ne sont plus des Message : le ton vit sur le groupe.
      assertEquals(messages.length, 0);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "NoticeGroup renders the section when items is empty but omittedLabel is provided",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <NoticeGroup label="Errors" items={[]} omittedLabel="3 more not shown" />,
        root,
      );

      assertEquals(root.querySelector("section") !== null, true);
      assertEquals(root.querySelector("section")?.getAttribute("data-tone"), "neutral");
      assertEquals(root.querySelectorAll(".mcp-view-message").length, 0);
      assertEquals(
        root.querySelector(".mcp-view-notice-group-omitted")?.textContent,
        "3 more not shown",
      );
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "renderStatusMessage without container returns the StateMessage node itself",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const node = renderStatusMessage("Loading results");
      // The node IS the state, not a wrapper around it: a caller handing this
      // to `defineView` must get an element carrying the class and the role.
      assertEquals(node.classList.contains("mcp-view-state"), true);
      assertEquals(node.getAttribute("aria-live"), null);
      assertEquals(
        node.querySelector(".mcp-view-state-detail")?.textContent,
        "Loading results",
      );
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "renderStatusMessage with container renders into it and returns the same node",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const container = dom.document.createElement("div") as unknown as HTMLElement;
      const result = renderStatusMessage("Solver running", { container });
      assertStrictEquals(result, container);
      assertEquals(container.querySelector(".mcp-view-state") !== null, true);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "renderStatusMessage passes tone title busy and className to StateMessage",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const node = renderStatusMessage("Solver running", {
        tone: "info",
        title: "Processing",
        busy: true,
        className: "my-status",
      });
      // className lands on the node that comes back, so a viewer can style the
      // element it mounts rather than an anonymous wrapper it never sees.
      assertEquals(node.getAttribute("data-tone"), "info");
      assertEquals(node.querySelector("strong")?.textContent, "Processing");
      assertEquals(node.querySelector(".mcp-view-state-busy") !== null, true);
      assertEquals(node.classList.contains("my-status"), true);
      assertEquals(node.classList.contains("mcp-view-state"), true);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "NoticeGroup announces one live region for the group, not one per notice",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <NoticeGroup
          label="Overruns"
          tone="danger"
          items={["REQ-014 over margin", "REQ-021 over margin", "REQ-033 over margin"]}
        />,
        root,
      );
      // Wrapping each notice in Message gave one alert per item: a reader heard
      // three alerts for what is drawn as a single severity heading.
      assertEquals(root.querySelectorAll("[role=alert]").length, 1);
      assertEquals(root.querySelector("section")?.getAttribute("role"), "alert");
      assertEquals(root.querySelectorAll(".mcp-view-notice-group-item").length, 3);

      render(<NoticeGroup label="Notes" items={["a"]} />, root);
      assertEquals(root.querySelectorAll("[role=alert]").length, 0);
      assertEquals(root.querySelector("section")?.getAttribute("role"), "status");
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("NoticeGroup treats a falsy omittedLabel as nothing left out", () => {
  // `{count && `${count} more`}` yields 0 and `{text && text}` yields "".
  for (const omittedLabel of [0, "", false, null, undefined]) {
    assertEquals(
      NoticeGroup({ label: "Warnings", items: [], omittedLabel }),
      null,
      `omittedLabel ${JSON.stringify(omittedLabel)} must not render the group`,
    );
  }
  assert(NoticeGroup({ label: "Warnings", items: [], omittedLabel: "+ 3 more" }) !== null);
});

Deno.test("DataTable context gestures keep columns, explicit disclosures and nested controls", async (test) => {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const dom = parseHTML("<html><body><div id=root></div></body></html>");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousDOMRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");
  const box = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "DOMRect", {
    configurable: true,
    value: class {
      constructor(x: number, y: number, width: number, height: number) {
        Object.assign(this, box(x, y, width, height));
      }
    },
  });

  const root = dom.document.getElementById("root") as unknown as HTMLElement;
  const rows = [
    { id: "a", name: "Boiler", balance: 10 },
    { id: "b", name: "Pump", balance: 20 },
    { id: "c", name: "Fan", balance: 30 },
  ];
  const observed: string[] = [];
  const selected = new Set<string>();
  let acknowledge: (() => void) | undefined;
  function draw(context = true) {
    render(
      <DataTable
        label="Parts"
        rows={rows}
        rowKey={(row) => row.id}
        selected={(row) => selected.has(row.id)}
        onSelect={(row) => observed.push(`select:${row.id}`)}
        getDisclosure={(row) =>
          row.id === "a"
            ? { label: "Open boiler", onOpen: () => observed.push("disclose:a") }
            : undefined}
        contextSelection={context
          ? {
            labels: { selected: "Dans le contexte", unselected: "Hors contexte" },
            onToggle: (row) => {
              observed.push(`toggle:${row.id}`);
              acknowledge = () => {
                if (!selected.delete(row.id)) selected.add(row.id);
                draw();
              };
            },
            onAdd: (rows) => {
              observed.push(`add:${rows.map((row) => row.id).join(",")}`);
              acknowledge = () => {
                for (const row of rows) selected.add(row.id);
                draw();
              };
            },
          }
          : undefined}
        columns={[
          { id: "name", label: "Name", render: (row) => row.name },
          {
            id: "balance",
            label: "Balance",
            align: "right",
            render: (row) =>
              row.id === "a"
                ? <button type="button" onClick={() => observed.push("nested:button")}>Pay</button>
                : row.id === "b"
                ? <span role="button" onClick={() => observed.push("nested:role")}>Adjust</span>
                : row.balance,
          },
        ]}
      />,
      root,
    );
  }
  const dispatch = (element: EventTarget, type: string, fields: Record<string, unknown> = {}) =>
    element.dispatchEvent(Object.assign(
      new dom.Event(type, {
        bubbles: true,
        cancelable: true,
      }),
      fields,
    ) as unknown as Event);
  const click = (element: Element, detail = 1) => dispatch(element, "click", { detail });
  const key = (element: Element, key: string, shiftKey = false) =>
    dispatch(element, "keydown", { key, shiftKey });
  const pointer = (element: EventTarget, type: string, clientX: number, clientY: number) =>
    dispatch(element, type, {
      button: 0,
      clientX,
      clientY,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    });
  const read = () => observed.splice(0);
  const settleClick = () => new Promise((resolve) => setTimeout(resolve, 520));
  const description = (row: Element) => {
    const id = row.getAttribute("aria-describedby");
    return id ? dom.document.getElementById(id)?.textContent?.trim() : undefined;
  };
  const marks = () => [...root.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const outline = () => root.querySelectorAll('tr[data-mcp-view-context-row="selected"]').length;
  try {
    draw();
    const tbody = root.querySelector("tbody")!;
    const [a, b, c] = marks();
    const first = a.querySelector("td")!;
    const second = b.querySelector("td")!;
    await test.step("uses its existing cells and controlled selection state", async () => {
      assertEquals(root.querySelectorAll("thead th").length, 2);
      assertEquals(marks().map((row) => row.cells?.length ?? row.querySelectorAll("td").length), [
        2,
        2,
        2,
      ]);
      assertEquals(b.getAttribute("aria-keyshortcuts"), "Shift+Space");
      assertEquals(outline(), 0);
      click(first);
      await settleClick();
      assertEquals(read(), ["disclose:a"]);
      click(second);
      click(second, 2);
      assertEquals(read(), ["toggle:b"]);
      assertEquals(description(b), "Hors contexte");
      assertEquals(outline(), 0);
      acknowledge?.();
      assertEquals(description(b), "Dans le contexte");
      assertEquals(b.getAttribute("aria-selected"), "true");
      assertEquals(outline(), 1);
      assertEquals(b.classList.contains("mcp-view-selected"), false);
      key(b, "Enter");
      assertEquals(read(), ["select:b"]);
    });
    await test.step("row clicks followed by explicit activation open once", async () => {
      const chevron = a.querySelector(".mcp-view-table-disclosure")!;
      click(first);
      // Linkedom runs ancestor capture listeners while bubbling. Deliver
      // this event to that listener even though the button stops bubbling
      // in the browser, after the real ancestor capture phase.
      dispatch(chevron, "click", { detail: 0, stopPropagation() {} });
      assertEquals(read(), ["disclose:a"]);
      await settleClick();
      assertEquals(read(), []);
      click(second);
      key(b, "Enter");
      assertEquals(read(), ["select:b"]);
      await settleClick();
      assertEquals(read(), []);
    });
    await test.step("leaves explicit and nested controls independent", () => {
      click(a.querySelector(".mcp-view-table-disclosure")!, 0);
      const inner = a.querySelector("button:not(.mcp-view-table-disclosure)")!;
      click(inner);
      click(inner, 2);
      click(b.querySelector('[role="button"]')!);
      assertEquals(read(), ["disclose:a", "nested:button", "nested:button", "nested:role"]);
      assertEquals(outline(), 1);
    });
    await test.step("adds a rectangle as one callback and toggles in place with Shift+Space", () => {
      tbody.getBoundingClientRect = () => box(0, 0, 280, 120) as DOMRect;
      for (const [index, row] of [a, b, c].entries()) {
        row.getBoundingClientRect = () => box(0, index * 40, 280, 40) as DOMRect;
      }
      pointer(first, "pointerdown", 10, 10);
      pointer(dom.document as unknown as Document, "pointermove", 50, 65);
      pointer(dom.document as unknown as Document, "pointerup", 50, 65);
      assertEquals(read(), ["add:a,b"]);
      assertEquals(outline(), 1);
      acknowledge?.();
      assertEquals(outline(), 2);
      key(b, " ", true);
      assertEquals(read(), ["toggle:b"]);
      assertEquals(outline(), 2);
      acknowledge?.();
      assertEquals(outline(), 1);
    });
    await test.step("rectangle respects a top-sticky header and keeps the exposed row", () => {
      const head = root.querySelector("thead")!;
      head.getBoundingClientRect = () => box(0, 0, 280, 60) as DOMRect;
      const window = head.ownerDocument.defaultView!;
      const previousStyle = window.getComputedStyle;
      window.getComputedStyle = (element) =>
        ({
          position: element === head ? "sticky" : "static",
          top: element === head ? "0px" : "auto",
          visibility: "visible",
        }) as CSSStyleDeclaration;
      try {
        pointer(second, "pointerdown", 10, 70);
        pointer(dom.document as unknown as Document, "pointermove", 150, 0);
        pointer(dom.document as unknown as Document, "pointerup", 150, 0);
        assertEquals(read(), ["add:b"]);
      } finally {
        window.getComputedStyle = previousStyle;
      }
    });
    await test.step("omitting the opt-in restores the existing selection and disclosure routes", () => {
      draw(false);
      assertEquals(root.querySelectorAll("[data-visual-item]").length, 0);
      assertEquals(outline(), 0);
      assert(a.classList.contains("mcp-view-selected"));
      const tabIndex = (row: Element) =>
        Array.from(row.attributes).find(({ name }) => name.toLowerCase() === "tabindex")?.value;
      assertEquals(tabIndex(a), undefined);
      assertEquals(tabIndex(b), "0");
      click(a);
      click(b);
      key(b, " ");
      assertEquals(read(), ["disclose:a", "select:b", "select:b"]);
    });
  } finally {
    render(null, root);
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousDOMRect) Object.defineProperty(globalThis, "DOMRect", previousDOMRect);
    else Reflect.deleteProperty(globalThis, "DOMRect");
  }
});
