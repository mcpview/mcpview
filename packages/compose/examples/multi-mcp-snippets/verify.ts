// SPDX-License-Identifier: MIT
import { assert, assertEquals, assertMatch } from "@std/assert";

const chainCode = `
const cadCatalog = await api.listSnippets("cad");
const slicerCatalog = await api.listSnippets("slicer");
const cad = await api.runSnippet("cad", "plate-stl", {
  thicknessMm: api.params.thicknessMm,
});
await api.panel(cad.id, "Plate geometry");
const estimate = await api.runSnippet("slicer", "pla-print-estimate", {
  stlSha256: cad.value.stlSha256,
});
await api.panel(estimate.id, "PLA print estimate");
return {
  snippets: [cadCatalog.map((entry) => entry.name), slicerCatalog.map((entry) => entry.name)],
  thicknessMm: api.params.thicknessMm,
  stlSha256: cad.value.stlSha256,
  printTimeS: estimate.value.print_time_s,
  filamentLengthMm: estimate.value.filament_length_mm,
};
`.trim();

const board = "ui://multi-mcp-snippets/board";
const panelKey = "io.mcpview/snippet-panels";
const savedName = "plate-and-estimate";
const port = Number(Deno.env.get("PILOT_CHAIN_PORT") ?? 3630);
assert(Number.isInteger(port) && port > 0 && port < 65_536);
const serverUrl = `http://127.0.0.1:${port}/mcp`;
const providerMetrics = [
  ["cad snippet MCP", Number(Deno.env.get("PILOT_CAD_SNIPPET_PORT") ?? 3614), "run_snippet"],
  ["slicer snippet MCP", Number(Deno.env.get("PILOT_SLICER_SNIPPET_PORT") ?? 3622), "run_snippet"],
  ["native CAD MCP", 3014, "build123d_export"],
  ["native slicer MCP", 3022, "prusaslicer_estimate_fff"],
] as const;

