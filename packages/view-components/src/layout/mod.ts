/** Responsive viewer layout for `@mcpview/components` Apps. */

export {
  isNarrow,
  layoutFromSearch,
  layoutWidth,
  NARROW_BREAKPOINT,
  resolveViewerLayout,
  touchInput,
  VIEWER_LAYOUTS,
  viewerBoundsStyle,
} from "./viewer-layout.ts";
export type {
  LayoutContainerDimensions,
  LayoutHostHints,
  ViewerBoundsStyle,
  ViewerLayout,
  ViewerLayoutInputs,
} from "./viewer-layout.ts";
export { useCoarsePointer, useContainerWidth, useViewerLayout } from "./hooks.ts";
export type { UseViewerLayoutOptions, ViewerLayoutState } from "./hooks.ts";
