/** @jsxImportSource preact */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { render } from "preact";
import type { JSX } from "preact";
import type { PresentationTone } from "./components.tsx";
import { MCP_VIEW_THEME_CSS } from "../theme.ts";
import { IntervalPlot, SeriesChart, Sparkline } from "./plots.tsx";

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

Deno.test({
  name: "Sparkline renders role=img with a combined aria-label and one polyline per sample",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <Sparkline
          label="Temperature"
          values={[10, 20, 15, 25]}
          summaryLabel="25 °C peak"
          tone="info"
        />,
        root,
      );

      const svg = root.querySelector("svg");
      assertEquals(svg?.getAttribute("role"), "img");
      assertEquals(svg?.getAttribute("aria-label"), "Temperature: 25 °C peak");
      const polyline = root.querySelector("polyline");
      assertEquals(polyline !== null, true);
      // Four values → four coordinate pairs in the points attribute
      const points = (polyline?.getAttribute("points") ?? "").trim().split(/\s+/);
      assertEquals(points.length, 4);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "Sparkline flat series produces finite coordinates without NaN",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(<Sparkline label="Flat" values={[7, 7, 7]} summaryLabel="7 constant" />, root);

      const pointsAttr = root.querySelector("polyline")?.getAttribute("points") ?? "";
      assertEquals(pointsAttr.includes("NaN"), false);
      // Three values → three coordinate pairs
      assertEquals(pointsAttr.trim().split(/\s+/).length, 3);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("Sparkline rejects fewer than two samples", () => {
  assertThrows(
    () => Sparkline({ label: "Empty", values: [], summaryLabel: "nothing" }),
    RangeError,
    "at least two",
  );
  assertThrows(
    () => Sparkline({ label: "One", values: [42], summaryLabel: "42" }),
    RangeError,
    "at least two",
  );
});

Deno.test("Sparkline rejects non-finite sample values", () => {
  assertThrows(
    () => Sparkline({ label: "NaN", values: [1, Number.NaN], summaryLabel: "bad" }),
    TypeError,
    "finite",
  );
  assertThrows(
    () => Sparkline({ label: "Inf", values: [1, Infinity], summaryLabel: "inf" }),
    TypeError,
    "finite",
  );
});

// ---------------------------------------------------------------------------
// SeriesChart
// ---------------------------------------------------------------------------

const BASE_SERIES = [
  {
    id: "pressure",
    label: "Pressure",
    mark: "line" as const,
    points: [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 15 },
    ],
    tone: "info" as const,
  },
];

