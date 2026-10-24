import type {
  ActiveContextHost,
  ActiveContextPolicy,
  ContextSelectionItem,
} from "./active-context.ts";
export type { ActiveContextActivation } from "./active-context-controller.ts";
import type { ActiveContextActivation } from "./active-context-controller.ts";
export type ActiveContextFlowHost = ActiveContextHost;
export type ActiveContextPresentationEffect = "replace" | "failure" | "ignore";
export function activeContextPresentationEffect(
  result: ActiveContextActivation,
): ActiveContextPresentationEffect {
  return result === "context"
    ? "replace"
    : result === "superseded" || result === "unsupported"
    ? "ignore"
    : "failure";
}
/** Passive context never starts a conversation. The author can guide users to detail UI. */
export async function activateContext(
  host: ActiveContextHost,
  items: readonly ContextSelectionItem[],
  policy: ActiveContextPolicy,
  isCurrent: () => boolean = () => true,
): Promise<ActiveContextActivation> {
  const result = await policy.replaceActiveContext(host, items);
  if (result === "shared" || result === "cleared") return "context";
  if (!isCurrent()) return "superseded";
  return result === "unsupported" ? "unsupported" : "none";
}
