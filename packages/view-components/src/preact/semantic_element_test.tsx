/** @jsxImportSource preact */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { render } from "preact";
import type { ComposedSemanticRef } from "@mcpview/contracts";
import {
  CollectionCard,
  ElementBody,
  ElementIdent,
  ElementLimit,
  ElementProvenance,
  ElementReading,
  ElementSection,
  ElementVerdict,
  SemanticElement,
  type SemanticElementDensity,
  SemanticList,
} from "./semantic-element.tsx";

const REFERENCE: ComposedSemanticRef = Object.freeze({
  domain: "simulation",
  kind: "metric",
  id: "temperature.outlet",
  basisFingerprint: "a".repeat(64),
});

Deno.test({
  name: "SemanticList groups row objects without inventing ordering semantics",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticList label="Simulation runs" scrollable>
          <SemanticElement
            reference={REFERENCE}
            density="row"
            ident={<ElementIdent label="Run A" />}
          />
          <SemanticElement
            reference={{ ...REFERENCE, id: "temperature.return" }}
            density="row"
            ident={<ElementIdent label="Run B" />}
          />
        </SemanticList>,
        root,
      );
      const list = root.firstElementChild;
      assertEquals(list?.getAttribute("role"), "group");
      assertEquals(list?.getAttribute("aria-label"), "Simulation runs");
      assertEquals(list?.getAttribute("data-scrollable"), "true");
      assertEquals(list?.querySelectorAll(".mcp-view-semantic-element").length, 2);
    });
  },
});

Deno.test({
  name: "ElementSection names one titled group inside the body",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticElement
          reference={REFERENCE}
          density="card"
          ident={<ElementIdent label="Run A" />}
          body={
            <ElementBody>
              <ElementSection title="Execution">
                <span>ngspice 44</span>
              </ElementSection>
              <ElementSection title="Provenance">
                <span>bench-rc@r4</span>
              </ElementSection>
            </ElementBody>
          }
        />,
        root,
      );
      const sections = root.querySelectorAll(".mcp-view-element-body .mcp-view-element-section");
      assertEquals(sections.length, 2);
      assertEquals(sections[0].getAttribute("aria-label"), "Execution");
      // A group, not a landmark: sections nest inside cards that may be controls.
      assertEquals(sections[0].tagName.toLowerCase(), "div");
      assertEquals(sections[0].getAttribute("role"), "group");
      assertEquals(sections[0].getAttribute("data-element-slot"), "section");
      assertEquals(
        sections[0].querySelector(".mcp-view-element-section-title")?.textContent,
        "Execution",
      );
      assertEquals(sections[1].textContent, "Provenancebench-rc@r4");
    });
  },
});

Deno.test({
  name: "an empty readings list renders no strip",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticElement
          reference={REFERENCE}
          density="card"
          ident={<ElementIdent label="Run A" />}
          reading={[]}
        />,
        root,
      );
      assertEquals(root.querySelector(".mcp-view-element-readings"), null);
    });
  },
});

Deno.test({
  name: "CollectionCard hosts a SemanticList inside one Card",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <CollectionCard
          label="Simulation runs"
          eyebrow="MCP / TEST"
          title="Runs"
          actions={<span>3</span>}
          scrollable
          className="domain-collection"
        >
          <SemanticElement
            reference={REFERENCE}
            density="row"
            ident={<ElementIdent label="Run A" />}
          />
        </CollectionCard>,
        root,
      );

      const card = root.firstElementChild;
      assertEquals(card?.tagName.toLowerCase(), "section");
      assertEquals(card?.classList.contains("mcp-view-card"), true);
      assertEquals(card?.classList.contains("mcp-view-collection-card"), true);
      assertEquals(card?.classList.contains("domain-collection"), true);
      assertEquals(root.querySelectorAll(".mcp-view-card").length, 1);
      assertEquals(root.querySelector(".mcp-view-card-eyebrow")?.textContent, "MCP / TEST");
      assertEquals(root.querySelector(".mcp-view-card-title")?.textContent, "Runs");
      assertEquals(root.querySelector(".mcp-view-card-actions")?.textContent, "3");

      const list = card?.querySelector(":scope > .mcp-view-semantic-list");
      assertEquals(list?.parentElement, card);
      assertEquals(list?.getAttribute("role"), "group");
      assertEquals(list?.getAttribute("aria-label"), "Simulation runs");
      assertEquals(list?.getAttribute("data-scrollable"), "true");
      assertEquals(root.querySelectorAll(".mcp-view-semantic-list").length, 1);
      assertEquals(list?.querySelectorAll(".mcp-view-semantic-element").length, 1);
    });
  },
});

