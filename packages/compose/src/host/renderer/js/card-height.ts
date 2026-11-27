import { COMPOSE_VERSION, MCP_APPS_PROTOCOL_VERSION } from "../../../version.ts";

/** Connect the generated dashboard to its enclosing MCP Apps host as an App. */
export function generateCardHeightScript(): string {
  return `
    (() => {
      const host = window.parent;
      if (!host || host === window) return;
      const board = document.querySelector('#container[data-compose-board]');
      if (!board) return;
      board.setAttribute('data-compose-intrinsic', '');

      const initializeId = 'compose-card-initialize';
      const protocolVersion = '${MCP_APPS_PROTOCOL_VERSION}';
      let hostOrigin;
      let lastHeight;
      const send = (message) => host.postMessage(
        { jsonrpc: '2.0', ...message }, hostOrigin && hostOrigin !== 'null' ? hostOrigin : '*'
      );
      function reportHeight() {
        // The viewport still has the previous height while a row disappears.
        // The grid's border box includes the skeleton, row gaps and padding.
        const height = Math.ceil(board.getBoundingClientRect().height);
        if (!Number.isFinite(height) || height < 0 || height === lastHeight) return;
        if (hostOrigin !== undefined) {
          send({ method: 'ui/notifications/size-changed', params: { height } });
        } else if (typeof window.openai?.notifyIntrinsicHeight === 'function') {
          window.openai.notifyIntrinsicHeight(height);
        } else {
          return;
        }
        lastHeight = height;
      }
      const observer = new ResizeObserver(reportHeight);
      function onHostMessage(event) {
        const msg = event.data;
        if (event.source !== host || msg?.jsonrpc !== '2.0') return;
        if (hostOrigin === undefined) {
          if (msg.id !== initializeId || msg.result?.protocolVersion !== protocolVersion) return;
          hostOrigin = event.origin;
          send({ method: 'ui/notifications/initialized' });
          lastHeight = undefined;
          reportHeight();
        } else if (event.origin === hostOrigin && msg.method === 'ui/resource-teardown' && msg.id != null) {
          observer.disconnect();
          window.removeEventListener('message', onHostMessage);
          window.removeEventListener('openai:set_globals', reportHeight);
          send({ id: msg.id, result: {} });
        }
      }
      window.addEventListener('message', onHostMessage);
      window.addEventListener('openai:set_globals', reportHeight);
      observer.observe(board, { box: 'border-box' });
      send({ id: initializeId, method: 'ui/initialize', params: {
        appInfo: { name: 'mcp-compose', version: '${COMPOSE_VERSION}' },
        appCapabilities: {}, protocolVersion
      } });
    })();`;
}
