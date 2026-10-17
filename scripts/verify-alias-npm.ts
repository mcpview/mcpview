#!/usr/bin/env -S deno run -A
/**
 * Verify a built `@casys/*` alias package the way an npm consumer sees it.
 *
 * Run it from an alias package directory (`packages/legacy/<alias>/`) after
 * `deno task build:npm`:
 *
 *   deno run -A ../../../scripts/verify-alias-npm.ts
 *
 * What it proves, in order:
 *  1. the tarball carries LICENSE, README.md, and CHANGELOG.md, and the
 *     manifest carries the `deprecated` notice and an ESM `type` when the
 *     alias is ESM-only;
 *  2. a clean consumer can install the tarball together with the target from
 *     the registry, import every sub-path of the alias and of the target, and
 *     sees exactly the same export names bound to the same values (ESM, and
 *     CommonJS when the alias ships a `require` condition);
 *  3. a strict NodeNext TypeScript consumer type-checks the alias entry points;
 *  4. the same holds against the declared lower bound of the dependency range,
 *     so a later target patch cannot silently raise the alias floor.
 *
 * Local rehearsal before the target is on the registry: pass the target (and
 * its own `@mcpview/*` dependencies) as local tarballs with one
 * `--target-tarball=<path>` each. The registry is then not consulted for them
 * and the lower-bound pass is skipped.
 */

interface AliasManifest {
  name: string;
  version: string;
  type?: string;
  deprecated?: string;
  dependencies: Record<string, string>;
  exports: Record<string, Record<string, string>>;
}

function fail(message: string): never {
  throw new Error(`[verify-alias-npm] ${message}`);
}

async function run(
  command: string,
  args: string[],
  options: { cwd?: string; capture?: boolean } = {},
): Promise<string> {
  const result = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    stdout: options.capture ? "piped" : "inherit",
    stderr: "inherit",
  }).output();
  if (!result.success) {
    fail(
      `\`${command} ${args.join(" ")}\` failed with exit code ${result.code}`,
    );
  }
  return options.capture ? new TextDecoder().decode(result.stdout) : "";
}

// Resolved up front: npm runs inside a temporary consumer directory, where a
// relative path would no longer point at the tarball.
const localTarballs = await Promise.all(
  Deno.args
    .filter((arg) => arg.startsWith("--target-tarball="))
    .map((arg) => Deno.realPath(arg.slice("--target-tarball=".length))),
);

