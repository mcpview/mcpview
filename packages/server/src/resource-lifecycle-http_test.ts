/**
 * HTTP wire coverage for resource content and lifecycle behavior.
 *
 * These tests bind a real loopback listener. They exercise the same stateless
 * request path a Streamable HTTP client uses, rather than inspecting the
 * resource registry in memory.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { McpApp } from "./mcp-app.ts";

const PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_KEY = "io.modelcontextprotocol/protocolVersion";
const CLIENT_CAPABILITIES_KEY = "io.modelcontextprotocol/clientCapabilities";

async function start(server: McpApp) {
  const listener = Deno.listen({ port: 0 });
  const port = (listener.addr as Deno.NetAddr).port;
  listener.close();
  return {
    port,
    http: await server.startHttp({ port, onListen: () => {} }),
  };
}

async function request(
  port: number,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "Mcp-Method": method,
      ...(method === "resources/read" && typeof params.uri === "string"
        ? { "Mcp-Name": params.uri }
        : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        _meta: {
          [PROTOCOL_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_KEY]: {},
        },
        ...params,
      },
    }),
  });
  return await response.json();
}

async function subscribeToResourceChanges(port: number): Promise<{
  events: string[];
  close: () => Promise<void>;
}> {
  const abort = new AbortController();
  const response = await fetch(`http://localhost:${port}/mcp`, {
    method: "POST",
    signal: abort.signal,
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "MCP-Protocol-Version": PROTOCOL_VERSION,
      "Mcp-Method": "subscriptions/listen",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "resource-changes",
      method: "subscriptions/listen",
      params: {
        notifications: { resourcesListChanged: true },
        _meta: {
          [PROTOCOL_KEY]: PROTOCOL_VERSION,
          [CLIENT_CAPABILITIES_KEY]: {},
        },
      },
    }),
  });
  assertEquals(response.status, 200);
  assert(response.body);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const events: string[] = [];
  let buffered = "";
  let pumpFailure: unknown;
  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += value;
        const frames = buffered.split("\n\n");
        buffered = frames.pop() ?? "";
        events.push(...frames.filter((frame) => frame.length > 0));
      }
    } catch (error) {
      if (!abort.signal.aborted) pumpFailure = error;
    }
  })();
  return {
    events,
    close: async () => {
      abort.abort();
      await reader.cancel().catch(() => {});
      await pump;
      if (pumpFailure !== undefined) throw pumpFailure;
    },
  };
}

async function waitUntil(
  predicate: () => boolean,
  description: string,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function resourceChangeCount(events: string[]): number {
  return events.filter((frame) =>
    frame.includes("notifications/resources/list_changed")
  ).length;
}

async function assertCountStays(
  events: string[],
  expected: number,
  windowMs = 75,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  assertEquals(resourceChangeCount(events), expected);
}

Deno.test("HTTP resources/read preserves text and canonical base64 blob payloads", async () => {
  const server = new McpApp({
    name: "resource-content-wire",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  server.registerResource(
    { uri: "ui://wire/text", name: "Text" },
    () => ({
      uri: "ui://wire/text",
      mimeType: "text/plain",
      text: "unchanged text",
      _meta: { attestation: "preserved" },
    }),
  );
  server.registerResource(
    { uri: "ui://wire/blob", name: "Blob", size: 3 },
    () => ({
      uri: "ui://wire/blob",
      mimeType: "application/octet-stream",
      blob: "AAEC",
    }),
  );

  const { http, port } = await start(server);
  try {
    const textResponse = await request(
      port,
      1,
      "resources/read",
      { uri: "ui://wire/text" },
    );
    const text =
      ((textResponse.result as Record<string, unknown>).contents as Array<
        Record<string, unknown>
      >)[0];
    assertEquals(text.text, "unchanged text");
    assertEquals("blob" in text, false);
    assertEquals(text._meta, { attestation: "preserved" });

    const blobResponse = await request(
      port,
      2,
      "resources/read",
      { uri: "ui://wire/blob" },
    );
    const blob =
      ((blobResponse.result as Record<string, unknown>).contents as Array<
        Record<string, unknown>
      >)[0];
    assertEquals(blob.blob, "AAEC");
    assertEquals("text" in blob, false);

    const listed = await request(port, 3, "resources/list");
    const resources = (listed.result as Record<string, unknown>)
      .resources as Array<Record<string, unknown>>;
    assertEquals(
      resources.find((resource) => resource.uri === "ui://wire/blob")?.size,
      3,
    );
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP resources/read never CSP-mutates a blob, even with an HTML MIME type", async () => {
  const blob = "PGgxPkJsb2I8L2gxPg==";
  const server = new McpApp({
    name: "resource-blob-csp-wire",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    resourceCsp: { allowInline: true },
  });
  server.registerResource(
    { uri: "ui://wire/html-blob", name: "HTML Blob" },
    () => ({
      uri: "ui://wire/html-blob",
      mimeType: "text/html",
      blob,
    }),
  );

  const { http, port } = await start(server);
  try {
    const response = await request(
      port,
      1,
      "resources/read",
      { uri: "ui://wire/html-blob" },
    );
    const content = ((response.result as Record<string, unknown>)
      .contents as Array<Record<string, unknown>>)[0];
    assertEquals(content.blob, blob);
    assertEquals("text" in content, false);
  } finally {
    await http.shutdown();
  }
});

Deno.test("HTTP resource size attests the bytes served after CSP injection", async () => {
  const server = new McpApp({
    name: "resource-csp-size-wire",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    resourceCsp: { allowInline: true },
  });
  server.registerResource(
    {
      uri: "ui://wire/csp-size",
      name: "CSP size",
      mimeType: "text/html",
      // `<html></html>` is 13 UTF-8 bytes before CSP injects its meta tag.
      size: 13,
    },
    () => ({
      uri: "ui://wire/csp-size",
      mimeType: "text/html",
      text: "<html></html>",
    }),
  );

  const { http, port } = await start(server);
  try {
    const response = await request(
      port,
      1,
      "resources/read",
      { uri: "ui://wire/csp-size" },
    );
    assertEquals((response.error as Record<string, unknown>).code, -32603);
    assertStringIncludes(
      String((response.error as Record<string, unknown>).message),
      "Resource content size must match registered metadata: expected 13",
    );
  } finally {
    await http.shutdown();
  }
});

Deno.test("expectResources unregister updates list and read after HTTP start", async () => {
  const server = new McpApp({
    name: "resource-dynamic-wire",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    expectResources: true,
  });
  const { http, port } = await start(server);
  const uri = "ui://wire/late";

  try {
    server.registerResource(
      { uri, name: "Late resource", size: 4 },
      () => ({ uri, mimeType: "text/plain", text: "late" }),
    );

    const before = await request(port, 1, "resources/list");
    assertEquals(
      ((before.result as Record<string, unknown>).resources as Array<
        Record<string, unknown>
      >).map(({ uri: listedUri, size }) => ({ uri: listedUri, size })),
      [{ uri, size: 4 }],
    );
    const read = await request(port, 2, "resources/read", { uri });
    assertEquals(
      ((read.result as Record<string, unknown>).contents as Array<
        Record<string, unknown>
      >)[0].text,
      "late",
    );

    assertEquals(server.unregisterResource(uri), true);
    assertEquals(server.unregisterResource(uri), false);
    const after = await request(port, 3, "resources/list");
    assertEquals((after.result as Record<string, unknown>).resources, []);
    const missing = await request(port, 4, "resources/read", { uri });
    assertEquals((missing.error as Record<string, unknown>).code, -32602);
  } finally {
    await http.shutdown();
  }
});

Deno.test("resources capability is stable while empty and templates/list is explicit", async () => {
  const server = new McpApp({
    name: "resource-capability-empty",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    expectResources: true,
  });
  const { http, port } = await start(server);
  try {
    for (const method of ["server/discover", "initialize"]) {
      const response = await request(port, 1, method);
      const result = response.result as Record<string, unknown>;
      const capabilities = result.capabilities as Record<string, unknown>;
      assertEquals(capabilities.resources, { listChanged: true });
    }
    const listed = await request(port, 2, "resources/list");
    assertEquals((listed.result as Record<string, unknown>).resources, []);
    const templates = await request(port, 3, "resources/templates/list");
    assertEquals(
      (templates.result as Record<string, unknown>).resourceTemplates,
      [],
    );
    const missing = await request(port, 4, "resources/read", {
      uri: "ui://resource-capability-empty/missing",
    });
    assertEquals((missing.error as Record<string, unknown>).code, -32602);
  } finally {
    await http.shutdown();
  }
});

Deno.test("resource metadata is faithfully listed without inventing MIME", async () => {
  const server = new McpApp({
    name: "resource-metadata-wire",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  const uri = "ui://resource-metadata-wire/report";
  server.registerResource(
    {
      uri,
      name: "Report",
      title: "Attested report",
      description: "Metadata wire test",
      icons: [{ src: "https://example.test/report.svg", theme: "dark" }],
      annotations: { audience: ["assistant"], priority: 0.7 },
      _meta: { provenance: "test" },
    },
    () => ({ uri, mimeType: "text/plain", text: "report" }),
  );
  const { http, port } = await start(server);
  try {
    const listed = await request(port, 1, "resources/list");
    const resource =
      ((listed.result as Record<string, unknown>).resources as Array<
        Record<string, unknown>
      >)[0];
    assertEquals(resource.title, "Attested report");
    assertEquals(resource.annotations, {
      audience: ["assistant"],
      priority: 0.7,
    });
    assertEquals(resource._meta, { provenance: "test" });
    assertEquals(resource.icons, [{
      src: "https://example.test/report.svg",
      theme: "dark",
    }]);
    assertEquals("mimeType" in resource, false);
  } finally {
    await http.shutdown();
  }
});

Deno.test("post-start mutations require installed handlers and publish one HTTP notification per commit", async () => {
  const rejected = new McpApp({
    name: "resource-post-start-rejected",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
  });
  const rejectedHttp = await start(rejected);
  try {
    let failure: unknown;
    try {
      rejected.registerResource(
        { uri: "ui://resource-post-start-rejected/late", name: "Late" },
        () => ({
          uri: "ui://resource-post-start-rejected/late",
          mimeType: "text/plain",
          text: "late",
        }),
      );
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof Error);
    assertStringIncludes(failure.message, "without expectResources: true");
    assertEquals(rejected.getResourceCount(), 0);
  } finally {
    await rejectedHttp.http.shutdown();
  }

  const server = new McpApp({
    name: "resource-post-start-notify",
    version: "1.0.0",
    logger: () => {},
    transport: "stateless",
    expectResources: true,
  });
  const { http, port } = await start(server);
  const subscription = await subscribeToResourceChanges(port);
  try {
    await waitUntil(
      () =>
        subscription.events.some((frame) =>
          frame.includes("notifications/subscriptions/acknowledged")
        ),
      "subscription acknowledgement",
    );
    assertEquals(resourceChangeCount(subscription.events), 0);
    const resources = ["a", "b"].map((name) => ({
      uri: `ui://resource-post-start-notify/${name}`,
      name,
    }));
    server.registerResources(
      resources,
      new Map(resources.map((resource) => [
        resource.uri,
        () => ({
          uri: resource.uri,
          mimeType: "text/plain",
          text: resource.name,
        }),
      ])),
    );
    await waitUntil(
      () => resourceChangeCount(subscription.events) >= 1,
      "the batch resource-list notification",
    );
    await assertCountStays(subscription.events, 1);

    // A rejected duplicate batch must add no event. The bounded quiet window
    // also drains any delayed event from the preceding successful batch before
    // the following unregister assertion.
    assertThrows(
      () =>
        server.registerResources(
          [resources[0]],
          new Map([[
            resources[0].uri,
            () => ({
              uri: resources[0].uri,
              mimeType: "text/plain",
              text: resources[0].name,
            }),
          ]]),
        ),
      Error,
      "already registered",
    );
    await assertCountStays(subscription.events, 1);

    // Removing one is a separate committed mutation, observed only after the
    // previous event count proved stable (no backlog can satisfy this wait).
    assertEquals(server.unregisterResource(resources[0].uri), true);
    await waitUntil(
      () => resourceChangeCount(subscription.events) >= 2,
      "the unregister resource-list notification",
    );
    await assertCountStays(subscription.events, 2);
  } finally {
    await subscription.close();
    await http.shutdown();
  }
});
