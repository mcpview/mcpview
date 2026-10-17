/**
 * Unit tests for resource registration in McpApp
 *
 * Tests MCP Apps (SEP-1865) resource support including:
 * - registerResource() single registration
 * - registerResources() batch registration
 * - Duplicate URI rejection
 * - Fail-fast on missing handlers
 * - Introspection methods
 *
 * @module lib/server/src/resource-registration_test
 */

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { Server } from "@modelcontextprotocol/server";
import { McpApp } from "./mcp-app.ts";
import type { MCPResource, ResourceContent, ResourceHandler } from "./types.ts";
import { MCP_APP_MIME_TYPE } from "./types.ts";

/**
 * Helper to create test server instance
 */
function createTestServer(): McpApp {
  return new McpApp({
    name: "test-server",
    version: "1.0.0",
    // Suppress logging during tests
    logger: () => {},
  });
}

Deno.test("registerResource - registers a resource", () => {
  const server = createTestServer();
  const resource: MCPResource = {
    uri: "ui://test/viewer",
    name: "Test Viewer",
    description: "A test viewer",
  };
  const handler: ResourceHandler = () => ({
    uri: resource.uri,
    mimeType: MCP_APP_MIME_TYPE,
    text: "<html></html>",
  });

  server.registerResource(resource, handler);

  assertEquals(server.getResourceCount(), 1);
  assertEquals(server.getResourceUris(), ["ui://test/viewer"]);
  assertEquals(server.hasResource("ui://test/viewer"), true);
});

Deno.test("registerResource - throws on duplicate URI", () => {
  const server = createTestServer();
  const resource: MCPResource = { uri: "ui://test/dup", name: "Dup" };
  const handler: ResourceHandler = () => ({
    uri: resource.uri,
    mimeType: MCP_APP_MIME_TYPE,
    text: "",
  });

  server.registerResource(resource, handler);

  assertThrows(
    () => server.registerResource(resource, handler),
    Error,
    "Resource already registered",
  );
});

Deno.test("registerResources - registers multiple resources", () => {
  const server = createTestServer();
  const resources: MCPResource[] = [
    { uri: "ui://test/a", name: "A" },
    { uri: "ui://test/b", name: "B" },
  ];
  const handlers = new Map<string, ResourceHandler>([
    [
      "ui://test/a",
      () => ({ uri: "ui://test/a", mimeType: MCP_APP_MIME_TYPE, text: "A" }),
    ],
    [
      "ui://test/b",
      () => ({ uri: "ui://test/b", mimeType: MCP_APP_MIME_TYPE, text: "B" }),
    ],
  ]);

  server.registerResources(resources, handlers);

  assertEquals(server.getResourceCount(), 2);
});

Deno.test("registerResources - throws if duplicate exists (atomic, no partial registration)", () => {
  const server = createTestServer();

  // Pre-register one resource
  server.registerResource(
    { uri: "ui://test/existing", name: "Existing" },
    () => ({
      uri: "ui://test/existing",
      mimeType: MCP_APP_MIME_TYPE,
      text: "",
    }),
  );

  // Try to batch register including the duplicate
  const resources: MCPResource[] = [
    { uri: "ui://test/new-a", name: "New A" },
    { uri: "ui://test/existing", name: "Duplicate" }, // Already exists!
    { uri: "ui://test/new-b", name: "New B" },
  ];
  const handlers = new Map<string, ResourceHandler>([
    [
      "ui://test/new-a",
      () => ({ uri: "ui://test/new-a", mimeType: MCP_APP_MIME_TYPE, text: "" }),
    ],
    [
      "ui://test/existing",
      () => ({
        uri: "ui://test/existing",
        mimeType: MCP_APP_MIME_TYPE,
        text: "",
      }),
    ],
    [
      "ui://test/new-b",
      () => ({ uri: "ui://test/new-b", mimeType: MCP_APP_MIME_TYPE, text: "" }),
    ],
  ]);

  assertThrows(
    () => server.registerResources(resources, handlers),
    Error,
    "Resources already registered",
  );

  // Verify atomic behavior: only the pre-existing resource remains
  assertEquals(server.getResourceCount(), 1);
  assertEquals(server.hasResource("ui://test/existing"), true);
  assertEquals(server.hasResource("ui://test/new-a"), false);
  assertEquals(server.hasResource("ui://test/new-b"), false);
});

