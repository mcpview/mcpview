import { App, applyDocumentTheme, applyHostStyleVariables } from "@modelcontextprotocol/ext-apps";
import {
  getPanelControlsCss,
  installPanelMovement,
  installPanelResizing,
} from "../../../src/code-mode/board.ts";
import { getLayoutCss } from "../../../src/host/renderer/css/layouts.ts";
import { mountCad } from "./cad.ts";
import { composeResult, type Panel, record, stackedLayout } from "./panels.ts";

const root = document.querySelector<HTMLElement>("#board")!;
const layoutStyle = document.createElement("style");
document.head.append(layoutStyle);
let mounted: AbortController | undefined;
let numberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function node<K extends keyof HTMLElementTagNameMap>(tag: K, label?: string) {
  const element = document.createElement(tag);
  if (label !== undefined) element.textContent = label;
  return element;
}

function display(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return numberFormat.format(value);
  }
  if (typeof value === "string" && value.length) return value;
}

function unit(value: unknown, symbol: string): string | undefined {
  const formatted = display(value);
  return formatted === undefined ? undefined : `${formatted} ${symbol}`;
}

function dataList(
  entries: Array<[string, string | undefined]>,
  className?: string,
) {
  const list = node("dl");
  if (className) list.className = className;
  for (const [name, value] of entries) {
    if (value === undefined) continue;
    const item = node("div");
    item.append(node("dt", name), node("dd", value));
    list.append(item);
  }
  return list;
}

function details(label: string, list: HTMLElement) {
  const element = node("details");
  element.append(node("summary", label), list);
  return element;
}

// Open the secondary information when its own panel has room. A reader's
// explicit choice takes precedence for the lifetime of this result.
function adaptiveDetails(label: string, list: HTMLElement, signal: AbortSignal) {
  const element = details(label, list);
  let pending = 0;
  const observer = new ResizeObserver(([entry]) => {
    const open = entry.contentRect.width >= 400;
    cancelAnimationFrame(pending);
    if (element.open !== open) {
      pending = requestAnimationFrame(() => {
        element.open = open;
      });
    }
  });
  function stop() {
    observer.disconnect();
    cancelAnimationFrame(pending);
  }
  observer.observe(element);
  element.querySelector("summary")!.addEventListener("click", stop, { once: true, signal });
  signal.addEventListener("abort", stop, { once: true });
  return element;
}

function button(label: string, action: () => void) {
  const control = node("button", label);
  control.type = "button";
  control.addEventListener("click", action);
  return control;
}

function notice(parent: HTMLElement, message: string) {
  const text = node("p", message);
  text.className = "notice";
  text.setAttribute("role", "status");
  parent.replaceChildren(text);
}

function dimensions(metrics: Record<string, unknown>): string | undefined {
  const { size } = record(metrics.bounding_box_mm);
  if (
    !Array.isArray(size) || size.length !== 3 ||
    size.some((value) => typeof value !== "number")
  ) {
    return;
  }
  return `${size.map((value) => numberFormat.format(value)).join(" × ")} mm`;
}

function nativeText(result: Record<string, unknown>): string {
  const { content } = result;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    const content = record(block);
    return content.type === "text" && typeof content.text === "string" ? [content.text] : [];
  }).join("\n");
}

async function renderCad(panel: Panel, body: HTMLElement, signal: AbortSignal) {
  const data = panel.data;
  const metrics = record(data.metrics);
  const viewport = node("div");
  viewport.className = "viewport";
  const controls = node("div");
  controls.className = "controls";
  const stl = (data.files as unknown[]).find((file) => record(file).format === "stl");
  const hash = display(record(record(stl).artifact).sha256);
  const stats = dataList([
    ["Bounds", dimensions(metrics)],
    ["Volume", unit(metrics.volume_mm3, "mm³")],
  ], "metrics");
  const measurements = adaptiveDetails("Mesh measurements", stats, signal);
  measurements.className = "mesh-measurements";
  body.append(viewport, controls, measurements);
  if (hash) {
    body.append(details("Mesh identity", dataList([["STL SHA-256", hash]])));
  }

  const { pilotGlbBase64 } = record(panel.result._meta);
  if (typeof pilotGlbBase64 !== "string" || !pilotGlbBase64) {
    notice(viewport, "The CAD result did not include a 3D snapshot.");
    return;
  }
  const canvas = node("canvas");
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "3D CAD geometry. Drag or use arrow keys to rotate.",
  );
  viewport.append(canvas);
  try {
    const scene = await mountCad(canvas, pilotGlbBase64, signal);
    const zoomIn = button("+", () => scene.scaleZoom(1.2));
    zoomIn.setAttribute("aria-label", "Zoom in");
    const zoomOut = button("−", () => scene.scaleZoom(1 / 1.2));
    zoomOut.setAttribute("aria-label", "Zoom out");
    const wire = button("Wireframe", () => {
      const active = wire.getAttribute("aria-pressed") !== "true";
      wire.setAttribute("aria-pressed", String(active));
      scene.setWireframe(active);
    });
    wire.setAttribute("aria-pressed", "false");
    controls.append(zoomIn, zoomOut, wire, button("Reset view", scene.reset));
  } catch (error) {
    if (!signal.aborted) {
      console.error("CAD snapshot could not be displayed", error);
      notice(viewport, "The 3D snapshot could not be displayed.");
    }
  }
}

