/**
 * MCP Inspector Launcher
 *
 * Launches the official @modelcontextprotocol/inspector to debug
 * and test MCP servers interactively in a browser.
 *
 * Runtime-agnostic: process spawning goes through `node:` builtins, which
 * both Deno (via its Node compat layer) and Node.js support — one code path
 * instead of a per-runtime adapter. The `node:` modules are imported
 * dynamically inside the function bodies so nothing process-related enters
 * the module graph at load time (mod.ts re-exports this module, and its
 * import must stay side-effect free on constrained runtimes like
 * Deno Deploy).
 *
 * Usage from a server script:
 * ```typescript
 * import { launchInspector } from "@casys/mcp-server";
 *
 * if (Deno.args.includes("--inspect")) {
 *   await launchInspector("deno", ["run", "--allow-all", "server.ts"]);
 * }
 * ```
 *
 * @module lib/server/inspector/launcher
 */

/** Options for the MCP Inspector launcher. */
export interface InspectorOptions {
  /** Port for the inspector web UI (default: 6274) */
  port?: number;
  /** Automatically open the browser (default: true) */
  open?: boolean;
  /** Environment variables to pass to the MCP server process */
  env?: Record<string, string>;
}

/**
 * Launch the MCP Inspector to debug a server.
 *
 * Spawns `npx @modelcontextprotocol/inspector` which:
 * 1. Starts a web UI on the given port (default 6274)
 * 2. Proxies stdio to the MCP server subprocess
 * 3. Allows interactive tool calls, resource browsing, etc.
 *
 * @param serverCommand - Command to start the MCP server (e.g. "deno", "node")
 * @param serverArgs - Arguments for the server command (e.g. ["run", "--allow-all", "server.ts"])
 * @param options - Inspector configuration
 */
export async function launchInspector(
  serverCommand: string,
  serverArgs: string[],
  options?: InspectorOptions,
): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { env, exit } = await import("node:process");

  const port = options?.port ?? 6274;
  const shouldOpen = options?.open ?? true;

  // Filter out --inspect from args to avoid recursion
  const filteredArgs = serverArgs.filter((a) => a !== "--inspect");

  const inspectorEnv: Record<string, string> = {
    ...options?.env,
    CLIENT_PORT: String(port),
  };

  console.error(
    `[mcp-inspector] Starting inspector on http://localhost:${port}`,
  );
  console.error(
    `[mcp-inspector] Server: ${serverCommand} ${filteredArgs.join(" ")}`,
  );

  // Use npx to run the inspector
  const child = spawn(
    "npx",
    [
      "-y",
      "@modelcontextprotocol/inspector",
      serverCommand,
      ...filteredArgs,
    ],
    {
      env: { ...env, ...inspectorEnv },
      stdio: "inherit",
    },
  );

  // Open browser after a short delay
  if (shouldOpen) {
    setTimeout(() => {
      openBrowser(`http://localhost:${port}`).catch(() => {
        // Ignore — user can open manually
      });
    }, 2000);
  }

  // Wait for the inspector process to exit
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => resolve(exitCode ?? 1));
  });
  if (code !== 0) {
    console.error(`[mcp-inspector] Inspector exited with code ${code}`);
    exit(code);
  }
}

/**
 * Open a URL in the default browser (cross-platform).
 */
async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { platform } = await import("node:process");

  let cmd: string[];
  if (platform === "darwin") {
    cmd = ["open", url];
  } else if (platform === "win32") {
    cmd = ["cmd", "/c", "start", url];
  } else {
    cmd = ["xdg-open", url];
  }

  const child = spawn(cmd[0], cmd.slice(1), { stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", () => resolve());
  });
}
