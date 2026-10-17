/**
 * Build @mcpview/server as native ESM JavaScript for npm.
 *
 * Deno remains the canonical source/runtime. dnt translates the same public
 * entry point, import map, and runtime selector into JavaScript plus declaration
 * files that a stock Node process can load without a TypeScript loader.
 */

import { build, emptyDir } from "@deno/dnt";

const denoJsonText = await Deno.readTextFile(
  new URL("../deno.json", import.meta.url),
);
const denoJson = JSON.parse(denoJsonText) as { version?: string };
const version = denoJson.version;
if (!version) {
  throw new Error(
    "[build-npm] failed to read version from packages/server/deno.json",
  );
}

console.log(`[build-npm] Version: ${version}`);
await emptyDir("./dist-node");

await build({
  entryPoints: ["./mod.ts"],
  outDir: "./dist-node",
  shims: {
    deno: false,
  },
  package: {
    name: "@mcpview/server",
    version,
    description: "MCP server framework for Deno and Node",
    license: "MIT",
    repository: {
      type: "git",
      url: "git+https://github.com/mcpview/mcpview.git",
      directory: "packages/server",
    },
    homepage: "https://mcpview.dev",
    bugs: { url: "https://github.com/mcpview/mcpview/issues" },
    keywords: [
      "mcp",
      "model-context-protocol",
      "server",
      "middleware",
      "oauth",
      "observability",
    ],
    engines: {
      node: ">=20.0.0",
    },
  },
  compilerOptions: {
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    target: "ES2022",
  },
  // The Deno release preflight type-checks the canonical source. dnt's job is
  // translation, including the inactive Deno adapter in the runtime selector.
  typeCheck: false,
  test: false,
  importMap: "./deno.json",
  // runtime.ts uses top-level await to load exactly one host adapter. A CJS
  // output cannot represent that contract, so npm intentionally ships ESM.
  scriptModule: false,
});

const packageJsonPath = "dist-node/package.json";
const packageJson = JSON.parse(
  await Deno.readTextFile(packageJsonPath),
) as Record<string, unknown>;
packageJson.main = "./esm/mod.js";
// ESM-only output (scriptModule: false): without this, Node <20.19 parses
// esm/*.js as CommonJS and every import breaks (engines floor is >=20).
packageJson.type = "module";
packageJson.types = "./esm/mod.d.ts";
packageJson.exports = {
  ".": {
    types: "./esm/mod.d.ts",
    import: "./esm/mod.js",
  },
};
packageJson.files = ["esm", "README.md", "LICENSE", "CHANGELOG.md"];
await Deno.writeTextFile(
  packageJsonPath,
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

console.log("[build-npm] Done. Output: dist-node/");
