/** Files emitted by the intentionally small component result-viewer scaffold. */

export const resultViewerTemplates: Readonly<Record<string, string>> = {
  "deno.json": `{
  "compilerOptions": {
    "lib": ["deno.ns", "deno.window", "dom", "dom.iterable", "dom.asynciterable", "esnext"]
  },
  "imports": {
    "@mcpview/view": "jsr:@mcpview/view@0.11.0",
    "@mcpview/components": "jsr:@mcpview/components@0.12.0",
    "@mcpview/components/surface": "jsr:@mcpview/components@0.12.0/surface"
  },
  "minimumDependencyAge": {
    "age": "P1D",
    "exclude": [
      "jsr:@mcpview/view",
      "jsr:@mcpview/components",
      "jsr:@mcpview/contracts"
    ]
  },
  "tasks": {
    "build": "deno run -A build.ts",
    "check": "deno check src/main.ts",
    "test": "deno test --allow-read src",
    "fmt": "deno fmt --check index.html build.ts src"
  }
}
`,
  "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Result viewer</title>
    <style>
    /* STYLES_PLACEHOLDER */
    </style>
  </head>
  <body>
    <main id="root" aria-live="polite">Loading result…</main>
    <script type="module">
    /* BUNDLE_PLACEHOLDER */
    </script>
  </body>
</html>
`,
  "build.ts":
    `import { dirname, fromFileUrl, join, resolve, toFileUrl } from "jsr:@std/path@^1.1.0";

const here = dirname(fromFileUrl(import.meta.url));
const mcpViewModule = moduleSpecifier(Deno.env.get("MCP_VIEW_MODULE") ?? "jsr:@mcpview/view@0.11.0");
const mcpViewComponentsModule = moduleSpecifier(
  Deno.env.get("MCP_VIEW_COMPONENTS_MODULE") ?? "jsr:@mcpview/components@0.12.0",
);
const mcpViewSurfaceModule = moduleSpecifier(
  Deno.env.get("MCP_VIEW_COMPONENTS_SURFACE_MODULE") ?? subpathModule(mcpViewComponentsModule, "surface"),
);
const temporaryDirectory = await Deno.makeTempDir({ prefix: "mcp-view-result-viewer-" });
const importMap = join(temporaryDirectory, "import-map.json");
const bundlePath = join(temporaryDirectory, "result-viewer.js");

try {
  await Deno.writeTextFile(importMap, JSON.stringify({
    compilerOptions: {
      lib: ["deno.ns", "deno.window", "dom", "dom.iterable", "dom.asynciterable", "esnext"]
    },
    imports: {
      "@mcpview/view": mcpViewModule,
      "@mcpview/components": mcpViewComponentsModule,
      "@mcpview/components/surface": mcpViewSurfaceModule,
      "@modelcontextprotocol/ext-apps": "npm:@modelcontextprotocol/ext-apps@^2.0.3",
      "@modelcontextprotocol/core": "npm:@modelcontextprotocol/core@^2.3.1",
      "@modelcontextprotocol/client": "npm:@modelcontextprotocol/client@^2.3.1",
      "zod": "npm:zod@^4.2.0"
    }
  }));
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle", "--config", importMap, "--check", "--platform=browser", "--minify",
      join(here, "src", "main.ts"), "--output", bundlePath
    ],
    stdout: "piped",
    stderr: "piped"
  });
  const result = await command.output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr));
  }
  const template = await Deno.readTextFile(join(here, "index.html"));
  const css = await Deno.readTextFile(join(here, "src", "styles.css"));
  const js = await Deno.readTextFile(bundlePath);
  const html = template
    .replace("/* STYLES_PLACEHOLDER */", () => css)
    .replace("/* BUNDLE_PLACEHOLDER */", () => js);
  const output = join(here, "dist", "result-viewer", "index.html");
  await Deno.mkdir(dirname(output), { recursive: true });
  await Deno.writeTextFile(output, html);
  console.log("[result-viewer] wrote " + output);
} finally {
  await Deno.remove(temporaryDirectory, { recursive: true });
}