Deno.test("registerResources - throws if handler missing (fail-fast)", () => {
  const server = createTestServer();
  const resources: MCPResource[] = [
    { uri: "ui://test/a", name: "A" },
    { uri: "ui://test/b", name: "B" },
  ];
  const handlers = new Map<string, ResourceHandler>([
    [
      "ui://test/a",
      () => ({ uri: "ui://test/a", mimeType: MCP_APP_MIME_TYPE, text: "A" }),
    ],
    // Missing handler for "ui://test/b"
  ]);

  assertThrows(
    () => server.registerResources(resources, handlers),
    Error,
    "Missing handlers for resources",
  );

  // Verify no resources were registered (atomic fail)
  assertEquals(server.getResourceCount(), 0);
});

Deno.test("getResourceInfo - returns resource details", () => {
  const server = createTestServer();
  const resource: MCPResource = {
    uri: "ui://test/info",
    name: "Info Test",
    description: "Description",
  };
  server.registerResource(resource, () => ({
    uri: resource.uri,
    mimeType: MCP_APP_MIME_TYPE,
    text: "",
  }));

  const info = server.getResourceInfo("ui://test/info");

  assertEquals(info?.name, "Info Test");
  assertEquals(info?.description, "Description");
});

Deno.test("getResourceInfo - returns undefined for unknown URI", () => {
  const server = createTestServer();

  assertEquals(server.getResourceInfo("ui://unknown"), undefined);
});

Deno.test("hasResource - returns false for unregistered URI", () => {
  const server = createTestServer();

  assertEquals(server.hasResource("ui://not-registered"), false);
});

Deno.test("getResourceUris - returns empty array when no resources", () => {
  const server = createTestServer();

  assertEquals(server.getResourceUris(), []);
  assertEquals(server.getResourceCount(), 0);
});

Deno.test("registerResource - handles URI edge cases (trailing slash, query params)", () => {
  const server = createTestServer();

  // Test various URI formats
  const uriVariants = [
    "ui://test/path/", // trailing slash
    "ui://test/path?query=1", // query params
    "ui://test/path#anchor", // anchor
    "ui://test/path%20space", // encoded space
  ];

  for (const uri of uriVariants) {
    const resource: MCPResource = { uri, name: `Resource ${uri}` };
    const handler: ResourceHandler = (receivedUri) => ({
      uri: receivedUri.toString(),
      mimeType: MCP_APP_MIME_TYPE,
      text: `Content for ${uri}`,
    });

    server.registerResource(resource, handler);
    assertEquals(server.hasResource(uri), true);
  }

  assertEquals(server.getResourceCount(), uriVariants.length);
});

Deno.test("registerResource accepts canonical non-ui resources and rejects non-canonical identities", () => {
  const server = createTestServer();
  const resource: MCPResource = {
    uri: "file://local/path",
    name: "Local File",
  };

  server.registerResource(resource, () => ({
    uri: resource.uri,
    mimeType: "text/plain",
    text: "content",
  }));

  assertEquals(server.hasResource("file://local/path"), true);
  assertThrows(
    () =>
      server.registerResource(
        { uri: "UI://test/noncanonical", name: "Noncanonical" },
        () => ({
          uri: "UI://test/noncanonical",
          mimeType: "text/plain",
          text: "x",
        }),
      ),
    Error,
    "Resource URI must be canonical",
  );
});

