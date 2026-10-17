/**
 * Build @casys/mcp-platform (deprecated alias) as native ESM JavaScript for npm.
 *
 * This package ships no code of its own: `mod.ts` re-exports the framework,
 * so dnt (which cannot externalize an import-mapped `jsr:` dependency and
 * would bundle the whole framework) is the wrong tool. This script emits the
 * one-line re-export directly and declares the framework as a real npm
 * dependency instead.
 */

const denoJsonText = await Deno.readTextFile(
  new URL("../deno.json", import.meta.url),
);
const denoJson = JSON.parse(denoJsonText) as {
  version?: string;
  imports?: Record<string, string>;
};
const version = denoJson.version;
if (!version) {
  throw new Error(
    "[build-npm] failed to read version from packages/platform/deno.json",
  );
}

// Keep the compatibility alias's JSR and npm dependency floors identical.
// Deno publishes this explicit workspace import range to JSR; the npm build
// derives its dependency from the same value instead of maintaining a second
// version constant that can drift.
const serverJsrSpecifier = denoJson.imports?.["@casys/mcp-server"];
const frameworkRangeMatch = serverJsrSpecifier?.match(
  /^jsr:@casys\/mcp-server@(\^\d+\.\d+\.\d+)$/,
);
const frameworkNpmRange = frameworkRangeMatch?.[1];
if (!frameworkNpmRange) {
  throw new Error(
    "[build-npm] packages/platform/deno.json must map @casys/mcp-server " +
      "to an explicit jsr:^semver range",
  );
}

// The alias tracks the workspace framework: fail loudly if the framework's
// minor drifted past the emitted npm range instead of publishing a stale pin.
// Patch drift inside the minor self-resolves through the ^ range.
const serverDenoJson = JSON.parse(
  await Deno.readTextFile(new URL("../../server/deno.json", import.meta.url)),
) as { version?: string };
const serverMinor = serverDenoJson.version?.match(/^(\d+\.\d+)\./)?.[1];
const npmMinor = frameworkNpmRange.match(/^\^(\d+\.\d+)\./)?.[1];
if (!serverMinor || serverMinor !== npmMinor) {
  throw new Error(
    `[build-npm] framework skew: workspace server is ${serverDenoJson.version}, ` +
      `alias range is ${frameworkNpmRange}`,
  );
}

console.log(`[build-npm] Version: ${version}`);
await Deno.remove("./dist-node", { recursive: true }).catch((error) => {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
});
await Deno.mkdir("./dist-node/esm", { recursive: true });

const entry = 'export * from "@casys/mcp-server";\n';
await Deno.writeTextFile("./dist-node/esm/mod.js", entry);
await Deno.writeTextFile("./dist-node/esm/mod.d.ts", entry);

const packageJson = {
  name: "@casys/mcp-platform",
  version,
  // ESM-only output: without this, Node <20.19 parses esm/*.js as CommonJS
  // and the re-export breaks (engines floor is >=20).
  type: "module",
  description: "Deprecated alias — re-exports the @casys/mcp-server framework",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/superWorldSavior/mcp-server.git",
  },
  keywords: [
    "mcp",
    "model-context-protocol",
    "framework",
  ],
  engines: {
    node: ">=20.0.0",
  },
  dependencies: {
    "@casys/mcp-server": frameworkNpmRange,
  },
  // npm surfaces this on install and on `npm view`: the rename notice reaches
  // consumers at the moment they depend on the old name.
  deprecated: "Renamed back to @casys/mcp-server",
  main: "./esm/mod.js",
  types: "./esm/mod.d.ts",
  exports: {
    ".": {
      types: "./esm/mod.d.ts",
      import: "./esm/mod.js",
    },
  },
  files: ["esm", "README.md", "LICENSE", "CHANGELOG.md"],
};
await Deno.writeTextFile(
  "dist-node/package.json",
  `${JSON.stringify(packageJson, null, 2)}\n`,
);

for (const asset of ["README.md", "LICENSE", "CHANGELOG.md"] as const) {
  await Deno.copyFile(asset, `dist-node/${asset}`);
}

console.log("[build-npm] Done. Output: dist-node/");
