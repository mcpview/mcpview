/**
 * Executable, dependency-free project generator for a vanilla MCP result
 * viewer. It intentionally emits one useful starting point rather than a
 * component framework or an application generator.
 *
 * @example
 * ```sh
 * deno run -A jsr:@mcpview/components@0.10.0/scaffold result-viewer ./my-view
 * ```
 */

import { dirname, isAbsolute, join, relative, resolve } from "@std/path";

import { resultViewerTemplates } from "./src/scaffold/result-viewer-templates.ts";

export interface ScaffoldOptions {
  /** Permit overwriting generated files in a non-empty target directory. */
  force?: boolean;
}

export class ScaffoldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldError";
  }
}

/** Generate the vanilla `result-viewer` starter in `target`. */
export async function scaffoldResultViewer(
  target: string,
  options: ScaffoldOptions = {},
): Promise<readonly string[]> {
  const destination = validateTarget(target);
  await ensureWritableDirectory(destination, options.force ?? false);

  const created: string[] = [];
  for (const [relativePath, contents] of Object.entries(resultViewerTemplates)) {
    const output = join(destination, relativePath);
    try {
      await Deno.mkdir(dirname(output), { recursive: true });
      await Deno.writeTextFile(output, contents);
      created.push(output);
    } catch (error) {
      throw new ScaffoldError(
        `Could not write ${output}: ${errorMessage(error)}. Check that the target is writable.`,
      );
    }
  }
  await formatGeneratedFiles(created);
  return created;
}

/** Parse CLI arguments without exiting, so callers and tests get useful errors. */
export function parseScaffoldArguments(args: readonly string[]): {
  target: string;
  options: ScaffoldOptions;
} {
  const force = args.includes("--force");
  const positional = args.filter((arg) => arg !== "--force");
  if (positional[0] !== "result-viewer" || positional.length !== 2) {
    throw new ScaffoldError(
      "Usage: mcp-view-components scaffold result-viewer <target> [--force]. Example: deno run -A jsr:@mcpview/components@0.10.0/scaffold result-viewer ./result-viewer",
    );
  }
  return { target: positional[1], options: { force } };
}

export async function runScaffoldCli(args: readonly string[]): Promise<void> {
  const { target, options } = parseScaffoldArguments(args);
  const created = await scaffoldResultViewer(target, options);
  console.log(`Created result-viewer scaffold in ${resolve(target)} (${created.length} files).`);
  console.log("Next: cd into the target, then run `deno task test` and `deno task build`.");
}

function validateTarget(target: string): string {
  if (!target || target.trim() === "") {
    throw new ScaffoldError(
      "A target directory is required. Example: result-viewer ./result-viewer",
    );
  }
  const resolved = isAbsolute(target) ? resolve(target) : resolve(Deno.cwd(), target);
  const cwd = resolve(Deno.cwd());
  const home = Deno.env.get("HOME");
  if (isSameOrAncestor(resolved, cwd) || (home !== undefined && resolve(home) === resolved)) {
    throw new ScaffoldError(
      "Refusing to scaffold into the filesystem root, the current directory, its ancestors, or the home directory; pass a new child directory.",
    );
  }
  return resolved;
}

async function ensureWritableDirectory(destination: string, force: boolean): Promise<void> {
  try {
    const stat = await Deno.stat(destination);
    if (!stat.isDirectory) {
      throw new ScaffoldError(
        `${destination} exists and is not a directory. Choose another target directory.`,
      );
    }
    const entries: string[] = [];
    for await (const entry of Deno.readDir(destination)) entries.push(entry.name);
    if (entries.length > 0 && !force) {
      throw new ScaffoldError(
        `${destination} is not empty. Refusing to overwrite it; rerun with --force if replacing scaffold files is intentional.`,
      );
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      try {
        await Deno.mkdir(destination, { recursive: true });
      } catch (mkdirError) {
        throw new ScaffoldError(
          `Could not create ${destination}: ${
            errorMessage(mkdirError)
          }. Check the parent path and permissions.`,
        );
      }
      return;
    }
    throw error;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isSameOrAncestor(candidate: string, descendant: string): boolean {
  const pathFromCandidate = relative(candidate, descendant);
  return pathFromCandidate === "" ||
    (!pathFromCandidate.startsWith("..") && !isAbsolute(pathFromCandidate));
}

async function formatGeneratedFiles(paths: readonly string[]): Promise<void> {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["fmt", ...paths],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new ScaffoldError(
      `Generated files could not be formatted: ${
        new TextDecoder().decode(result.stderr).trim()
      }. Remove the partial target or rerun with --force after fixing the environment.`,
    );
  }
}

if (import.meta.main) {
  runScaffoldCli(Deno.args).catch((error) => {
    console.error(`mcp-view-components scaffold: ${errorMessage(error)}`);
    Deno.exitCode = 1;
  });
}
