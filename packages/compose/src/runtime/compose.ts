/**
 * Dashboard composition orchestrator.
 *
 * Wires together manifest loading, template parsing, arg injection,
 * server startup, tool calling, and the core pipeline to produce
 * a self-contained composite dashboard.
 *
 * ## AX (Agent Experience)
 *
 * - **Single entry point**: `composeDashboard()` does everything.
 *   `composeDashboardFromFiles()` adds file loading on top.
 * - **Structured warnings**: Non-fatal issues (tool without UI metadata)
 *   are collected as warnings, not thrown. The dashboard renders with
 *   whatever UIs were successfully collected.
 * - **Guaranteed cleanup**: Server processes are always stopped in `finally`,
 *   even on errors.
 * - **URI resolution**: `ui://server/...` URIs are automatically resolved
 *   to the server's actual HTTP base URL before rendering.
 *
 * @module runtime/compose
 */

import type { ComposeRequest, ComposeResult } from "./types.ts";
import type { ComposedDashboardCsp, ComposedDashboardPanel } from "./host-dashboard-types.ts";
import type { ComponentSurface } from "../core/types/components.ts";
import { loadManifests } from "./manifest.ts";
import {
  injectArgs,
  loadTemplate,
  resolveTemplateComponentId,
  validateTemplate,
} from "./template.ts";
import { createCluster } from "./cluster.ts";
import { createCollector } from "../core/collector/collector.ts";
import { buildCompositeUi } from "../core/composer/composer.ts";
import { renderComposite } from "../host/renderer/html-generator.ts";
import { RuntimeErrorCode } from "./types.ts";
import type { RuntimeError } from "./types.ts";

/**
 * Compose a dashboard from a template + manifests + runtime args.
 *
 * Full flow:
 * 1. Validate template against manifests
 * 2. Start/connect MCP server cluster
 * 3. Call tools with injected args, collect UI resources
 * 4. Resolve `ui://` URIs to real HTTP URLs
 * 5. Build composite descriptor + render HTML (core pipeline)
 * 6. Shut down cluster
 *
 * @param request - Template, manifests, and runtime args
 * @returns Composite descriptor, rendered HTML, and warnings
 *
 * @example
 * ```typescript
 * const result = await composeDashboard({
 *   template,
 *   manifests,
 *   args: { customer_id: "CUST-001" },
 * });
 * // result.html is a complete dashboard
 * ```
 */
