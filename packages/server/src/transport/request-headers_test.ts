/**
 * Track C — request-metadata header validation (spec 2026-07-28, SEP-2243).
 *
 * @module lib/server/transport/request-headers_test
 */

import { assertEquals } from "@std/assert";
import {
  collectMirroredParams,
  decodeHeaderValue,
  encodeHeaderValue,
  mcpNameRequirement,
  validateRequestHeaders,
} from "./request-headers.ts";

const VERSION = "2026-07-28";

/** Build a case-insensitive header getter from a plain object. */
function headers(map: Record<string, string>) {
  const lower = new Map(
    Object.entries(map).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return (name: string) => lower.get(name.toLowerCase());
}

function ok(
  map: Record<string, string>,
  method: string,
  params?: Record<string, unknown>,
  mirroredParams?: Parameters<
    typeof validateRequestHeaders
  >[0]["mirroredParams"],
) {
  return validateRequestHeaders({
    getHeader: headers(map),
    method,
    params,
    bodyProtocolVersion: VERSION,
    mirroredParams,
  });
}

// ── Value encoding ──────────────────────────────────────────────────────────

Deno.test("encoding - plain ASCII travels unwrapped", () => {
  assertEquals(encodeHeaderValue("us-west1"), "us-west1");
  assertEquals(decodeHeaderValue("us-west1"), "us-west1");
});

Deno.test("encoding - round-trips the cases the spec enumerates", () => {
  for (
    const value of [
      "Hello, 世界", // non-ASCII
      " padded ", // leading/trailing space
      "line1\nline2", // control character
      "=?base64?literal?=", // matches the sentinel pattern
    ]
  ) {
    const encoded = encodeHeaderValue(value);
    assertEquals(
      encoded.startsWith("=?base64?"),
      true,
      `${JSON.stringify(value)} must be sentinel-encoded`,
    );
    assertEquals(decodeHeaderValue(encoded), value);
  }
});

Deno.test("encoding - a plain value that looks like the sentinel is still encoded", () => {
  // Otherwise decoding would unwrap something that was never wrapped, and a
  // client could smuggle a mismatching value past validation.
  const literal = "=?base64?literal?=";
  assertEquals(decodeHeaderValue(encodeHeaderValue(literal)), literal);
});

Deno.test("encoding - a malformed sentinel payload is rejected, not compared raw", () => {
  assertEquals(decodeHeaderValue("=?base64?not-valid-base64!!?="), null);
});

// ── Mcp-Name source field ───────────────────────────────────────────────────

Deno.test("Mcp-Name - required only for the three methods that define it", () => {
  assertEquals(mcpNameRequirement("tools/call", { name: "get_weather" }), {
    required: true,
    sourceField: "name",
    expected: "get_weather",
  });
  assertEquals(mcpNameRequirement("prompts/get", { name: "summarize" }), {
    required: true,
    sourceField: "name",
    expected: "summarize",
  });
  assertEquals(
    mcpNameRequirement("resources/read", { uri: "file:///a.json" }),
    {
      required: true,
      sourceField: "uri",
      expected: "file:///a.json",
    },
  );
  assertEquals(mcpNameRequirement("tools/list", {}), { required: false });
  assertEquals(mcpNameRequirement("server/discover", {}), { required: false });
});

Deno.test("Mcp-Name - the requirement follows the method, not the body", () => {
  // A malformed tools/call with no usable `name` must still be *required* to
  // carry Mcp-Name. Deriving the requirement from the body let such a request
  // skip validation entirely.
  const rule = mcpNameRequirement("tools/call", {});
  assertEquals(rule.required, true);
  assertEquals(rule.expected, undefined);

  const result = ok(
    { "MCP-Protocol-Version": VERSION, "Mcp-Method": "tools/call" },
    "tools/call",
    {},
  );
  assertEquals(result.ok, false);
});

Deno.test("Mcp-Name - a raw unsafe value must be sentinel-encoded, not sent bare", () => {
  const uri = "file:///rapports/été.json";
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "resources/read",
      "Mcp-Name": uri, // non-ASCII, sent raw
    },
    "resources/read",
    { uri },
  );
  assertEquals(result.ok, false);
});

Deno.test("encoding - a leading BOM is preserved, not silently stripped", () => {
  // The default TextDecoder strips a leading U+FEFF. That was a bypass: an
  // encoded "\uFEFFfoo" decoded to "foo" and compared equal to a body of "foo".
  assertEquals(decodeHeaderValue(encodeHeaderValue("\uFEFFfoo")), "\uFEFFfoo");

  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": encodeHeaderValue("\uFEFFecho"),
    },
    "tools/call",
    { name: "echo" },
  );
  assertEquals(result.ok, false, "BOM + echo must not match body echo");
});