function renderSlice(panel: Panel, body: HTMLElement, signal: AbortSignal) {
  const data = panel.data;
  const config = record(record(data.effective_config_summary).values);
  const primary = node("div");
  primary.className = "print-time";
  primary.append(
    node("span", "Estimated print time"),
    node(
      "strong",
      display(data.print_time_normal_mode) ?? unit(data.print_time_s, "s") ??
        "—",
    ),
  );
  const settings = dataList([
    ["Printer", display(config.printer_settings_id)],
    ["Material", display(config.filament_type)],
    ["Layer height", unit(config.layer_height, "mm")],
    ["Infill", display(config.fill_density)],
    ["Silent mode time", display(data.print_time_silent_mode)],
    ["Filament volume", unit(data.filament_volume_mm3, "mm³")],
    [
      "Engine",
      [display(data.engine_name), display(data.engine_version)].filter(Boolean)
        .join(" ") ||
      undefined,
    ],
  ]);
  const hashes = dataList([
    ["STL SHA-256", display(record(data.stl_artifact).sha256)],
    ["Profile SHA-256", display(record(data.profile_artifact).sha256)],
    ["G-code SHA-256", display(data.gcode_sha256)],
  ]);
  body.append(
    primary,
    dataList([
      ["Filament length", unit(data.filament_length_mm, "mm")],
      ["Filament mass", unit(data.filament_mass_g, "g")],
    ], "metrics"),
  );
  if (settings.children.length) body.append(adaptiveDetails("Print settings", settings, signal));
  if (hashes.children.length) {
    body.append(details("Input and output identities", hashes));
  }
}

function renderPanel(panel: Panel, slot: number, signal: AbortSignal) {
  const section = node("section");
  section.className = "panel";
  section.dataset.composePanel = "";
  section.dataset.panelLabel = panel.title;
  section.dataset.area = `panel${slot}`;
  const header = node("header");
  const grip = node("button");
  grip.type = "button";
  grip.dataset.composeGrip = "";
  grip.setAttribute("aria-label", `Move ${panel.title}`);
  header.append(
    node("h1", panel.title),
    node("p", `${panel.provider} / ${panel.name}`),
  );
  const body = node("div");
  body.className = "panel-body";
  section.append(grip, header, body);
  if (panel.result.isError) {
    notice(body, nativeText(panel.result) || "The provider reported an error.");
  } else if (panel.adapter === "cad") {
    void renderCad(panel, body, signal);
  } else if (panel.adapter === "slice") {
    renderSlice(panel, body, signal);
  } else {
    notice(
      body,
      nativeText(panel.result) ||
        "The snippet returned no displayable summary.",
    );
  }
  return section;
}

function render(result: unknown) {
  mounted?.abort();
  mounted = new AbortController();
  const descriptor = composeResult(result);
  const count = descriptor.children.length;
  if (!count) {
    notice(
      root,
      nativeText(record(result)) ||
        "The workflow did not attach any panel results.",
    );
    return;
  }
  layoutStyle.textContent = `
    ${getPanelControlsCss()}
    ${getLayoutCss(descriptor.layout)}
    @media (max-width: 620px) {
      ${getLayoutCss(stackedLayout(count))}
    }
    .layout-areas { height: auto; grid-template-rows: auto; padding: 0; }
  `;
  const board = node("div");
  board.className = "layout-areas";
  board.dataset.composeBoard = "";
  board.dataset.composeIntrinsic = "";
  for (const child of descriptor.children) {
    const panel = { ...record(child.context?.panel), ...record(child.context?.view) } as Panel;
    const section = renderPanel(panel, child.slot, mounted.signal);
    if (child.supportedWidths?.length) {
      section.dataset.composeWidths = child.supportedWidths.join(" ");
    }
    board.append(section);
  }
  root.replaceChildren(board);
  installPanelMovement(board, mounted.signal);
  installPanelResizing(board, mounted.signal);
}

const app = new App({ name: "CAD and print estimate", version: "0.1.0" });
function updateHostContext(context: ReturnType<typeof app.getHostContext>) {
  if (context?.theme) applyDocumentTheme(context.theme);
  if (context?.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }
  if (context?.locale) {
    try {
      numberFormat = new Intl.NumberFormat(context.locale, {
        maximumFractionDigits: 2,
      });
    } catch {
      // A host locale may not be accepted by this browser.
    }
  }
}
app.ontoolresult = render;
app.onhostcontextchanged = updateHostContext;
app.onteardown = () => {
  mounted?.abort();
  return Promise.resolve({});
};
app.connect().then(() => updateHostContext(app.getHostContext())).catch(() => {
  notice(root, "Could not connect to the MCP Apps host.");
});
