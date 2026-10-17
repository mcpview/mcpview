# @mcpview/compose — API Reference

Full exports by subpath, with signatures and notes.

---

## `/core` — `@mcpview/compose/core`

### Functions

#### `createCollector(): UiCollector`

Creates a new UI resource collector. Accumulates `CollectedUiResource` objects from MCP tool results
that carry `_meta.ui.resourceUri`.

```typescript
import { createCollector } from "@mcpview/compose/core";
const collector = createCollector();
```

#### `buildCompositeUi(resources, orchestration?): CompositeUiDescriptor`

Assembles collected resources into a descriptor ready for rendering.

```typescript
function buildCompositeUi(
  resources: CollectedUiResource[],
  orchestration?: UiOrchestration,
): CompositeUiDescriptor;
```

- `resources` — array from `collector.getResources()`
- `orchestration.layout` — defaults to `"stack"` if omitted
- `orchestration.sync` — tool-name-based rules, resolved to slot indices internally; invalid rules
  silently excluded
- `orchestration.sharedContext` — list of keys to extract from resource contexts into a merged
  `sharedContext`
- Generates a unique `workflowId` (UUID) for the descriptor's `resourceUri`

#### `validateSyncRules(rules, knownSources): ValidationResult`

Validates sync rules against known tool names. Must be called explicitly — not called by
`buildCompositeUi`.

```typescript
function validateSyncRules(
  rules: UiSyncRule[],
  knownSources: string[],
): ValidationResult;
```

Detects:

- `ErrorCode.ORPHAN_SYNC_REFERENCE` — `from` or `to` tool name not in `knownSources`
- `ErrorCode.CIRCULAR_SYNC_RULE` — `from === to` for non-broadcast rules

#### `resolveSyncRules(rules, resources): ResolutionResult`

Internal — resolves tool names to slot indices. Called by `buildCompositeUi`. Use
`validateSyncRules` instead for upfront checks.

#### `extractUiMeta(result): McpUiToolMeta | null`

Extracts `_meta.ui` from a raw tool result. Used internally by the collector.

#### `isValidLayout(value): value is UiLayout`

Runtime check — returns true for preset strings and valid areas objects.

#### `isLayoutPreset(layout): layout is UiLayoutPreset`

Returns true if layout is a string preset.

#### `isLayoutAreas(layout): layout is UiLayoutAreas`

Returns true if layout is an areas grid object.

### Types

```typescript
interface UiCollector {
  collect(
    toolName: string,
    result: unknown,
    context?: Record<string, unknown>,
  ): CollectedUiResource | null;
  getResources(): CollectedUiResource[];
  clear(): void;
}

interface CollectedUiResource {
  source: string; // tool name
  resourceUri: string; // ui:// URI
  slot: number; // 0-based, auto-incremented
  context?: Record<string, unknown>;
}

interface CompositeUiDescriptor {
  type: "composite";
  resourceUri: string; // ui://mcp-compose/workflow/<uuid>
  layout: UiLayout;
  children: CollectedUiResource[];
  sync: ResolvedSyncRule[];
  sharedContext?: Record<string, unknown>;
  areaMap?: Record<string, string>; // source → area name (areas layout)
}

interface UiOrchestration {
  layout?: UiLayout;
  sync?: UiSyncRule[];
  sharedContext?: string[];
}

interface UiSyncRule {
  from: string; // source tool name
  event: string;
  to: string; // target tool name or "*"
  action: string;
}

interface ResolvedSyncRule {
  from: number; // source slot index
  event: string;
  to: number | "*"; // target slot index or broadcast
  action: string;
}

interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

interface ValidationIssue {
  code: ErrorCode;
  message: string;
  path: string; // e.g. "sync[0].from"
}

enum ErrorCode {
  ORPHAN_SYNC_REFERENCE = "ORPHAN_SYNC_REFERENCE",
  CIRCULAR_SYNC_RULE = "CIRCULAR_SYNC_RULE",
}

type UiLayout = UiLayoutPreset | UiLayoutAreas;
type UiLayoutPreset = "split" | "tabs" | "grid" | "stack";

interface UiLayoutAreas {
  areas: string[][];
  columns?: number[];
  rows?: number[];
  gap?: "none" | "compact" | "normal" | "spacious";
}

// MCP tool result meta shapes
interface McpUiResourceMeta {
  resourceUri: string;
  visibility?: Array<"model" | "app">;
  csp?: McpUiCsp;
  permissions?: McpUiPermissions;
  domain?: string;
  prefersBorder?: boolean;
}

interface McpUiCsp {
  allowScripts?: boolean;
  allowForms?: boolean;
  allowSameOrigin?: boolean;
  allowedOrigins?: string[];
}

interface McpUiPermissions {
  clipboard?: boolean;
  geolocation?: boolean;
  camera?: boolean;
  microphone?: boolean;
}
```

---

## `/sdk` — `@mcpview/compose/sdk`

### Functions

#### `createMcpSdkCollector(): McpSdkCollector`

Creates an MCP SDK-aware collector. Wraps the core collector with typed input for `CallToolResult`.

```typescript
import { createMcpSdkCollector } from "@mcpview/compose/sdk";
const collector = createMcpSdkCollector();
```

