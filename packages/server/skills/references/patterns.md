# @mcpview/server — Common Patterns

---

## 1. Basic STDIO server

Minimal server for local tools (Claude Desktop, cline, etc.):

```typescript
import { McpApp } from "@mcpview/server";

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
});

app.registerTool(
  {
    name: "get_weather",
    description: "Get current weather for a city",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name" },
      },
      required: ["city"],
    },
  },
  async (args) => {
    const data = await fetchWeather(args.city as string);
    return { temp: data.temp, conditions: data.conditions };
  },
);

await app.start();
```

---

## 2. HTTP server with Auth0 auth

```typescript
import { createAuth0AuthProvider, McpApp } from "@mcpview/server";

const app = new McpApp({
  name: "my-api-server",
  version: "1.0.0",
  maxConcurrent: 20,
  auth: {
    provider: createAuth0AuthProvider({
      domain: "my-tenant.auth0.com",
      audience: "https://my-mcp.example.com",
      resource: "https://my-mcp.example.com",
      scopesSupported: ["read:data", "write:data"],
    }),
    authorizationServers: ["https://my-tenant.auth0.com/"],
    resource: "https://my-mcp.example.com",
    scopesSupported: ["read:data", "write:data"],
  },
});

app.registerTool(
  {
    name: "read_data",
    description: "Read data",
    inputSchema: { type: "object" },
    requiredScopes: ["read:data"],
  },
  (args) => ({ data: "..." }),
);

const http = await app.startHttp({
  port: 3000,
  corsOrigins: ["https://app.example.com"],
  requireAuth: true,
  ipRateLimit: { maxRequests: 100, windowMs: 60_000 },
  maxBodyBytes: 1_048_576,
});

console.log(`Listening on ${http.addr.port}`);
```

---

## 3. Custom middleware (logging, tracing, tenant context)

```typescript
import { McpApp, type Middleware } from "@mcpview/server";

const loggingMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] → ${ctx.toolName}`);
  try {
    const result = await next();
    console.log(
      `[${new Date().toISOString()}] ← ${ctx.toolName} (${
        Date.now() - start
      }ms)`,
    );
    return result;
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] ✗ ${ctx.toolName} (${
        Date.now() - start
      }ms)`,
      err,
    );
    throw err;
  }
};

const app = new McpApp({ name: "my-server", version: "1.0.0" });
app.use(loggingMiddleware);

// Access auth info set by auth middleware upstream:
const authAwareMiddleware: Middleware = async (ctx, next) => {
  const authInfo = ctx.authInfo as
    | { subject: string; scopes: string[] }
    | undefined;
  if (authInfo) {
    console.log(
      `User: ${authInfo.subject}, scopes: ${authInfo.scopes.join(", ")}`,
    );
  }
  return next();
};
app.use(authAwareMiddleware);
```

---

## 4. MCP Apps — Tool with UI resource

Register both a resource (HTML viewer) and a tool that references it:

```typescript
import { MCP_APP_MIME_TYPE, McpApp } from "@mcpview/server";
import { uiMeta } from "@mcpview/compose/sdk";

const app = new McpApp({
  name: "dashboard-server",
  version: "1.0.0",
  expectResources: true,
});

// Register the HTML viewer resource
app.registerResource(
  {
    uri: "ui://dashboard-server/chart-viewer",
    name: "Chart Viewer",
    description: "Interactive chart component",
    mimeType: MCP_APP_MIME_TYPE,
  },
  async () => ({
    uri: "ui://dashboard-server/chart-viewer",
    mimeType: MCP_APP_MIME_TYPE,
    text: await Deno.readTextFile("./ui/dist/chart-viewer/index.html"),
  }),
);

// Register a tool that returns data for the chart viewer
app.registerTool(
  {
    name: "get_sales_chart",
    description: "Get sales data as a chart",
    inputSchema: { type: "object", properties: { period: { type: "string" } } },
    _meta: {
      ui: {
        resourceUri: "ui://dashboard-server/chart-viewer",
        emits: ["select"],
        accepts: ["highlight"],
      },
    },
  },
  async (args) => {
    const data = await fetchSalesData(args.period as string);
    return {
      content: `Sales data for ${args.period}: ${data.total} total`,
      structuredContent: { labels: data.labels, values: data.values },
    };
  },
);

await app.startHttp({ port: 3000 });
```

---

## 5. registerViewers — batch viewer registration

For servers with multiple MCP App UIs:

```typescript
import { McpApp } from "@mcpview/server";

const app = new McpApp({ name: "my-server", version: "1.0.0" });

const summary = app.registerViewers({
  prefix: "my-server",
  moduleUrl: import.meta.url,
  viewers: ["table-viewer", "chart-viewer", "form-viewer"],
  readFile: (path) => Deno.readTextFile(path),
  exists: (path) => {
    try {
      Deno.statSync(path);
      return true;
    } catch {
      return false;
    }
  },
});

console.log("Registered:", summary.registered);
console.log("Skipped (not built):", summary.skipped);

await app.start();
```

