// Build the server-side replay archive from the same trusted ERPNext checkout as the UI.
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { source: { type: "string" }, output: { type: "string" } },
});
if (!values.source || !values.output) {
  throw new Error("Usage: node prepare-buy-archive.mjs --source ERP_CHECKOUT --output ASSETS");
}
const source = resolve(values.source);
const archive = resolve(values.output, "buy-archive");
const requireFromUi = createRequire(join(source, "src/ui/package.json"));
const { build } = requireFromUi("esbuild");
const fixtures = await mkdtemp(join(tmpdir(), "erpnext-buy-contract-"));
try {
  // The provider's generator validates its reference sessions before writing them.
  execFileSync("deno", [
    "run",
    "--no-config",
    "--no-lock",
    `--allow-write=${fixtures}`,
    join(source, "scripts/buy-write-contract-fixtures.ts"),
    fixtures,
  ]);
  await mkdir(archive, { recursive: true });
  for (const record of ["complete", "unavailable"]) {
    await copyFile(
      join(fixtures, "accepted", `buy-recorded-session.${record}.json`),
      join(archive, `${record}.json`),
    );
  }
  await build({
    entryPoints: [join(source, "src/buy/session.ts")],
    outfile: join(archive, "session-parser.mjs"),
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2022",
  });
} finally {
  await rm(fixtures, { recursive: true, force: true });
}
