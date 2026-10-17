/**
 * Build script for @casys/mcp-bridge npm package.
 *
 * Uses dnt (Deno to Node Transform) to produce ESM + CJS + type declarations
 * from the Deno source.
 *
 * Usage:
 *   deno run -A scripts/build-npm.ts
 */

import { build, emptyDir } from "@deno/dnt";

const denoJsonText = await Deno.readTextFile(
  new URL("../deno.json", import.meta.url),
);
const denoJson = JSON.parse(denoJsonText) as { version?: string };
const VERSION = denoJson.version;
if (!VERSION) {
  throw new Error(
    "[build-npm] failed to read version from packages/bridge/deno.json",
  );
}
console.log(`[build-npm] Version: ${VERSION}`);

await emptyDir("./dist-node");

await build({
  entryPoints: [
    "./src/mod.ts",
    { name: "./adapters/network", path: "./src/adapters/network/mod.ts" },
  ],
  outDir: "./dist-node",
  shims: {
    deno: false,
  },
  package: {
    name: "@casys/mcp-bridge",
    version: VERSION,
    description:
      "Bridge MCP Apps interactive UIs to messaging platforms (Telegram Mini Apps, LINE LIFF)",
    license: "MIT",
    repository: {
      type: "git",
      url: "https://github.com/superWorldSavior/mcp-server",
    },
    keywords: [
      "mcp",
      "model-context-protocol",
      "telegram",
      "mini-apps",
      "line",
      "liff",
      "bridge",
      "messaging",
    ],
  },
  compilerOptions: {
    lib: ["ES2022", "DOM"],
    target: "ES2022",
  },
  // server.ts uses Deno.serve / Deno.readTextFile / Deno.readFile —
  // type-checking would fail for those. Consumers who need the resource
  // server should run it with Deno; the npm package exposes client-side
  // and protocol utilities that are runtime-agnostic.
  typeCheck: false,
  test: false,
  importMap: "./deno.json",
});

// Copy bridge.js client script to dist so npm consumers can serve it
const bridgeSrc = "src/client/bridge.js";

async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (err) {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  }
}

await ensureDir("dist-node/esm/client");
await ensureDir("dist-node/script/client");

await Deno.copyFile(bridgeSrc, "dist-node/esm/client/bridge.js");
await Deno.copyFile(bridgeSrc, "dist-node/script/client/bridge.js");

// Patch package.json: add "types" field and types conditions in exports
// for broader TypeScript compatibility (moduleResolution: node, bundler, etc.)
const pkgPath = "dist-node/package.json";
const pkg = JSON.parse(await Deno.readTextFile(pkgPath));
pkg.types = "./esm/mod.d.ts";
pkg.exports = {
  ".": {
    types: "./esm/mod.d.ts",
    import: "./esm/mod.js",
    require: "./script/mod.js",
  },
  "./adapters/network": {
    types: "./esm/adapters/network/mod.d.ts",
    import: "./esm/adapters/network/mod.js",
    require: "./script/adapters/network/mod.js",
  },
};
await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

await smokeTestNetworkAdapterSubpath();

console.log("\n[build-npm] Done. Output in ./dist-node/");

async function smokeTestNetworkAdapterSubpath(): Promise<void> {
  const tempConsumer = await Deno.makeTempDir({
    prefix: "mcp-bridge-npm-smoke-",
  });
  try {
    const packageScope = `${tempConsumer}/node_modules/@casys`;
    await Deno.mkdir(packageScope, { recursive: true });
    await Deno.symlink(
      new URL("../dist-node", import.meta.url).pathname,
      `${packageScope}/mcp-bridge`,
      { type: "dir" },
    );
    const command = new Deno.Command("node", {
      cwd: tempConsumer,
      args: [
        "--input-type=module",
        "--eval",
        [
          "const mod = await import('@casys/mcp-bridge/adapters/network');",
          "if (typeof mod.NetworkRelay !== 'function') {",
          "  throw new Error('NetworkRelay export missing');",
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
          "[build-npm] npm subpath smoke test failed",
          stdout && `stdout:\n${stdout}`,
          stderr && `stderr:\n${stderr}`,
        ].filter(Boolean).join("\n"),
      );
    }
  } finally {
    await Deno.remove(tempConsumer, { recursive: true });
  }
}
