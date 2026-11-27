/** Presentation state for an element using the visual item gestures. */
export interface VisualItemPropsOptions {
  id: string;
  activation?: {
    label?: string;
    expanded?: boolean;
    controls?: string;
  };
  pressed?: boolean | "mixed";
  selectionStart?: boolean;
}

/** Attributes for a focusable visual item with independent activation and context gestures. */
export function visualItemProps({
  id,
  activation,
  pressed,
  selectionStart = pressed !== undefined,
}: VisualItemPropsOptions): {
  "data-visual-item": string | undefined;
  "data-visual-no-activate": string | undefined;
  "data-visual-no-toggle": string | undefined;
  "data-visual-selection-start": string | undefined;
  role: "button" | undefined;
  tabIndex: number | undefined;
  "aria-label": string | undefined;
  "aria-pressed": boolean | "mixed" | undefined;
  "aria-keyshortcuts": string | undefined;
  "aria-expanded": boolean | undefined;
  "aria-controls": string | undefined;
  title: string | undefined;
} {
  const canToggle = pressed !== undefined;
  const interactive = activation !== undefined || canToggle;
  return {
    "data-visual-item": interactive ? id : undefined,
    "data-visual-no-activate": activation ? undefined : "",
    "data-visual-no-toggle": canToggle ? undefined : "",
    "data-visual-selection-start": selectionStart ? "" : undefined,
    role: interactive ? "button" as const : undefined,
    tabIndex: interactive ? 0 : undefined,
    "aria-label": activation?.label,
    "aria-pressed": pressed,
    "aria-keyshortcuts": canToggle ? "Shift+Space" : undefined,
    "aria-expanded": activation?.expanded,
    "aria-controls": activation?.controls,
    title: activation?.label,
  };
}