Deno.test("ResourceContent is a compile-time XOR between text and blob", () => {
  const text: ResourceContent = {
    uri: "ui://test/text",
    mimeType: "text/plain",
    text: "text",
  };
  const blob: ResourceContent = {
    uri: "ui://test/blob",
    mimeType: "application/octet-stream",
    blob: "AA==",
  };

  // @ts-expect-error ResourceContent intentionally forbids both payload forms.
  const invalid: ResourceContent = {
    uri: "ui://test/invalid",
    mimeType: "text/plain",
    text: "text",
    blob: "dGV4dA==",
  };
  void invalid;

  const misplacedAnnotations: ResourceContent = {
    uri: "ui://test/misplaced-annotations",
    mimeType: "text/plain",
    text: "text",
    // @ts-expect-error annotations belong to MCPResource, not ResourceContents.
    annotations: { audience: ["assistant"] },
  };
  void misplacedAnnotations;

  assertEquals(text.text, "text");
  assertEquals(blob.blob, "AA==");
});

Deno.test("ResourceContent runtime contract rejects invalid unchecked handler results", async () => {
  const cases: Array<{
    name: string;
    content: Record<string, unknown>;
    message: string;
  }> = [
    {
      name: "both payloads",
      content: {
        uri: "ui://test/both-payloads",
        mimeType: "text/plain",
        text: "text",
        blob: "dGV4dA==",
      },
      message: "exactly one of text or blob",
    },
    {
      name: "wrong URI",
      content: {
        uri: "ui://test/not-requested",
        mimeType: "text/plain",
        text: "text",
      },
      message: "must match requested URI",
    },
    {
      name: "empty mime type",
      content: {
        uri: "ui://test/empty-mime-type",
        mimeType: "   ",
        text: "text",
      },
      message: "mimeType must be a non-empty string",
    },
    {
      name: "non-canonical base64",
      content: {
        uri: "ui://test/non-canonical-base64",
        mimeType: "application/octet-stream",
        blob: "dGV4dA",
      },
      message: "canonical standard base64",
    },
    {
      name: "non-zero pad bits",
      content: {
        uri: "ui://test/non-zero-pad-bits",
        mimeType: "application/octet-stream",
        blob: "/x==",
      },
      message: "canonical standard base64",
    },
    {
      name: "misplaced annotations",
      content: {
        uri: "ui://test/misplaced-annotations",
        mimeType: "text/plain",
        text: "text",
        annotations: { audience: ["assistant"] },
      },
      message: "annotations are not a ResourceContents field",
    },
  ];

  for (const { name, content, message } of cases) {
    const server = createTestServer();
    const uri = `ui://test/${name.replaceAll(" ", "-")}`;
    server.registerResource(
      { uri, name },
      () => content as unknown as ResourceContent,
    );
    await assertRejects(
      () => server.readResourceContent(uri),
      Error,
      message,
    );
  }
});

Deno.test("registerResource validates metadata size", () => {
  const server = createTestServer();
  const handler: ResourceHandler = () => ({
    uri: "ui://test/size",
    mimeType: "text/plain",
    text: "size",
  });

  server.registerResource(
    { uri: "ui://test/size", name: "Size", size: 4 },
    handler,
  );
  assertEquals(server.getResourceInfo("ui://test/size")?.size, 4);

  assertThrows(
    () =>
      server.registerResource(
        { uri: "ui://test/negative", name: "Negative", size: -1 },
        handler,
      ),
    Error,
    "size must be a non-negative safe integer",
  );
  assertThrows(
    () =>
      server.registerResource(
        { uri: "ui://test/fraction", name: "Fraction", size: 1.5 },
        handler,
      ),
    Error,
    "size must be a non-negative safe integer",
  );
  assertThrows(
    () =>
      server.registerResource(
        {
          uri: "ui://test/unsafe",
          name: "Unsafe",
          size: Number.MAX_SAFE_INTEGER + 1,
        },
        handler,
      ),
    Error,
    "size must be a non-negative safe integer",
  );
});

