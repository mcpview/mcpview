/**
 * Manifest parsing and validation.
 *
 * Reads static MCP server manifests from JSON files.
 * No server startup needed — manifests are generated at build time.
 *
 * @module runtime/manifest
 */

import { isSupportedWidths } from "../core/types/resources.ts";
import type { McpManifest } from "./types.ts";
import { RuntimeErrorCode } from "./types.ts";
import type { RuntimeError } from "./types.ts";

/**
 * Validate a raw object as a manifest. Returns errors if invalid.
 *
 * @example
 * ```typescript
 * const { valid, errors } = validateManifest(data);
 * if (!valid) console.error(errors);
 * ```
 */
export function validateManifest(
  data: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Manifest must be a non-null object"] };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    errors.push("Manifest must have a non-empty 'name' string");
  }

  if (!obj.transport || typeof obj.transport !== "object") {
    errors.push("Manifest must have a 'transport' object");
  } else {
    const transport = obj.transport as Record<string, unknown>;
    if (
      transport.protocol !== undefined &&
      transport.protocol !== "auto" &&
      transport.protocol !== "stateless-2026-07-28" &&
      transport.protocol !== "streamable-http"
    ) {
      errors.push(
        'transport.protocol must be "auto", "stateless-2026-07-28", or "streamable-http" if provided',
      );
    }
    if (transport.type === "stdio") {
      if (typeof transport.command !== "string" || transport.command.trim() === "") {
        errors.push("transport.command must be a non-empty string for stdio transport");
      }
      if (transport.args !== undefined && !Array.isArray(transport.args)) {
        errors.push("transport.args must be an array if provided");
      }
      if (
        transport.env !== undefined &&
        (typeof transport.env !== "object" || transport.env === null)
      ) {
        errors.push("transport.env must be an object if provided");
      }
    } else if (transport.type === "http") {
      if (typeof transport.url !== "string" || transport.url.trim() === "") {
        errors.push("transport.url must be a non-empty string for http transport");
      }
    } else {
      errors.push(
        `transport.type must be "stdio" or "http", got "${String(transport.type)}"`,
      );
    }
  }

  if (!Array.isArray(obj.tools)) {
    errors.push("Manifest must have a 'tools' array");
  } else {
    for (let i = 0; i < obj.tools.length; i++) {
      const tool = obj.tools[i] as Record<string, unknown>;
      if (!tool || typeof tool !== "object") {
        errors.push(`tools[${i}] must be an object`);
      } else if (typeof tool.name !== "string" || tool.name.trim() === "") {
        errors.push(`tools[${i}] must have a non-empty 'name' string`);
      } else if (tool.appCallable !== undefined && typeof tool.appCallable !== "boolean") {
        errors.push(`tools[${i}].appCallable must be a boolean if provided`);
      } else if (tool.supportedWidths !== undefined && !isSupportedWidths(tool.supportedWidths)) {
        errors.push(`tools[${i}].supportedWidths must be an array of positive safe integers`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a JSON string into a validated McpManifest.
 *
 * @param json - Raw JSON string
 * @param filePath - Optional file path for error messages
 * @returns Parsed manifest
 * @throws RuntimeError on invalid JSON or validation failure
 *
 * @example
 * ```typescript
 * const manifest = parseManifest('{"name":"pg","command":"pg-mcp","tools":[{"name":"query"}]}');
 * ```
 */
export function parseManifest(json: string, filePath?: string): McpManifest {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    throw {
      code: RuntimeErrorCode.MANIFEST_PARSE_ERROR,
      message: `Invalid JSON${filePath ? ` in ${filePath}` : ""}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    } satisfies RuntimeError;
  }

  const validation = validateManifest(data);
  if (!validation.valid) {
    throw {
      code: RuntimeErrorCode.MANIFEST_PARSE_ERROR,
      message: `Invalid manifest${filePath ? ` in ${filePath}` : ""}: ${
        validation.errors.join("; ")
      }`,
    } satisfies RuntimeError;
  }

  return data as McpManifest;
}

/**
 * Load a manifest from a file path.
 *
 * @example
 * ```typescript
 * const manifest = await loadManifest("./manifests/postgres.json");
 * ```
 */
export async function loadManifest(path: string): Promise<McpManifest> {
  const json = await Deno.readTextFile(path);
  return parseManifest(json, path);
}

/**
 * Load all manifests from a directory (all `.json` files).
 *
 * @returns Map keyed by manifest name
 *
 * @example
 * ```typescript
 * const manifests = await loadManifests("./manifests/");
 * // manifests.get("postgres") → McpManifest
 * ```
 */
export async function loadManifests(
  dirPath: string,
): Promise<Map<string, McpManifest>> {
  const manifests = new Map<string, McpManifest>();

  for await (const entry of Deno.readDir(dirPath)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const manifest = await loadManifest(`${dirPath}/${entry.name}`);
    manifests.set(manifest.name, manifest);
  }

  return manifests;
}
