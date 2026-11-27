import { assertEquals } from "@std/assert";
import {
  connectSnippetBoardLayout,
  type SnippetBoardLayoutOptions,
  type SnippetLayoutReceipt,
  type SnippetLayoutStatus,
} from "./layout-publisher.ts";

type Stage = SnippetBoardLayoutOptions["host"]["callServerTool"];
type Update = SnippetBoardLayoutOptions["updateContext"];

// The actual movement and resizing handlers have already been installed on this board.
class MountedBoard extends EventTarget {
  ownerDocument = { defaultView: {} };
  panel = { dataset: { composePanelId: "margin" }, style: { order: "" } };
  hasAttribute(name: string) {
    return ["data-compose-movement-ready", "data-compose-resizing-ready"].includes(name);
  }
  querySelectorAll() {
    return [this.panel];
  }
}

function mount(options: {
  capabilities?: ReturnType<SnippetBoardLayoutOptions["host"]["getHostCapabilities"]>;
  stage?: Stage;
  update?: Update;
  savedLayout?: unknown;
} = {}) {
  const board = new MountedBoard();
  const lifetime = new AbortController();
  const receipts: SnippetLayoutReceipt[] = [];
  const shown: SnippetLayoutStatus[] = [];
  const updates: Parameters<Update>[0][] = [];
  const staged: Parameters<Stage>[0][] = [];
  const commit = connectSnippetBoardLayout(
    board as unknown as Parameters<typeof connectSnippetBoardLayout>[0],
    {
      host: {
        getHostCapabilities: () =>
          options.capabilities ??
            { serverTools: {}, updateModelContext: { structuredContent: {} } },
        callServerTool: (params, request) => {
          staged.push(params);
          const { runId, revision } = params.arguments;
          return options.stage?.(params, request) ??
            Promise.resolve({ structuredContent: { runId, revision } });
        },
      },
      updateContext: async (update, request) => {
        updates.push(update);
        const response = await options.update?.(update, request) ?? {};
        const { snippetLayout } = "structuredContent" in update
          ? update.structuredContent
          : JSON.parse(update.content[0].text);
        receipts.push(snippetLayout);
        return response;
      },
      runId: "test-run",
      stageTool: "stage_engineering_board",
      savedLayout: options.savedLayout,
      signal: lifetime.signal,
      onStatus: (status) => shown.push(status),
    },
  );
  return { board, lifetime, receipts, updates, staged, shown, commit };
}

Deno.test("only the latest committed gesture becomes ready after out-of-order staging", async () => {
  const first = Promise.withResolvers<void>();
  const h = mount({
    stage: async ({ arguments: { runId, revision } }) => {
      if (revision === 1) await first.promise;
      return { structuredContent: { runId, revision } };
    },
  });
  const slow = h.commit();
  await h.commit();
  first.resolve();
  await slow;
  assertEquals(h.receipts.map(({ revision, status }) => [revision, status]), [
    [1, "pending"],
    [2, "pending"],
    [2, "ready"],
  ]);
  assertEquals(h.shown, ["pending", "pending", "ready"]);
  const { layout } = h.staged[1].arguments;
  assertEquals(layout, { version: 1, order: ["margin"], widths: [], placements: [] });
  assertEquals(h.staged[1].name, "stage_engineering_board");
  h.lifetime.abort();
  await h.commit();
  h.board.dispatchEvent(new Event("compose-panel-layout-committed"));
  assertEquals(h.staged.length, 2);
});

Deno.test("a delayed context acknowledgement cannot overwrite the latest ready receipt", async () => {
  const sending = Promise.withResolvers<void>();
  const sent = Promise.withResolvers<void>();
  const h = mount({
    update: async (value) => {
      if ("structuredContent" in value) {
        const { revision, status } = value.structuredContent.snippetLayout;
        if (revision === 1 && status === "ready") {
          sending.resolve();
          await sent.promise;
        }
      }
      return {};
    },
  });
  const first = h.commit();
  await sending.promise;
  const second = h.commit();
  assertEquals(h.staged.length, 2);
  sent.resolve();
  await Promise.all([first, second]);
  assertEquals(h.receipts.map(({ revision, status }) => [revision, status]), [
    [1, "pending"],
    [1, "ready"],
    [2, "pending"],
    [2, "ready"],
  ]);
  assertEquals(h.shown, ["pending", "pending", "ready"]);
});

Deno.test("text-only hosts receive only the layout receipt and rejection stays retryable", async () => {
  const h = mount({
    capabilities: { serverTools: {}, updateModelContext: { text: {} } },
    stage: ({ arguments: { runId, revision } }) =>
      Promise.resolve({
        structuredContent: { runId: revision === 1 ? "another run" : runId, revision },
      }),
  });
  await h.commit();
  await h.commit();
  assertEquals(h.shown, ["pending", "failed", "pending", "ready"]);
  assertEquals(h.receipts.map(({ revision, status }) => [revision, status]), [
    [1, "pending"],
    [1, "failed"],
    [2, "pending"],
    [2, "ready"],
  ]);
  assertEquals(h.updates.at(-1), {
    content: [{
      type: "text",
      text: JSON.stringify({
        snippetLayout: { runId: "test-run", revision: 2, status: "ready" },
      }),
    }],
  });
});

Deno.test("failed context writes do not report a ready layout or poison retry", async () => {
  const h = mount({
    update: (value) =>
      Promise.resolve({
        isError: "structuredContent" in value &&
          value.structuredContent.snippetLayout.revision === 1,
      }),
  });
  await h.commit();
  await h.commit();
  assertEquals(h.shown, ["pending", "failed", "pending", "ready"]);
});

Deno.test("a local-only host can restore geometry without sending conversation context", async () => {
  const savedLayout = { version: 1, order: ["margin"], widths: [], placements: [] };
  const h = mount({ capabilities: { updateModelContext: { text: {} } }, savedLayout });
  assertEquals(h.board.panel.style.order, "0");
  await h.commit();
  assertEquals(h.shown, ["local"]);
  assertEquals(h.staged, []);
  assertEquals(h.updates, []);
  const incompatible = mount({ savedLayout: { ...savedLayout, order: ["other"] } });
  assertEquals(incompatible.shown, ["restore-failed"]);
});

Deno.test("a disconnected staging call can retry, while a closed board stays quiet", async () => {
  const late = Promise.withResolvers<void>();
  const h = mount({
    stage: async ({ arguments: { runId, revision } }) => {
      if (revision === 1) throw new Error("offline");
      if (revision === 3) await late.promise;
      return { structuredContent: { runId, revision } };
    },
  });
  await h.commit();
  await h.commit();
  const last = h.commit();
  h.lifetime.abort();
  late.resolve();
  await last;
  assertEquals(h.shown, ["pending", "failed", "pending", "ready", "pending"]);
  assertEquals(
    h.receipts.some((receipt) => receipt.revision === 3 && receipt.status !== "pending"),
    false,
  );
});

Deno.test("the SDK's untyped structured result is checked before acknowledging a revision", async () => {
  const callServerTool = (): Promise<{ structuredContent?: unknown; isError?: boolean }> =>
    Promise.resolve({ structuredContent: ["unrelated", 1] });
  const h = mount({ stage: callServerTool });
  await h.commit();
  assertEquals(h.shown, ["pending", "failed"]);
  assertEquals(h.receipts.map(({ status }) => status), ["pending", "failed"]);
});