// ── Required headers ────────────────────────────────────────────────────────

Deno.test("validation - accepts a conformant request", () => {
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "get_weather",
    },
    "tools/call",
    { name: "get_weather", arguments: {} },
  );
  assertEquals(result.ok, true);
});

Deno.test("validation - header names are matched case-insensitively", () => {
  // RFC 9110: field names are case-insensitive. A client sending lowercase
  // headers is conforming and must not be rejected.
  const result = ok(
    {
      "mcp-protocol-version": VERSION,
      "mcp-method": "tools/list",
    },
    "tools/list",
    {},
  );
  assertEquals(result.ok, true);
});

Deno.test("validation - a missing MCP-Protocol-Version header is rejected", () => {
  const result = ok({ "Mcp-Method": "tools/list" }, "tools/list", {});
  assertEquals(result.ok, false);
});

Deno.test("validation - a missing Mcp-Method header is rejected", () => {
  const result = ok({ "MCP-Protocol-Version": VERSION }, "tools/list", {});
  assertEquals(result.ok, false);
});

Deno.test("validation - Mcp-Method must equal the body method", () => {
  const result = ok(
    { "MCP-Protocol-Version": VERSION, "Mcp-Method": "tools/list" },
    "tools/call",
    { name: "x" },
  );
  assertEquals(result.ok, false);
});

Deno.test("validation - Mcp-Name is required for tools/call and must match", () => {
  const missing = ok(
    { "MCP-Protocol-Version": VERSION, "Mcp-Method": "tools/call" },
    "tools/call",
    { name: "get_weather" },
  );
  assertEquals(missing.ok, false);

  const wrong = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "other_tool",
    },
    "tools/call",
    { name: "get_weather" },
  );
  assertEquals(wrong.ok, false);
});

Deno.test("validation - Mcp-Name is not required where the spec does not define it", () => {
  const result = ok(
    { "MCP-Protocol-Version": VERSION, "Mcp-Method": "resources/list" },
    "resources/list",
    {},
  );
  assertEquals(result.ok, true);
});

Deno.test("validation - a base64-encoded Mcp-Name is decoded before comparison", () => {
  const uri = "file:///projets/été/config.json";
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "resources/read",
      "Mcp-Name": encodeHeaderValue(uri),
    },
    "resources/read",
    { uri },
  );
  assertEquals(result.ok, true);
});

// ── Mirrored tool parameters ────────────────────────────────────────────────

Deno.test("Mcp-Param - present argument requires a matching header", () => {
  const mirrored = [{ headerName: "Region", path: ["region"] }];

  const good = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "execute_sql",
      "Mcp-Param-Region": "us-west1",
    },
    "tools/call",
    {
      name: "execute_sql",
      arguments: { region: "us-west1", query: "SELECT 1" },
    },
    mirrored,
  );
  assertEquals(good.ok, true);

  const absent = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "execute_sql",
    },
    "tools/call",
    { name: "execute_sql", arguments: { region: "us-west1" } },
    mirrored,
  );
  assertEquals(absent.ok, false);

  const mismatched = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "execute_sql",
      "Mcp-Param-Region": "eu-west1",
    },
    "tools/call",
    { name: "execute_sql", arguments: { region: "us-west1" } },
    mirrored,
  );
  assertEquals(mismatched.ok, false);
});

Deno.test("Mcp-Param - absent argument requires an absent header", () => {
  const mirrored = [{ headerName: "Region", path: ["region"] }];

  const omitted = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "execute_sql",
    },
    "tools/call",
    { name: "execute_sql", arguments: { query: "SELECT 1" } },
    mirrored,
  );
  assertEquals(omitted.ok, true);

  const spurious = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "execute_sql",
      "Mcp-Param-Region": "us-west1",
    },
    "tools/call",
    { name: "execute_sql", arguments: { query: "SELECT 1" } },
    mirrored,
  );
  assertEquals(spurious.ok, false);
});

Deno.test("Mcp-Param - an empty string is mirrored as an empty header value", () => {
  // Empty is valid JSON and a valid plain HTTP field value. Encoding it turns a
  // conforming `Mcp-Param-Name:` into a different wire representation, and
  // rejecting it prevents a tool from mirroring an optional empty string.
  const mirrored = [{ headerName: "Name", path: ["name"] }];
  assertEquals(encodeHeaderValue(""), "");
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "rename",
      "Mcp-Param-Name": "",
    },
    "tools/call",
    { name: "rename", arguments: { name: "" } },
    mirrored,
  );
  assertEquals(result.ok, true);
});

