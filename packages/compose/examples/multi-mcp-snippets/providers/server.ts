// SPDX-License-Identifier: MIT
import { dirname, join } from "node:path";
import { McpApp, type ResourceContent } from "../../../../server/mod.ts";
import {
  createFileSnippetStore,
  createSnippetCatalog,
  type SnippetParameters,
} from "../../../../server/snippets.ts";
import { runProgram } from "../sandbox.ts";

const viewerUri = "ui://mcp-build123d/results-viewer";
const viewerMimeType = "text/html;profile=mcp-app";
const protocol = "2026-07-28";
const sha256Pattern = "^[0-9a-f]{64}$";
const sha256Regex = new RegExp(sha256Pattern);
const maxArtifactBytes = 256 * 1024;
const maxStagedMeshes = 32;
const snippetTimeoutMs = 23_000;
const nativeProcessTimeoutMs = 20_000;
const resourceTimeoutMs = 5_000;
const diagnosticMessages = {
  INVALID_INPUT: "Supply the saved snippet's declared input.",
  ARTIFACT_UNAVAILABLE: "The verified CAD artifact is unavailable.",
  UPSTREAM_ERROR: "The native MCP provider could not complete the operation.",
  TIMEOUT: "The saved snippet exceeded its execution time limit.",
};
type DiagnosticCode = keyof typeof diagnosticMessages;

class PilotError extends Error {
  constructor(readonly code: DiagnosticCode) {
    super(diagnosticMessages[code]);
  }
}
type JsonObject = Record<string, unknown>;

const cadSnippet = {
  name: "plate-stl",
  description:
    "Build and measure a 40 × 24 mm plate with two 4 mm through holes. Export STL and GLB.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { thicknessMm: { type: "number", minimum: 1, maximum: 20 } },
    required: ["thicknessMm"],
  },
};
const slicerSnippet = {
  name: "pla-print-estimate",
  description: "Estimate the plate's print time and filament with the pilot PLA profile.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: { stlSha256: { type: "string", pattern: sha256Pattern } },
    required: ["stlSha256"],
  },
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an MCP object.");
  }
  return value as JsonObject;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
}

function setting(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Set ${name} before starting the pilot providers.`);
  return value;
}

async function mcp(
  url: string,
  method: "tools/call" | "resources/read",
  params: JsonObject,
  signal: AbortSignal,
): Promise<JsonObject> {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Accept": "application/json",
    "MCP-Protocol-Version": protocol,
    "Mcp-Method": method,
  });
  headers.set("Mcp-Name", String(method === "tools/call" ? params.name : params.uri));
  const response = await fetch(url, {
    method: "POST",
    headers,
    redirect: "error",
    signal,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocol,
          "io.modelcontextprotocol/clientCapabilities": {
            extensions: { "io.modelcontextprotocol/ui": {} },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new PilotError("UPSTREAM_ERROR");
  }
  const payload = object(await response.json());
  if (payload.error) throw new PilotError("UPSTREAM_ERROR");
  return object(payload.result);
}

async function readResource(
  url: string,
  uri: string,
  signal = AbortSignal.timeout(resourceTimeoutMs),
): Promise<ResourceContent> {
  const contents = (await mcp(url, "resources/read", { uri }, signal)).contents;
  if (!Array.isArray(contents) || contents.length !== 1 || contents[0]?.uri !== uri) {
    throw new PilotError("ARTIFACT_UNAVAILABLE");
  }
  return contents[0] as ResourceContent;
}

interface Artifact {
  uri: string;
  sha256: string;
  bytes: number;
  mimeType: string;
}

function artifact(geometry: JsonObject, format: "stl" | "gltf"): Artifact {
  const files = geometry.files;
  const entry = Array.isArray(files) && files.find((file) => file?.format === format);
  const descriptor = object(entry?.artifact);
  const extension = format === "gltf" ? "glb" : "stl";
  const mimeType = format === "gltf" ? "model/gltf-binary" : "model/stl";
  if (
    typeof descriptor.sha256 !== "string" || !sha256Regex.test(descriptor.sha256) ||
    descriptor.uri !== `casys://build123d/artifacts/${descriptor.sha256}.${extension}` ||
    descriptor.mimeType !== mimeType || typeof descriptor.bytes !== "number" ||
    !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 ||
    descriptor.bytes > maxArtifactBytes
  ) throw new PilotError("ARTIFACT_UNAVAILABLE");
  return {
    uri: descriptor.uri,
    sha256: descriptor.sha256,
    bytes: descriptor.bytes,
    mimeType,
  };
}