---

## 6. Multi-tenant setup

One `McpApp` per tenant, cached and served from a shared HTTP layer:

```typescript
import {
  createAuth0AuthProvider,
  createMultiTenantMiddleware,
  McpApp,
} from "@mcpview/server";

const tenantCache = new Map<string, ReturnType<McpApp["getFetchHandler"]>>();

async function getHandlerForTenant(tenantId: string) {
  if (tenantCache.has(tenantId)) return tenantCache.get(tenantId)!;

  const app = new McpApp({
    name: `server-${tenantId}`,
    version: "1.0.0",
    auth: {
      provider: createAuth0AuthProvider({
        domain: `${tenantId}.auth0.com`,
        audience: "https://api.example.com",
        resource: "https://api.example.com",
      }),
      authorizationServers: [`https://${tenantId}.auth0.com/`],
      resource: "https://api.example.com",
    },
  });

  app.use(createMultiTenantMiddleware({
    resolver: async (ctx) => ({
      tenantId: ctx.authInfo?.claims?.org_id as string ?? tenantId,
    }),
  }));

  app.registerTool(
    { name: "get_data", description: "Get tenant data", inputSchema: {} },
    (args, ctx) => fetchTenantData(tenantId),
  );

  const handler = await app.getFetchHandler({ requireAuth: true });
  tenantCache.set(tenantId, Promise.resolve(handler));
  return handler;
}
```

---

## 7. Embedding in Hono

```typescript
import { Hono } from "hono";
import { createGoogleAuthProvider, McpApp } from "@mcpview/server";

const app = new McpApp({ name: "my-server", version: "1.0.0" });
app.registerTool(
  { name: "hello", description: "Hello", inputSchema: {} },
  () => "hi",
);

const mcpHandler = await app.getFetchHandler({
  requireAuth: true,
  corsOrigins: ["https://app.example.com"],
  auth: {
    provider: createGoogleAuthProvider({
      audience: "https://my-mcp.example.com",
      resource: "https://my-mcp.example.com",
    }),
    authorizationServers: ["https://accounts.google.com"],
    resource: "https://my-mcp.example.com",
  },
});

const honoApp = new Hono();
honoApp.all("/mcp/*", (c) => mcpHandler(c.req.raw));
honoApp.get("/", (c) => c.text("Hello from Hono!"));

Deno.serve({ port: 8000 }, honoApp.fetch);
```

---

## 8. Embedding in Deno Fresh (routes/mcp/[...path].tsx)

```typescript
// routes/mcp/[...path].tsx
import type { Handlers } from "$fresh/server.ts";
import { McpApp } from "@mcpview/server";

// Instantiate once at module level (Fresh keeps this in memory)
const app = new McpApp({ name: "fresh-mcp", version: "1.0.0" });
app.registerTool(
  { name: "ping", description: "Ping", inputSchema: {} },
  () => "pong",
);

const handler = await app.getFetchHandler({ requireAuth: false });

export const handlers: Handlers = {
  GET: (req) => handler(req),
  POST: (req) => handler(req),
  DELETE: (req) => handler(req),
};
```

---

## 9. Error handling with toolErrorMapper

Convert known errors to `isError: true` MCP results instead of JSON-RPC errors:

```typescript
import { McpApp, type ToolErrorMapper } from "@mcpview/server";

class NotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Not found: ${id}`);
  }
}

class ValidationError extends Error {}

const errorMapper: ToolErrorMapper = (error, toolName) => {
  if (error instanceof NotFoundError) {
    return `${error.message} (tool: ${toolName})`;
  }
  if (error instanceof ValidationError) {
    return `Validation failed: ${error.message}`;
  }
  // Return null to rethrow as JSON-RPC error (unexpected errors)
  return null;
};

const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  toolErrorMapper: errorMapper,
});

app.registerTool(
  {
    name: "get_item",
    description: "Get item by ID",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  async (args) => {
    const item = await db.findById(args.id as string);
    if (!item) throw new NotFoundError(args.id as string);
    return item;
  },
);
```

---

## 10. Rate limiting configuration

### Tool-level rate limiting (per-client)

```typescript
const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  rateLimit: {
    maxRequests: 10,
    windowMs: 60_000, // 10 calls per minute
    onLimitExceeded: "reject", // or "wait" (default)
    keyExtractor: (ctx) => {
      // Rate-limit per tool
      return ctx.toolName;
      // Or per user (requires auth middleware to set ctx.userId):
      // return (ctx.userId as string) ?? "anonymous";
    },
  },
});
```

### HTTP-level IP rate limiting