Deno.test("resource reads attest explicit MIME metadata and exact byte size", async () => {
  const server = createTestServer();
  server.registerResource(
    { uri: "ui://test/mime-attestation", name: "MIME", mimeType: "text/html" },
    () => ({
      uri: "ui://test/mime-attestation",
      mimeType: "text/plain",
      text: "wrong MIME",
    }),
  );
  server.registerResource(
    { uri: "ui://test/utf8-attestation", name: "UTF-8", size: 2 },
    () => ({
      uri: "ui://test/utf8-attestation",
      mimeType: "text/plain",
      text: "€",
    }),
  );
  server.registerResource(
    { uri: "ui://test/blob-attestation", name: "Blob", size: 4 },
    () => ({
      uri: "ui://test/blob-attestation",
      mimeType: "application/octet-stream",
      blob: "AAEC",
    }),
  );

  await assertRejects(
    () => server.readResourceContent("ui://test/mime-attestation"),
    Error,
    "mimeType must match registered metadata",
  );
  await assertRejects(
    () => server.readResourceContent("ui://test/utf8-attestation"),
    Error,
    "expected 2, got 3",
  );
  await assertRejects(
    () => server.readResourceContent("ui://test/blob-attestation"),
    Error,
    "expected 4, got 3",
  );
});

Deno.test("unregisterResource removes a static registration before start and is idempotent", () => {
  const server = createTestServer();
  const uri = "ui://test/remove-before-start";
  server.registerResource(
    { uri, name: "Remove before start" },
    () => ({ uri, mimeType: "text/plain", text: "present" }),
  );

  assertEquals(server.unregisterResource(uri), true);
  assertEquals(server.hasResource(uri), false);
  assertEquals(server.getResourceCount(), 0);
  assertEquals(server.unregisterResource(uri), false);
  assertEquals(server.unregisterResource("ui://test/absent"), false);
});

Deno.test("registerResources commits despite a throwing logger and does not create ghosts", () => {
  let reachedBatchCommitLog = false;
  const server = new McpApp({
    name: "late-registration-failure",
    version: "1.0.0",
    logger: (message) => {
      if (message === "Registered 2 resources") {
        reachedBatchCommitLog = true;
        throw new Error("late registration failure");
      }
    },
  });
  const resources: MCPResource[] = [
    { uri: "ui://test/first", name: "First" },
    { uri: "ui://test/second", name: "Second" },
  ];
  const handlers = new Map<string, ResourceHandler>(
    resources.map((resource) => [
      resource.uri,
      () => ({
        uri: resource.uri,
        mimeType: "text/plain",
        text: resource.name,
      }),
    ]),
  );

  server.registerResources(resources, handlers);
  assertEquals(reachedBatchCommitLog, true);
  assertEquals(
    server.getResourceUris(),
    resources.map((resource) => resource.uri),
  );
  assertEquals(server.unregisterResource("ui://test/first"), true);
  assertEquals(server.unregisterResource("ui://test/second"), true);
  assertEquals(server.getResourceCount(), 0);
  // A re-registration is a fresh Map insertion, not a stale SDK entry.
  server.registerResource(resources[0], handlers.get(resources[0].uri)!);
  assertEquals(server.getResourceUris(), [resources[0].uri]);
});

Deno.test("resource capability is projected onto every fresh protocol instance", () => {
  const app = createTestServer();
  const uri = "ui://projection/fresh-instance";
  app.registerResource(
    { uri, name: "Fresh instance" },
    () => ({ uri, mimeType: "text/plain", text: "projected" }),
  );

  const createProtocolServer = (
    app as unknown as { createProtocolServer(): Server }
  ).createProtocolServer.bind(app);
  const first = createProtocolServer();
  const second = createProtocolServer();

  assertEquals(first === second, false);
  assertEquals(first.getCapabilities().resources, { listChanged: true });
  assertEquals(second.getCapabilities().resources, { listChanged: true });
  assertEquals(app.getResourceUris(), [uri]);
});