async function verifiedArtifact(url: string, descriptor: Artifact, signal: AbortSignal) {
  const content = await readResource(url, descriptor.uri, signal);
  if (
    content.mimeType !== descriptor.mimeType ||
    typeof content.blob !== "string" ||
    content.blob.length !== Math.ceil(descriptor.bytes / 3) * 4
  ) throw new PilotError("ARTIFACT_UNAVAILABLE");
  const bytes = Uint8Array.fromBase64(content.blob);
  if (bytes.length !== descriptor.bytes || await sha256(bytes) !== descriptor.sha256) {
    throw new PilotError("ARTIFACT_UNAVAILABLE");
  }
  return bytes;
}

function plateScript(thicknessMm: number) {
  // Only a validated JSON number is interpolated into this fixed program.
  return `from build123d import BuildPart, Box, Hole, Locations
with BuildPart() as plate:
    Box(40, 24, ${thicknessMm})
    with Locations((-12, 0, 0), (12, 0, 0)):
        Hole(2)
result = plate
`;
}

async function stageMesh(path: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  signal.throwIfAborted();
  const temporary = await Deno.makeTempFile({ dir: dirname(path), prefix: ".mesh-" });
  try {
    await Deno.writeFile(temporary, bytes, { signal });
    await Deno.chmod(temporary, 0o644);
    signal.throwIfAborted();
    try {
      await Deno.link(temporary, path);
      if (signal.aborted) {
        await Deno.remove(path);
        signal.throwIfAborted();
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      const stat = await Deno.lstat(path);
      if (
        !stat.isFile || stat.size !== bytes.length ||
        await sha256(await Deno.readFile(path)) !== await sha256(bytes)
      ) {
        throw new PilotError("ARTIFACT_UNAVAILABLE");
      }
    }
  } finally {
    await Deno.remove(temporary);
  }
}

async function createProviders(options: {
  cadUrl: string;
  slicerUrl: string;
  stageDir: string;
  slicerStageDir: string;
  profile: string;
  profileSha256: string;
  snippetStoreDir: string;
}) {
  const cad = new McpApp({ name: "build123d-plate-snippets", version: "0.1.0" });
  const slicer = new McpApp({ name: "prusaslicer-pla-snippets", version: "0.1.0" });
  const stagedMeshes = new Map<string, Promise<void>>();
  const viewable = new Set<string>();

  cad.registerResource(
    { uri: viewerUri, name: "build123d Results", mimeType: viewerMimeType },
    () => readResource(options.cadUrl, viewerUri),
  );

  await registerSnippet(cad, options.snippetStoreDir, cadSnippet, {
    operation: "build123d_export",
    parameters: { thicknessMm: "number" },
  }, async (input, signal) => {
    const thicknessMm = input.thicknessMm;
    if (
      Object.keys(input).length !== 1 || typeof thicknessMm !== "number" ||
      !Number.isFinite(thicknessMm) || thicknessMm < 1 || thicknessMm > 20
    ) throw new PilotError("INVALID_INPUT");

    const native = await mcp(options.cadUrl, "tools/call", {
      name: "build123d_export",
      arguments: {
        script: plateScript(thicknessMm),
        formats: ["stl", "gltf"],
        name: "pilot-plate",
        timeout_ms: nativeProcessTimeoutMs,
      },
    }, signal);
    if (native.isError) throw new PilotError("UPSTREAM_ERROR");
    const geometry = object(native.structuredContent);
    const stl = artifact(geometry, "stl");
    const glb = artifact(geometry, "gltf");
    const [stlBytes, glbBytes] = await Promise.all([
      verifiedArtifact(options.cadUrl, stl, signal),
      verifiedArtifact(options.cadUrl, glb, signal),
    ]);

    signal.throwIfAborted();
    let pending = stagedMeshes.get(stl.sha256);
    if (!pending) {
      if (stagedMeshes.size >= maxStagedMeshes) throw new PilotError("ARTIFACT_UNAVAILABLE");
      pending = stageMesh(join(options.stageDir, `${stl.sha256}.stl`), stlBytes, signal);
      stagedMeshes.set(stl.sha256, pending);
      pending.catch(() => stagedMeshes.delete(stl.sha256));
    }
    await pending;
    signal.throwIfAborted();
    for (const descriptor of [stl, glb]) {
      if (viewable.has(descriptor.uri)) continue;
      cad.registerResource(
        { uri: descriptor.uri, name: "Plate export", mimeType: descriptor.mimeType },
        () => readResource(options.cadUrl, descriptor.uri),
      );
      viewable.add(descriptor.uri);
    }

    return {
      ...native,
      structuredContent: { ...geometry, value: { stlSha256: stl.sha256, geometry } },
      _meta: {
        ...object(native._meta ?? {}),
        ui: { resourceUri: viewerUri },
        pilotGlbBase64: glbBytes.toBase64(),
      },
    };
  }, viewerUri);

  await registerSnippet(slicer, options.snippetStoreDir, slicerSnippet, {
    operation: "prusaslicer_estimate_fff",
    parameters: { stlSha256: "string" },
  }, async (input, signal) => {
    const digest = input.stlSha256;
    if (
      Object.keys(input).length !== 1 || typeof digest !== "string" ||
      !sha256Regex.test(digest)
    ) throw new PilotError("INVALID_INPUT");
    const pending = stagedMeshes.get(digest);
    if (!pending) throw new PilotError("ARTIFACT_UNAVAILABLE");
    await pending;
    const name = `${digest}.stl`;
    const localPath = join(options.stageDir, name);
    const stat = await Deno.lstat(localPath);
    if (
      !stat.isFile || stat.size > maxArtifactBytes ||
      await sha256(await Deno.readFile(localPath)) !== digest
    ) {
      throw new PilotError("ARTIFACT_UNAVAILABLE");
    }

    const native = await mcp(options.slicerUrl, "tools/call", {
      name: "prusaslicer_estimate_fff",
      arguments: {
        stl_path: join(options.slicerStageDir, name),
        stl_sha256: digest,
        profile_ini_path: options.profile,
        profile_sha256: options.profileSha256,
        timeout_ms: nativeProcessTimeoutMs,
      },
    }, signal);
    if (native.isError) throw new PilotError("UPSTREAM_ERROR");
    const estimate = object(native.structuredContent);
    return { ...native, structuredContent: { ...estimate, value: estimate } };
  });
  return { cad, slicer };
}

async function registerSnippet(
  server: McpApp,
  storeDirectory: string,
  snippet: typeof cadSnippet | typeof slicerSnippet,
  binding: { operation: string; parameters: SnippetParameters },
  run: (input: JsonObject, signal: AbortSignal) => Promise<JsonObject>,
  resourceUri?: string,
) {
  const scope = binding.operation;
  const store = createFileSnippetStore(storeDirectory);
  const catalog = createSnippetCatalog({ store });
  // Install trusted example fixtures. Callers discover and replay their names using MCP.
  await store.putIfAbsent(scope, {
    name: snippet.name,
    description: snippet.description,
    parameters: binding.parameters,
    code: await Deno.readTextFile(new URL(`./${snippet.name}.js`, import.meta.url)),
  });
  server.registerTool({
    name: "list_snippets",
    description: "List the named snippets available on this pilot provider.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  }, async () => ({
    content: snippet.description,
    structuredContent: {
      snippets: (await catalog.list(scope)).map((summary) => ({
        ...summary,
        inputSchema: snippet.inputSchema,
      })),
    },
  }));
  server.registerTool({
    name: "run_snippet",
    description: "Run a saved pilot snippet with its declared parameters.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { name: { type: "string", const: snippet.name }, input: snippet.inputSchema },
      required: ["name", "input"],
    },
    ...(resourceUri ? { _meta: { ui: { resourceUri } } } : {}),
  }, async (args, context) => {
    const deadline = AbortSignal.timeout(snippetTimeoutMs);
    const requestSignal = context?.request?.signal;
    const signal = requestSignal ? AbortSignal.any([deadline, requestSignal]) : deadline;
    try {
      if (args.name !== snippet.name) throw new PilotError("INVALID_INPUT");
      return await catalog.run(scope, snippet.name, args.input, {
        validate: object,
        async execute(code, input) {
          let native: JsonObject | undefined;
          let invocationError: unknown;
          const execute = runProgram(code, input, async (operation, args, sandboxSignal) => {
            const executionSignal = AbortSignal.any([signal, sandboxSignal]);
            executionSignal.throwIfAborted();
            if (
              native || operation !== "runSnippet" || args[0] !== binding.operation ||
              args.length !== 2
            ) throw new PilotError("INVALID_INPUT");
            try {
              native = await run(object(args[1]), executionSignal);
              return object(native.structuredContent).value;
            } catch (error) {
              invocationError = error;
              throw error;
            }
          });
          const value = await execute.catch((error) => {
            throw invocationError ?? error;
          });
          signal.throwIfAborted();
          if (!native) throw new PilotError("UPSTREAM_ERROR");
          return {
            ...native,
            structuredContent: { ...object(native.structuredContent), value },
          };
        },
      });
    } catch (error) {
      const code = signal.aborted
        ? "TIMEOUT"
        : error instanceof PilotError
        ? error.code
        : "UPSTREAM_ERROR";
      return {
        isError: true,
        content: [{ type: "text", text: diagnosticMessages[code] }],
        structuredContent: { error: { code } },
      };
    }
  });
}

