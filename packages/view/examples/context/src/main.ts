import { h, render } from "npm:preact@^10.28.3";
import { useEffect, useMemo, useState } from "npm:preact@^10.28.3/hooks";
import { createMcpApp, defineView } from "@mcpview/view";
import { MCP_VIEW_THEME_CSS } from "@mcpview/components";
import {
  type ActiveContextController,
  type ActiveContextHost,
  type ActiveContextSelection,
  type ContextSelectionItem,
  createActiveContextController,
  createActiveContextPolicy,
  createClickIntentArbiter,
} from "@mcpview/view/context";
import {
  ActiveContextChip,
  contextBasketLabels,
  MCP_VIEW_CONTEXT_BASKET_CSS,
  MCP_VIEW_CONTEXT_SELECTION_CSS,
  useActiveContext,
} from "@mcpview/components/preact/context";
import { createExampleInteractions } from "./interactions.ts";

const records = Array.from({ length: 12 }, (_, index) => ({
  id: `sample-${index + 1}`,
  view: "Synthetic samples",
  label: `Sample ${index + 1}`,
  value: index % 2 ? "Ready" : "Review",
  fields: [{ label: "Status", value: index % 2 ? "Ready" : "Review" }],
  reconcileKey: "samples",
}));

const policy = createActiveContextPolicy({
  schema: "context-example/selection",
  version: 1,
  maxItems: 12,
  compactUpTo: 3,
  referenceUpTo: 8,
  maxSnapshotBytes: 8192,
  maxResourceBytes: 1024,
  maxTextFallbackBytes: 1024,
  resourcePolicy: "none",
  limits: {
    id: 80,
    view: 120,
    label: 120,
    value: 200,
    fields: 8,
    fieldLabel: 80,
    fieldValue: 160,
    resourceUri: 200,
    resourceMimeType: 80,
  },
  reference: ({ id, view, label, value }) => ({ id, view, label, value }),
  query: (items) => ({
    id: "sample-selection",
    view: "Synthetic samples",
    label: `${items.length} selected samples`,
    // The owning server must implement this exact filter, rather than parse labels.
    query: { tool: "sample_list", filters: { ids: items.map((item) => item.id) } },
  }),
});

let currentRoot = "root-a";

function Example({ controller }: { controller: ActiveContextController }) {
  const [scope, setScope] = useState(currentRoot);
  const [detail, setDetail] = useState<ContextSelectionItem | null>(null);
  const context = useActiveContext(controller, scope);
  const arbiter = useMemo(() => createClickIntentArbiter(), []);
  useEffect(() => () => arbiter.dispose(), [arbiter]);
  const { intent } = createExampleInteractions(context, scope, setDetail);

  return h(
    "section",
    {},
    h("h1", {}, "Active context"),
    h("p", {}, "Synthetic data. An ACK means host acceptance, not model consumption."),
    h(
      "div",
      { class: "toolbar" },
      h("button", {
        onClick: () => {
          arbiter.cancelScope(scope);
          setDetail(null);
          currentRoot = scope === "root-a" ? "root-b" : "root-a";
          setScope(currentRoot);
        },
      }, `Change root (${scope})`),
      ...[1, 3, 8, 12].map((count) =>
        h("button", {
          disabled: !context.supported,
          onClick: () => {
            void context.select(records.slice(0, count));
          },
        }, `Select ${count}`)
      ),
      h(ActiveContextChip<ActiveContextSelection>, {
        selections: context.selections,
        pending: context.pending,
        failed: context.failed,
        evictedLabel: context.evictedLabel,
        labels: contextBasketLabels("en"),
        onRemove: context.remove,
        onClear: context.clear,
        onRetry: context.retry,
      }),
    ),
    !context.supported
      ? h("p", { role: "status" }, "Context unavailable; rows open local detail.")
      : h(
        "p",
        {},
        "Click previews selection immediately; sharing waits 500 ms. Double-click or Enter opens detail; Space selects immediately. Dashed rows are awaiting host acceptance.",
      ),
    detail
      ? h(
        "article",
        {},
        h("button", { onClick: () => setDetail(null) }, "Back"),
        h("h2", {}, detail.label),
        h("p", {}, `${detail.id}: ${detail.value}`),
      )
      : h(
        "ul",
        {},
        records.map((item) => {
          const action = intent(item);
          const selectionState = context.selectionState(item);
          const changing = selectionState === "adding" || selectionState === "removing";
          return h(
            "li",
            { key: item.id },
            h(
              "button",
              {
                class: "mcp-view-context-selection",
                "data-context-state": selectionState,
                "aria-pressed": selectionState === "selected" || selectionState === "adding",
                "aria-busy": changing || undefined,
                onClick: (event: MouseEvent) => arbiter.click(action, event.detail),
                onDblClick: () => arbiter.doubleClick(action),
                onKeyDown: (event: KeyboardEvent) => arbiter.keyDown(action, event),
              },
              `${item.label}: ${item.value}`,
              changing &&
                h(
                  "span",
                  { class: "mcp-view-context-selection-status" },
                  selectionState === "adding" ? "Adding…" : "Removing…",
                ),
            ),
            h("button", { onClick: () => arbiter.activateDetail(action) }, "Details"),
          );
        }),
      ),
    h(
      "details",
      {},
      h("summary", {}, "Acknowledged basket and queued intent"),
      h(
        "pre",
        {},
        JSON.stringify(
          {
            selections: context.selections,
            desiredSelections: context.desiredSelections,
            pending: context.pending,
            error: context.error,
          },
          null,
          2,
        ),
      ),
    ),
  );
}

async function boot() {
  const root = document.getElementById("root")!;
  const mount = document.createElement("div");
  const style = document.createElement("style");
  style.textContent = MCP_VIEW_THEME_CSS + MCP_VIEW_CONTEXT_BASKET_CSS +
    MCP_VIEW_CONTEXT_SELECTION_CSS;
  document.head.append(style);
  let controller: ActiveContextController | undefined;
  const show = (host: ActiveContextHost) => {
    controller ??= createActiveContextController(host, "root-a", policy);
    render(h(Example, { controller }), mount);
    return mount;
  };
  const cleanup = async () => {
    render(null, mount);
    await controller?.dispose();
  };
  if (window.parent === window) {
    root.replaceChildren(show({
      getHostCapabilities: () => ({}),
      updateModelContext: () => Promise.reject(new Error("No MCP Apps host")),
    }));
    return;
  }
  const app = await createMcpApp({
    info: { name: "context-example", version: "0.1.0" },
    root,
    initialView: "samples",
    views: { samples: defineView({ render: (ctx) => show(ctx.app) }) },
    onTeardown: cleanup,
  });
  window.addEventListener("pagehide", () => {
    void app.dispose();
  }, { once: true });
}

boot().catch((error) => {
  document.getElementById("root")!.textContent = `Connection failed: ${String(error)}`;
});