Deno.test({
  name: "SeriesChart renders one polyline per series and omits baseline when zero is out of range",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <SeriesChart
          label="Pressure over time"
          series={BASE_SERIES}
          xMin={0}
          xMax={2}
          yMin={5}
          yMax={30}
        />,
        root,
      );

      assertEquals(root.querySelectorAll(".mcp-view-series-chart-line").length, 1);
      // Zero not in [5, 30] → no baseline
      assertEquals(root.querySelectorAll(".mcp-view-series-chart-baseline").length, 0);
      // No cursor → no readout
      assertEquals(root.querySelectorAll(".mcp-view-series-chart-readout").length, 0);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "SeriesChart baseline appears only when zero is within yMin and yMax",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <SeriesChart
          label="Delta"
          series={[{
            id: "delta",
            label: "Delta",
            mark: "line" as const,
            points: [{ x: 0, y: -5 }, { x: 1, y: 5 }],
          }]}
          xMin={0}
          xMax={1}
          yMin={-10}
          yMax={10}
        />,
        root,
      );

      assertEquals(root.querySelectorAll(".mcp-view-series-chart-baseline").length, 1);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test({
  name: "SeriesChart cursor renders a readout per entry, displaying the series label it names",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      render(
        <SeriesChart
          label="Pressure over time"
          series={BASE_SERIES}
          xMin={0}
          xMax={2}
          yMin={5}
          yMax={30}
          cursor={{
            x: 1,
            label: "t = 1 s",
            readouts: [{ seriesId: "pressure", valueLabel: "20 bar" }],
          }}
        />,
        root,
      );

      assertEquals(root.querySelectorAll(".mcp-view-series-chart-cursor").length, 1);
      assertEquals(root.querySelectorAll(".mcp-view-series-chart-readout").length, 1);
      assertEquals(
        root.querySelector(".mcp-view-series-chart-readout-position")?.textContent,
        "t = 1 s",
      );
      assertEquals(
        root.querySelector(".mcp-view-series-chart-readout-value dt")?.textContent,
        "Pressure",
      );
      assertEquals(
        root.querySelector(".mcp-view-series-chart-readout-value dd")?.textContent,
        "20 bar",
      );
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("SeriesChart rejects non-finite or incoherent bounds", () => {
  const valid = { label: "Chart", series: BASE_SERIES, xMin: 0, xMax: 2, yMin: 0, yMax: 30 };
  assertThrows(() => SeriesChart({ ...valid, xMin: NaN }), TypeError, "finite");
  assertThrows(() => SeriesChart({ ...valid, yMax: Infinity }), TypeError, "finite");
  assertThrows(() => SeriesChart({ ...valid, xMax: 0 }), RangeError, "greater than xMin");
  assertThrows(() => SeriesChart({ ...valid, yMax: 0 }), RangeError, "greater than yMin");
});

Deno.test("SeriesChart rejects empty series or duplicated series ids", () => {
  const bounds = { xMin: 0, xMax: 2, yMin: 0, yMax: 30 };
  assertThrows(
    () => SeriesChart({ label: "Empty", series: [], ...bounds }),
    TypeError,
    "series must not be empty",
  );
  assertThrows(
    () =>
      SeriesChart({
        label: "Dup",
        series: [
          { id: "a", label: "A", mark: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { id: "a", label: "A2", mark: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        ],
        ...bounds,
      }),
    TypeError,
    "duplicated",
  );
});

Deno.test("SeriesChart rejects series with fewer than two points", () => {
  assertThrows(
    () =>
      SeriesChart({
        label: "Short",
        series: [{ id: "s", label: "S", mark: "line", points: [{ x: 0, y: 0 }] }],
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      }),
    RangeError,
    "at least two points",
  );
});

Deno.test("SeriesChart rejects cursor outside xMin–xMax or readout naming an undeclared series", () => {
  const props = { label: "Chart", series: BASE_SERIES, xMin: 0, xMax: 2, yMin: 5, yMax: 30 };
  assertThrows(
    () => SeriesChart({ ...props, cursor: { x: 5, label: "t=5", readouts: [] } }),
    RangeError,
    "within xMin and xMax",
  );
  assertThrows(
    () =>
      SeriesChart({
        ...props,
        cursor: { x: 1, label: "t=1", readouts: [{ seriesId: "unknown", valueLabel: "0" }] },
      }),
    TypeError,
    "names no declared series",
  );
});

// ---------------------------------------------------------------------------
// IntervalPlot
// ---------------------------------------------------------------------------

const BASE_INTERVALS = [
  {
    id: "tolerance-a",
    label: "Tolerance A",
    lower: -0.05,
    upper: 0.05,
    lowerLabel: "−0.05 mm",
    upperLabel: "+0.05 mm",
    tone: "success" as const,
  },
];

Deno.test({
  name:
    "IntervalPlot renders one row per interval with percentage layout consistent with the scale",
  permissions: { read: true, env: true, run: true },
  async fn() {
    const documentModule = await import("npm:linkedom@0.18.12");
    const dom = documentModule.parseHTML("<html><body><div id=root></div></body></html>");
    const previousDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
    try {
      const root = dom.document.getElementById("root") as unknown as HTMLElement;
      // min=-0.1, max=0.1, lower=-0.05, upper=0.05
      // left = normalize(-0.05, -0.1, 0.1) * 100 = 25%
      // width = ((0.05 - -0.05) / 0.2) * 100 = 50%
      render(
        <IntervalPlot
          label="Dimensional tolerances"
          min={-0.1}
          max={0.1}
          zeroLabel="0 mm nominal"
          intervals={BASE_INTERVALS}
        />,
        root,
      );

      assertEquals(
        root.querySelector("[role=group]")?.getAttribute("aria-label"),
        "Dimensional tolerances",
      );
      assertEquals(root.querySelectorAll(".mcp-view-interval-plot-row").length, 1);
      const box = root.querySelector(".mcp-view-interval-plot-box");
      const styleAttr = box?.getAttribute("style") ?? "";
      assertEquals(styleAttr.includes("25%"), true);
      assertEquals(styleAttr.includes("50%"), true);
    } finally {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: previousDocument,
      });
    }
  },
});

Deno.test("IntervalPlot rejects non-finite bounds, inverted scale, or scale not containing zero", () => {
  const valid = { label: "Plot", min: -0.1, max: 0.1, zeroLabel: "0", intervals: BASE_INTERVALS };
  assertThrows(() => IntervalPlot({ ...valid, min: NaN }), TypeError, "finite");
  assertThrows(() => IntervalPlot({ ...valid, max: Infinity }), TypeError, "finite");
  assertThrows(() => IntervalPlot({ ...valid, max: -0.1 }), RangeError, "greater than min");
  assertThrows(() => IntervalPlot({ ...valid, min: 0.01, max: 0.1 }), RangeError, "contain zero");
});

Deno.test(
  "IntervalPlot rejects empty intervals, duplicated ids, inverted bounds, or out-of-range intervals",
  () => {
    const common = { label: "Plot", min: -0.1, max: 0.1, zeroLabel: "0" };
    assertThrows(
      () => IntervalPlot({ ...common, intervals: [] }),
      TypeError,
      "must not be empty",
    );
    assertThrows(
      () =>
        IntervalPlot({
          ...common,
          intervals: [{ ...BASE_INTERVALS[0], id: "x" }, { ...BASE_INTERVALS[0], id: "x" }],
        }),
      TypeError,
      "duplicated",
    );
    assertThrows(
      () =>
        IntervalPlot({
          ...common,
          intervals: [{
            id: "inv",
            label: "Inverted",
            lower: 0.05,
            upper: -0.05,
            lowerLabel: "",
            upperLabel: "",
          }],
        }),
      RangeError,
      "upper must not be below lower",
    );
    assertThrows(
      () =>
        IntervalPlot({
          ...common,
          intervals: [{
            id: "out",
            label: "Out of range",
            lower: -0.2,
            upper: 0.05,
            lowerLabel: "",
            upperLabel: "",
          }],
        }),
      RangeError,
      "within min and max",
    );
  },
);

Deno.test("SeriesChart reports pointer geometry and resolves no sample itself", () => {
  const base = {
    label: "Transient",
    xMin: 0,
    xMax: 10,
    yMin: -1,
    yMax: 5,
    series: [{
      id: "v",
      label: "v(out)",
      mark: "line",
      points: [{ x: 0, y: 0 }, { x: 10, y: 4.9 }],
    }],
  } as const;

  // Without a callback the chart installs no pointer handler at all.
  const inert = SeriesChart({ ...base });
  assertEquals(svgOf(inert).props.onPointerMove, undefined);
  assertEquals(svgOf(inert).props.onPointerLeave, undefined);

  const reported: (number | undefined)[] = [];
  const scrubbing = SeriesChart({ ...base, onScrub: (x) => reported.push(x) });
  const svg = svgOf(scrubbing);

  // A quarter of the way across a 200px box is a quarter of the declared scale.
  svg.props.onPointerMove(pointerAt(50, 200));
  assertEquals(reported, [2.5]);

  // Outside the box nothing is reported: the chart never extrapolates.
  svg.props.onPointerMove(pointerAt(-10, 200));
  svg.props.onPointerMove(pointerAt(260, 200));
  assertEquals(reported, [2.5]);

  // A collapsed box carries no usable geometry.
  svg.props.onPointerMove(pointerAt(50, 0));
  assertEquals(reported, [2.5]);

  // Leaving clears the position rather than freezing the last one.
  svg.props.onPointerLeave();
  assertEquals(reported, [2.5, undefined]);
});

// deno-lint-ignore no-explicit-any
function svgOf(vnode: any): any {
  const children = vnode.props.children;
  for (const child of (Array.isArray(children) ? children : [children]).flat()) {
    if (child?.type === "svg") return child;
    if (child?.props?.children) {
      const svg = svgOf(child);
      if (svg) return svg;
    }
  }
}

function pointerAt(clientX: number, width: number) {
  return {
    clientX,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width }) },
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("SeriesChart draws a bar series as one mark per sample and connects nothing", () => {
  const sparse = [{ x: 0, y: 2 }, { x: 3, y: 5 }, { x: 9, y: 1 }];
  const chart = SeriesChart({
    label: "Sparse readings",
    xMin: 0,
    xMax: 10,
    yMin: 0,
    yMax: 6,
    series: [{ id: "s", label: "Readings", mark: "bar", points: sparse }],
  });
  const svg = svgOf(chart);
  // deno-lint-ignore no-explicit-any
  const marks = (svg.props.children as any[]).flat().filter(Boolean);
  const group = marks.find((child) => child?.props?.class === "mcp-view-series-chart-bars");
  const line = marks.find((child) => child?.props?.class === "mcp-view-series-chart-line");

  // A sparse series must never be connected: a polyline would claim values
  // between two recorded samples that were never measured.
  assertEquals(line, undefined);
  assertEquals(group.props.children.length, sparse.length);
  for (const mark of group.props.children) {
    assertEquals(mark.props.x1, mark.props.x2, "each mark stands on its own sample");
  }
  assertEquals(group.props.children[0].props.x1, 0);
  assertEquals(group.props.children[2].props.x1, 90);

  // The same points declared as a line produce connected geometry instead.
  const connected = SeriesChart({
    label: "Sparse readings",
    xMin: 0,
    xMax: 10,
    yMin: 0,
    yMax: 6,
    series: [{ id: "s", label: "Readings", mark: "line", points: sparse }],
  });
  // deno-lint-ignore no-explicit-any
  const connectedMarks = (svgOf(connected).props.children as any[]).flat().filter(Boolean);
  assert(
    connectedMarks.some((child) => child?.props?.class === "mcp-view-series-chart-line"),
  );
});

async function withPlotDom(check: (root: HTMLElement) => void) {
  const { parseHTML } = await import("npm:linkedom@0.18.12");
  const { document } = parseHTML("<html><body><div id=root></div></body></html>");
  const previous = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  const root = document.getElementById("root") as unknown as HTMLElement;
  try {
    check(root);
  } finally {
    render(null, root);
    Object.defineProperty(globalThis, "document", { configurable: true, value: previous });
  }
}

const CHART_PROPS = {
  label: "Pressure history",
  series: BASE_SERIES,
  xMin: 0,
  xMax: 2,
  yMin: 5,
  yMax: 30,
};

Deno.test("SeriesChart legend names multiple series and can be suppressed", async () => {
  await withPlotDom((root) => {
    const series = [...BASE_SERIES, {
      ...BASE_SERIES[0],
      id: "other",
      label: "Other pressure",
      mark: "bar" as const,
    }];
    render(<SeriesChart {...CHART_PROPS} series={series} />, root);
    const legend = root.querySelector(".mcp-view-series-chart-legend");
    // The plot's aria-label names the series; the legend must not repeat them.
    assertEquals(legend?.getAttribute("aria-hidden"), "true");
    assertEquals(Array.from(legend?.querySelectorAll("li") ?? [], (item) => item.textContent), [
      "Pressure",
      "Other pressure",
    ]);
    assertEquals(
      Array.from(
        legend?.querySelectorAll("[data-mark]") ?? [],
        (mark) => mark.getAttribute("data-mark"),
      ),
      ["line", "bar"],
    );
    render(<SeriesChart {...CHART_PROPS} series={series} legend={false} />, root);
    assertEquals(root.querySelector(".mcp-view-series-chart-legend"), null);
    render(<SeriesChart {...CHART_PROPS} />, root);
    assertEquals(root.querySelector(".mcp-view-series-chart-legend"), null);
    render(<SeriesChart {...CHART_PROPS} legend />, root);
    assertEquals(root.querySelector(".mcp-view-series-chart-legend"), null);
  });
});

Deno.test("SeriesChart supplied y ticks retain caller labels and share the plot scale", async () => {
  await withPlotDom((root) => {
    render(
      <SeriesChart
        {...CHART_PROPS}
        yTicks={[
          { value: 5, label: "5 bar floor" },
          { value: 17.5, label: "midpoint" },
          { value: 30, label: "30 bar ceiling" },
        ]}
      />,
      root,
    );
    const ticks = Array.from(root.querySelectorAll(".mcp-view-series-chart-y-axis span"));
    assertEquals(ticks.map((tick) => tick.textContent), [
      "5 bar floor",
      "midpoint",
      "30 bar ceiling",
    ]);
    assertEquals(ticks.map((tick) => (tick as HTMLElement).style.top), ["100%", "50%", "0%"]);
    const grid = Array.from(root.querySelectorAll(".mcp-view-series-chart-grid"));
    assertEquals(grid.map((line) => line.getAttribute("y1")), ["40", "20", "0"]);
    for (const line of grid) {
      assertEquals(line.getAttribute("y2"), line.getAttribute("y1"));
      assertEquals([line.getAttribute("x1"), line.getAttribute("x2")], ["0", "100"]);
    }
    render(<SeriesChart {...CHART_PROPS} />, root);
    assertEquals(root.querySelector(".mcp-view-series-chart-grid"), null);
    assertEquals(root.querySelector(".mcp-view-series-chart-y-axis"), null);
  });
});

Deno.test("SeriesChart rejects all nonfinite and outside y ticks with its exact contract", () => {
  for (const value of [NaN, Infinity, -Infinity, 4.99, 30.01]) {
    const error = assertThrows(
      () => SeriesChart({ ...CHART_PROPS, yTicks: [{ value, label: "bad" }] }),
      RangeError,
    );
    assertEquals(error.message, "SeriesChart yTicks value must be within yMin and yMax");
  }
});

Deno.test("Sparkline defaults to inline and block exposes its wording once", async () => {
  await withPlotDom((root) => {
    const props = { label: "Temperature", summaryLabel: "25 °C peak", values: [10, 25] };
    const draw = (node: JSX.Element) => {
      render(node, root);
      return root.innerHTML;
    };
    const implicit = draw(<Sparkline {...props} />);
    assertEquals(draw(<Sparkline {...props} variant="inline" />), implicit);
    assertEquals(root.firstElementChild?.tagName.toLowerCase(), "svg");
    render(<Sparkline {...props} variant="block" />, root);
    assertEquals(root.querySelectorAll('[role="img"]').length, 1);
    assertEquals(root.firstElementChild?.getAttribute("aria-label"), "Temperature: 25 °C peak");
    const heading = root.querySelector(".mcp-view-sparkline-heading");
    assertEquals(heading?.getAttribute("aria-hidden"), "true");
    assertEquals(Array.from(heading?.children ?? [], (child) => child.textContent), [
      "Temperature",
      "25 °C peak",
    ]);
    assertEquals(root.querySelector("svg")?.getAttribute("aria-hidden"), "true");
    assertEquals(root.querySelector("svg")?.getAttribute("aria-label"), null);
  });
});

Deno.test("Plot categorical tones survive rendering and resolve to distinct theme colors", async () => {
  await withPlotDom((root) => {
    for (const tone of ["accent", "brand"] as const) {
      render(<Sparkline label="Trend" values={[1, 2]} summaryLabel="up" tone={tone} />, root);
      assertEquals(root.querySelector("svg")?.getAttribute("data-tone"), tone);
      render(
        <SeriesChart
          {...CHART_PROPS}
          series={[{ ...BASE_SERIES[0], tone }, {
            ...BASE_SERIES[0],
            id: "bars",
            mark: "bar",
            tone,
          }]}
        />,
        root,
      );
      assertEquals(root.querySelector("polyline")?.getAttribute("data-tone"), tone);
      assertEquals(
        Array.from(
          root.querySelectorAll(".mcp-view-series-chart-legend li"),
          (item) => item.getAttribute("data-tone"),
        ),
        [tone, tone],
      );
      assertEquals(
        root.querySelector(".mcp-view-series-chart-bars")?.getAttribute("data-tone"),
        tone,
      );
      for (
        const selector of [
          `.mcp-view-sparkline[data-tone="${tone}"]`,
          `.mcp-view-series-chart-line[data-tone="${tone}"]`,
          `.mcp-view-series-chart-bars[data-tone="${tone}"] line`,
        ]
      ) {
        assert(cssRule(selector).includes(`var(--mcp-view-${tone})`));
      }
    }
  });
});

function cssRule(selector: string): string {
  const start = MCP_VIEW_THEME_CSS.indexOf(`\n${selector} {`);
  assert(start >= 0, `Missing CSS rule: ${selector}`);
  return MCP_VIEW_THEME_CSS.slice(start, MCP_VIEW_THEME_CSS.indexOf("}", start));
}

Deno.test("Plot CSS keeps shared interval columns and overridable chart dimensions", () => {
  assert(
    cssRule(".mcp-view-interval-plot").includes(
      "grid-template-columns: minmax(2.5rem, auto) minmax(0, 1fr) minmax(5rem, auto)",
    ),
  );
  const row = cssRule(".mcp-view-interval-plot-row");
  assert(row.includes("grid-template-columns: subgrid"));
  assert(row.includes("grid-column: 1 / -1"));
  assert(cssRule(".mcp-view-interval-plot-scale").includes("grid-column: 2"));
  const narrow = MCP_VIEW_THEME_CSS.slice(
    MCP_VIEW_THEME_CSS.indexOf("@container (max-width: 440px)"),
  );
  assert(narrow.includes("grid-template-columns: minmax(0, 1fr) minmax(5rem, auto)"));
  assert(narrow.includes(".mcp-view-interval-plot-scale { grid-column: 1 / -1; }"));
  assert(narrow.includes(".mcp-view-interval-plot-track { grid-column: 1 / -1; grid-row: 2; }"));
  assert(
    cssRule(".mcp-view-series-chart-plot").includes(
      "height: var(--mcp-view-series-chart-height, 10rem)",
    ),
  );
  assert(
    cssRule(".mcp-view-series-chart-bars line").includes(
      "stroke-width: var(--mcp-view-series-chart-bar-width, 8px)",
    ),
  );
});

Deno.test("Categorical plot colors do not widen PresentationTone", () => {
  const categoricalIsPresentation: Extract<PresentationTone, "accent" | "brand"> extends never
    ? false
    : true = false;
  assertEquals(categoricalIsPresentation, false);
});
