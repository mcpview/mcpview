/** @jsxImportSource preact */

import { assertEquals, assertThrows } from "@std/assert";
import { render } from "preact";
import {
  ArtifactRow,
  DrillHint,
  LimitGauge,
  PathBar,
  Slot3D,
  StaleBanner,
  TreeList,
  TypeBadge,
} from "./structural.tsx";

Deno.test({
  name: "PathBar exposes controlled, accessible local navigation",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const selected: string[] = [];
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const items = [
        { id: "project", label: "Project" },
        { id: "thread", label: "Thread" },
        { id: "artifact", label: "Artifact" },
      ];
      render(
        <PathBar
          label="Recorded evidence path"
          items={items}
          currentId="artifact"
          onSelect={(id) => selected.push(id)}
        />,
        root,
      );

      assertEquals(root.querySelector("nav")?.getAttribute("aria-label"), "Recorded evidence path");
      assertEquals(root.querySelectorAll("ol > li").length, 3);
      assertEquals(root.querySelector("[aria-current=page]")?.textContent, "Artifact");
      assertEquals(root.querySelectorAll("button").length, 2);
      (root.querySelector("button") as unknown as HTMLButtonElement).click();
      assertEquals(selected, ["project"]);

      render(
        <PathBar
          label="Recorded evidence path"
          items={items}
          currentId="thread"
          onSelect={(id) => selected.push(id)}
        />,
        root,
      );
      assertEquals(root.querySelector("[aria-current=page]")?.textContent, "Thread");
      assertEquals(selected, ["project"]);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "LimitGauge renders only caller-supplied status on one finite meter",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <LimitGauge
          label="Minimum thickness"
          min={0}
          max={2}
          value={0.84}
          valueLabel="0.84 mm"
          statusLabel="Recorded outside limit"
          tone="danger"
          limit={{ value: 1.2, label: "Recorded limit 1.20 mm" }}
        />,
        root,
      );

      const meter = root.querySelector("meter");
      assertEquals(meter?.getAttribute("aria-label"), "Minimum thickness");
      assertEquals(meter?.getAttribute("aria-valuetext"), "0.84 mm; Recorded outside limit");
      assertEquals(meter?.getAttribute("min"), "0");
      assertEquals(meter?.getAttribute("max"), "2");
      assertEquals(meter?.getAttribute("value"), "0.84");
      assertEquals(root.firstElementChild?.getAttribute("data-tone"), "danger");
      assertEquals(
        root.querySelector(".mcp-view-limit-gauge-status")?.textContent,
        "Recorded outside limit",
      );
      assertEquals(
        root.querySelector(".mcp-view-limit-gauge-limit")?.textContent,
        "Recorded limit 1.20 mm",
      );
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("LimitGauge rejects non-finite or incoherent scales", () => {
  const valid = {
    label: "Envelope",
    min: 0,
    max: 100,
    value: 57,
    valueLabel: "57 %",
    statusLabel: "Recorded nominal",
    tone: "success" as const,
  };
  assertThrows(() => LimitGauge({ ...valid, min: Number.NaN }), TypeError, "finite");
  assertThrows(() => LimitGauge({ ...valid, max: Number.POSITIVE_INFINITY }), TypeError, "finite");
  assertThrows(() => LimitGauge({ ...valid, max: 0 }), RangeError, "greater than min");
  assertThrows(() => LimitGauge({ ...valid, value: 101 }), RangeError, "within min and max");
  assertThrows(
    () => LimitGauge({ ...valid, limit: { value: Number.NaN, label: "limit" } }),
    TypeError,
    "limit must be finite",
  );
});

Deno.test({
  name: "ArtifactRow becomes a button only with an explicit callback",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const base = {
        label: "Module geometry",
        kind: "GLB",
        uri: "casys://build123d/artifacts/a.glb",
        fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
        sizeLabel: "6,336 bytes",
        verification: { label: "Digest verified by host", tone: "success" as const },
      };
      render(<ArtifactRow {...base} />, root);

      assertEquals(root.querySelectorAll("article").length, 1);
      assertEquals(root.querySelectorAll("button").length, 0);
      assertEquals(
        root.querySelector(".mcp-view-artifact-row-verification")?.textContent,
        "Digest verified by host",
      );
      assertEquals(root.textContent?.includes("rehash"), false);

      let activations = 0;
      render(
        <ArtifactRow
          {...base}
          actionLabel="Open recorded module geometry"
          onActivate={() => activations++}
        />,
        root,
      );
      const button = root.querySelector("button") as unknown as HTMLButtonElement;
      assertEquals(root.querySelectorAll("article").length, 0);
      assertEquals(button.getAttribute("type"), "button");
      assertEquals(button.getAttribute("aria-label"), "Open recorded module geometry");
      button.click();
      assertEquals(activations, 1);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "PathBar renders null when the path has only one item",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <PathBar
          label="Path"
          items={[{ id: "only", label: "Only" }]}
          currentId="only"
          onSelect={() => {}}
        />,
        root,
      );
      assertEquals(root.querySelector("nav"), null);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "PathBar renders a back button that selects the previous item when backLabel is provided",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const selected: string[] = [];
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const items = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ];

      // Without backLabel: no back button
      render(
        <PathBar label="Path" items={items} currentId="c" onSelect={(id) => selected.push(id)} />,
        root,
      );
      assertEquals(root.querySelector("button[aria-label]"), null);

      // With backLabel and current at index 2: back button selects index 1 ("b")
      render(
        <PathBar
          label="Path"
          items={items}
          currentId="c"
          onSelect={(id) => selected.push(id)}
          backLabel="Go back"
        />,
        root,
      );
      const back = root.querySelector("button[aria-label='Go back']");
      assertEquals(back !== null, true);
      (back as unknown as HTMLButtonElement).click();
      assertEquals(selected, ["b"]);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "PathBar never collapses when collapsedLabel is absent regardless of path length",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const items = Array.from(
        { length: 10 },
        (_, i) => ({ id: `step-${i}`, label: `Step ${i}` }),
      );
      render(
        <PathBar label="Path" items={items} currentId="step-9" onSelect={() => {}} />,
        root,
      );
      assertEquals(root.querySelector("details"), null);
      assertEquals(root.querySelectorAll("ol > li").length, 10);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "PathBar collapses leading items under a details summary when collapsedLabel is given",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const items = [
        { id: "a", label: "Alpha", detail: "α snapshot" },
        { id: "b", label: "Beta", detail: "β snapshot" },
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
        { id: "e", label: "Epsilon" },
      ];
      render(
        <PathBar
          label="Path"
          items={items}
          currentId="e"
          onSelect={() => {}}
          maxVisible={3}
          collapsedLabel="Show earlier steps"
        />,
        root,
      );
      const details = root.querySelector("details");
      assertEquals(details !== null, true);
      const summary = details?.querySelector("summary");
      assertEquals(summary?.getAttribute("aria-label"), "Show earlier steps");
      // items a and b are collapsed (5 items − maxVisible 3 = 2 leading items)
      assertEquals(details?.querySelectorAll("button").length, 2);
      // collapsed items expose their detail
      assertEquals(details?.querySelector(".mcp-view-path-bar-kept-detail") !== null, true);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("PathBar rejects maxVisible that is not a positive integer", () => {
  const base = {
    label: "Path",
    items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    currentId: "b",
    onSelect: () => {},
  };
  assertThrows(() => PathBar({ ...base, maxVisible: 0 }), RangeError, "positive integer");
  assertThrows(() => PathBar({ ...base, maxVisible: 1.5 }), RangeError, "positive integer");
  assertThrows(() => PathBar({ ...base, maxVisible: -1 }), RangeError, "positive integer");
});

Deno.test({
  name: "DrillHint without onActivate degrades to a span with data-degraded and no glyph",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(<DrillHint label="More details" direction="in-view" />, root);
      assertEquals(root.querySelector("button"), null);
      assertEquals(
        root.querySelector(".mcp-view-drill-hint")?.getAttribute("data-degraded"),
        "true",
      );
      assertEquals(root.querySelector(".mcp-view-drill-hint-glyph"), null);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "DrillHint with onActivate renders a button with aria-label and a direction glyph",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const activations: string[] = [];
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <DrillHint
          label="Open model"
          direction="in-view"
          actionLabel="Drill into view"
          onActivate={() => activations.push("in-view")}
        />,
        root,
      );
      const btn = root.querySelector("button") as unknown as HTMLButtonElement;
      assertEquals(btn?.getAttribute("aria-label"), "Drill into view");
      assertEquals(
        root.querySelector("button")?.firstElementChild?.classList.contains(
          "mcp-view-disclosure-chevron",
        ),
        true,
      );
      btn.click();

      render(
        <DrillHint
          label="Open model"
          direction="to-model"
          actionLabel="Jump to model"
          onActivate={() => activations.push("to-model")}
        />,
        root,
      );
      assertEquals(root.querySelector(".mcp-view-drill-hint-glyph")?.textContent, "~");
      assertEquals(activations, ["in-view"]);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "TypeBadge renders the caller label and exposes data-kind",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(<TypeBadge kind="list" label="Requirement list" />, root);
      const badge = root.querySelector(".mcp-view-type-badge");
      assertEquals(badge?.getAttribute("data-kind"), "list");
      assertEquals(badge?.textContent, "Requirement list");
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "StaleBanner carries role=status by default and role=alert when tone is danger",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(<StaleBanner message="Values recorded 5 min ago" />, root);
      assertEquals(root.querySelector("[role=status]") !== null, true);
      assertEquals(root.querySelector("[role=alert]"), null);
      assertEquals(
        root.querySelector(".mcp-view-stale-banner-message")?.textContent,
        "Values recorded 5 min ago",
      );
      assertEquals(root.querySelector("button"), null);

      const activations: number[] = [];
      render(
        <StaleBanner
          message="Stale — connection lost"
          tone="danger"
          action={{ label: "Retry", onActivate: () => activations.push(1) }}
        />,
        root,
      );
      assertEquals(root.querySelector("[role=alert]") !== null, true);
      assertEquals(root.querySelector("[role=status]"), null);
      const actionBtn = root.querySelector("button") as unknown as HTMLButtonElement;
      assertEquals(actionBtn !== null, true);
      actionBtn.click();
      assertEquals(activations, [1]);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "Slot3D marks the area reserved with an aria-hidden mark and carries the status label",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(<Slot3D label="3D viewport" statusLabel="Awaiting geometry" />, root);
      assertEquals(root.querySelector("figure")?.getAttribute("data-reserved"), "true");
      assertEquals(
        root.querySelector(".mcp-view-slot-3d-mark")?.getAttribute("aria-hidden"),
        "true",
      );
      assertEquals(root.querySelector("figcaption")?.textContent, "Awaiting geometry");

      render(
        <Slot3D label="3D viewport" statusLabel="Geometry loaded">
          <canvas />
        </Slot3D>,
        root,
      );
      assertEquals(root.querySelector("figure")?.getAttribute("data-reserved"), null);
      assertEquals(root.querySelector(".mcp-view-slot-3d-mark"), null);
      assertEquals(root.querySelector("canvas") !== null, true);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "TreeList renders role=tree with treeitem depths and aria-expanded only on parent nodes",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const nodes = [
        { id: "parent", label: "Parent", children: [{ id: "child", label: "Child" }] },
        { id: "leaf", label: "Leaf" },
      ];
      render(
        <TreeList
          label="Requirements"
          nodes={nodes}
          expandedIds={["parent"]}
          onToggle={() => {}}
          toggleLabel="Toggle"
        />,
        root,
      );
      assertEquals(
        root.querySelector("[role=tree]")?.getAttribute("aria-label"),
        "Requirements",
      );
      const items = root.querySelectorAll("[role=treeitem]");
      assertEquals(items.length, 3);
      const [parentItem, childItem, leafItem] = Array.from(items);
      assertEquals(parentItem.getAttribute("aria-level"), "1");
      assertEquals(childItem.getAttribute("aria-level"), "2");
      assertEquals(leafItem.getAttribute("aria-level"), "1");
      assertEquals(parentItem.getAttribute("aria-expanded"), "true");
      assertEquals(childItem.getAttribute("aria-expanded"), null);
      assertEquals(leafItem.getAttribute("aria-expanded"), null);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "TreeList expansion is controlled exclusively by expandedIds",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const nodes = [
        { id: "parent", label: "Parent", children: [{ id: "child", label: "Child" }] },
      ];
      render(
        <TreeList
          label="Tree"
          nodes={nodes}
          expandedIds={[]}
          onToggle={() => {}}
          toggleLabel="Toggle"
        />,
        root,
      );
      assertEquals(root.querySelectorAll("[role=treeitem]").length, 1);
      render(
        <TreeList
          label="Tree"
          nodes={nodes}
          expandedIds={["parent"]}
          onToggle={() => {}}
          toggleLabel="Toggle"
        />,
        root,
      );
      assertEquals(root.querySelectorAll("[role=treeitem]").length, 2);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "TreeList twisty calls onToggle with the node id",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const toggled: string[] = [];
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      const nodes = [
        { id: "parent", label: "Parent", children: [{ id: "child", label: "Child" }] },
      ];
      render(
        <TreeList
          label="Tree"
          nodes={nodes}
          expandedIds={[]}
          onToggle={(id) => toggled.push(id)}
          toggleLabel="Expand"
        />,
        root,
      );
      const twisty = root.querySelector("button[aria-label='Expand']");
      (twisty as unknown as HTMLButtonElement).click();
      root.querySelector<HTMLElement>(".mcp-view-tree-list-row")!.click();
      assertEquals(toggled, ["parent", "parent"]);

      const selected: string[] = [];
      render(
        <TreeList
          label="Tree"
          nodes={nodes}
          expandedIds={[]}
          onToggle={(id) => toggled.push(id)}
          toggleLabel="Expand"
          onSelect={(id) => selected.push(id)}
        />,
        root,
      );
      root.querySelector<HTMLButtonElement>(".mcp-view-tree-list-label")!.click();
      assertEquals(selected, ["parent"]);
      assertEquals(toggled, ["parent", "parent"]);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "TreeList without onSelect renders the label as a span and omits aria-selected",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <TreeList
          label="Tree"
          nodes={[{ id: "n", label: "Node" }]}
          expandedIds={[]}
          onToggle={() => {}}
          toggleLabel="Toggle"
        />,
        root,
      );
      assertEquals(root.querySelectorAll("button").length, 0);
      assertEquals(root.querySelector("[aria-selected]"), null);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("TreeList rejects an empty node list and duplicate ids including across depths", () => {
  const base = {
    label: "Tree",
    expandedIds: [] as string[],
    onToggle: () => {},
    toggleLabel: "Toggle",
  };
  assertThrows(() => TreeList({ ...base, nodes: [] }), TypeError, "must not be empty");
  assertThrows(
    () => TreeList({ ...base, nodes: [{ id: "x", label: "A" }, { id: "x", label: "B" }] }),
    TypeError,
    "duplicated",
  );
  assertThrows(
    () =>
      TreeList({
        ...base,
        nodes: [{ id: "p", label: "P", children: [{ id: "p", label: "Child" }] }],
      }),
    TypeError,
    "duplicated",
  );
});
