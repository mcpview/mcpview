/** Aggregate panel selections and board receipts for a single MCP Apps host. @module */

/** Replacement snapshot accepted by the host in its negotiated content formats. */
export interface PanelContextUpdate<Block> {
  /** Content blocks offered to hosts that accept text or resources. */
  content?: Block[];
  /** Structured context offered to hosts that accept JSON. */
  structuredContent?: Record<string, unknown>;
}

/** Send one context replacement and return the host acknowledgement. */
export type SendPanelContext<Block, Options, Response> = (
  update: PanelContextUpdate<Block>,
  options?: Options,
) => Promise<Response>;

/** Writers share a serialized host update queue and retain only acknowledged contributions. */
export interface PanelContexts<Block, Options, Response> {
  /** Bind a panel's selection to its identity and lifetime. */
  forPanel(
    id: string,
    title: string,
    signal: AbortSignal,
  ): SendPanelContext<Block, Options, Response>;
  /**
   * Publish board metadata using its own lifetime and top-level structured keys.
   * Compose reserves the `panels` key to group panel selections.
   */
  forBoard(signal: AbortSignal): SendPanelContext<Block, Options, Response>;
  /** Send a replacement snapshot after one or more contributor lifetimes end. */
  clear(): Promise<void>;
}

type Selection<Block> = {
  title: string;
  value: PanelContextUpdate<Block>;
  signal: AbortSignal;
};

/** One host snapshot contains the acknowledged selections of every mounted panel. */
export function createPanelContexts<Block, Options, Response extends object>(
  send: SendPanelContext<Block, Options, Response>,
  clearErrorMessage: () => string = () => "Context not updated",
): PanelContexts<Block, Options, Response> {
  type Update = PanelContextUpdate<Block>;
  const board = Symbol("layout receipt");
  type Source = string | typeof board;
  let active = new Map<Source, Selection<Block>>();
  // A lost acknowledgement leaves the host snapshot unknown. Retain only the
  // formats to clear on the next replacement, never the attempted selection.
  let uncertain: Update | undefined;
  function liveSelections() {
    return new Map(
      [...active].filter(([, selection]) => !selection.signal.aborted),
    );
  }
  let queued: Promise<unknown> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = queued.then(work);
    queued = next.catch(() => {});
    return next;
  }
  function hasSelection(value: Update): boolean {
    return Boolean(
      value.content?.length ||
        Object.keys(value.structuredContent ?? {}).length,
    );
  }
  function businessSelection(
    entries: Selection<Block>[],
    last: Update,
    boardMetadata?: Record<string, unknown>,
  ): Update {
    if (entries.length === 0) return last;
    if (entries.length === 1) {
      const only = entries[0].value;
      const overlap = boardMetadata &&
        Object.keys(only.structuredContent ?? {}).some((key) => Object.hasOwn(boardMetadata, key));
      if (!overlap) return only;
    }
    const content = entries.flatMap(({ value }) => value.content ?? []);
    const panels = entries.flatMap(({ title, value }) =>
      value.structuredContent ? [{ title, context: value.structuredContent }] : []
    );
    return {
      ...(entries.some(({ value }) => value.content !== undefined) ? { content } : {}),
      ...(panels.length ? { structuredContent: { panels } } : {}),
    };
  }
  function merge(next: Map<Source, Selection<Block>>, last: Update): Update {
    const receipt = next.get(board)?.value;
    if (!receipt) return businessSelection([...next.values()], last);
    const business = businessSelection(
      [...next].filter(([key]) => key !== board).map(([, entry]) => entry),
      {},
      receipt.structuredContent,
    );
    return {
      ...(business.structuredContent || receipt.structuredContent ||
          last.structuredContent
        ? {
          structuredContent: {
            ...business.structuredContent,
            ...receipt.structuredContent,
          },
        }
        : {}),
      ...(business.content || receipt.content || last.content
        ? { content: [...(business.content ?? []), ...(receipt.content ?? [])] }
        : {}),
    };
  }
  async function replace(next: Map<Source, Selection<Block>>, last: Update, options?: Options) {
    const update = { ...uncertain, ...merge(next, last) };
    let response: Response;
    try {
      response = await send(update, options);
    } catch (cause) {
      uncertain = {
        ...(update.content !== undefined ? { content: [] } : {}),
        ...(update.structuredContent !== undefined ? { structuredContent: {} } : {}),
      };
      throw cause;
    }
    if (!("isError" in response && response.isError)) {
      active = next;
      uncertain = undefined;
    }
    return response;
  }
  function forSource(id: Source, title: string, signal: AbortSignal) {
    return (value: Update, options?: Options) =>
      enqueue(async () => {
        signal.throwIfAborted();
        if (
          id === board && value.structuredContent &&
          Object.hasOwn(value.structuredContent, "panels")
        ) {
          throw new TypeError('Board context reserves "panels" for panel selections');
        }
        const next = liveSelections();
        if (hasSelection(value)) next.set(id, { title, value, signal });
        else next.delete(id);
        return await replace(next, value, options);
      });
  }
  return {
    forPanel: (id: string, title: string, signal: AbortSignal) => forSource(id, title, signal),
    forBoard: (signal: AbortSignal) => forSource(board, "", signal),
    clear(): Promise<void> {
      return enqueue(async () => {
        const next = liveSelections();
        if (!uncertain && next.size === active.size) return;
        const entries = [...active.values()];
        const empty = {
          ...(entries.some(({ value }) => value.structuredContent !== undefined)
            ? { structuredContent: {} }
            : {}),
          ...(entries.some(({ value }) => value.content !== undefined) ? { content: [] } : {}),
        };
        const response = await replace(next, empty);
        if ("isError" in response && response.isError) {
          throw new Error(clearErrorMessage());
        }
      });
    },
  };
}
