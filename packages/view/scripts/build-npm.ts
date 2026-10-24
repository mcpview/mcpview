/**
 * Build script for @mcpview/view npm package.
 *
 * Uses dnt (Deno to Node Transform) to produce browser-compatible ESM/CJS
 * bundles plus type declarations from the Deno source.
 *
 * Usage:
 *   deno run -A scripts/build-npm.ts
 */

import { build, emptyDir } from "@deno/dnt";

const denoJsonText = await Deno.readTextFile(
  new URL("../deno.json", import.meta.url),
);
const denoJson = JSON.parse(denoJsonText) as {
  version?: string;
  imports: Record<string, string>;
};
const VERSION = denoJson.version;
if (!VERSION) {
  throw new Error(
    "[build-npm] failed to read version from packages/view/deno.json",
  );
}
const contractsDenoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../view-contracts/deno.json", import.meta.url)),
) as { version?: string };
if (!contractsDenoJson.version) {
  throw new Error("[build-npm] failed to read packages/view-contracts version");
}
console.log(`[build-npm] Version: ${VERSION}`);

await emptyDir("./dist-node");

const contractsEntryPoint = new URL("../../view-contracts/mod.ts", import.meta.url).href;
const npmImportMapPath = "./dist-node/.npm-import-map.json";
await Deno.writeTextFile(
  npmImportMapPath,
  JSON.stringify({
    imports: { ...denoJson.imports, "@mcpview/contracts": contractsEntryPoint },
  }),
);

await build({
  entryPoints: [
    "./mod.ts",
    { name: "./contracts", path: "./contracts.ts" },
    { name: "./react", path: "./react.ts" },
    { name: "./context", path: "./context.ts" },
  ],
  outDir: "./dist-node",
  shims: {
    deno: false,
  },
  package: {
    name: "@mcpview/view",
    version: VERSION,
    description: "View-side SDK for MCP Apps with in-iframe routing and host tool calls",
    license: "MIT",
    engines: { node: ">=20" },
    repository: {
      type: "git",
      url: "git+https://github.com/mcpview/mcpview.git",
      directory: "packages/view",
    },
    homepage: "https://mcpview.dev",
    bugs: { url: "https://github.com/mcpview/mcpview/issues" },
    keywords: [
      "mcp",
      "model-context-protocol",
      "mcp-apps",
      "iframe",
      "ui",
      "viewer",
    ],
  },
  compilerOptions: {
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    target: "ES2022",
  },
  typeCheck: false,
  test: false,
  importMap: npmImportMapPath,
  // Keep contracts external without fetching npm during dnt installation.
  // The dependency range is added below after the build.
  mappings: {
    [contractsEntryPoint]: { name: "@mcpview/contracts" },
  },
}).finally(() => Deno.remove(npmImportMapPath));

const pkgPath = "dist-node/package.json";
const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
pkg.types = "./esm/mod.d.ts";
pkg.exports = {
  ".": {
    types: "./esm/mod.d.ts",
    import: "./esm/mod.js",
    require: "./script/mod.js",
  },
  "./context": {
    types: "./esm/context.d.ts",
    import: "./esm/context.js",
    require: "./script/context.js",
  },
  "./contracts": {
    types: "./esm/contracts.d.ts",
    import: "./esm/contracts.js",
    require: "./script/contracts.js",
  },
  "./react": {
    types: "./esm/react.d.ts",
    import: "./esm/react.js",
    require: "./script/react.js",
  },
};
pkg.dependencies ??= {};
pkg.dependencies["@mcpview/contracts"] = `^${contractsDenoJson.version}`;

// dnt sees the optional React entry point and initially records its imports as
// hard dependencies. Keep the base package renderer-neutral: npm consumers
// that only import `@mcpview/view` must not install a UI framework. Projects
// opting into `@mcpview/view/react` already own these renderer dependencies.
const optionalReactPeers = [
  "react",
  "react-dom",
  "@types/react",
  "@types/react-dom",
] as const;
pkg.peerDependencies ??= {};
pkg.peerDependenciesMeta ??= {};
for (const dependency of optionalReactPeers) {
  const version = pkg.dependencies?.[dependency];
  if (!version) {
    throw new Error(`[build-npm] expected dnt dependency ${dependency}`);
  }
  delete pkg.dependencies[dependency];
  pkg.peerDependencies[dependency] = version;
  pkg.peerDependenciesMeta[dependency] = { optional: true };
}
await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}
await Deno.mkdir("dist-node/docs/decision-records", { recursive: true });
await Deno.copyFile("docs/adoption.md", "dist-node/docs/adoption.md");
for await (const entry of Deno.readDir("docs/decision-records")) {
  if (!entry.isFile || !entry.name.endsWith(".md")) continue;
  await Deno.copyFile(
    `docs/decision-records/${entry.name}`,
    `dist-node/docs/decision-records/${entry.name}`,
  );
}

await smokeTestPackageImport();

console.log("\n[build-npm] Done. Output in ./dist-node/");

async function smokeTestPackageImport(): Promise<void> {
  const tempConsumer = await Deno.makeTempDir({
    prefix: "mcp-view-npm-smoke-",
  });
  try {
    const packageScope = `${tempConsumer}/node_modules/@mcpview`;
    await Deno.mkdir(packageScope, { recursive: true });
    await Deno.symlink(
      new URL("../dist-node", import.meta.url).pathname,
      `${packageScope}/view`,
      { type: "dir" },
    );
    await Deno.symlink(
      new URL("../../view-contracts/dist-node", import.meta.url).pathname,
      `${packageScope}/contracts`,
      { type: "dir" },
    );
    const command = new Deno.Command("node", {
      cwd: tempConsumer,
      args: [
        "--preserve-symlinks",
        "--input-type=module",
        "--eval",
        [
          "const mod = await import('@mcpview/view');",
          "if (typeof mod.createMcpApp !== 'function') {",
          "  throw new Error('createMcpApp export missing');",
          "}",
          "if (typeof mod.defineView !== 'function') {",
          "  throw new Error('defineView export missing');",
          "}",
          "if ('installMcpViewTheme' in mod || 'defineComponentRegistry' in mod) {",
          "  throw new Error('core root leaks component or theme exports');",
          "}",
          "const contracts = await import('@mcpview/view/contracts');",
          "if (contracts.SEMANTIC_SELECTION_SCHEMA !== 'io.casys.semantic-selection/1.0' ||",
          "    typeof contracts.defineViewAppManifest !== 'function') {",
          "  throw new Error('composition contracts export missing');",
          "}",
          "const context = await import('@mcpview/view/context');",
          "if (typeof context.createActiveContextController !== 'function' ||",
          "    typeof context.createClickIntentArbiter !== 'function') {",
          "  throw new Error('active context entry exports missing');",
          "}",
          "const react = await import('@mcpview/view/react');",
          "if (typeof react.defineReactView !== 'function') {",
          "  throw new Error('defineReactView export missing');",
          "}",
        ].join("\n"),
      ],
    });
    const result = await command.output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      const stdout = new TextDecoder().decode(result.stdout).trim();
      throw new Error(
        [
          "[build-npm] npm import smoke test failed",
          stdout && `stdout:\n${stdout}`,
          stderr && `stderr:\n${stderr}`,
        ].filter(Boolean).join("\n"),
      );
    }
  } finally {
    await Deno.remove(tempConsumer, { recursive: true });
  }
}