Deno.test("Mcp-Param - integers compare numerically, not as strings", () => {
  // The spec calls this out: 42.0 and 42 are the same value. A string compare
  // would reject a conforming client over formatting.
  const mirrored = [{ headerName: "Limit", path: ["limit"] }];
  for (const headerValue of ["42", "42.0"]) {
    const result = ok(
      {
        "MCP-Protocol-Version": VERSION,
        "Mcp-Method": "tools/call",
        "Mcp-Name": "query",
        "Mcp-Param-Limit": headerValue,
      },
      "tools/call",
      { name: "query", arguments: { limit: 42 } },
      mirrored,
    );
    assertEquals(result.ok, true, `${headerValue} should match 42`);
  }
});

Deno.test("Mcp-Param - booleans compare as lowercase strings", () => {
  const mirrored = [{ headerName: "Dry", path: ["dryRun"] }];
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "apply",
      "Mcp-Param-Dry": "true",
    },
    "tools/call",
    { name: "apply", arguments: { dryRun: true } },
    mirrored,
  );
  assertEquals(result.ok, true);
});

Deno.test("Mcp-Param - nested properties are read at their exact path", () => {
  const mirrored = [{ headerName: "Tenant", path: ["scope", "tenant"] }];
  const result = ok(
    {
      "MCP-Protocol-Version": VERSION,
      "Mcp-Method": "tools/call",
      "Mcp-Name": "report",
      "Mcp-Param-Tenant": "acme",
    },
    "tools/call",
    { name: "report", arguments: { scope: { tenant: "acme" } } },
    mirrored,
  );
  assertEquals(result.ok, true);
});

// ── x-mcp-header annotation collection ──────────────────────────────────────

Deno.test("x-mcp-header - collects statically reachable annotations", () => {
  const schema = {
    type: "object",
    properties: {
      region: { type: "string", "x-mcp-header": "Region" },
      query: { type: "string" },
      scope: {
        type: "object",
        properties: { tenant: { type: "string", "x-mcp-header": "Tenant" } },
      },
    },
  };
  assertEquals(collectMirroredParams(schema), [
    { headerName: "Region", path: ["region"] },
    { headerName: "Tenant", path: ["scope", "tenant"] },
  ]);
});

Deno.test("x-mcp-header - rejects annotations that are not statically reachable", () => {
  // Inside `items`, a path cannot resolve to one value without the instance. The
  // spec says such an annotation invalidates the whole TOOL DEFINITION — so it
  // must be reported, not quietly skipped. An earlier version returned [] with no
  // complaint, which let a tool ship with an annotation clients would honour and
  // the server would never check.
  const reasons: string[] = [];
  const schema = {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string", "x-mcp-header": "Id" } },
        },
      },
    },
  };
  assertEquals(collectMirroredParams(schema, (r) => reasons.push(r)), []);
  assertEquals(reasons.length, 1, "must report the unreachable annotation");
});

Deno.test("x-mcp-header - rejects annotations under every composition keyword", () => {
  for (
    const keyword of ["oneOf", "anyOf", "allOf", "not", "if", "then", "else"]
  ) {
    const reasons: string[] = [];
    const nested = { type: "string", "x-mcp-header": "Sneaky" };
    const schema = {
      type: "object",
      properties: {
        field: {
          type: "object",
          [keyword]: keyword === "not" || keyword.length <= 4
            ? { properties: { inner: nested } }
            : [{ properties: { inner: nested } }],
        },
      },
    };
    collectMirroredParams(schema, (r) => reasons.push(r));
    assertEquals(
      reasons.length >= 1,
      true,
      `${keyword} must be reported as unreachable`,
    );
  }
});

Deno.test("x-mcp-header - rejects number, keeps integer", () => {
  const reasons: string[] = [];
  const schema = {
    type: "object",
    properties: {
      ratio: { type: "number", "x-mcp-header": "Ratio" },
      count: { type: "integer", "x-mcp-header": "Count" },
    },
  };
  const found = collectMirroredParams(schema, (r) => reasons.push(r));
  assertEquals(found, [{ headerName: "Count", path: ["count"] }]);
  assertEquals(reasons.length, 1);
});

Deno.test("x-mcp-header - rejects invalid names and case-insensitive duplicates", () => {
  const reasons: string[] = [];
  const schema = {
    type: "object",
    properties: {
      a: { type: "string", "x-mcp-header": "" },
      b: { type: "string", "x-mcp-header": "bad name" },
      c: { type: "string", "x-mcp-header": "with\nnewline" },
      d: { type: "string", "x-mcp-header": "Region" },
      e: { type: "string", "x-mcp-header": "region" },
    },
  };
  const found = collectMirroredParams(schema, (r) => reasons.push(r));
  assertEquals(found, [{ headerName: "Region", path: ["d"] }]);
  assertEquals(reasons.length, 4);
});