Deno.test({
  name: "SemanticElement owns explicit selection presentation and accessible state",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticElement
          reference={REFERENCE}
          density="row"
          selected
          activationLabel="Select run"
          ident={<ElementIdent label="Run A" />}
          onActivate={() => {}}
        />,
        root,
      );
      const interactive = root.firstElementChild;
      assertEquals(interactive?.getAttribute("data-selected"), "true");
      assertEquals(interactive?.getAttribute("aria-pressed"), "true");
      assertEquals(interactive?.classList.contains("mcp-view-selected"), true);

      render(
        <SemanticElement
          reference={REFERENCE}
          density="chip"
          selected
          ident={<ElementIdent label="Run A" />}
        />,
        root,
      );
      const passive = root.firstElementChild;
      assertEquals(passive?.getAttribute("aria-current"), "true");
      assertEquals(passive?.hasAttribute("aria-pressed"), false);
    });
  },
});

Deno.test({
  name: "SemanticElement preserves one semantic identity across chip row and card densities",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      const densities: readonly SemanticElementDensity[] = ["chip", "row", "card"];
      for (const density of densities) {
        render(
          <SemanticElement
            reference={REFERENCE}
            density={density}
            ident={<ElementIdent marker="T" label="Outlet temperature" detail="Sensor T-04" />}
            reading={<ElementReading label="Reading" value="94" unit="°C" />}
            body={<ElementBody>bounded provider content</ElementBody>}
            provenance={<ElementProvenance label="Basis" value="run-42" />}
          />,
          root,
        );

        const element = root.firstElementChild;
        assertEquals(element?.getAttribute("data-density"), density);
        assertEquals(element?.getAttribute("data-semantic-domain"), REFERENCE.domain);
        assertEquals(element?.getAttribute("data-semantic-kind"), REFERENCE.kind);
        assertEquals(element?.getAttribute("data-semantic-id"), REFERENCE.id);
        assertEquals(
          element?.getAttribute("data-basis-fingerprint"),
          REFERENCE.basisFingerprint,
        );
        assertEquals(element?.hasAttribute("data-tone"), false);
        assertEquals(element?.hasAttribute("style"), false);
        assertEquals(
          root.querySelector("[data-element-slot=ident]")?.textContent,
          "TOutlet temperatureSensor T-04",
        );
        // Readings sit in one strip so card density can lay them out as tiles.
        const readings = root.querySelector(
          ":scope > .mcp-view-semantic-element > .mcp-view-element-readings",
        );
        assertEquals(readings?.getAttribute("data-element-slot"), "readings");
        assertEquals(
          readings?.querySelector(":scope > [data-element-slot=reading]")?.textContent,
          "Reading94°C",
        );
        assertEquals(
          root.querySelector("[data-element-slot=body]")?.textContent,
          "bounded provider content",
        );
        assertEquals(root.querySelector("[data-element-slot=verdict]"), null);
        assertEquals(
          root.querySelector("[data-element-slot=provenance]")?.textContent,
          "Basisrun-42",
        );
      }
    });
  },
});

