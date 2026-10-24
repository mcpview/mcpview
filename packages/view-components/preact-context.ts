/** Context controls without the MCP Apps lifecycle or surface runtime. @module */
export { ActiveContextChip } from "./src/preact/context-basket.tsx";
export type {
  ActiveContextChipProps,
  ContextBasketEntry,
  ContextBasketGroup,
  ContextBasketLabels,
  ContextBasketSelection,
  ContextBasketSlot,
  ContextMutation,
} from "./src/preact/context-basket.tsx";
export { useActiveContext } from "./src/preact/use-active-context.ts";
export type { ActiveContextHook } from "./src/preact/use-active-context.ts";
export {
  CONTEXT_BASKET_MESSAGES_EN,
  CONTEXT_BASKET_MESSAGES_FR,
  contextBasketLabels,
  contextBasketMessages,
} from "./src/context-basket-labels.ts";
export type { ContextBasketMessages } from "./src/context-basket-labels.ts";
export {
  MCP_VIEW_CONTEXT_BASKET_CSS,
  MCP_VIEW_CONTEXT_SELECTION_CSS,
} from "./src/context-basket-styles.ts";
