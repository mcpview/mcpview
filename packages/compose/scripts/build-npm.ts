/**
 * Build script for @mcpview/compose npm package.
 *
 * Uses dnt (Deno to Node Transform) to produce ESM + CJS + type declarations
 * from the Deno source.
 *
 * Usage:
 *   deno run -A scripts/build-npm.ts
 */

import { build, emptyDir } from "@deno/dnt";

// Read version from deno.json — single source of truth. Parsing JSON instead
// of importing with `with { type: "json" }` keeps the script portable and
// independent of import-attribute support across Deno versions.
const denoJsonText = await Deno.readTextFile(
  new URL("../deno.json", import.meta.url),
);
const denoJson = JSON.parse(denoJsonText) as { version?: string };
const VERSION = denoJson.version;
if (!VERSION) {
  throw new Error(
    "[build-npm] failed to read version from packages/compose/deno.json",
  );
}
console.log(`[build-npm] Version: ${VERSION}`);

await emptyDir("./dist-node");

await build({
  entryPoints: [
    "./mod.ts",
    { name: "./core", path: "./src/core/mod.ts" },
    { name: "./sdk", path: "./src/sdk/mod.ts" },
    { name: "./host", path: "./src/host/mod.ts" },
    { name: "./runtime", path: "./src/runtime/mod.ts" },
    { name: "./deploy", path: "./src/deploy/mod.ts" },
  ],
  outDir: "./dist-node",
  shims: {
    deno: false,
  },
  package: {
    name: "@mcpview/compose",
    version: VERSION,
    description: "Compose and synchronize multiple MCP Apps UIs into composite dashboards",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/mcpview/mcpview.git",
      directory: "packages/compose",
    },
    homepage: "https://mcpview.dev",
    bugs: { url: "https://github.com/mcpview/mcpview/issues" },
    keywords: [
      "mcp",
      "model-context-protocol",
      "compose",
      "dashboard",
      "ui",
      "orchestration",
    ],
  },
  compilerOptions: {
    lib: ["ES2022", "DOM"],
    target: "ES2022",
  },
  typeCheck: false,
  test: false,
  importMap: "./deno.json",
});

// Patch package.json: add "types" field for broader TS compatibility
const pkgPath = "dist-node/package.json";
const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
pkg.types = "./esm/mod.d.ts";
await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

console.log("\n[build-npm] Done. Output in ./dist-node/");
