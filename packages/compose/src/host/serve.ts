/**
 * Local dashboard server — serves composed HTML on localhost.
 *
 * Provides a simple `Deno.serve()` wrapper that serves the composed
 * dashboard HTML and opens it in the default browser.
 *
 * ## AX
 *
 * - **Single function**: `serveDashboard()` does everything.
 * - **Auto-open**: Opens the browser by default (configurable).
 * - **Graceful shutdown**: Returns a `shutdown()` handle.
 * - **Dynamic port**: Defaults to port 0 (OS picks a free port).
 *
 * @module host/serve
 */

/**
 * Options for `serveDashboard()`.
 */
export interface ServeDashboardOptions {
  /** Port to serve on (default: 0 = dynamic). */
  port?: number;
  /** Hostname to bind to (default: "localhost"). */
  hostname?: string;
  /** Open the browser automatically (default: true). */
  open?: boolean;
}

/**
 * Handle returned by `serveDashboard()`.
 */
export interface ServeDashboardHandle {
  /** The URL where the dashboard is served. */
  url: string;
  /** Shut down the server. */
  shutdown(): Promise<void>;
}

/**
 * Serve a composed dashboard HTML on localhost.
 *
 * @param html - Complete HTML string from `renderComposite()` or `composeDashboard()`
 * @param options - Server options
 * @returns Handle with URL and shutdown function
 *
 * @example
 * ```typescript
 * import { composeDashboard } from "@mcpview/compose/runtime";
 * import { serveDashboard } from "@mcpview/compose/host";
 *
 * const result = await composeDashboard({ template, manifests, args });
 * const handle = await serveDashboard(result.html);
 * // Dashboard available at handle.url
 * // Later: await handle.shutdown();
 * ```
 */
export async function serveDashboard(
  html: string,
  options?: ServeDashboardOptions,
): Promise<ServeDashboardHandle> {
  const port = options?.port ?? 0;
  const hostname = options?.hostname ?? "localhost";
  const shouldOpen = options?.open ?? true;

  let resolveReady: (addr: Deno.NetAddr) => void;
  const ready = new Promise<Deno.NetAddr>((resolve) => {
    resolveReady = resolve;
  });

  const server = Deno.serve({
    port,
    hostname,
    onListen(addr) {
      resolveReady(addr);
    },
  }, (req) => {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  });

  const addr = await ready;
  const dashboardUrl = `http://${addr.hostname}:${addr.port}`;

  if (shouldOpen) {
    await openBrowser(dashboardUrl);
  }

  return {
    url: dashboardUrl,
    async shutdown() {
      await server.shutdown();
    },
  };
}

/** Open a URL in the default browser (macOS/Linux/Windows). */
async function openBrowser(url: string): Promise<void> {
  const os = Deno.build.os;
  const cmd = os === "darwin"
    ? ["open", url]
    : os === "windows"
    ? ["cmd", "/c", "start", url]
    : ["xdg-open", url];

  try {
    const process = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdout: "null",
      stderr: "null",
    }).spawn();
    await process.status;
  } catch {
    // Browser open failed — not critical, dashboard is still served
    console.error(`[mcp-compose] Could not open browser. Dashboard available at ${url}`);
  }
}