```typescript
await app.startHttp({
  port: 3000,
  ipRateLimit: {
    maxRequests: 100,
    windowMs: 60_000,
    onLimitExceeded: "reject",
    keyExtractor: (ctx) => {
      // Custom key: e.g., per session instead of per IP
      return ctx.sessionId ?? ctx.ip;
    },
  },
});
```

---

## 11. Structured tool results (separate LLM text from data)

Use `StructuredToolResult` when the data payload is large and you want to keep
the LLM context clean:

```typescript
import { type StructuredToolResult } from "@mcpview/server";

app.registerTool(
  {
    name: "query_table",
    description: "Query a database table",
    inputSchema: {
      type: "object",
      properties: { sql: { type: "string" } },
      required: ["sql"],
    },
    outputSchema: {
      type: "object",
      properties: {
        rows: { type: "array" },
        count: { type: "number" },
      },
    },
  },
  async (args): Promise<StructuredToolResult> => {
    const rows = await db.query(args.sql as string);
    return {
      content: `Query returned ${rows.length} rows.`, // short summary for the LLM
      structuredContent: { rows, count: rows.length }, // full data in structuredContent
    };
  },
);
```

---

## 12. Dynamic tool registration (relay/proxy pattern)

Register and unregister tools while the server is running:

```typescript
import { McpApp } from "@mcpview/server";

const app = new McpApp({ name: "relay", version: "1.0.0" });

// Start first — registerToolLive works after start()
await app.startHttp({ port: 3000 });

// Later, when a downstream service connects:
function onServiceConnected(service: { name: string; tools: MCPTool[] }) {
  for (const tool of service.tools) {
    app.registerToolLive(
      { ...tool, name: `${service.name}/${tool.name}` },
      (args) => service.callTool(tool.name, args),
    );
  }
}

// When it disconnects:
function onServiceDisconnected(service: { name: string; tools: MCPTool[] }) {
  for (const tool of service.tools) {
    app.unregisterTool(`${service.name}/${tool.name}`);
  }
}
```

---

## 13. GitHub Actions OIDC auth (machine-to-machine)

```typescript
import { createGitHubAuthProvider, McpApp } from "@mcpview/server";

const app = new McpApp({
  name: "ci-tools",
  version: "1.0.0",
  auth: {
    provider: createGitHubAuthProvider({
      audience: "https://ci-tools.example.com",
      resource: "https://ci-tools.example.com",
      scopesSupported: ["deploy"],
    }),
    authorizationServers: ["https://token.actions.githubusercontent.com"],
    resource: "https://ci-tools.example.com",
  },
});

app.registerTool(
  {
    name: "deploy",
    description: "Deploy an artifact",
    inputSchema: {
      type: "object",
      properties: { artifact: { type: "string" } },
      required: ["artifact"],
    },
    requiredScopes: ["deploy"],
  },
  async (args) => deployArtifact(args.artifact as string),
);

await app.startHttp({ port: 3000, requireAuth: true });
```

---

## 14. Using onInitialized callback

React after the MCP handshake completes (e.g., to check client capabilities):

```typescript
import { MCP_APP_MIME_TYPE, McpApp } from "@mcpview/server";

const app = new McpApp({ name: "my-server", version: "1.0.0" });

// Register both UI and text-only versions of a tool
app.registerTool(
  { name: "query", description: "Query data", inputSchema: {} },
  (args) => {
    const cap = app.getClientMcpAppsCapability();
    if (cap?.mimeTypes?.includes(MCP_APP_MIME_TYPE)) {
      return {
        content: "Data loaded — see the table viewer.",
        structuredContent: { rows: [] },
      };
    }
    // Text-only fallback
    return "Results: ...";
  },
);

await app.start();
```

---

## 15. Custom routes on HTTP server

Add non-MCP endpoints alongside the MCP protocol routes:

```typescript
await app.startHttp({
  port: 3000,
  customRoutes: [
    {
      method: "get",
      path: "/status",
      handler: (req) =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    },
    {
      method: "post",
      path: "/webhook",
      handler: async (req) => {
        const body = await req.json();
        await processWebhook(body);
        return new Response(null, { status: 204 });
      },
    },
  ],
});
```

---

## 16. Schema validation

Enable input validation before tool handlers run:

```typescript
const app = new McpApp({
  name: "my-server",
  version: "1.0.0",
  validateSchema: true,
});

app.registerTool(
  {
    name: "create_user",
    description: "Create a user",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 100 },
        email: { type: "string", format: "email" },
        age: { type: "number", minimum: 0 },
      },
      required: ["name", "email"],
      additionalProperties: false,
    },
  },
  async (args) => {
    // args are guaranteed to match the schema here
    return await createUser(args);
  },
);
```

If validation fails, the middleware returns an `isError: true` result with a
description of the schema violations before the handler is called.
