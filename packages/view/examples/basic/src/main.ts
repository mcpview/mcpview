/// <reference lib="dom" />
/**
 * Entry point for the view-basic demo.
 *
 * Attempts the real MCP handshake via createMcpApp. If no MCP host is present
 * (e.g. dist/index.html opened directly in a browser), falls back to a
 * local-only driver that runs the same view definitions without the
 * ext-apps App layer. This makes the bundle self-demoable while still
 * exercising the real SDK path when an MCP host is available.
 */

import { createMcpApp } from "@mcpview/view";
import type { AppContext, AppHandle } from "@mcpview/view";
import { listView } from "./list-view.ts";
import { detailView } from "./detail-view.ts";
import type { AppState } from "./state.ts";

const views = { list: listView, detail: detailView };

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("#root missing");

  // Detect "no host": opening dist/index.html directly → window === window.parent.
  const hasHost = window.parent && window.parent !== window;

  if (hasHost) {
    try {
      const handle = await createMcpApp<AppState>({
        info: { name: "view-basic-demo", version: "0.1.0" },
        root,
        views,
        initialView: "list",
        initialState: { invoices: [] },
      });
      // deno-lint-ignore no-explicit-any
      (globalThis as any).__mcpApp = handle;
      renderBanner(root, "Connected to MCP host via createMcpApp");
      return;
    } catch (err) {
      console.warn("[view-basic] createMcpApp failed, falling back to local mode:", err);
    }
  }

  // Local fallback
  const handle = bootLocal(root);
  // deno-lint-ignore no-explicit-any
  (globalThis as any).__mcpApp = handle;
  renderBanner(
    root,
    "Local-only mode: no MCP host detected. SPA navigation still works.",
    "warn",
  );
}

function bootLocal(root: HTMLElement): AppHandle<AppState> {
  const state: AppState = { invoices: [] };
  let currentView = "list";

  const ctx: AppContext<AppState> = {
    navigate: async (name, args) => {
      await renderView(name, args);
    },
    callTool: () => {
      throw new Error("callTool unavailable in local mode (no MCP host)");
    },
    // `sample` needs a host round-trip, so local mode can only refuse it —
    // same as `callTool` above.
    sample: () => {
      throw new Error("sample unavailable in local mode (no MCP host)");
    },
    // `tools` only flips what the host is told about the current view's tools.
    // With no host there is nothing to announce, so these are no-ops rather
    // than throws: a view calling `tools.disable()` on a dirty form is doing
    // nothing wrong, and it should still run in local mode.
    //
    // Typed rather than cast to `any` on purpose: when `AppContext` grows a
    // member, this example should stop compiling until someone decides what
    // local mode does with it.
    tools: {
      enable: () => {},
      disable: () => {},
      update: () => {},
      remove: () => {},
    },
    // deno-lint-ignore no-explicit-any
    capabilities: {} as any,
    hostContext: {},
    state,
    // deno-lint-ignore no-explicit-any
    app: {} as any,
  };

  async function renderView(name: string, args: unknown): Promise<void> {
    const view = (views as Record<string, typeof listView | typeof detailView>)[name];
    if (!view) throw new Error(`Unknown view: ${name}`);
    currentView = name;
    // deno-lint-ignore no-explicit-any
    const data = view.onEnter ? await view.onEnter(ctx, args as any) : undefined;
    // deno-lint-ignore no-explicit-any
    const out = view.render(ctx, data as any);

    // Preserve the banner if any.
    const banner = root.querySelector(".banner");
    // Clear root with DOM methods (avoid innerHTML = "").
    while (root.firstChild) root.removeChild(root.firstChild);
    if (banner) root.appendChild(banner);

    if (typeof out === "string") {
      // Parse HTML string → fragment via DOMParser (no innerHTML).
      const doc = new DOMParser().parseFromString(
        `<!doctype html><body>${out}</body>`,
        "text/html",
      );
      const frag = document.createDocumentFragment();
      while (doc.body.firstChild) frag.appendChild(doc.body.firstChild);
      root.appendChild(frag);
    } else {
      root.appendChild(out);
    }
  }

  // Defer so caller can assign __mcpApp first.
  queueMicrotask(() => void renderView("list", undefined));

  return {
    // deno-lint-ignore no-explicit-any
    ctx: ctx as any,
    get currentView() {
      return currentView;
    },
    navigate: (name, args) => renderView(name, args),
    dispose: () => Promise.resolve(),
  };
}

function renderBanner(root: HTMLElement, msg: string, kind: "info" | "warn" = "info"): void {
  const b = document.createElement("div");
  b.className = `banner banner-${kind}`;
  b.textContent = msg;
  root.prepend(b);
}

boot().catch((err) => {
  const root = document.getElementById("root");
  if (root) {
    const pre = document.createElement("pre");
    pre.className = "fatal";
    pre.textContent = `Fatal: ${String(err)}`;
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(pre);
  }
  console.error(err);
});
