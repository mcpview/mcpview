/** Build @casys/mcp-view-components for npm. */

import { build, emptyDir } from "@deno/dnt";

const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
) as { version?: string };
if (!denoJson.version) throw new Error("[build-npm] missing view-components version");
const coreDenoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../view/deno.json", import.meta.url)),
) as { version?: string };
const contractsDenoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../view-contracts/deno.json", import.meta.url)),
) as { version?: string };
if (!coreDenoJson.version || !contractsDenoJson.version) {
  throw new Error("[build-npm] missing view family dependency version");
}

await emptyDir("./dist-node");
await build({
  // `./scaffold` is intentionally Deno/JSR-only: its public contract uses
  // Deno filesystem APIs and `deno fmt`. Do not emit a nominal Node entry.
  entryPoints: [
    "./mod.ts",
    { name: "./preact", path: "./preact.ts" },
    { name: "./preact/components", path: "./preact-components.ts" },
    { name: "./surface", path: "./surface.ts" },
    { name: "./layout", path: "./layout.ts" },
    { name: "./fonts", path: "./fonts.ts" },
  ],
  outDir: "./dist-node",
  shims: { deno: false },
  package: {
    name: "@casys/mcp-view-components",
    version: denoJson.version,
    description: "Optional light-first component runtime for small composable MCP App viewers",
    license: "MIT",
    repository: { type: "git", url: "https://github.com/superWorldSavior/mcp-platform" },
    keywords: ["mcp", "model-context-protocol", "mcp-apps", "components", "preact"],
  },
  compilerOptions: { lib: ["ES2022", "DOM", "DOM.Iterable"], target: "ES2022" },
  typeCheck: false,
  test: false,
  importMap: "./deno.json",
});

const packageJsonPath = "dist-node/package.json";
const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
packageJson.types = "./esm/mod.d.ts";
packageJson.exports = {
  ".": {
    types: "./esm/mod.d.ts",
    import: "./esm/mod.js",
    require: "./script/mod.js",
  },
  "./preact": {
    types: "./esm/preact.d.ts",
    import: "./esm/preact.js",
    require: "./script/preact.js",
  },
  "./preact/components": {
    types: "./esm/preact-components.d.ts",
    import: "./esm/preact-components.js",
    require: "./script/preact-components.js",
  },
  "./surface": {
    types: "./esm/surface.d.ts",
    import: "./esm/surface.js",
    require: "./script/surface.js",
  },
  "./layout": {
    types: "./esm/layout.d.ts",
    import: "./esm/layout.js",
    require: "./script/layout.js",
  },
  "./fonts": {
    types: "./esm/fonts.d.ts",
    import: "./esm/fonts.js",
    require: "./script/fonts.js",
  },
};
packageJson.dependencies ??= {};
packageJson.dependencies["@casys/mcp-view"] = `^${coreDenoJson.version}`;
packageJson.dependencies["@casys/mcp-view-contracts"] = `^${contractsDenoJson.version}`;

const preactVersion = packageJson.dependencies?.preact;
if (!preactVersion) throw new Error("[build-npm] expected dnt dependency preact");
delete packageJson.dependencies.preact;
packageJson.peerDependencies ??= {};
packageJson.peerDependenciesMeta ??= {};
packageJson.peerDependencies.preact = preactVersion;
packageJson.peerDependenciesMeta.preact = { optional: true };
await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

for (const asset of ["README.md", "LICENSE"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

console.log("[build-npm] @casys/mcp-view-components ready in ./dist-node/");
