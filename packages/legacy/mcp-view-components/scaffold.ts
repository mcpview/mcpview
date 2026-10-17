/**
 * `@casys/mcp-view-components/scaffold` — deprecated alias of `@mcpview/components/scaffold`.
 *
 * The package moved to the `@mcpview` scope. This entry point re-exports
 * `@mcpview/components/scaffold` unchanged: same API, same behaviour. New code should import
 * `@mcpview/components/scaffold` directly (see `docs/migration/casys-to-mcpview.md`).
 *
 * @deprecated Use `@mcpview/components/scaffold` instead.
 * @module
 */
export * from "@mcpview/components/scaffold";

import { runScaffoldCli } from "@mcpview/components/scaffold";

// `deno run -A jsr:@casys/mcp-view-components/scaffold ...` was the documented way to scaffold
// a result viewer. `import.meta.main` is false inside the re-exported module,
// so the old command keeps working only if the alias runs the CLI itself.
if (import.meta.main) {
  console.error(
    "@casys/mcp-view-components/scaffold is deprecated: run jsr:@mcpview/components/scaffold instead.",
  );
  runScaffoldCli(Deno.args).catch((error) => {
    console.error(`scaffold: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  });
}
