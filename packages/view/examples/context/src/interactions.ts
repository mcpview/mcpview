import {
  type ActiveContextActions,
  type ContextSelectionItem,
  detailOnClickIntent,
} from "@mcpview/view/context";

/** Row callbacks shared by the rendered example and its interaction regression. */
export function createExampleInteractions(
  context: ActiveContextActions & { supported: boolean },
  scope: string,
  setDetail: (item: ContextSelectionItem) => void,
) {
  const open = (item: ContextSelectionItem) => {
    // Local detail retains the root and unrelated pending row gestures.
    setDetail(item);
  };
  const intent = (item: ContextSelectionItem) =>
    context.supported
      ? {
        key: item.id,
        scope,
        onPreview: () => context.previewToggle(item),
        onSingle: () => {
          void context.toggle(item);
        },
        onDouble: () => open(item),
      }
      : detailOnClickIntent(item.id, () => open(item), scope);
  return { intent };
}
