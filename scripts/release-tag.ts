#!/usr/bin/env -S deno run -A
/**
 * Release tag helper for the @casys mcp-server monorepo.
 *
 * Reads the version of a workspace package from `packages/<pkg>/deno.json`,
 * verifies that the matching CHANGELOG section exists and that `[Unreleased]`
 * has been promoted, then creates the annotated git tag `<pkg>-v<version>`
 * locally. The tag is *not* pushed — that's the operator's call.
 *
 * Usage:
 *   deno task release:tag    (from inside packages/<pkg>/)
 *   deno run -A scripts/release-tag.ts <pkg>
 *
 * Where <pkg> is one of: server, compose, bridge, view, view-contracts,
 * view-components, platform.
 */

const PACKAGES = [
  "server",
  "compose",
  "bridge",
  "view",
  "view-contracts",
  "view-components",
  "platform",
] as const;
type Pkg = (typeof PACKAGES)[number];

const repoRoot = new URL("..", import.meta.url).pathname;

function isPkg(s: string): s is Pkg {
  return (PACKAGES as readonly string[]).includes(s);
}

const pkg = Deno.args[0];
if (!pkg || !isPkg(pkg)) {
  console.error(
    `usage: release-tag.ts <${PACKAGES.join("|")}>\n  got: ${pkg ?? "(none)"}`,
  );
  Deno.exit(2);
}

const denoJsonPath = `${repoRoot}packages/${pkg}/deno.json`;
const changelogPath = `${repoRoot}packages/${pkg}/CHANGELOG.md`;

const denoJson = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
  version?: string;
};
const version = denoJson.version;
if (!version) {
  console.error(`[release-tag] no "version" field in ${denoJsonPath}`);
  Deno.exit(1);
}

const changelog = await Deno.readTextFile(changelogPath);
const tag = `${pkg}-v${version}`;
const versionHeading = `## [${version}]`;
if (!changelog.includes(versionHeading)) {
  console.error(
    `[release-tag] CHANGELOG.md is missing a "${versionHeading}" section.\n` +
      `  → Promote [Unreleased] to [${version}] before tagging.`,
  );
  Deno.exit(1);
}

const unreleasedMatch = changelog.match(
  /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[)/m,
);
if (unreleasedMatch && unreleasedMatch[1].trim().length > 0) {
  console.warn(
    `[release-tag] [Unreleased] section is non-empty — make sure pending\n` +
      `  changes are intentional before tagging.`,
  );
}

const existing = await new Deno.Command("git", {
  args: ["tag", "--list", tag],
  cwd: repoRoot,
  stdout: "piped",
}).output();
if (new TextDecoder().decode(existing.stdout).trim() === tag) {
  console.error(`[release-tag] tag ${tag} already exists locally — abort.`);
  Deno.exit(1);
}

const tagBody = `Release @casys/mcp-${pkg} ${version}.\n\n` +
  `See packages/${pkg}/CHANGELOG.md for details.`;
const tagResult = await new Deno.Command("git", {
  args: ["tag", "-a", tag, "-m", tagBody],
  cwd: repoRoot,
}).output();

if (!tagResult.success) {
  console.error(`[release-tag] git tag failed (exit ${tagResult.code})`);
  Deno.exit(tagResult.code);
}

console.log(`[release-tag] created ${tag}`);
console.log(
  `[release-tag] next step:  git push origin ${tag}\n` +
    `[release-tag] this triggers .github/workflows/release.yml`,
);