if (import.meta.main) {
  const stageDir = await Deno.realPath(setting("PILOT_PRUSASLICER_STAGE_DIR"));
  const profileSha256 = setting("PILOT_PRUSASLICER_PROFILE_SHA256");
  if (!sha256Regex.test(profileSha256)) throw new Error("Invalid PLA profile SHA-256.");
  const { cad, slicer } = await createProviders({
    cadUrl: Deno.env.get("PILOT_BUILD123D_URL") ?? "http://127.0.0.1:3014/mcp",
    slicerUrl: Deno.env.get("PILOT_PRUSASLICER_URL") ?? "http://127.0.0.1:3022/mcp",
    stageDir,
    slicerStageDir: Deno.env.get("PILOT_PRUSASLICER_REMOTE_STAGE_DIR") ?? stageDir,
    profile: setting("PILOT_PRUSASLICER_PROFILE"),
    profileSha256,
    snippetStoreDir: Deno.env.get("PILOT_SNIPPET_STORE") ?? join(stageDir, "catalog"),
  });
  await Promise.all([
    cad.startHttp({
      hostname: "127.0.0.1",
      port: Number(Deno.env.get("PILOT_CAD_SNIPPET_PORT") ?? 3614),
    }),
    slicer.startHttp({
      hostname: "127.0.0.1",
      port: Number(Deno.env.get("PILOT_SLICER_SNIPPET_PORT") ?? 3622),
    }),
  ]);
}
