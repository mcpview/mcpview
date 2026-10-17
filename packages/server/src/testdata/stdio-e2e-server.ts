/**
 * A real stdio server, started the way a consumer starts one.
 *
 * Spawned as a subprocess by `stdio-e2e_test.ts`. Kept as a fixture rather than
 * written to a temp file at run time so the thing under test is readable and
 * versioned: this is exactly the five lines from the README.
 */

import { McpApp } from "../mcp-app.ts";
import { MCP_APP_MIME_TYPE } from "../types.ts";

const RESOURCE_URI = "ui://e2e-stdio/lifecycle";
const BATCH_RESOURCES = ["batch-a", "batch-b"].map((name) => ({
  uri: `ui://e2e-stdio/${name}`,
  name,
}));

function registerBatch(): string {
  app.registerResources(
    BATCH_RESOURCES,
    new Map(BATCH_RESOURCES.map((resource) => [
      resource.uri,
      () => ({
        uri: resource.uri,
        mimeType: "text/plain",
        text: resource.name,
      }),
    ])),
  );
  return "registered batch";
}

const app = new McpApp({
  name: "e2e-stdio",
  version: "9.9.9",
  logger: () => {},
  instructions: "fixture server",
});

app.registerTool(
  {
    name: "echo",
    description: "Echo the input",
    inputSchema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  },
  (args) => args.value ?? "empty",
);

app.registerTool(
  {
    name: "scoped_local",
    description: "Prove OAuth scopes do not apply to trusted local stdio",
    inputSchema: { type: "object" },
    requiredScopes: ["admin"],
  },
  () => "trusted-local",
);

app.registerResource(
  {
    uri: RESOURCE_URI,
    name: "Lifecycle resource",
    mimeType: MCP_APP_MIME_TYPE,
    size: 5,
  },
  () => ({
    uri: RESOURCE_URI,
    mimeType: MCP_APP_MIME_TYPE,
    text: "hello",
    _meta: { fixture: "stdio" },
  }),
);

app.registerTool(
  {
    name: "unregister_lifecycle_resource",
    description: "Remove the fixture resource after startup",
    inputSchema: { type: "object" },
  },
  () => app.unregisterResource(RESOURCE_URI) ? "removed" : "absent",
);

app.registerTool(
  {
    name: "register_resource_batch",
    description: "Register two resources in one post-start batch",
    inputSchema: { type: "object" },
  },
  registerBatch,
);

app.registerTool(
  {
    name: "register_duplicate_resource_batch",
    description: "Attempt to register the same batch again",
    inputSchema: { type: "object" },
  },
  registerBatch,
);

app.registerTool(
  {
    name: "register_second_lifecycle_resource",
    description: "Register one resource after the stdio transport starts",
    inputSchema: { type: "object" },
  },
  () => {
    const uri = "ui://e2e-stdio/second";
    app.registerResource(
      { uri, name: "Second lifecycle resource" },
      () => ({ uri, mimeType: "text/plain", text: "second" }),
    );
    return "registered";
  },
);

await app.start();
