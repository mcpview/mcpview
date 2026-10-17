import { assertEquals, assertThrows } from "@std/assert";
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";

import type { ComposeEventClient, ComposeEventHandler } from "./compose-events.ts";
import { CASYS_SURFACE_CONTEXT_KEY } from "@mcpview/contracts";
import {
  defineSemanticSelection,
  emitSemanticSelection,
  onSemanticSelection,
  parseSemanticSelection,
  SEMANTIC_SELECTION_APPLY_ACTION,
  SEMANTIC_SELECTION_CHANGED_EVENT,
  SEMANTIC_SELECTION_EVENT_PORTS,
  SEMANTIC_SELECTION_SCHEMA,
} from "./semantic-selection.ts";

class FakeEvents implements ComposeEventClient {
  readonly emitted: Array<{ event: string; data: unknown }> = [];
  readonly handlers = new Map<string, ComposeEventHandler>();

  emit(event: string, data?: unknown): void {
    this.emitted.push({ event, data });
  }

  on(action: string, handler: ComposeEventHandler): () => void {
    this.handlers.set(action, handler);
    return () => this.handlers.delete(action);
  }

  destroy(): void {}
}

const reference = {
  domain: "cad",
  kind: "face",
  id: "face-12",
  basisFingerprint: "a".repeat(64),
};

function composedHostContext(): McpUiHostContext {
  return {
    [CASYS_SURFACE_CONTEXT_KEY]: {
      instanceId: "cad-viewer",
      status: "ready",
      eventChannel: "ui/compose/event",
    },
  } as McpUiHostContext;
}

Deno.test("semantic selection uses a versioned payload without owning domain values", () => {
  const selection = defineSemanticSelection({
    mode: "replace",
    references: [reference, { domain: "future-domain", kind: "node", id: "n-1" }],
  });

  assertEquals(selection, {
    schema: SEMANTIC_SELECTION_SCHEMA,
    mode: "replace",
    references: [reference, { domain: "future-domain", kind: "node", id: "n-1" }],
  });
  assertEquals(parseSemanticSelection(selection), selection);
  assertEquals(SEMANTIC_SELECTION_EVENT_PORTS, {
    emits: [SEMANTIC_SELECTION_CHANGED_EVENT],
    accepts: [SEMANTIC_SELECTION_APPLY_ACTION],
  });
});

Deno.test("semantic selection rejects invented fingerprint shapes and ambiguous clear payloads", () => {
  assertThrows(
    () =>
      defineSemanticSelection({
        mode: "replace",
        references: [{ ...reference, basisFingerprint: "not-a-sha256" }],
      }),
    TypeError,
    "SHA-256",
  );
  assertThrows(
    () => defineSemanticSelection({ mode: "clear", references: [reference] }),
    TypeError,
    "clear",
  );
  assertEquals(
    parseSemanticSelection({
      schema: SEMANTIC_SELECTION_SCHEMA,
      mode: "replace",
      references: [],
    }),
    undefined,
  );
});

Deno.test("semantic selection emits only on a negotiated Compose surface", () => {
  const events = new FakeEvents();
  const selection = defineSemanticSelection({ mode: "replace", references: [reference] });

  assertEquals(emitSemanticSelection({ events, hostContext: {} }, selection), false);
  assertEquals(events.emitted, []);
  assertEquals(
    emitSemanticSelection({ events, hostContext: composedHostContext() }, selection),
    true,
  );
  assertEquals(events.emitted, [{ event: SEMANTIC_SELECTION_CHANGED_EVENT, data: selection }]);
});

Deno.test("semantic selection subscribers ignore malformed routed data", () => {
  const events = new FakeEvents();
  const seen: unknown[] = [];
  const off = onSemanticSelection(events, (selection, payload) => {
    seen.push({ selection, sourceSlot: payload.sourceSlot });
  });
  const handler = events.handlers.get(SEMANTIC_SELECTION_APPLY_ACTION)!;
  handler({ data: { schema: "wrong" }, sourceSlot: 1 });
  const selection = defineSemanticSelection({ mode: "replace", references: [reference] });
  handler({ data: selection, sourceSlot: 2 });
  off();

  assertEquals(seen, [{ selection, sourceSlot: 2 }]);
});
