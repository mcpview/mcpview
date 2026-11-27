/** The board element available to a caller running in a DOM environment. */
type PanelContainer = typeof globalThis extends { HTMLElement: { prototype: infer Element } }
  ? Element
  : never;

/** Install pointer and keyboard controls for moving panels within a Compose board. */
export declare function installPanelMovement(container: PanelContainer, signal?: AbortSignal): void;

/** Install a lower-right handle to select one of the viewer's declared widths. */
export declare function installPanelResizing(container: PanelContainer, signal?: AbortSignal): void;

/** Layout operations used by the resize handles in both browser renderers. */
export declare function createPanelReflow(container: PanelContainer): {
  layout(
    choices: ReadonlyMap<PanelContainer, number>,
    preview?: { panel: PanelContainer; skeleton: PanelContainer },
    placements?: ReadonlyMap<
      PanelContainer,
      { beside: PanelContainer; side: "left" | "right" | "below" }
    >,
  ): boolean;
  reset(): void;
};