/** An override is a jsr:/npm: package, a module URL, or a path to a local mod.ts. */
function moduleSpecifier(value: string): string {
  return URL.canParse(value) ? value : toFileUrl(resolve(value)).href;
}

/** A registry package resolves its own subpaths; a local checkout names the file next to mod.ts. */
function subpathModule(root: string, name: string): string {
  if (root.startsWith("jsr:") || root.startsWith("npm:")) return root + "/" + name;
  return new URL("./" + name + ".ts", root).href;
}
`,
  "src/model.ts": `export interface Metric {
  label: string;
  value: string | number;
  unit?: string;
}

export interface Artifact {
  label: string;
  uri: string;
  sha256?: string;
  bytes?: number;
}

export interface ResultModel {
  title: string;
  summary?: string;
  status?: string;
  metrics: Metric[];
  artifacts: Artifact[];
  details: Metric[];
}

/**
 * What the surface shows. A refresh that fails keeps the last recorded result
 * on the page: a viewer that blanks its panels on error replaces the last
 * recorded truth with a hole.
 */
export interface ViewerData {
  result: ResultModel;
  /** When the result was recorded, so a later failure can date the kept values. */
  recordedAt: string;
  /** The refresh that failed after the result was recorded, if any. */
  failure?: string;
}

export function parseStructuredResult(value: unknown): ResultModel {
  if (!isRecord(value)) throw new TypeError("Expected structuredContent to be an object.");
  const title = stringValue(value.title) ?? stringValue(value.name) ?? "Result";
  const summary = stringValue(value.summary) ?? stringValue(value.description);
  const status = stringValue(value.status);
  const metrics = metricsFrom(value.metrics);
  const artifacts = artifactsFrom(value.artifacts);
  const details = Object.entries(value)
    .filter(([key, item]) => !["title", "name", "summary", "description", "status", "metrics", "artifacts"].includes(key) && isScalar(item))
    .map(([label, item]) => ({ label: humanize(label), value: String(item) }));
  return { title, summary, status, metrics, artifacts, details };
}

export function isEmptyResult(result: ResultModel): boolean {
  return result.title === "Result" && !result.summary && !result.status &&
    result.metrics.length === 0 && result.artifacts.length === 0 && result.details.length === 0;
}

export function toolErrorMessage(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.content)) return "The tool reported an error.";
  const text = value.content.find((item) => isRecord(item) && item.type === "text")?.text;
  return typeof text === "string" && text.trim() ? text : "The tool reported an error.";
}

function metricsFrom(value: unknown): Metric[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (!isRecord(item)) return [];
      const label = stringValue(item.label) ?? stringValue(item.name);
      const metric = metricValue(item.value, item.unit);
      return label && metric ? [{ label, ...metric }] : [];
    });
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([label, metric]) => {
    const reading = isRecord(metric)
      ? metricValue(metric.value, metric.unit)
      : metricValue(metric, undefined);
    return reading ? [{ label: humanize(label), ...reading }] : [];
  });
}

function artifactsFrom(value: unknown): Artifact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || !stringValue(item.uri)) return [];
    const bytes = typeof item.bytes === "number" && Number.isSafeInteger(item.bytes) && item.bytes >= 0
      ? item.bytes
      : undefined;
    return [{
      label: stringValue(item.label) ?? stringValue(item.name) ?? stringValue(item.kind) ?? "Artifact",
      uri: stringValue(item.uri)!,
      sha256: stringValue(item.sha256),
      bytes,
    }];
  });
}

function metricValue(value: unknown, unit: unknown): Pick<Metric, "value" | "unit"> | undefined {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  const suffix = stringValue(unit);
  return { value: typeof value === "number" ? value : String(value), ...(suffix ? { unit: suffix } : {}) };
}

/** Format at render time so a host locale change can re-render the same recorded values. */
export function formatNumber(value: number, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale ?? "en", { maximumFractionDigits: 4 }).format(value);
  } catch {
    return new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(value);
  }
}

