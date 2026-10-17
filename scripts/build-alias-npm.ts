#!/usr/bin/env -S deno run -A
/**
 * Build a deprecated `@casys/*` alias package for npm.
 *
 * The aliases ship no code of their own: every entry point is a one-line
 * re-export of the matching `@mcpview/*` entry point. dnt (which cannot
 * externalize an import-mapped `jsr:` dependency and would bundle the whole
 * target) is the wrong tool, so this script emits the re-exports directly and
 * declares the target as a real npm dependency instead.
 *
 * Run it from an alias package directory (`packages/legacy/<alias>/`):
 *
 *   deno run -A ../../../scripts/build-alias-npm.ts --target=@mcpview/view --cjs
 *
 * Flags:
 *   --target=<name>      Canonical package the alias re-exports (required).
 *   --cjs                Also emit CommonJS entry points. Set it exactly when
 *                        the target ships a `require` condition.
 *   --jsr-only=<a,b>     Sub-paths exported on JSR but deliberately absent from
 *                        the target's npm build (for example `./scaffold`).
 *
 * The dependency range is read from the alias `deno.json` import map, so the
 * JSR and npm publications cannot drift apart.
 */

interface DenoConfig {
  name?: string;
  version?: string;
  exports?: string | Record<string, string>;
  imports?: Record<string, string>;
  workspace?: string[];
}

function fail(message: string): never {
  throw new Error(`[build-alias-npm] ${message}`);
}

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const target = flag("target");
if (!target?.startsWith("@mcpview/")) {
  fail("--target=@mcpview/<name> is required");
}
const cjs = Deno.args.includes("--cjs");
const jsrOnly = new Set((flag("jsr-only") ?? "").split(",").filter(Boolean));

const denoJson = JSON.parse(await Deno.readTextFile("deno.json")) as DenoConfig;
const { name, version } = denoJson;
if (!name?.startsWith("@casys/") || !version) {
  fail("deno.json must declare a @casys/* name and a version");
}
if (typeof denoJson.exports !== "object" || denoJson.exports === null) {
  fail('deno.json "exports" must be an object map of sub-paths');
}

// The alias tracks the workspace target: fail loudly if the target's minor
// drifted past the emitted npm range instead of publishing a stale pin. Patch
// drift inside the minor self-resolves through the ^ range.
const targetSpecifier = denoJson.imports?.[target];
const rangeMatch = targetSpecifier?.match(
  new RegExp(`^jsr:${target}@(\\^\\d+\\.\\d+\\.\\d+)$`),
);
const npmRange = rangeMatch?.[1];
if (!npmRange) {
  fail(
    `deno.json must map ${target} to an explicit jsr:${target}@^semver range`,
  );
}

const rootUrl = new URL("../", import.meta.url);
const rootConfig = JSON.parse(
  await Deno.readTextFile(new URL("deno.json", rootUrl)),
) as DenoConfig;
let targetVersion: string | undefined;
for (const member of rootConfig.workspace ?? []) {
  const memberConfig = JSON.parse(
    await Deno.readTextFile(new URL(`${member}/deno.json`, rootUrl)),
  ) as DenoConfig;
  if (memberConfig.name === target) targetVersion = memberConfig.version;
}
if (!targetVersion) fail(`no workspace member is named ${target}`);
const targetMinor = targetVersion.match(/^(\d+\.\d+)\./)?.[1];
const rangeMinor = npmRange.match(/^\^(\d+\.\d+)\./)?.[1];
if (!targetMinor || targetMinor !== rangeMinor) {
  fail(
    `target skew: workspace ${target} is ${targetVersion}, alias range is ${npmRange}`,
  );
}

console.log(`[build-alias-npm] ${name}@${version} -> ${target}${npmRange}`);
await Deno.remove("./dist-node", { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});

const packageExports: Record<string, Record<string, string>> = {};
for (const [subpath, file] of Object.entries(denoJson.exports)) {
  if (jsrOnly.has(subpath)) continue;
  const base = file.replace(/^\.\//, "").replace(/\.ts$/, "");
  const specifier = subpath === "." ? target : `${target}/${subpath.slice(2)}`;
  const reexport = `export * from "${specifier}";\n`;

  await Deno.mkdir("./dist-node/esm", { recursive: true });
  await Deno.writeTextFile(`./dist-node/esm/${base}.js`, reexport);
  await Deno.writeTextFile(`./dist-node/esm/${base}.d.ts`, reexport);
  const conditions: Record<string, string> = {
    types: `./esm/${base}.d.ts`,
    import: `./esm/${base}.js`,
  };
  if (cjs) {
    await Deno.mkdir("./dist-node/script", { recursive: true });
    await Deno.writeTextFile(
      `./dist-node/script/${base}.js`,
      `"use strict";\nmodule.exports = require("${specifier}");\n`,
    );
    await Deno.writeTextFile(`./dist-node/script/${base}.d.ts`, reexport);
    conditions.require = `./script/${base}.js`;
  }
  packageExports[subpath] = conditions;
}
for (const subpath of jsrOnly) {
  if (!(subpath in denoJson.exports)) {
    fail(`--jsr-only names an unknown sub-path: ${subpath}`);
  }
}
if (!packageExports["."]) fail('deno.json must export the "." entry point');

const packageJson: Record<string, unknown> = {
  name,
  version,
  description: `Deprecated alias — re-exports ${target}`,
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/mcpview/mcpview.git",
    directory: `packages/legacy/${name.slice("@casys/".length)}`,
  },
  homepage: "https://mcpview.dev",
  bugs: { url: "https://github.com/mcpview/mcpview/issues" },
  keywords: ["mcp", "model-context-protocol", "deprecated", "alias"],
  engines: { node: ">=20.0.0" },
  dependencies: { [target]: npmRange },
  // npm surfaces this on install and on `npm view`: the rename notice reaches
  // consumers at the moment they depend on the old name.
  deprecated: `Moved to ${target}`,
  main: cjs ? "./script/mod.js" : "./esm/mod.js",
  types: "./esm/mod.d.ts",
  exports: packageExports,
  files: cjs
    ? ["esm", "script", "README.md", "LICENSE", "CHANGELOG.md"]
    : ["esm", "README.md", "LICENSE", "CHANGELOG.md"],
};
if (cjs) {
  // Mirror dnt: the package is dual, so each output tree declares its format.
  packageJson.module = "./esm/mod.js";
  await Deno.writeTextFile(
    "./dist-node/esm/package.json",
    '{\n  "type": "module"\n}\n',
  );
  await Deno.writeTextFile(
    "./dist-node/script/package.json",
    '{\n  "type": "commonjs"\n}\n',
  );
} else {
  // ESM-only output: without this, Node <20.19 parses esm/*.js as CommonJS and
  // the re-export breaks (engines floor is >=20).
  packageJson.type = "module";
}
await Deno.writeTextFile(
  "dist-node/package.json",
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

console.log("[build-alias-npm] Done. Output: dist-node/");
