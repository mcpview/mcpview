/// <reference lib="deno.ns" />
/**
 * esbuild bundler for the context demo.
 *
 * Bundles src/main.ts (+ its imports of `@mcpview/view`) into a single
 * ESM string, inlines it and src/styles.css into index.html, and writes
 * dist/index.html.
 *
 * No Vite, no chunks, no external files: the artifact is self-contained
 * and can be served as a `ui://` MCP resource or opened directly.
 *
 * Run:
 *   deno run --allow-all packages/view/examples/context/build.ts
 */

import * as esbuild from "npm:esbuild@^0.24.0";
import { denoPlugins } from "jsr:@luca/esbuild-deno-loader@^0.11.0";
import { dirname, fromFileUrl, join } from "jsr:@std/path@^1.0.0";

const here = dirname(fromFileUrl(import.meta.url));
const entry = join(here, "src", "main.ts");
const template = join(here, "index.html");
const styles = join(here, "src", "styles.css");
const outDir = join(here, "dist");
const outHtml = join(outDir, "index.html");

// Resolve the view package's deno.json as the import-map root so
// bare specifiers like `@mcpview/view` and `@modelcontextprotocol/ext-apps`
// resolve.
const configPath = join(here, "..", "..", "deno.json");

console.log("[build] entry:", entry);
console.log("[build] config:", configPath);

const result = await esbuild.build({
  plugins: [...denoPlugins({ configPath })],
  entryPoints: [entry],
  bundle: true,
  jsx: "automatic",
  jsxImportSource: "preact",
  format: "esm",
  target: "es2022",
  platform: "browser",
  write: false,
  minify: true,
  sourcemap: false,
  logLevel: "info",
  // Shim Node builtins that might be pulled in transitively.
  define: {
    "process.env.NODE_ENV": '"production"',
    "globalThis.process": "undefined",
  },
});

await esbuild.stop();

if (result.errors.length) {
  console.error(result.errors);
  Deno.exit(1);
}
if (result.warnings.length) {
  console.warn("[build] warnings:", result.warnings.length);
  for (const w of result.warnings) console.warn(" -", w.text);
}

const js = result.outputFiles[0].text;
const css = await Deno.readTextFile(styles);
const tpl = await Deno.readTextFile(template);

const html = tpl
  .replace("/* STYLES_PLACEHOLDER */", () => css)
  .replace("/* BUNDLE_PLACEHOLDER */", () => js);

await Deno.mkdir(outDir, { recursive: true });
await Deno.writeTextFile(outHtml, html);

const bytes = new TextEncoder().encode(html).length;
const kb = (bytes / 1024).toFixed(1);
console.log(`[build] wrote ${outHtml} (${kb} KB)`);
console.log(
  `[build] bundle JS: ${(js.length / 1024).toFixed(1)} KB, CSS: ${
    (css.length / 1024).toFixed(1)
  } KB`,
);