#### `uiMeta(options): UiMetaResult`

Builds a typed `_meta` object for an MCP tool definition. Only defined fields are included.

```typescript
function uiMeta(options: UiMetaOptions): { _meta: { ui: UiMetaUi } };
```

```typescript
interface UiMetaOptions {
  resourceUri: string; // required
  visibility?: Array<"model" | "app">;
  csp?: McpUiCsp;
  permissions?: McpUiPermissions;
  domain?: string;
  prefersBorder?: boolean;
  emits?: string[]; // PML extension — event types this UI emits
  accepts?: string[]; // PML extension — event types this UI accepts
}
```

#### `composeEvents(handler): ComposeEvents`

Returns an event handler object for cross-UI event routing. See `/sdk` types for
`ComposeEventHandler`, `ComposeEventPayload`.

```typescript
import { composeEvents } from "@mcpview/compose/sdk";
```

#### `validateComposition(descriptor): CompositionValidationResult`

Validates a full `CompositeUiDescriptor` for structural issues.

### Types

```typescript
interface McpSdkCollector {
  collectFromSdk(
    toolName: string,
    result: McpSdkCallToolResult,
    context?: Record<string, unknown>,
  ): CollectedUiResource | null;
  getResources(): CollectedUiResource[];
  clear(): void;
  readonly inner: UiCollector;
}

interface McpSdkCallToolResult {
  content?: Array<{ type: string; text?: string; [key: string]: unknown }>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}
```

---

## `/host` — `@mcpview/compose/host`

### Functions

#### `renderComposite(descriptor): string`

Renders a `CompositeUiDescriptor` to a complete self-contained HTML document.

```typescript
import { renderComposite } from "@mcpview/compose/host";

function renderComposite(descriptor: CompositeUiDescriptor): string;
```

Output is a valid HTML5 document containing:

- Layout CSS matching `descriptor.layout`
- Dark/light theme support via CSS variables
- One `<iframe>` per child resource with `data-slot`, `data-source` attributes
- JavaScript event bus (JSON-RPC 2.0) for cross-UI sync

#### `serveDashboard(html, options?): Promise<ServeDashboardHandle>`

Serves HTML on localhost using `Deno.serve()`, optionally opens the browser.

```typescript
async function serveDashboard(
  html: string,
  options?: ServeDashboardOptions,
): Promise<ServeDashboardHandle>;

interface ServeDashboardOptions {
  port?: number; // default: 0 (OS-assigned)
  hostname?: string; // default: "localhost"
  open?: boolean; // default: true
}

interface ServeDashboardHandle {
  url: string;
  shutdown(): Promise<void>;
}
```

### Types

```typescript
interface CompositeUiHost {
  // host contract for embedding composite UIs
}

interface HostConfig {
  // host configuration
}
```

---

## `/runtime` — `@mcpview/compose/runtime`

### Functions

#### `composeDashboardFromFiles(request): Promise<ComposeResult>`

High-level entry point: reads template + manifest files, starts MCP servers, calls tools, and
returns composed HTML.

```typescript
import { composeDashboardFromFiles } from "@mcpview/compose/runtime";

async function composeDashboardFromFiles(
  request: ComposeRequest,
): Promise<ComposeResult>;
```

#### `composeDashboard(request): Promise<ComposeResult>`

Same as above but accepts already-loaded template/manifest objects (no file I/O).

#### `loadManifest(path): Promise<McpManifest>`

#### `loadManifests(paths): Promise<McpManifest[]>`

#### `parseManifest(yaml): McpManifest`

#### `validateManifest(manifest): ValidationResult`

#### `loadTemplate(path): Promise<DashboardTemplate>`

#### `parseTemplate(yaml): DashboardTemplate`

#### `validateTemplate(template): ValidationResult`

#### `injectArgs(template, args): DashboardTemplate`

#### `createCluster(manifests): McpCluster`

#### `connectHttp(url): McpConnection`

#### `startServer(manifest): Promise<McpConnection>`

### Types

```typescript
interface ComposeRequest {
  template: DashboardTemplate;
  manifests: McpManifest[];
  args?: Record<string, unknown>;
}

interface ComposeResult {
  html: string;
  descriptor: CompositeUiDescriptor;
}

interface McpManifest {
  servers: McpConnection[];
}

interface McpConnection {
  name: string;
  transport: McpTransport;
}

type McpTransport = StdioTransport | HttpTransport;

interface StdioTransport {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HttpTransport {
  type: "http";
  url: string;
}

interface DashboardTemplate {
  layout?: UiLayout;
  sync?: UiSyncRule[];
  tools: TemplateToolCall[];
}

interface TemplateToolCall {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}
```

---

## `/deploy` — `@mcpview/compose/deploy`

Types only in v0.4.0 — no exported functions yet.

```typescript
interface DeployRequest {
  credentials: DeployCredentials;
  manifest: DeployManifestEntry[];
}

interface DeployResult {
  url: string;
}

interface DeployCredentials {
  token: string;
}

interface DeployManifestEntry {
  name: string;
  transport: DeployTransport;
}

enum DeployErrorCode {
  // ...
}
```
