/** Browser-side transport for user-edited Code Mode dashboard layouts. @module */
import {
  capturePanelLayout,
  installPanelMovement,
  installPanelResizing,
  restorePanelLayout,
} from "../host/renderer/panel-controls.js";
import type { PanelLayoutSnapshot } from "./layout.ts";

/** The conversation receives a reference to the staged geometry. */
export interface SnippetLayoutReceipt {
  /** Execution reference supplied by the server that owns the snippet. */
  runId: string;
  /** Monotonic revision within this mounted board. */
  revision: number;
  /** Whether the server has acknowledged this revision for saving. */
  status: "pending" | "ready" | "failed";
}

/** State available to an App's translated layout feedback and retry controls. */
export type SnippetLayoutStatus = SnippetLayoutReceipt["status"] | "local" | "restore-failed";

/** MCP Apps host methods and the board's context writer, which can aggregate panel selections. */
export interface SnippetBoardLayoutOptions {
  /** Connected MCP App providing the negotiated capabilities and the staging callback. */
  host: {
    getHostCapabilities(): {
      serverTools?: unknown;
      updateModelContext?: { structuredContent?: unknown; text?: unknown };
    } | undefined;
    callServerTool(
      params: {
        name: string;
        arguments: { runId: string; revision: number; layout: PanelLayoutSnapshot };
      },
      options: { signal: AbortSignal },
    ): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  };
  /** The board's context writer, shared with the panels in this App. */
  updateContext(
    update:
      | { structuredContent: { snippetLayout: SnippetLayoutReceipt } }
      | { content: { type: "text"; text: string }[] },
  ): Promise<object>;
  /** App-only callback that stages the geometry and returns the matching run ID and revision. */
  stageTool: string;
  /** Execution metadata from the tool result. Without a reference, edits stay local. */
  runId?: unknown;
  /** Previously saved geometry supplied on replay. */
  savedLayout?: unknown;
  /** Signals the end of this board's display lifetime. */
  signal: AbortSignal;
  /** Receives updates for the App's own feedback, including recoverable errors. */
  onStatus?(status: SnippetLayoutStatus): void;
}

/**
 * Install the controls and restore a saved layout on a mounted board. Each
 * committed gesture stages its geometry and publishes an acknowledgement for
 * the next model turn. Pass the board's context writer when other panels share
 * its context. The returned callback retries the current layout after an error.
 */
export function connectSnippetBoardLayout(
  board: Parameters<typeof capturePanelLayout>[0],
  { host, updateContext, stageTool, runId, savedLayout, signal, onStatus }:
    SnippetBoardLayoutOptions,
): () => Promise<void> {
  installPanelMovement(board, signal);
  installPanelResizing(board, signal);
  if (!signal.aborted && savedLayout !== undefined && !restorePanelLayout(board, savedLayout)) {
    onStatus?.("restore-failed");
  }

  const capabilities = host.getHostCapabilities();
  const formats = capabilities?.updateModelContext;
  const structured = typeof formats?.structuredContent === "object" &&
    formats.structuredContent !== null;
  const text = typeof formats?.text === "object" && formats.text !== null;
  let latest = 0;
  let contextSent = Promise.resolve();

  function sendReceipt(receipt: SnippetLayoutReceipt): Promise<void> {
    // Wait for the preceding context write even if the host delivers requests out of order.
    const next = contextSent.then(async () => {
      signal.throwIfAborted();
      if (receipt.status !== "pending" && receipt.revision !== latest) return;
      const value = { snippetLayout: receipt };
      // Once sent, an App-wide context update may include live selections from
      // other panels. Let its acknowledgement settle even if this board closes.
      const response = await updateContext(
        structured
          ? { structuredContent: value }
          : { content: [{ type: "text", text: JSON.stringify(value) }] },
      );
      if ("isError" in response && response.isError) throw new Error("Layout receipt rejected");
    });
    contextSent = next.catch(() => {});
    return next;
  }

  async function commit(): Promise<void> {
    if (signal.aborted) return;
    if (typeof runId !== "string" || !capabilities?.serverTools || !(structured || text)) {
      onStatus?.("local");
      return;
    }
    const layout = capturePanelLayout(board);
    if (!layout) {
      onStatus?.("local");
      return;
    }
    const revision = ++latest;
    const current = () => latest === revision && !signal.aborted;
    onStatus?.("pending");
    try {
      const [staged] = await Promise.all([
        host.callServerTool({ name: stageTool, arguments: { runId, revision, layout } }, {
          signal,
        }),
        sendReceipt({ runId, revision, status: "pending" }),
      ]);
      const ack = staged.structuredContent;
      if (
        staged.isError || !ack || typeof ack !== "object" ||
        !("runId" in ack) || ack.runId !== runId ||
        !("revision" in ack) || ack.revision !== revision
      ) {
        throw new Error("Layout revision not acknowledged");
      }
      if (!current()) return;
      await sendReceipt({ runId, revision, status: "ready" });
      if (current()) onStatus?.("ready");
    } catch {
      if (!current()) return;
      onStatus?.("failed");
      // Leave retry available even when a disconnected host rejects the failure notice.
      await sendReceipt({ runId, revision, status: "failed" }).catch(() => {});
    }
  }
  const events: EventTarget = board;
  events.addEventListener("compose-panel-layout-committed", commit, { signal });
  return commit;
}
