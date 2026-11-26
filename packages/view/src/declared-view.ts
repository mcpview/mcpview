/** Mount a server-selected MCP App view in the shell's existing document. @module */

import { readDeclaredViewUri } from "@mcpview/contracts";
import type { ToolResult } from "./types.ts";

/** The instance owns its DOM, event subscriptions and any in-flight work. */
export interface MountedDeclaredView {
  /** Release this instance's resources. The shell owns the host connection. */
  dispose(): void;
  /** Receive the next native result in place. Without this hook the shell remounts. */
  update?(result: ToolResult): void | Promise<void>;
}

/** A module provided by the publisher for an exact resource URI. */
export interface DeclaredViewModule<THost> {
  /**
   * Mount into a fresh element in the existing document. Use the shell's
   * connected host for callbacks. The signal ends this mount's lifetime,
   * including a mount still waiting for its first asynchronous operation.
   * A mount that throws must release any resources it already acquired.
   */
  mount(
    root: HTMLElement,
    host: THost,
    result: ToolResult,
    signal: AbortSignal,
  ): MountedDeclaredView | Promise<MountedDeclaredView>;
}

export interface DeclaredViewDispatcherOptions<THost> {
  /** Exclusive DOM root for the mounted view. */
  root: HTMLElement;
  /** Already-connected host, e.g. the App from the shell's MCP Apps SDK. */
  host: THost;
  /** Trusted build-time imports keyed by the complete resource URI. */
  loaders: ReadonlyMap<string, () => Promise<DeclaredViewModule<THost>>>;
}

export interface DeclaredViewDispatcher {
  /**
   * Deliver the native result. Returns false for an unhandled or failed tool
   * result and after disposal. An accepted delivery superseded by a later
   * one still returns true. Failures in the current loader or view reject.
   */
  dispatch(result: ToolResult): Promise<boolean>;
  /** Unmount the active view and revoke all pending deliveries. Idempotent. */
  dispose(): void;
}

interface Entry {
  uri: string;
  target: HTMLElement;
  controller: AbortController;
  mounted?: MountedDeclaredView;
  updates: Promise<void>;
}

/**
 * Build the shell's dispatcher. Give it the complete result from the
 * shell's `onToolResult`, and call `dispose` on shell teardown. Only a URI
 * in the local loader map can mount code. The URI itself is never imported.
 */
export function createDeclaredViewDispatcher<THost>(
  { root, host, loaders }: DeclaredViewDispatcherOptions<THost>,
): DeclaredViewDispatcher {
  const routes = new Map(loaders);
  let active: Entry | undefined;
  let disposed = false;

  function release(entry: Entry | undefined): void {
    if (!entry) return;
    entry.target.remove();
    entry.controller.abort();
    entry.mounted?.dispose();
  }

  function clear(): void {
    const previous = active;
    active = undefined;
    release(previous);
  }

  async function dispatch(result: ToolResult): Promise<boolean> {
    if (disposed) return false;
    const uri = result.isError ? undefined : readDeclaredViewUri(result);
    const load = uri && routes.get(uri);
    if (!uri || !load) {
      clear();
      return false;
    }

    const previous = active;
    const mounted = previous?.mounted;
    if (previous && previous.uri === uri && mounted?.update) {
      const update = mounted.update.bind(mounted);
      const delivery = previous.updates.then(async () => {
        if (active !== previous) return;
        try {
          await update(result);
        } catch (error) {
          if (active === previous) {
            clear();
            throw error;
          }
        }
      });
      // Later same-view results run in arrival order; a failed instance is
      // cleared above and cannot receive an already queued delivery.
      previous.updates = delivery.catch(() => {});
      await delivery;
      return true;
    }

    const entry: Entry = {
      uri,
      target: root.ownerDocument.createElement("div"),
      controller: new AbortController(),
      updates: Promise.resolve(),
    };
    active = entry;
    try {
      release(previous);
      if (active !== entry) return true;
      const module = await load();
      if (active !== entry) return true;
      if (typeof module?.mount !== "function") {
        throw new TypeError(`Declared view ${uri} must export mount()`);
      }
      root.replaceChildren(entry.target);
      const view = await module.mount(entry.target, host, result, entry.controller.signal);
      if (typeof view?.dispose !== "function") {
        throw new TypeError(`Declared view ${uri} must return an instance with dispose()`);
      }
      if (active === entry) entry.mounted = view;
      else view.dispose();
    } catch (error) {
      if (active === entry) {
        clear();
        throw error;
      }
    }
    return true;
  }

  return {
    dispatch,
    dispose() {
      disposed = true;
      clear();
    },
  };
}
