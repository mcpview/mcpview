# Build123d and PrusaSlicer snippet providers

This example runs the Build123d MCP server with its qualified Python runtime and the released
PrusaSlicer MCP container. The snippet adapters listen on loopback. Each adapter discovers its own
saved snippet through `list_snippets` and replays the saved JavaScript with `run_snippet`. Both load
the checked-in source into durable, provider-scoped MCP View catalogs. The host supplies the catalog
directory and the single native MCP operation available to each saved program.

## Start the native providers

Set up the Build123d runtime from its checkout. On a cold Python installation, the explicit import
also verifies the qualified runtime before starting MCP.

```bash
export BUILD123D_CHECKOUT=/absolute/path/to/mcp-build123d
export PRUSASLICER_CHECKOUT=/absolute/path/to/mcp-prusaslicer
export PILOT_ROOT="$(mktemp -d /tmp/mcpview-snippets.XXXXXXXX)"
mkdir -m 700 "$PILOT_ROOT/exports" "$PILOT_ROOT/stage" "$PILOT_ROOT/catalog"
cp "$PRUSASLICER_CHECKOUT/tests/fixtures/pla_0.4_0.2.ini" "$PILOT_ROOT/stage/profile.ini"
uv venv --python 3.13 "$PILOT_ROOT/venv"
uv pip install --python "$PILOT_ROOT/venv/bin/python" \
  -r "$BUILD123D_CHECKOUT/requirements/runtime.txt" \
  -c "$BUILD123D_CHECKOUT/requirements/constraints.txt"
"$PILOT_ROOT/venv/bin/python" -I -c 'import build123d, OCP; print(build123d.__version__, OCP.__version__)'

(
  cd "$BUILD123D_CHECKOUT" &&
  BUILD123D_PYTHON_BIN="$PILOT_ROOT/venv/bin/python" \
    BUILD123D_EXPORT_DIR="$PILOT_ROOT/exports" \
    deno run -A --frozen server.ts --port=3014
)
```

In a second terminal with the same `PILOT_ROOT`, start the published PrusaSlicer 0.4.0 image
containing PrusaSlicer 2.9.2. On macOS, use a temporary directory shared with the Docker VM. Docker
accepts the canonical path produced by `pwd -P`. The container reads only the stage mount.

```bash
export PILOT_STAGE="$(cd "$PILOT_ROOT/stage" && pwd -P)"
docker run --rm -p 127.0.0.1:3022:3022 \
  --mount "type=bind,src=$PILOT_STAGE,dst=/pilot,readonly" \
  ghcr.io/casys-ai/mcp-prusaslicer@sha256:e63093777eff5f766e51acf1afe7cdb3b0e20c133cff93ad0d3e3b9b979e1ab3 \
  http
```

In a third terminal, from the MCP View checkout with the same `PILOT_ROOT`, start the two snippet
adapters. The optional `PILOT_BUILD123D_URL` and `PILOT_PRUSASLICER_URL` settings override the
native loopback endpoints.

```bash
PILOT_PRUSASLICER_STAGE_DIR="$PILOT_ROOT/stage" \
PILOT_PRUSASLICER_REMOTE_STAGE_DIR=/pilot \
PILOT_PRUSASLICER_PROFILE=/pilot/profile.ini \
PILOT_PRUSASLICER_PROFILE_SHA256=28172b6a4614655eea634cf6448090695cf4b135b0dd4d906c90eec2beebd841 \
PILOT_SNIPPET_STORE="$PILOT_ROOT/catalog" \
deno run -A packages/compose/examples/multi-mcp-snippets/providers/server.ts
```

| Provider | Default endpoint            | Snippet              | Input                             |
| -------- | --------------------------- | -------------------- | --------------------------------- |
| `cad`    | `http://127.0.0.1:3614/mcp` | `plate-stl`          | `{thicknessMm}`, 1–20 mm          |
| `slicer` | `http://127.0.0.1:3622/mcp` | `pla-print-estimate` | `{stlSha256}` from the CAD result |

The CAD adapter reads the immutable STL returned by Build123d, checks its SHA-256, and stages it in
the private run directory. The slicer adapter accepts digests issued during the current provider
process, resolves them inside the stage directory, and passes the pinned STL and PLA profile hashes
to PrusaSlicer. The composed host can use the native Build123d MCP App or the verified GLB snapshot
carried in CAD result metadata. The PrusaSlicer provider exposes native structured print estimates
through MCP.

The example keeps a maximum of 32 unique staged meshes per process. Use a fresh run directory to
reset the staged files and retain an existing catalog directory to keep its saved snippet records.

Each saved run has a 23-second adapter deadline. The adapters forward an observed request
cancellation to their native HTTP calls and give each native computation a 20-second process limit.
Stateless HTTP disconnects can be observed after the adapter deadline. The CAD adapter checks the
deadline again before publishing a staged mesh.
