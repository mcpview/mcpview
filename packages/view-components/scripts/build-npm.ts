/** Build @mcpview/components for npm. */

import { build, emptyDir } from "@deno/dnt";

const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
) as { version?: string; imports: Record<string, string> };
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
const npmImportMapPath = "./dist-node/.npm-import-map.json";
const siblingModules = {
  "@mcpview/view": new URL("../../view/mod.ts", import.meta.url).href,
  "@mcpview/view/context": new URL("../../view/context.ts", import.meta.url).href,
  "@mcpview/contracts": new URL("../../view-contracts/mod.ts", import.meta.url).href,
};
await Deno.writeTextFile(
  npmImportMapPath,
  JSON.stringify({ imports: { ...denoJson.imports, ...siblingModules } }, null, 2) + "\n",
);
await build({
  // `./scaffold` is intentionally Deno/JSR-only: its public contract uses
  // Deno filesystem APIs and `deno fmt`. Do not emit a nominal Node entry.
  entryPoints: [
    "./mod.ts",
    { name: "./preact", path: "./preact.ts" },
    { name: "./preact/components", path: "./preact-components.ts" },
    { name: "./preact/context", path: "./preact-context.ts" },
    { name: "./surface", path: "./surface.ts" },
    { name: "./layout", path: "./layout.ts" },
    { name: "./fonts", path: "./fonts.ts" },
  ],
  outDir: "./dist-node",
  shims: { deno: false },
  package: {
    name: "@mcpview/components",
    version: denoJson.version,
    description: "Optional light-first component runtime for small composable MCP App viewers",
    license: "MIT",
    engines: { node: ">=20" },
    repository: {
      type: "git",
      url: "git+https://github.com/mcpview/mcpview.git",
      directory: "packages/view-components",
    },
    homepage: "https://mcpview.dev",
    bugs: { url: "https://github.com/mcpview/mcpview/issues" },
    keywords: ["mcp", "model-context-protocol", "mcp-apps", "components", "preact"],
  },
  compilerOptions: { lib: ["ES2022", "DOM", "DOM.Iterable"], target: "ES2022" },
  typeCheck: false,
  test: false,
  importMap: npmImportMapPath,
  // Keep sibling packages external without fetching unpublished npm versions
  // during dnt's install. Their release ranges are added below after the build.
  mappings: {
    [siblingModules["@mcpview/view"]]: { name: "@mcpview/view" },
    [siblingModules["@mcpview/view/context"]]: {
      name: "@mcpview/view",
      subPath: "context",
    },
    [siblingModules["@mcpview/contracts"]]: { name: "@mcpview/contracts" },
  },
}).finally(() => Deno.remove(npmImportMapPath));

const packageJsonPath = "dist-node/package.json";
const packageJson = JSON.parse(await Deno.readTextFile(packageJsonPath));
packageJson.types = "./esm/mod.d.ts";
packageJson.exports = {
  ".": {
    types: "./esm/mod.d.ts",
    import: "./esm/mod.js",
    require: "./script/mod.js",
  },
  "./preact/context": {
    types: "./esm/preact-context.d.ts",
    import: "./esm/preact-context.js",
    require: "./script/preact-context.js",
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
packageJson.dependencies["@mcpview/view"] = `^${coreDenoJson.version}`;
packageJson.dependencies["@mcpview/contracts"] = `^${contractsDenoJson.version}`;

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

console.log("[build-npm] @mcpview/components ready in ./dist-node/");
