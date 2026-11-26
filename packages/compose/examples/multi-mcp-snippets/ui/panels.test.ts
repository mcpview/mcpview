import { expect, test } from "bun:test";
import { composeResult, PANELS_META } from "./panels.ts";

test("mounted panels preserve the native results and selected receipt order", () => {
  const cad = {
    structuredContent: {
      value: {
        geometry: {
          schemaVersion: "1.0",
          kind: "export",
          metrics: { volume_mm3: 3739.47 },
          files: [
            { format: "stl", artifact: { sha256: "same-mesh" } },
            { format: "gltf", artifact: { mimeType: "model/gltf-binary" } },
          ],
        },
      },
    },
    _meta: { pilotGlbBase64: "Z2xURgIAAAA=" },
  };
  const slice = {
    structuredContent: {
      value: { print_time_s: 1001, filament_length_mm: 917.27 },
    },
  };
  const result = composeResult({
    structuredContent: { value: { stlSha256: "same-mesh" } },
    _meta: {
      [PANELS_META]: [
        {
          id: "slice",
          provider: "new-provider",
          name: "estimate",
          title: "Slice",
          result: slice,
        },
        {
          id: "cad",
          provider: "new-cad",
          name: "generate",
          title: "CAD",
          result: cad,
        },
      ],
    },
  });

  expect(result.children.map((child) => child.componentId)).toEqual([
    "slice",
    "cad",
  ]);
  expect(result.children.map((child) => child.context?.view)).toMatchObject([
    { adapter: "slice", data: slice.structuredContent.value },
    { adapter: "cad", data: cad.structuredContent.value.geometry },
  ]);
  expect(result.children[1].context?.panel).toMatchObject({ result: cad });
  expect(result.sharedContext).toEqual({ value: { stlSha256: "same-mesh" } });
});

test("a tool response with no view-only results does not fabricate panels", () => {
  const result = composeResult({
    structuredContent: {
      value: {},
      panels: [{ id: "missing", provider: "cad" }],
    },
  });

  expect(result.children).toEqual([]);
});

test("an export without the CAD snapshot and descriptor falls back to its summary", () => {
  const geometry = {
    schemaVersion: "1.0",
    kind: "export",
    metrics: { volume_mm3: 3739.47 },
    files: [{ format: "gltf", artifact: { mimeType: "model/gltf-binary" } }],
  };
  const nativeResults = [
    { structuredContent: { value: { geometry } } },
    {
      structuredContent: { value: { geometry } },
      _meta: { pilotGlbBase64: "not a GLB" },
    },
    {
      structuredContent: { value: { geometry: { ...geometry, files: [] } } },
      _meta: { pilotGlbBase64: "Z2xURgIAAAA=" },
    },
  ];
  const result = composeResult({
    _meta: {
      [PANELS_META]: nativeResults.map((result, index) => ({
        id: String(index),
        provider: "other",
        name: "export",
        title: "Other export",
        result,
      })),
    },
  });

  expect(result.children.map((child) => child.context?.view)).toMatchObject(
    nativeResults.map(() => ({ adapter: "summary" })),
  );
  expect(result.children.map((child) => child.context?.panel)).toMatchObject(
    nativeResults.map((result) => ({ result })),
  );
});
