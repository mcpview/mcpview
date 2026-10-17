/** Build the dependency-free @casys/mcp-view-contracts npm package. */

import { build, emptyDir } from "@deno/dnt";

const denoJson = JSON.parse(
  await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
) as { version?: string };
if (!denoJson.version) {
  throw new Error("[build-npm] missing packages/view-contracts version");
}

await emptyDir("./dist-node");
await build({
  entryPoints: ["./mod.ts"],
  outDir: "./dist-node",
  shims: { deno: false },
  package: {
    name: "@casys/mcp-view-contracts",
    version: denoJson.version,
    description: "Dependency-free MCP App resource, composition, and session contracts",
    license: "MIT",
    repository: { type: "git", url: "https://github.com/superWorldSavior/mcp-server" },
    keywords: ["mcp", "model-context-protocol", "mcp-apps", "contracts", "manifest"],
  },
  compilerOptions: { lib: ["ES2022"], target: "ES2022" },
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
};
if (Object.keys(packageJson.dependencies ?? {}).length !== 0) {
  throw new Error("[build-npm] contracts package acquired runtime dependencies");
}
delete packageJson.dependencies;
await Deno.writeTextFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

for (const asset of ["README.md", "LICENSE"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

const consumer = await Deno.makeTempDir({ prefix: "mcp-view-contracts-smoke-" });
try {
  const scope = `${consumer}/node_modules/@casys`;
  await Deno.mkdir(scope, { recursive: true });
  await Deno.symlink(
    new URL("../dist-node", import.meta.url).pathname,
    `${scope}/mcp-view-contracts`,
    {
      type: "dir",
    },
  );
  const result = await new Deno.Command("node", {
    cwd: consumer,
    args: [
      "--input-type=module",
      "--eval",
      [
        "const contracts = await import('@casys/mcp-view-contracts');",
        "if (contracts.VIEWER_SESSION_APPLY_ACTION !== 'viewer.session.apply') throw new Error('session action missing');",
        "if (typeof contracts.defineViewAppManifest !== 'function') throw new Error('manifest validator missing');",
      ].join("\n"),
    ],
  }).output();
  if (!result.success) {
    throw new Error(new TextDecoder().decode(result.stderr).trim());
  }
} finally {
  await Deno.remove(consumer, { recursive: true });
}

console.log("[build-npm] @casys/mcp-view-contracts ready in ./dist-node/");
