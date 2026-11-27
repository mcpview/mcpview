import type { RefCallback } from "preact";
import { useCallback, useRef } from "preact/hooks";
import { bindVisualItemGestures, type VisualItemGestureOptions } from "../visual-item-gestures.ts";

/** A stable callback ref that delegates to the latest gesture callbacks. */
export function useVisualItemGestures<T extends Element = HTMLElement>(
  options: VisualItemGestureOptions,
): RefCallback<T> {
  const current = useRef(options);
  const detach = useRef<() => void>();
  current.current = options;

  return useCallback((root: T | null) => {
    detach.current?.();
    detach.current = root
      ? bindVisualItemGestures(root, {
        get onActivate() {
          return current.current.onActivate;
        },
        get onToggle() {
          return current.current.onToggle;
        },
        get onAdd() {
          return current.current.onAdd;
        },
        get getItemBounds() {
          return current.current.getItemBounds;
        },
        get intersectsItem() {
          return current.current.intersectsItem;
        },
      })
      : undefined;
  }, []);
}
