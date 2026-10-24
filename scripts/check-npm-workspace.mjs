/** Build and test the unpublished workspace as an isolated npm consumer.
 * Run from anywhere: node scripts/check-npm-workspace.mjs [--skip-build]
 * --skip-build is for local diagnosis after building all thirteen packages.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The view build's own smoke test needs contracts built first.
const members = JSON.parse(readFileSync(join(root, "deno.json"), "utf8"))
  .workspace.map((member) => member.replace(/^\.\/packages\//, ""));
assert(
  process.argv.slice(2).every((arg) => arg === "--skip-build"),
  "Unknown argument",
);
const scratch = mkdtempSync(join(tmpdir(), "mcp-npm-workspace-"));
const run = (command, args, cwd = root, capture = false) =>
  execFileSync(command, args, {
    cwd,
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

try {
  const tarballs = new Map();
  for (const member of members) {
    const packageDir = join(root, "packages", member);
    if (!process.argv.includes("--skip-build")) {
      run(
        "deno",
        ["task", "build:npm"],
        packageDir,
      );
    }
    const manifest = json(join(packageDir, "dist-node", "package.json"));
    const source = json(join(packageDir, "deno.json"));
    assert.equal(manifest.name, source.name);
    assert.equal(manifest.version, source.version);
    const [pack] = JSON.parse(run(
      "npm",
      [
        "pack",
        "./dist-node",
        "--pack-destination",
        scratch,
        "--json",
        "--ignore-scripts",
      ],
      packageDir,
      true,
    ));
    for (const asset of ["LICENSE", "README.md"]) {
      assert(
        pack.files.some((file) => file.path === asset),
        `${manifest.name}: missing ${asset}`,
      );
    }
    // The server is ESM-only; later Node releases can mask a missing type field.
    if (member === "server") {
      assert.equal(manifest.type, "module");
    }
    tarballs.set(manifest.name, {
      path: join(scratch, pack.filename),
      version: manifest.version,
    });
  }

  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  // Install every workspace tarball in one operation so sibling ranges resolve
  // to this checkout. Never install an alias alone against the npm registry.
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...Array.from(tarballs.values(), ({ path }) => path),
    "typescript@5.9.3",
    "@types/node@22.18.6",
    "react@18.3.1",
    "react-dom@18.3.1",
    "@types/react@18.3.28",
    "@types/react-dom@18.3.7",
    "preact@10.28.3",
  ], scratch);

  const installed = json(join(scratch, "package-lock.json")).packages;
  for (const [location, pkg] of Object.entries(installed)) {
    assert(
      !/(?:^|\/)node_modules\/@modelcontextprotocol\/sdk$/.test(location),
      `Legacy SDK v1 installed at ${location}`,
    );
    const name = location.match(
      /(?:^|\/)node_modules\/(@(?:casys|mcpview)\/[^/]+)$/,
    )?.[1];
    if (!tarballs.has(name)) continue;
    const expected = tarballs.get(name);
    assert.equal(
      pkg.version,
      expected.version,
      `${location}: wrong workspace version`,
    );
    assert(
      pkg.resolved?.startsWith("file:"),
      `${location}: fetched a registry sibling`,
    );
    assert.equal(
      resolve(scratch, pkg.resolved.slice(5)),
      expected.path,
      `${location}: wrong archive`,
    );
    assert(
      !pkg.link,
      `${location}: expected an archive installation, not a symlink`,
    );
  }
  for (const name of tarballs.keys()) {
    assert(installed[`node_modules/${name}`], `Missing ${name}`);
  }

  // Check every published alias sub-path, including exports that the fixture
  // does not import statically. JSR-only sub-paths are absent from this manifest.
  for (const name of tarballs.keys()) {
    if (!name.startsWith("@casys/")) continue;
    const manifest = json(join(scratch, "node_modules", name, "package.json"));
    const target = Object.keys(manifest.dependencies)[0];
    for (const subpath of Object.keys(manifest.exports)) {
      const suffix = subpath === "." ? "" : subpath.slice(1);
      run(process.execPath, [
        "--input-type=module",
        "--eval",
        `
        import assert from "node:assert/strict";
        const alias = await import(${JSON.stringify(name + suffix)});
        const target = await import(${JSON.stringify(target + suffix)});
        assert.deepEqual(Object.keys(alias).sort(), Object.keys(target).sort());
        for (const key of Object.keys(target)) assert.equal(alias[key], target[key]);
      `,
      ], scratch);
    }
  }

  copyFileSync(
    join(root, "scripts", "npm-workspace-consumer.ts"),
    join(scratch, "consumer.ts"),
  );
  for (const member of ["server"]) {
    copyFileSync(
      join(root, "packages", member, "scripts", "smoke-node-consumer.ts"),
      join(scratch, `${member}.ts`),
    );
  }
  run(process.execPath, [
    join(scratch, "node_modules", "typescript", "bin", "tsc"),
    "--strict",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--lib",
    "ES2022,DOM,DOM.Iterable",
    "--outDir",
    "compiled",
    "consumer.ts",
    "server.ts",
  ], scratch);
  run(process.execPath, ["compiled/consumer.js"], scratch);
  console.log(`All thirteen local npm packages passed on ${process.version}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