export function formatMetricValue(metric: Metric, locale?: string): string {
  const formatted = typeof metric.value === "number" ? formatNumber(metric.value, locale) : metric.value;
  return metric.unit ? formatted + " " + metric.unit : formatted;
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
`,
  "src/render.ts": `import type { SurfaceStatus } from "@mcpview/components/surface";
import { formatMetricValue, formatNumber, type Metric, type ResultModel, type ViewerData } from "./model.ts";

/** Statuses shown before, between and instead of results. Loading is frame-first. */
export function renderStatus(status: SurfaceStatus): string {
  if (status.kind === "loading") return shell("Loading result", '<div class="mcp-view-skeleton" role="status" aria-busy="true" aria-label="' + escapeHtml(status.message) + '"><span class="mcp-view-skeleton-line" aria-hidden="true"></span><span class="mcp-view-skeleton-line" aria-hidden="true"></span><span class="mcp-view-skeleton-line" aria-hidden="true"></span></div>');
  const title = status.title ?? "Result status";
  const role = status.tone === "danger" ? "alert" : "status";
  // A busy notice (a refresh in flight) is still busy for assistive technology.
  const busy = status.busy ? ' aria-busy="true"' : "";
  return shell(escapeHtml(title), '<div class="mcp-view-state" data-kind="' + escapeHtml(status.kind) + '" data-tone="' + escapeHtml(status.tone) + '" role="' + role + '"' + busy + "><strong>" + escapeHtml(title) + '</strong><p class="mcp-view-state-detail">' + escapeHtml(status.message) + "</p></div>");
}

export function renderViewer(data: ViewerData, locale?: string): string {
  // The kept values stay on the page underneath the failure.
  const banner = data.failure ? '<div class="mcp-view-stale-banner" data-tone="danger" role="alert"><span class="mcp-view-stale-banner-message">' + escapeHtml(data.failure) + " — values recorded at " + escapeHtml(data.recordedAt) + "</span></div>" : "";
  return shell(escapeHtml(data.result.title), banner + renderBody(data.result, locale));
}

export function renderResult(result: ResultModel, locale?: string): string {
  return shell(escapeHtml(result.title), renderBody(result, locale));
}

function renderBody(result: ResultModel, locale?: string): string {
  const status = result.status ? '<span class="mcp-view-badge">' + escapeHtml(result.status) + "</span>" : "";
  const summary = result.summary ? '<p class="mcp-view-card-eyebrow">' + escapeHtml(result.summary) + "</p>" : "";
  return '<header class="mcp-view-card-header"><div class="mcp-view-card-heading">' + summary + "</div>" + status + "</header>" +
    renderMetrics("Metrics", result.metrics, "No metrics were supplied.", locale) +
    renderMetrics("Details", result.details, "No additional scalar details were supplied.", locale) +
    renderArtifacts(result, locale);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function shell(title: string, content: string): string {
  return '<section class="viewer" aria-label="Structured result"><h1>' + title + "</h1>" + content + "</section>";
}

function renderMetrics(title: string, metrics: Metric[], empty: string, locale?: string): string {
  const rows = metrics.length
    ? '<dl class="mcp-view-metrics">' + metrics.map((metric) => '<div class="mcp-view-metric"><dt class="mcp-view-metric-label">' + escapeHtml(metric.label) + '</dt><dd class="mcp-view-metric-value">' + escapeHtml(formatMetricValue(metric, locale)) + "</dd></div>").join("") + "</dl>"
    : '<p class="mcp-view-empty">' + escapeHtml(empty) + "</p>";
  return '<section class="mcp-view-card"><h2 class="mcp-view-card-title">' + title + "</h2>" + rows + "</section>";
}

function renderArtifacts(result: ResultModel, locale?: string): string {
  const rows = result.artifacts.length
    ? '<div class="mcp-view-stack">' + result.artifacts.map((artifact) => '<article class="mcp-view-artifact-row"><span class="mcp-view-artifact-row-identity"><strong class="mcp-view-artifact-row-label">' + escapeHtml(artifact.label) + '</strong></span><code class="mcp-view-artifact-row-uri">' + escapeHtml(artifact.uri) + "</code>" + (artifact.sha256 ? '<span class="mcp-view-artifact-row-fingerprint"><span>sha256</span><code>' + escapeHtml(artifact.sha256) + "</code></span>" : "") + (artifact.bytes === undefined ? "" : '<span class="mcp-view-artifact-row-size">' + formatNumber(artifact.bytes, locale) + " bytes</span>") + "</article>").join("") + "</div>"
    : '<p class="mcp-view-empty">No artifacts were supplied.</p>';
  return '<section class="mcp-view-card"><h2 class="mcp-view-card-title">Artifacts</h2>' + rows + "</section>";
}
`,
  "src/styles.css": `/*
 * The kit owns the component vocabulary through installMcpViewTheme(); this
 * file only frames the page around it.
 */
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body {
  min-width: 0;
  margin: 0;
  background: var(--color-background-primary, #ffffff);
  color: var(--mcp-view-text, #101519);
}
body { font: 14px/1.5 var(--mcp-view-font-body, system-ui, sans-serif); }
#root { max-width: 1040px; margin: 0 auto; padding: 16px; }
.viewer { display: grid; gap: 12px; min-width: 0; }
.viewer h1 {
  margin: 0;
  font-family: var(--mcp-view-font-heading, system-ui, sans-serif);
  font-size: clamp(20px, 4vw, 28px);
  letter-spacing: -.02em;
}
.viewer p { margin: 0; }
@media (max-width: 480px) { #root { padding: 8px; } }
@media (prefers-reduced-motion: reduce) { .mcp-view-skeleton-line { animation: none; } }
`,
  "src/main.ts": `import {
  createTranslator,
  defineComponentRegistry,
  defineCustomComponent,
  defineKeyValueComponent,
  defineMetricGridComponent,
} from "@mcpview/components";
import {
  startSurfaceApp,
  type SurfaceAppContext,
  type SurfaceDisplayState,
  type SurfaceStatus,
  type SurfaceToolResult,
} from "@mcpview/components/surface";
import { formatMetricValue, formatNumber, isEmptyResult, parseStructuredResult, toolErrorMessage, type ViewerData } from "./model.ts";
import { escapeHtml, renderStatus } from "./render.ts";

type ViewerContext = SurfaceAppContext<ViewerData>;

const messages = createTranslator({
  defaultLocale: "en",
  messages: { refreshFailedTitle: "Refresh failed" },
  translations: { fr: { refreshFailedTitle: "Échec de l’actualisation" } },
});

const components = defineComponentRegistry<ViewerData, ViewerContext>({
  components: {
    "result.identity": defineCustomComponent({
      title: "Result identity",
      mount(target, { data }) {
        target.className = "mcp-view-card";
        const header = document.createElement("header");
        header.className = "mcp-view-card-header";
        const heading = document.createElement("div");
        heading.className = "mcp-view-card-heading";
        const title = document.createElement("h1");
        title.className = "mcp-view-card-title";
        title.textContent = data.result.title;
        const summary = document.createElement("p");
        summary.className = "mcp-view-card-eyebrow";
        summary.textContent = data.result.summary ?? data.result.status ?? "Structured result";
        heading.append(summary, title);
        header.append(heading);
        target.append(header);
        if (!data.failure) return;
        // The failure is announced beside the values it could not refresh,
        // never in place of them.
        const banner = document.createElement("div");
        banner.className = "mcp-view-stale-banner";
        banner.setAttribute("role", "alert");
        banner.setAttribute("data-tone", "danger");
        const message = document.createElement("span");
        message.className = "mcp-view-stale-banner-message";
        message.textContent = data.failure + " — values recorded at " + data.recordedAt;
        banner.append(message);
        target.append(banner);
      },
    }),
    "result.metrics": defineCustomComponent({
      title: "Metrics",
      mount(target, props) {
        return defineMetricGridComponent<ViewerData, ViewerContext>({
          title: "Metrics",
          select: (data) => data.result.metrics.map((metric, index) => ({
            id: "metric-" + index,
            label: metric.label,
            value: formatMetricValue(metric, props.appContext.hostContext.locale),
          })),
        }).mount(target, props);
      },
    }),
    "result.details": defineKeyValueComponent({
      title: "Details",
      select: (data) =>
        data.result.details.map((detail, index) => ({
          key: "detail-" + index,
          label: detail.label,
          value: detail.value,
        })),
    }),
    "result.artifacts": defineCustomComponent({
      title: "Artifacts",
      mount(target, { data, appContext }) {
        target.className = "mcp-view-stack";
        if (data.result.artifacts.length === 0) {
          const empty = document.createElement("p");
          empty.className = "mcp-view-empty";
          empty.textContent = "No artifacts were supplied.";
          target.append(empty);
          return;
        }
        for (const artifact of data.result.artifacts) {
          // Identity, address and digest are displayed exactly as supplied;
          // this starter verifies nothing on its own.
          const item = document.createElement("article");
          item.className = "mcp-view-artifact-row";
          const identity = document.createElement("span");
          identity.className = "mcp-view-artifact-row-identity";
          const label = document.createElement("strong");
          label.className = "mcp-view-artifact-row-label";
          label.textContent = artifact.label;
          identity.append(label);
          const uri = document.createElement("code");
          uri.className = "mcp-view-artifact-row-uri";
          uri.textContent = artifact.uri;
          item.append(identity, uri);
          if (artifact.sha256) {
            const fingerprint = document.createElement("span");
            fingerprint.className = "mcp-view-artifact-row-fingerprint";
            const algorithm = document.createElement("span");
            algorithm.textContent = "sha256";
            const digest = document.createElement("code");
            digest.textContent = artifact.sha256;
            fingerprint.append(algorithm, digest);
            item.append(fingerprint);
          }
          if (artifact.bytes !== undefined) {
            const size = document.createElement("span");
            size.className = "mcp-view-artifact-row-size";
            size.textContent = formatNumber(artifact.bytes, appContext.hostContext.locale) + " bytes";
            item.append(size);
          }
          target.append(item);
        }
      },
    }),
  },
  defaultSurface: {
    layout: { type: "stack" },
    components: [
      { id: "identity", component: "result.identity" },
      { id: "metrics", component: "result.metrics" },
      { id: "details", component: "result.details" },
      { id: "artifacts", component: "result.artifacts" },
    ],
  },
});

/**
 * One tool result, what the surface shows. startSurfaceApp registers the
 * projection before connect(), so the initiating result cannot be lost during
 * the MCP Apps handshake; every later ui/notifications/tool-result runs it
 * again. The last displayable result lives in the closure, one per App: a
 * refresh that fails keeps it on the page, dated, under the message.
 */
function resultProjection(): (result: SurfaceToolResult) => SurfaceDisplayState<ViewerData> {
  let kept: ViewerData | undefined;
  const failed = (message: string): SurfaceDisplayState<ViewerData> =>
    kept ? { kind: "result", result: { ...kept, failure: message } } : {
      kind: "error",
      title: (locale) => messages(locale)("refreshFailedTitle"),
      message,
    };
  return (result) => {
    if (result.isError) return failed(toolErrorMessage(result));
    let parsed;
    try {
      parsed = parseStructuredResult(result.structuredContent);
    } catch (error) {
      return failed(error instanceof Error ? error.message : "The result could not be read.");
    }
    if (isEmptyResult(parsed)) return { kind: "empty" };
    kept = { result: parsed, recordedAt: new Date().toISOString() };
    return { kind: "result", result: kept };
  };
}

function statusNode(status: SurfaceStatus): Node {
  const host = document.createElement("div");
  host.innerHTML = renderStatus(status);
  return host.firstElementChild ?? host;
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("The result viewer root is missing.");
  await startSurfaceApp<ViewerData>({
    root,
    info: { name: "Result Viewer", version: "0.1.0" },
    registry: components,
    fromToolResult: resultProjection(),
    documentLanguage: messages.locale,
    renderStatus: statusNode,
    strict: true,
  });
}

void boot().catch((error) => {
  const root = document.getElementById("root");
  if (root) root.innerHTML = '<section class="viewer"><div class="mcp-view-state" data-tone="danger" role="alert"><strong>Viewer unavailable</strong><p class="mcp-view-state-detail">' + escapeHtml(error instanceof Error ? error.message : "The viewer could not start.") + "</p></div></section>";
  console.error(error);
});
`,
  "src/model_test.ts": `import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.0";
import { formatMetricValue, formatNumber, isEmptyResult, parseStructuredResult, toolErrorMessage } from "./model.ts";
import { escapeHtml, renderResult, renderStatus, renderViewer } from "./render.ts";

Deno.test("result viewer parses generic metrics and artifacts", () => {
  const result = parseStructuredResult({
    title: "Report",
    status: "complete",
    metrics: { total: { value: 12.5, unit: "ms" } },
    artifacts: [{ name: "Output", uri: "casys://result.json", bytes: 42 }],
  });
  assertEquals(result.metrics, [{ label: "total", value: 12.5, unit: "ms" }]);
  assertEquals(result.artifacts[0]?.uri, "casys://result.json");
  assertEquals(renderResult(result).includes("12.5 ms"), true);
});

Deno.test("result viewer formats the same recorded numbers in the host locale", () => {
  const result = parseStructuredResult({
    status: "documentary",
    metrics: [{ label: "Displacement", value: 12.5, unit: "mm" }],
    artifacts: [{ uri: "casys://part.glb", bytes: 12345 }],
  });
  assertEquals(formatMetricValue(result.metrics[0], "en-US"), "12.5 mm");
  assertEquals(formatMetricValue(result.metrics[0], "fr-FR"), "12,5 mm");
  const french = renderResult(result, "fr-FR");
  assertEquals(french.includes("12,5 mm"), true);
  assertEquals(french.includes(new Intl.NumberFormat("fr-FR").format(12345) + " bytes"), true);
  assertEquals(french.includes("documentary"), true);
  assertEquals(result.metrics[0].value, 12.5);
  assertEquals(formatNumber(12.5, "invalid_locale"), "12.5");
});

Deno.test("result viewer distinguishes empty and invalid structured content", () => {
  assertEquals(isEmptyResult(parseStructuredResult({})), true);
  assertThrows(() => parseStructuredResult([]), TypeError, "structuredContent");
  assertEquals(toolErrorMessage({ content: [{ type: "text", text: "Unavailable" }] }), "Unavailable");
  assertEquals(escapeHtml("<unsafe>"), "&lt;unsafe&gt;");
  const hostile = renderResult(parseStructuredResult({ title: '<img src=x onerror=alert(1)>', metrics: { value: '<script>' } }));
  assertEquals(hostile.includes("<img"), false);
  assertEquals(hostile.includes("&lt;script&gt;"), true);
});

Deno.test("result viewer keeps the recorded values under a later failure", () => {
  const result = parseStructuredResult({ title: "Report", metrics: { total: 3 } });
  const page = renderViewer({ result, recordedAt: "2026-01-01T00:00:00.000Z", failure: "Solver <offline>" });
  assertEquals(page.includes("mcp-view-stale-banner"), true);
  assertEquals(page.includes("Solver &lt;offline&gt;"), true);
  assertEquals(page.includes("2026-01-01T00:00:00.000Z"), true);
  assertEquals(page.includes(">3<"), true);
  const loading = renderStatus({ kind: "loading", message: "Waiting", tone: "info", busy: true });
  assertEquals(loading.includes('aria-busy="true"'), true);
  const error = renderStatus({ kind: "error", title: "Error", message: "<bad>", tone: "danger", busy: false });
  assertEquals(error.includes('role="alert"'), true);
  assertEquals(error.includes("&lt;bad&gt;"), true);
  assertEquals(error.includes("aria-busy"), false);
  const notice = renderStatus({ kind: "notice", title: "Refreshing", message: "Again", tone: "warning", busy: true });
  assertEquals(notice.includes('data-kind="notice"'), true);
  assertEquals(notice.includes('aria-busy="true"'), true);
  assertEquals(notice.includes('role="status"'), true);
});
`,
};