export async function composeDashboard(
  request: ComposeRequest,
): Promise<ComposeResult> {
  const { template, manifests, args, keepAlive } = request;
  const warnings: string[] = [];

  // 1. Validate template against manifests
  const validation = validateTemplate(template, manifests);
  if (!validation.valid) {
    throw {
      code: RuntimeErrorCode.TEMPLATE_PARSE_ERROR,
      message: `Template validation failed: ${validation.errors.join("; ")}`,
    } satisfies RuntimeError;
  }

  // 2. Start cluster
  const serverNames = template.sources.map((s) => s.manifest);
  const cluster = createCluster(manifests, serverNames);
  await cluster.startAll();
  let completed = false;

  try {
    // 3. Call tools and collect UI resources
    const collector = createCollector();
    const panels: ComposedDashboardPanel[] = [];

    // Calls still execute in parallel across sources and sequentially within
    // each source. Their results are collected only after every source group
    // settles, in template order, so network timing can never renumber slots.
    const sourceOutcomes = await Promise.all(
      template.sources.map(async (source, sourceIndex) => {
        const resolvedCalls = injectArgs(source.calls, args ?? {});
        const manifest = manifests.get(source.manifest);
        // Validation above guarantees this, but retaining the guard keeps the
        // provenance boundary explicit if callers supply a malformed Map.
        if (!manifest) {
          throw {
            code: RuntimeErrorCode.MANIFEST_NOT_FOUND,
            message: `Manifest "${source.manifest}" not found`,
            server: source.manifest,
          } satisfies RuntimeError;
        }
        const allowedTools = manifest.tools
          .filter((tool) => tool.appCallable === true)
          .map((tool) => ({
            name: tool.name,
            ...(tool.description === undefined ? {} : { description: tool.description }),
            ...(tool.inputSchema === undefined ? {} : { inputSchema: tool.inputSchema }),
          }));
        const allowedToolNames = allowedTools.map((tool) => tool.name);
        const outcomes: Array<{
          componentId: string;
          qualifiedName: string;
          serverName: string;
          toolName: string;
          args?: Record<string, unknown>;
          surface?: ComponentSurface;
          supportedWidths?: readonly number[];
          allowedToolNames: string[];
          allowedTools: typeof allowedTools;
          result?: unknown;
          error?: string;
        }> = [];

        for (let callIndex = 0; callIndex < resolvedCalls.length; callIndex++) {
          const call = resolvedCalls[callIndex];
          const qualifiedName = `${source.manifest}:${call.tool}`;
          const componentId = resolveTemplateComponentId(
            source,
            sourceIndex,
            call,
            callIndex,
          );

          try {
            const result = await cluster.callTool(
              source.manifest,
              call.tool,
              call.args,
            );
            outcomes.push({
              componentId,
              qualifiedName,
              serverName: source.manifest,
              toolName: call.tool,
              args: call.args,
              surface: call.surface ?? source.surface,
              supportedWidths: manifest.tools.find((tool) => tool.name === call.tool)
                ?.supportedWidths,
              allowedToolNames,
              allowedTools,
              result,
            });
          } catch (e) {
            const err = e as RuntimeError;
            outcomes.push({
              componentId,
              qualifiedName,
              serverName: source.manifest,
              toolName: call.tool,
              args: call.args,
              surface: call.surface ?? source.surface,
              allowedToolNames,
              allowedTools,
              error: err.message ?? String(e),
            });
          }
        }
        return outcomes;
      }),
    );

    for (const outcome of sourceOutcomes.flat()) {
      if (outcome.error !== undefined) {
        warnings.push(`Tool "${outcome.qualifiedName}" call failed: ${outcome.error}`);
        continue;
      }
      const collected = collector.collect(
        outcome.qualifiedName,
        outcome.result,
        outcome.args,
        {
          componentId: outcome.componentId,
          surface: outcome.surface,
          supportedWidths: outcome.supportedWidths,
        },
      );
      if (!collected) {
        warnings.push(
          `Tool "${outcome.qualifiedName}" did not return UI metadata (_meta.ui.resourceUri)`,
        );
        continue;
      }

      // Capture provenance only after the stable slot is assigned.
      const resourceCsp = extractResourceCsp(outcome.result);
      panels.push({
        componentId: outcome.componentId,
        slot: collected.slot,
        serverName: outcome.serverName,
        toolName: outcome.toolName,
        resourceUri: collected.resourceUri,
        initialToolResult: outcome.result,
        allowedToolNames: outcome.allowedToolNames,
        allowedTools: outcome.allowedTools,
        ...(resourceCsp === undefined ? {} : { resourceCsp }),
      });
    }

    // 4. Resolve ui:// URIs to real HTTP URLs
    const resources = collector.getResources().map((resource) => {
      const resolved = resolveResourceUri(
        resource.resourceUri,
        (name) => cluster.getUiBaseUrl(name),
      );
      return { ...resource, resourceUri: resolved };
    });

    // 5. Build area map (source qualified name → area id)
    const areaMap: Record<string, string> = {};
    for (let sourceIndex = 0; sourceIndex < template.sources.length; sourceIndex++) {
      const source = template.sources[sourceIndex];
      if (source.id) {
        for (let callIndex = 0; callIndex < source.calls.length; callIndex++) {
          const call = source.calls[callIndex];
          areaMap[resolveTemplateComponentId(source, sourceIndex, call, callIndex)] = source.id;
        }
      }
    }

    // 6. Build composite + render
    const orchestration = {
      layout: template.orchestration.layout,
      sync: template.orchestration.sync,
      portSync: template.orchestration.portSync,
      sharedContext: template.orchestration.sharedContext,
    };

    const descriptor = buildCompositeUi(resources, orchestration);
    if (Object.keys(areaMap).length > 0) {
      descriptor.areaMap = areaMap;
    }
    const html = renderComposite(descriptor);

    const composed: ComposeResult = {
      descriptor,
      html,
      warnings,
      panels: panels.sort((a, b) => a.slot - b.slot),
      cluster: keepAlive ? cluster : undefined,
    };
    completed = true;
    return composed;
  } finally {
    // A kept-alive cluster belongs to the returned result only. If anything
    // fails before that return, this function is its sole owner and must still
    // release spawned processes and Streamable HTTP sessions.
    if (!keepAlive || !completed) {
      await cluster.stopAll();
    }
  }
}

