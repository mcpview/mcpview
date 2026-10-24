import { assertEquals, assertFalse } from "@std/assert";
import * as context from "../context.ts";

Deno.test("/context exports the renderer-neutral engine without exporting an App lifecycle", () => {
  assertEquals(typeof context.createActiveContextPolicy, "function");
  assertEquals(typeof context.createActiveContextController, "function");
  assertEquals(typeof context.createClickIntentArbiter, "function");
  for (const name of ["createMcpApp", "startSurfaceApp", "App", "ActiveContextChip"]) {
    assertFalse(name in context, `/context must not expose ${name}`);
  }
});
