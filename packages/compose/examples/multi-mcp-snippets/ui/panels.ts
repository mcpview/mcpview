import {
  composeSnippetBoard,
  SNIPPET_PANELS_META_KEY,
  type SnippetPanel,
} from "../../../src/code-mode/board.ts";
import type { UiLayoutAreas } from "../../../src/core/types/layout.ts";

export { SNIPPET_PANELS_META_KEY as PANELS_META };
const CAD_RESOURCE = "ui://mcp-build123d/results-viewer";
const SLICE_RESOURCE = "ui://multi-mcp-snippets/slice-report";

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type Panel = SnippetPanel & {
  data: Record<string, unknown>;
  adapter: "cad" | "slice" | "summary";
  resourceUri: string;
};

function selectAdapter(result: Record<string, unknown>) {
  const content = record(result.structuredContent);
  const value = "value" in content ? record(content.value) : content;
  const geometry = "geometry" in value ? record(value.geometry) : value;
  const metadata = record(result._meta);
  const resourceUri = record(metadata.ui).resourceUri;
  const snapshot = metadata.pilotGlbBase64;
  if (
    typeof snapshot === "string" &&
    // Base64 prefix of the GLB magic number and version 2.
    snapshot.startsWith("Z2xURgIAAA") &&
    geometry.kind === "export" && geometry.schemaVersion === "1.0" &&
    typeof record(geometry.metrics).volume_mm3 === "number" &&
    Array.isArray(geometry.files) &&
    geometry.files.some((file) => {
      const descriptor = record(file);
      return descriptor.format === "gltf" &&
        record(descriptor.artifact).mimeType === "model/gltf-binary";
    })
  ) {
    return {
      adapter: "cad",
      resourceUri: CAD_RESOURCE,
      data: geometry,
    } as const;
  }
  if (
    typeof value.print_time_s === "number" &&
    typeof value.filament_length_mm === "number"
  ) {
    return {
      adapter: "slice",
      resourceUri: SLICE_RESOURCE,
      data: value,
    } as const;
  }
  return {
    adapter: "summary",
    data: value,
    resourceUri: typeof resourceUri === "string" && resourceUri.startsWith("ui://")
      ? resourceUri
      : "ui://multi-mcp-snippets/result-summary",
  } as const;
}

export function desktopLayout(count: number): UiLayoutAreas {
  return {
    areas: [Array.from({ length: count }, (_, index) => `panel${index}`)],
    gap: "normal",
  };
}

export function stackedLayout(count: number): UiLayoutAreas {
  return {
    areas: desktopLayout(count).areas[0].map((area) => [area]),
    gap: "normal",
  };
}

export function composeResult(result: unknown) {
  return composeSnippetBoard(result, {
    layout: desktopLayout,
    resolveView: (panel) => {
      const view = selectAdapter(panel.result);
      return { resourceUri: view.resourceUri, context: view };
    },
  });
}
