import type {
  ActiveContextActions,
  ActiveContextController,
  ActiveContextState,
} from "@mcpview/view/context";
import { useLayoutEffect, useMemo, useState } from "preact/hooks";

export type { ActiveContextReconcileResult } from "@mcpview/view/context";

/** ACK-confirmed basket, provisional row states and actions for the current root. */
export interface ActiveContextHook extends ActiveContextState, ActiveContextActions {
  retry: ActiveContextController["retry"];
  dismissFailure: ActiveContextController["dismissFailure"];
  dismissEviction: ActiveContextController["dismissEviction"];
}

/**
 * Subscribe to a controller owned outside the render tree. Surface remounts only
 * unsubscribe; they never clear, dispose or recreate the App's context queue.
 * Changing scope invalidates old handlers immediately, then queues the root clear.
 */
export function useActiveContext(
  controller: ActiveContextController,
  scopeKey: string,
): ActiveContextHook {
  const [observed, setObserved] = useState(() => ({ controller, state: controller.getSnapshot() }));
  controller.setScope(scopeKey);
  const actions = useMemo(() => controller.actionsForScope(scopeKey), [controller, scopeKey]);
  useLayoutEffect(() => {
    const update = () => setObserved({ controller, state: controller.getSnapshot() });
    const unsubscribe = controller.subscribe(update);
    update();
    return unsubscribe;
  }, [controller]);
  useLayoutEffect(() => {
    void controller.clearPreviousScope();
  }, [controller, scopeKey]);
  const state = observed.controller === controller ? observed.state : controller.getSnapshot();
  return {
    ...state,
    ...actions,
    retry: controller.retry,
    dismissFailure: controller.dismissFailure,
    dismissEviction: controller.dismissEviction,
  };
}
