// The eight conventional ERPNext apps own their Preact tree and expect an App
// object. The shell owns the actual MCP connection and the routed tool results.
export function mountPreactResource(root, host, firstResult, signal, css, start) {
  signal?.throwIfAborted();
  let disposed = false;
  let connected = false;
  let latest = firstResult;
  let contextListener;
  const app = {
    ontoolresult: undefined,
    async connect() {
      if (!disposed && !connected) {
        connected = true;
        await this.ontoolresult(latest);
      }
    },
    set onhostcontextchanged(listener) {
      if (contextListener) host.removeEventListener("hostcontextchanged", contextListener);
      contextListener = disposed ? undefined : listener;
      if (contextListener) host.addEventListener("hostcontextchanged", contextListener);
    },
  };

  // Input/partial notifications belong to the outer tool (e.g. its code
  // argument). A view gets the selected inner tool's complete result instead.
  for (
    const name of [
      "getHostContext",
      "getHostCapabilities",
      "callServerTool",
      "sendMessage",
      "updateModelContext",
      "downloadFile",
    ]
  ) {
    if (typeof host[name] === "function") app[name] = host[name].bind(host);
  }

  const style = root.ownerDocument.createElement("style");
  style.textContent = css;
  root.ownerDocument.head.append(style);
  let unmount;
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      unmount?.();
    } finally {
      app.onhostcontextchanged = undefined;
      app.ontoolresult = undefined;
      style.remove();
      signal?.removeEventListener("abort", dispose);
    }
  }
  try {
    unmount = start({ root, app });
    signal?.addEventListener("abort", dispose, { once: true });
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    update(result) {
      if (disposed) return;
      latest = result;
      if (connected) app.ontoolresult(result);
    },
    dispose,
  };
}