Deno.test({
  name: "ElementLimit renders only the caller-declared bound",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticElement
          reference={{ domain: "requirements", kind: "requirement", id: "force.max" }}
          density="row"
          ident={<ElementIdent label="Maximum force" />}
          reading={
            <ElementLimit
              label="Authored limit"
              operator="≤"
              value="35"
              unit="N"
              detail="declared"
            />
          }
        />,
        root,
      );

      const element = root.firstElementChild;
      const limit = root.querySelector(".mcp-view-element-limit");
      assertEquals(limit?.getAttribute("data-element-slot"), "reading");
      assertEquals(limit?.textContent, "Authored limit≤35Ndeclared");
      assertEquals(element?.hasAttribute("data-tone"), false);
      assertEquals(root.querySelector(".mcp-view-limit-gauge"), null);
      assertEquals(root.querySelector("meter"), null);
    });
  },
});

Deno.test({
  name: "SemanticElement renders only caller supplied reading unit verdict and tone",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root) => {
      render(
        <SemanticElement
          reference={{ domain: "cad", kind: "artifact", id: "part.step" }}
          density="card"
          tone="warning"
          ident={<ElementIdent label="Bracket" />}
          reading={<ElementReading value="12.5" />}
          verdict={<ElementVerdict label="Review" value="Provisional" />}
        />,
        root,
      );

      const element = root.firstElementChild;
      assertEquals(element?.getAttribute("data-tone"), "warning");
      assertStringIncludes(
        element?.getAttribute("style") ?? "",
        "border-inline-start:var(--mcp-view-semantic-verdict-border-width, 3px) solid var(--mcp-view-warning, currentColor)",
      );
      assertEquals(root.querySelector(".mcp-view-element-reading-unit"), null);
      assertEquals(
        root.querySelector("[data-element-slot=verdict]")?.textContent,
        "ReviewProvisional",
      );
      assertEquals(root.querySelector("[data-element-slot=provenance]"), null);
    });
  },
});

Deno.test({
  name: "SemanticElement activation is opt-in and keyboard accessible",
  permissions: { read: true, env: true, run: true },
  async fn() {
    await withDom((root, window) => {
      const activated: ComposedSemanticRef[] = [];
      render(
        <SemanticElement
          reference={REFERENCE}
          density="row"
          activationLabel="Open outlet temperature"
          ident={<ElementIdent label="Outlet temperature" />}
          onActivate={(reference) => activated.push(reference)}
        />,
        root,
      );

      const element = root.firstElementChild as HTMLElement;
      assertEquals(element.getAttribute("role"), "button");
      // Linkedom preserves Preact's property spelling; browsers normalize it to tabindex.
      assertEquals(element.getAttribute("tabIndex"), "0");
      assertEquals(element.getAttribute("aria-label"), "Open outlet temperature");
      assertEquals(element.getAttribute("data-interactive"), "true");

      element.dispatchEvent(new window.Event("click", { bubbles: true }));
      dispatchKey(window, element, "Enter");
      dispatchKey(window, element, " ");
      dispatchKey(window, element, "Escape");
      assertEquals(activated, [REFERENCE, REFERENCE, REFERENCE]);

      render(
        <SemanticElement
          reference={REFERENCE}
          density="chip"
          ident={<ElementIdent label="Outlet temperature" />}
        />,
        root,
      );
      const passive = root.firstElementChild;
      assertEquals(passive?.hasAttribute("role"), false);
      assertEquals(passive?.hasAttribute("tabindex"), false);
      assertEquals(passive?.hasAttribute("data-interactive"), false);
    });
  },
});

async function withDom(
  run: (root: HTMLElement, window: Window & typeof globalThis) => void | Promise<void>,
): Promise<void> {
  const documentModule = await import("npm:linkedom@0.18.12");
  const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: dom.document,
  });
  try {
    const root = dom.document.getElementById("root") as unknown as HTMLElement;
    await run(root, dom.window as unknown as Window & typeof globalThis);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
}

function dispatchKey(
  window: Window & typeof globalThis,
  target: HTMLElement,
  key: string,
): void {
  const event = new window.Event("keydown", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "key", { configurable: true, value: key });
  target.dispatchEvent(event);
}
