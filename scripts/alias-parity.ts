/**
 * Shared parity assertions for the deprecated `@casys/*` alias packages in
 * `packages/legacy/`. Each alias test imports one module namespace per export
 * sub-path (the alias entry and its `@mcpview/*` target) and calls these
 * helpers, so a target gaining, dropping, or renaming an export fails the
 * alias suite instead of silently breaking old imports.
 */

import { assert, assertEquals } from "@std/assert";

/**
 * The alias entry must expose exactly the target entry's runtime export names,
 * bound to the very same values. `export *` skips only `default`, which none of
 * the targets define, so the key sets must match with no exception.
 */
export function assertModuleParity(
  subpath: string,
  alias: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  const aliasKeys = Object.keys(alias).sort();
  assert(aliasKeys.length > 0, `alias sub-path ${subpath} re-exports nothing`);
  assertEquals(
    aliasKeys,
    Object.keys(target).sort(),
    `alias sub-path ${subpath} does not expose the same export names as its target`,
  );
  for (const key of aliasKeys) {
    assert(
      Object.is(alias[key], target[key]),
      `alias sub-path ${subpath}: export "${key}" is not the target's value`,
    );
  }
}

type ExportMap = Record<string, string>;

async function readExportMap(config: URL): Promise<ExportMap> {
  const { exports } = JSON.parse(await Deno.readTextFile(config)) as {
    exports?: string | ExportMap;
  };
  assert(exports !== undefined, `${config.pathname} declares no "exports"`);
  return typeof exports === "string" ? { ".": exports } : exports;
}

/**
 * The alias must declare exactly the sub-paths its target exports, so every
 * `@casys/<alias>/<sub-path>` import that used to work has a counterpart.
 */
export async function assertExportMapParity(
  aliasConfig: URL,
  targetConfig: URL,
): Promise<void> {
  const [alias, target] = await Promise.all([
    readExportMap(aliasConfig),
    readExportMap(targetConfig),
  ]);
  assertEquals(
    Object.keys(alias).sort(),
    Object.keys(target).sort(),
    "alias deno.json must export the same sub-paths as its target",
  );
}