/** Wait for a version that the previous CI job just published to be resolvable. */
async function waitForRegistry(
  spec: string,
  attempts = 6,
  delayMs = 15_000,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = await new Deno.Command("npm", {
      args: ["view", spec, "version"],
      stdout: "null",
      stderr: "null",
    }).output();
    if (result.success) return;
    if (attempt < attempts) {
      console.log(
        `[verify-alias-npm] ${spec} not on the registry yet (${attempt}/${attempts})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  fail(`${spec} is not available on the npm registry`);
}

const manifest = JSON.parse(
  await Deno.readTextFile("dist-node/package.json"),
) as AliasManifest;
const [target, range] = Object.entries(manifest.dependencies)[0] ?? [];
if (!target || Object.keys(manifest.dependencies).length !== 1) {
  fail("an alias must depend on exactly one package: its target");
}
if (manifest.deprecated !== `Moved to ${target}`) {
  fail(`package.json "deprecated" must read "Moved to ${target}"`);
}
const floor = range.match(/^\^(\d+\.\d+\.\d+)$/)?.[1];
if (!floor) fail(`dependency range ${range} is not an explicit ^semver`);
const subpaths = Object.keys(manifest.exports);
const dual = Object.values(manifest.exports).every((conditions) =>
  "require" in conditions
);
if (!dual && manifest.type !== "module") {
  fail(
    'an ESM-only alias must declare "type": "module" (Node <20.19 would parse esm/*.js as CommonJS)',
  );
}

const work = await Deno.makeTempDir({ prefix: "verify-alias-npm-" });
try {
  // 1. Tarball contents.
  const packed = JSON.parse(
    await run("npm", [
      "pack",
      "./dist-node",
      "--pack-destination",
      work,
      "--json",
    ], {
      capture: true,
    }),
  ) as Array<{ filename: string }>;
  const tarball = `${work}/${packed[0].filename}`;
  const listing = (await run("tar", ["-tzf", tarball], { capture: true }))
    .split("\n");
  for (
    const required of [
      "package/LICENSE",
      "package/README.md",
      "package/CHANGELOG.md",
    ]
  ) {
    if (!listing.includes(required)) fail(`tarball is missing ${required}`);
  }

  // 2-3. Consumer: install, compare entry points, type-check.
  if (localTarballs.length === 0) await waitForRegistry(`${target}@${floor}`);
  const consumer = `${work}/consumer`;
  await Deno.mkdir(consumer);
  await run("npm", ["init", "--yes"], { cwd: consumer, capture: true });
  await run("npm", ["pkg", "set", "type=module"], {
    cwd: consumer,
    capture: true,
  });
  await run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
    ...localTarballs,
    // Optional peers of the view family, so every sub-path can actually load.
    "preact@10.28.3",
    "react@18.3.1",
    "react-dom@18.3.1",
    "typescript@5.9.3",
    "@types/node@22",
  ], { cwd: consumer });

  const aliasSpecifier = (subpath: string) =>
    subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`;
  const targetSpecifier = (subpath: string) =>
    subpath === "." ? target : `${target}/${subpath.slice(2)}`;

  await Deno.writeTextFile(
    `${consumer}/parity.mjs`,
    `import { createRequire } from "node:module";
const pairs = ${
      JSON.stringify(
        subpaths.map((s) => [aliasSpecifier(s), targetSpecifier(s)]),
      )
    };
const dual = ${JSON.stringify(dual)};
const require = createRequire(import.meta.url);
function compare(kind, label, alias, target) {
  const aliasKeys = Object.keys(alias).sort();
  const targetKeys = Object.keys(target).sort();
  if (aliasKeys.length === 0) throw new Error(kind + " " + label + " re-exports nothing");
  if (JSON.stringify(aliasKeys) !== JSON.stringify(targetKeys)) {
    throw new Error(kind + " " + label + " does not expose the target's export names");
  }
  for (const key of aliasKeys) {
    if (!Object.is(alias[key], target[key])) {
      throw new Error(kind + " " + label + ": export " + key + " is not the target's value");
    }
  }
}
for (const [aliasName, targetName] of pairs) {
  compare("ESM", aliasName, await import(aliasName), await import(targetName));
  if (dual) compare("CJS", aliasName, require(aliasName), require(targetName));
}
console.log("parity ok: " + pairs.length + " entry point(s)" + (dual ? ", ESM and CJS" : ", ESM"));
`,
  );

  const customSmoke = new URL(
    "scripts/smoke-node-consumer.ts",
    `file://${Deno.cwd()}/`,
  );
  let tsSmoke: string;
  let tsFlags: string[];
  try {
    tsSmoke = await Deno.readTextFile(customSmoke);
    tsFlags = [];
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    tsSmoke = subpaths
      .map((s, i) =>
        `import * as entry${i} from "${aliasSpecifier(s)}";\nvoid entry${i};\n`
      )
      .join("");
    // The target's declarations may name optional peers (react types); the
    // alias contract under test is that its own entry points resolve.
    tsFlags = ["--skipLibCheck"];
  }
  await Deno.writeTextFile(`${consumer}/smoke-node-consumer.ts`, tsSmoke);

  const check = async (label: string) => {
    console.log(`[verify-alias-npm] ${label}`);
    await run("node", ["parity.mjs"], { cwd: consumer });
    await run("npx", [
      "tsc",
      "--noEmit",
      "--strict",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--lib",
      "ES2022,DOM,DOM.Iterable",
      ...tsFlags,
      "smoke-node-consumer.ts",
    ], { cwd: consumer });
  };

  await check(
    `${manifest.name}@${manifest.version} against the newest ${target}${range}`,
  );

  // 4. Declared lower bound.
  if (localTarballs.length === 0) {
    await run("npm", [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${target}@${floor}`,
    ], {
      cwd: consumer,
    });
    const installed = JSON.parse(
      await Deno.readTextFile(
        `${consumer}/node_modules/${target}/package.json`,
      ),
    ) as { version: string };
    if (installed.version !== floor) {
      fail(
        `expected ${target}@${floor} to be installed, found ${installed.version}`,
      );
    }
    await check(
      `${manifest.name}@${manifest.version} against the lower bound ${target}@${floor}`,
    );
  } else {
    console.log(
      "[verify-alias-npm] local tarballs in use: lower-bound pass skipped",
    );
  }
  console.log(
    `[verify-alias-npm] ${manifest.name}@${manifest.version} verified`,
  );
} finally {
  await Deno.remove(work, { recursive: true });
}
