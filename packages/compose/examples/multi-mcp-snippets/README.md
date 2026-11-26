# Run snippets from two MCP servers in one Compose board

A user asks for a 40 × 24 mm mounting plate and its PLA print estimate. One `execute` call runs a
snippet on the CAD provider, passes the exported STL's SHA-256 to a snippet on the slicer provider,
and selects both results for display. Replaying the saved chain with a different thickness
regenerates the geometry and slices the new STL.

## How the calls fit together

The orchestrator is both the MCP server that the chat connects to and an MCP client of each
configured provider. Each provider owns its snippet catalog. The example adapters connect these
catalogs to the existing build123d and PrusaSlicer MCP servers. Configure each upstream connection
on the orchestrator, then connect the chat to the orchestrator as a single app.

The chat sees one tool, `execute`. Inside its JavaScript body, `api.listSnippets(provider)`
discovers approved provider snippets, `api.runSnippet(provider, name, input)` returns a value and a
receipt, and `api.panel(receipt.id, title)` selects that result for this board. Pass values between
calls as needed. Keeping the receipt lets Compose render the result even when another step consumes
its value.

For the plate, save this body with `saveAs: "plate-and-estimate"` and
`params: { "thicknessMm": 2 }`.

```js
const plate = await api.runSnippet("cad", "plate-stl", {
  thicknessMm: api.params.thicknessMm,
});
const estimate = await api.runSnippet("slicer", "pla-print-estimate", {
  stlSha256: plate.value.stlSha256,
});

await api.panel(plate.id, "Plate geometry");
await api.panel(estimate.id, "PLA print estimate");

return {
  thicknessMm: api.params.thicknessMm,
  stlSha256: plate.value.stlSha256,
  printTimeS: estimate.value.print_time_s,
  filamentLengthMm: estimate.value.filament_length_mm,
};
```

The next chat can issue the following call against the same catalog.

```json
{ "replay": "plate-and-estimate", "params": { "thicknessMm": 4 } }
```

The outer tool declares one MCP App resource, `ui://multi-mcp-snippets/board`. Its response contains
a compact summary for the LLM and the selected receipts in `_meta["io.mcpview/snippet-panels"]` for
the app. The board uses MCPView Compose's collector and layout, renders the GLB with a local 3D
adapter, and renders the slicer's measurements in a second panel. Rotating the part or expanding
print settings uses data already in the board. Other result types can use the text summary or supply
a renderer.

## Run it from a checkout

Start the two native servers and their snippet adapters using the
[provider setup](providers/README.md). Use the same `PILOT_ROOT` as in that guide. From the MCPView
repository root, build the self-contained app and start the orchestrator.

```sh
example=packages/compose/examples/multi-mcp-snippets
(cd "$example/ui" && npm ci && npm run build)
mkdir -p "$PILOT_ROOT/chains"
PILOT_SNIPPET_STORE="$PILOT_ROOT/chains" deno run --frozen \
  --allow-net=127.0.0.1 --allow-env --allow-read --allow-write="$PILOT_ROOT/chains" \
  "$example/server.ts"
```

The endpoint is `http://127.0.0.1:3630/mcp`. In another terminal, run the following to exercise it
with the MCP Inspector. The check discovers both snippets, saves the 2 mm chain, compares the CAD
and slicer input digests, reads the board twice, and replays the chain at 4 mm. It checks actual
invocation counts, so allow it to finish before running another plate.

```sh
deno run --frozen --allow-env --allow-net=127.0.0.1 --allow-run=npx \
  packages/compose/examples/multi-mcp-snippets/verify.ts
```

`PILOT_SNIPPET_STORE` on the orchestrator persists the enclosing script and its parameter types in a
local single-user directory. With this setting, another chat or a restarted orchestrator can replay
the saved chain. Omitting it uses a process-local catalog. The provider catalogs and freshly
generated CAD artifacts are stored separately.

## Connect another snippet provider

Set `PILOT_PROVIDERS_FILE` to a JSON file containing the complete list of providers. The example
defaults are equivalent to this configuration.

```json
[
  { "alias": "cad", "port": 3614, "snippets": ["plate-stl"] },
  { "alias": "slicer", "port": 3622, "snippets": ["pla-print-estimate"] }
]
```

Each entry connects to `http://127.0.0.1:<port>/mcp` using MCP protocol `2026-07-28`. A provider
implements `list_snippets({})` with `structuredContent.snippets` entries containing `name`,
`description`, and `inputSchema`, and `run_snippet({name, input})` with `structuredContent.value`.
The orchestrator retains the MCP tool result for the board. Add an alias, port and allowed snippet
names to connect another compatible provider. Existing MCPs with a different Code Mode interface
need an adapter.

## Open the board in ChatGPT

For a private test, make the orchestrator reachable through a private MCP tunnel or an HTTPS
endpoint scoped to the example. In ChatGPT, open **Plugins → Add → Add custom MCP server**, supply
that endpoint and its authentication method, then choose **Try in chat**. Ask to replay the saved
plate at 2 mm. Open a new chat with the same app and ask for 4 mm. Inside the board, drag the plate
to rotate it and click **Print settings** to inspect the slicing parameters.

This example uses the published Compose Code Mode API and a local single-user catalog. The ChatGPT
test used a private plugin pointing to a temporary HTTPS facade with just the saved plate workflow
and those two thicknesses enabled.
