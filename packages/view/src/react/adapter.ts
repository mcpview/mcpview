/**
 * React 18 adapter for `@mcpview/view` view definitions.
 *
 * The core router deliberately knows only about DOM `Node`s. This adapter
 * creates one DOM container per route entry, mounts a React root into it, and
 * returns that container to the router. Existing domain components therefore
 * keep owning their JSX while `mcp-view` owns MCP Apps lifecycle and routing.
 *
 * @module
 */

// Keep runtime and type packages pinned to the versions used by mcp-erpnext.
// @deno-types="npm:@types/react@18.3.28"
import { type ComponentType, createElement, type ReactNode } from "npm:react@18.3.1";
// @deno-types="npm:@types/react-dom@18.3.7/client"
import { createRoot } from "npm:react-dom@18.3.1/client";

import type { AppContext, ViewDefinition } from "../types.ts";

/** Props received by a component mounted through {@link defineReactView}. */
export interface ReactViewProps<S, D> {
  /** The same live context object passed to vanilla `mcp-view` hooks. */
  readonly ctx: AppContext<S>;

  /** The value resolved by this view's `onEnter` hook. */
  readonly data: D;
}

/** Minimal root surface needed from ReactDOM. Public for renderer injection. */
export interface ReactViewRoot {
  render(node: ReactNode): void;
  unmount(): void;
}

/**
 * Rendering seam used by {@link defineReactView}.
 *
 * Consumers normally use the built-in ReactDOM implementation. The optional
 * injection exists for DOM-light tests and keeps a future Preact adapter from
 * being coupled to ReactDOM internals.
 */
export interface ReactViewRenderer {
  createContainer(): HTMLElement;
  createRoot(container: HTMLElement): ReactViewRoot;
  createElement<P extends object>(component: ComponentType<P>, props: P): ReactNode;
}

/**
 * React counterpart of `ViewDefinition`.
 *
 * `component` replaces the core `render(ctx, data)` hook. `onEnter`,
 * `onLeave`, and declarative `tools` keep their original contracts.
 */
export type ReactViewOptions<S, A = void, D = void> =
  & Omit<ViewDefinition<S, A, D>, "render" | "onLeave">
  & {
    component: ComponentType<ReactViewProps<S, D>>;
    onLeave?: ViewDefinition<S, A, D>["onLeave"];
  };

/** Default browser implementation backed by ReactDOM 18.3.1. */
export const reactDomRenderer: ReactViewRenderer = {
  createContainer(): HTMLElement {
    const container = document.createElement("div");
    container.dataset.mcpViewFramework = "react";
    return container;
  },
  createRoot,
  createElement,
};

/**
 * Define an `mcp-view` route backed by a React component.
 *
 * The returned value is a regular `ViewDefinition`, so it can be mixed with
 * vanilla views in the same `createMcpApp({ views })` map. On route leave,
 * the user's hook runs first and React is always unmounted afterward, even if
 * that hook rejects. React effect cleanups therefore complete before the core
 * router unregisters the route's tools.
 *
 * @example
 * ```tsx
 * const detail = defineReactView<State, { id: string }, Invoice>({
 *   async onEnter(ctx, { id }) {
 *     const result = await ctx.callTool("invoice_get", { id });
 *     return result.structuredContent as Invoice;
 *   },
 *   component: ({ ctx, data }) => (
 *     <InvoiceViewer invoice={data} onBack={() => ctx.navigate("list")} />
 *   ),
 * });
 * ```
 */
export function defineReactView<S, A = void, D = void>(
  options: ReactViewOptions<S, A, D>,
  renderer: ReactViewRenderer = reactDomRenderer,
): ViewDefinition<S, A, D> {
  const { component, onEnter, onLeave, tools } = options;
  const activeRoots = new WeakMap<AppContext<S>, ReactViewRoot>();

  const unmountActiveRoot = (ctx: AppContext<S>): void => {
    const root = activeRoots.get(ctx);
    activeRoots.delete(ctx);
    root?.unmount();
  };

  return {
    onEnter,
    tools,
    render(ctx, data) {
      // A conforming router calls onLeave before render. Defensively clean up
      // if a custom caller invokes render twice so no React root is orphaned.
      unmountActiveRoot(ctx);

      const container = renderer.createContainer();
      const root = renderer.createRoot(container);
      activeRoots.set(ctx, root);

      try {
        const element = renderer.createElement(component, { ctx, data });
        root.render(element);
      } catch (error) {
        // ReactDOM owns listeners and effect state as soon as createRoot
        // succeeds. Release them before preserving the original render error.
        try {
          unmountActiveRoot(ctx);
        } catch (unmountError) {
          throw new AggregateError(
            [error, unmountError],
            "React view render and cleanup both failed",
          );
        }
        throw error;
      }

      return container;
    },
    async onLeave(ctx) {
      let userError: unknown;
      try {
        await onLeave?.(ctx);
      } catch (error) {
        userError = error;
      }

      let unmountError: unknown;
      try {
        unmountActiveRoot(ctx);
      } catch (error) {
        unmountError = error;
      }

      if (userError !== undefined && unmountError !== undefined) {
        throw new AggregateError(
          [userError, unmountError],
          "React view user cleanup and unmount both failed",
        );
      }
      if (userError !== undefined) throw userError;
      if (unmountError !== undefined) throw unmountError;
    },
  };
}
