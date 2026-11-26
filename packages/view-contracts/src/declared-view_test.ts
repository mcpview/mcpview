import { assertEquals, assertThrows } from "@std/assert";
import {
  DECLARED_VIEW_META_KEY,
  readDeclaredViewUri,
  withDeclaredViewUri,
} from "./declared-view.ts";

Deno.test("selection round-trips through JSON and preserves native content and metadata", () => {
  const uri = "ui://erpnext/invoice";
  const original = { content: [], _meta: { "io.casys/viewer": { actions: ["open"] } } };
  const result = withDeclaredViewUri(original, uri);
  assertEquals(readDeclaredViewUri(JSON.parse(JSON.stringify(result))), uri);
  assertEquals(result.content, []);
  assertEquals(result._meta["io.casys/viewer"], original._meta["io.casys/viewer"]);
  assertEquals(readDeclaredViewUri(original), undefined);
  assertEquals(readDeclaredViewUri(withDeclaredViewUri({ content: [] }, uri)), uri);
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