async function inspect(method: string, ...args: string[]) {
  const command = new Deno.Command("npx", {
    args: [
      "-y",
      "@modelcontextprotocol/inspector@2.13.0",
      "--cli",
      "--server-url",
      serverUrl,
      "--protocol-era",
      "modern",
      "--advertise-apps",
      "--format",
      "json",
      "--quiet",
      "--method",
      method,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const decoder = new TextDecoder();
  const stdout = decoder.decode(output.stdout);
  const stderr = decoder.decode(output.stderr);
  assert(output.success, `Inspector ${method} failed: ${stderr || stdout}`);
  const envelope = JSON.parse(stdout);
  assert(envelope.result, stdout);
  return envelope.result;
}

function execute(args: Record<string, unknown>) {
  return inspect("tools/call", "--tool-name", "execute", "--tool-args-json", JSON.stringify(args));
}

function sha64(value: string) {
  assertMatch(value, /^[a-f0-9]{64}$/);
  return value;
}

function evaluate(result: Awaited<ReturnType<typeof execute>>, thicknessMm: number) {
  assert(!result.isError, JSON.stringify(result.content));
  const { value, panels } = result.structuredContent;
  assertEquals(value.thicknessMm, thicknessMm);
  assertEquals(value.snippets, [["plate-stl"], ["pla-print-estimate"]]);
  assert(value.printTimeS > 0);
  assert(value.filamentLengthMm > 0);
  assertEquals(
    panels.map((panel: { provider: string; name: string }) => [panel.provider, panel.name]),
    [
      ["cad", "plate-stl"],
      ["slicer", "pla-print-estimate"],
    ],
  );
  const payloads = result._meta[panelKey];
  assertEquals(payloads.length, 2);
  assertEquals(
    payloads.map(({ id }: { id: string }) => id),
    panels.map(({ id }: { id: string }) => id),
  );
  const [cad, slice] = payloads.map((panel: { result: Awaited<ReturnType<typeof execute>> }) =>
    panel.result
  );
  assert(cad.content.length > 0 && slice.content.length > 0);
  assert(cad._meta.pilotGlbBase64.startsWith("Z2xURg"));
  const geometry = cad.structuredContent.value.geometry;
  const estimate = slice.structuredContent.value;
  const stl = geometry.files.find(({ format }: { format: string }) => format === "stl");
  assertEquals(sha64(stl.artifact.sha256), sha64(value.stlSha256));
  assertEquals(sha64(estimate.stl_artifact.sha256), value.stlSha256);
  assertEquals(estimate.stl_artifact.bytes, stl.artifact.bytes);
  assertEquals(estimate.print_time_s, value.printTimeS);
  assertEquals(estimate.filament_length_mm, value.filamentLengthMm);
  assertMatch(estimate.engine_name, /prusa/i);
  sha64(estimate.profile_artifact.sha256);
  sha64(estimate.gcode_sha256);
  console.log(JSON.stringify({
    thicknessMm,
    stlSha256: value.stlSha256,
    stlBytes: stl.artifact.bytes,
    prusaStlSha256: estimate.stl_artifact.sha256,
    printTimeS: value.printTimeS,
    filamentLengthMm: value.filamentLengthMm,
    engine: estimate.engine_name,
    engineVersion: estimate.engine_version,
    panelNames: panels.map(({ name }: { name: string }) => name),
    glbBase64Length: cad._meta.pilotGlbBase64.length,
  }));
  return value;
}

async function audit() {
  return await Promise.all(providerMetrics.map(async ([name, port, tool]) => {
    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    assert(response.ok, `Failed to read ${name} metrics: HTTP ${response.status}`);
    const metrics = await response.text();
    assert(
      metrics.includes("# TYPE mcp_server_tool_calls_by_name counter"),
      `Missing metrics for ${name}`,
    );
    const prefix = `mcp_server_tool_calls_by_name{tool="${tool}",status="success"} `;
    return Number(
      metrics.split("\n").find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? 0,
    );
  }));
}

function verifyRunCounts(before: number[], after: number[]) {
  assertEquals(after.map((value, index) => value - before[index]), [1, 1, 1, 1]);
  console.log(JSON.stringify({ providerToolCallCounts: after }));
}

const listings = await inspect("tools/list");
assertEquals(listings.tools.map(({ name }: { name: string }) => name), ["execute"]);
assertEquals(listings.tools[0]._meta.ui.resourceUri, board);
console.log("Inspector tools/list returned execute only.");

const before = await audit();
const saved = await execute({ code: chainCode, params: { thicknessMm: 2 }, saveAs: savedName });
assertEquals(saved.structuredContent?.saved, savedName);
const first = evaluate(saved, 2);
const afterFirst = await audit();
verifyRunCounts(before, afterFirst);

const resources = await inspect("resources/list");
assertEquals(resources.resources.map(({ uri }: { uri: string }) => uri), [board]);
const resourceArgs = ["--uri", board];
const html = await inspect("resources/read", ...resourceArgs);
assertEquals(html, await inspect("resources/read", ...resourceArgs));
assertEquals(html.contents.length, 1);
assertEquals(html.contents[0].uri, board);
assertEquals(html.contents[0].mimeType, "text/html;profile=mcp-app");
assertMatch(html.contents[0].text, /<script/);
assertEquals(await audit(), afterFirst);
console.log("Inspector read the same board twice with no snippet calls.");

const catalog = await execute({ listSaved: true });
assert(
  catalog.structuredContent.value.snippets.some(({ name }: { name: string }) => name === savedName),
);
assertEquals(await audit(), afterFirst);
const second = evaluate(await execute({ replay: savedName, params: { thicknessMm: 4 } }), 4);
assert(first.stlSha256 !== second.stlSha256);
assert(first.filamentLengthMm !== second.filamentLengthMm);
const afterReplay = await audit();
verifyRunCounts(afterFirst, afterReplay);
console.log(
  `Inspector replayed ${savedName}; the local catalog remains available at ${serverUrl}.`,
);
