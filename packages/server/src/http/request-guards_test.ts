import { assertEquals } from "@std/assert";
import { callerPrincipal } from "./request-guards.ts";
import { MRTR_NO_AUTH_PRINCIPAL } from "./wire.ts";

Deno.test("callerPrincipal reserves the no-auth sentinel for unauthenticated calls", () => {
  assertEquals(callerPrincipal(undefined), MRTR_NO_AUTH_PRINCIPAL);
  assertEquals(
    callerPrincipal({ subject: MRTR_NO_AUTH_PRINCIPAL, scopes: [] }),
    null,
  );
});
