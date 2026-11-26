import { assertEquals, assertThrows } from "@std/assert";
import {
  DECLARED_VIEW_META_KEY,
  readDeclaredViewSelection,
  readDeclaredViewUri,
  VIEWER_SESSION_APPLY_ACTION,
  withDeclaredViewUri,
} from "./declared-view.ts";

Deno.test("selection round-trips through JSON and preserves native content and metadata", () => {
  const uri = "ui://erpnext/invoice";
  const original = { content: [], _meta: { "io.casys/viewer": { actions: ["open"] } } };
  const result = withDeclaredViewUri(original, uri);
  assertEquals(readDeclaredViewUri(JSON.parse(JSON.stringify(result))), uri);
  assertEquals(readDeclaredViewSelection(result), { resourceUri: uri, action: "tool-result" });
  assertEquals(result.content, []);
  assertEquals(result._meta["io.casys/viewer"], original._meta["io.casys/viewer"]);
  assertEquals(readDeclaredViewUri(original), undefined);
  assertEquals(readDeclaredViewUri(withDeclaredViewUri({ content: [] }, uri)), uri);
});

Deno.test("a recorded delivery round-trips in private metadata and cannot masquerade as a direct result", () => {
  const uri = "ui://erp/recording";
  const session = { schemaVersion: "erp.session/1.0", anchor: { fingerprint: "abc" } };
  const original = {
    content: [{ type: "text", text: "Summary" }],
    structuredContent: { id: "record" },
  };
  const routed = JSON.parse(JSON.stringify(withDeclaredViewUri(original, uri, session)));
  assertEquals(readDeclaredViewSelection(routed), {
    resourceUri: uri,
    action: VIEWER_SESSION_APPLY_ACTION,
    session,
  });
  assertEquals(readDeclaredViewUri(routed), undefined);
  assertEquals(routed.structuredContent, original.structuredContent);
  assertEquals(routed.content, original.content);
  for (const invalid of [null, {}, [], { schemaVersion: "erp.session/latest" }]) {
    assertThrows(() => withDeclaredViewUri(original, uri, invalid), TypeError);
  }
  for (
    const bad of [
      { version: 2, resourceUri: uri, action: "unsupported", session },
      { version: 2, resourceUri: uri, action: VIEWER_SESSION_APPLY_ACTION },
      {
        version: 2,
        resourceUri: uri,
        action: VIEWER_SESSION_APPLY_ACTION,
        session: { schemaVersion: "x/latest" },
      },
      { version: 1, resourceUri: uri, action: VIEWER_SESSION_APPLY_ACTION, session },
    ]
  ) {
    assertEquals(
      readDeclaredViewSelection({ _meta: { [DECLARED_VIEW_META_KEY]: bad } }),
      undefined,
    );
  }
});

Deno.test("only an exact ui resource in a supported selection is recognized", () => {
  for (
    const input of [null, {}, { _meta: [] }, { _meta: { ui: { resourceUri: "ui://erp/invoice" } } }]
  ) {
    assertEquals(readDeclaredViewUri(input), undefined);
  }
  const meta = (version: unknown, resourceUri: unknown) => ({
    _meta: { [DECLARED_VIEW_META_KEY]: { version, resourceUri } },
  });
  assertEquals(readDeclaredViewUri(meta(2, "ui://erp/list")), undefined);
  for (const uri of ["ui://", "ui://erp/bad path", "https://erp/list", "ui://erp/latest"]) {
    assertEquals(readDeclaredViewUri(meta(1, uri)), undefined);
    assertThrows(() => withDeclaredViewUri({}, uri), TypeError);
  }
});