/**
 * Convenience: load manifests + template from files, then compose.
 *
 * @param manifestDir - Directory containing `.json` manifest files
 * @param templatePath - Path to `.yaml` template file
 * @param args - Runtime arguments (injected into `{{placeholder}}` values)
 * @returns Composite result
 *
 * @example
 * ```typescript
 * const result = await composeDashboardFromFiles(
 *   "./manifests/",
 *   "./dashboards/sales.yaml",
 *   { customer_id: "CUST-001" },
 * );
 * await Deno.writeTextFile("dashboard.html", result.html);
 * ```
 */
export async function composeDashboardFromFiles(
  manifestDir: string,
  templatePath: string,
  args?: Record<string, unknown>,
): Promise<ComposeResult> {
  const manifests = await loadManifests(manifestDir);
  const template = await loadTemplate(templatePath);
  return composeDashboard({ template, manifests, args });
}

/**
 * Resolve a `ui://server-name/path` URI to an HTTP URL.
 *
 * Uses the cluster's uiBaseUrl for the server to replace the `ui://` scheme.
 * Non-`ui://` URIs pass through unchanged.
 *
 * @example
 * ```typescript
 * resolveResourceUri("ui://mcp-einvoice/invoice-viewer", getUrl);
 * // → "http://localhost:54321/ui?uri=ui://mcp-einvoice/invoice-viewer"
 * ```
 */
function resolveResourceUri(
  uri: string,
  getBaseUrl: (serverName: string) => string | undefined,
): string {
  if (!uri.startsWith("ui://")) return uri;

  // Extract server name: ui://server-name/path → "server-name"
  const withoutScheme = uri.slice("ui://".length);
  const slashIndex = withoutScheme.indexOf("/");
  const serverName = slashIndex >= 0 ? withoutScheme.slice(0, slashIndex) : withoutScheme;

  const baseUrl = getBaseUrl(serverName);
  if (!baseUrl) return uri; // can't resolve, pass through

  return `${baseUrl}/ui?uri=${encodeURIComponent(uri)}`;
}

/**
 * Retain only the domain lists from MCP Apps UI metadata. The serving host
 * validates every source expression before translating this declaration into
 * a response CSP header; unknown metadata never becomes a browser grant.
 */
function extractResourceCsp(result: unknown): ComposedDashboardCsp | undefined {
  if (!isRecord(result) || !isRecord(result._meta) || !isRecord(result._meta.ui)) {
    return undefined;
  }
  const csp = result._meta.ui.csp;
  if (!isRecord(csp)) return undefined;

  const policy: ComposedDashboardCsp = {
    ...(stringArray(csp.connectDomains) === undefined
      ? {}
      : { connectDomains: stringArray(csp.connectDomains) }),
    ...(stringArray(csp.resourceDomains) === undefined
      ? {}
      : { resourceDomains: stringArray(csp.resourceDomains) }),
    ...(stringArray(csp.frameDomains) === undefined
      ? {}
      : { frameDomains: stringArray(csp.frameDomains) }),
    ...(stringArray(csp.baseUriDomains) === undefined
      ? {}
      : { baseUriDomains: stringArray(csp.baseUriDomains) }),
  };

  return Object.keys(policy).length === 0 ? undefined : policy;
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
