/**
 * Event bus script generator for cross-UI communication.
 *
 * Generates JavaScript that implements:
 * - JSON-RPC 2.0 message handling via postMessage
 * - `ui/initialize` / `ui/notifications/initialized` MCP Apps lifecycle
 * - opt-in slot-local tools/resources proxying
 * - `ui/compose/event` dedicated cross-UI event routing
 * - Broadcast support via `to: "*"` on sync rules
 *
 * @module renderer/js/event-bus
 */

import type { CompositeUiDescriptor } from "../../../core/types/descriptor.ts";
import { COMPOSE_EVENT_METHOD } from "../../../sdk/compose-events.ts";
import { COMPOSE_VERSION, MCP_APPS_PROTOCOL_VERSION } from "../../../version.ts";
import type { ResolvedRendererSlotOptions } from "../options.ts";
import {
  CASYS_COMPONENT_CATALOG_CAPABILITY_KEY,
  CASYS_SURFACE_CONTEXT_KEY,
} from "../../components-contract.ts";

/**
 * Generate the event bus JavaScript for a composite UI.
 *
 * `slots` is deliberately a renderer-only value. It lets any serving runtime
 * map a child iframe to a local resource URL and local MCP proxy without the
 * browser code importing runtime types or knowing about server transports.
 *
 * @param descriptor - Composite UI descriptor with sync rules
 * @param slots - Fully-resolved browser host settings, keyed by slot
 * @returns JavaScript code string for inline `<script>` tag
 *
 * @example
 * ```typescript
 * const js = generateEventBusScript(descriptor, slots);
 * // js contains the MCP Apps lifecycle, local proxy, and sync routing
 * ```
 */
export function generateEventBusScript(
  descriptor: CompositeUiDescriptor,
  slots: ReadonlyMap<number, ResolvedRendererSlotOptions> = new Map(),
): string {
  const tabSwitchingCode = descriptor.layout === "tabs"
    ? `
    // Tab switching logic
    const tabs = document.querySelectorAll('.tab');
    const tabIframes = document.querySelectorAll('.tab-content iframe');

    function switchTab(slot) {
      tabs.forEach((t, i) => t.classList.toggle('active', i === slot));
      tabIframes.forEach((iframe, i) => iframe.classList.toggle('active', i === slot));
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => switchTab(i));
    });

    if (tabs.length > 0) switchTab(0);
  `
    : "";

  const serialisedSlots = Object.fromEntries(slots.entries());

  return `
    // mcp-compose Event Bus - MCP Apps Protocol host
    const COMPOSE_METHOD = '${COMPOSE_EVENT_METHOD}';
    const syncRules = ${serializeForInlineScript(descriptor.sync)};
    const portSyncRules = ${serializeForInlineScript(descriptor.portSync ?? [])};
    const sharedContext = ${serializeForInlineScript(descriptor.sharedContext ?? {})};
    const slotConfigs = ${serializeForInlineScript(serialisedSlots)};
    const initialResultsDelivered = new Set();
    const initializationResponded = new Set();
    const componentCatalogs = new Map();
    const lastHostContexts = new Map();
    const COMPONENT_CAPABILITY = '${CASYS_COMPONENT_CATALOG_CAPABILITY_KEY}';
    const SURFACE_CONTEXT = '${CASYS_SURFACE_CONTEXT_KEY}';

    // Build slot -> iframe map + reverse lookup. The fallback lookup matters
    // when the iframe's WindowProxy becomes available after this script runs.
    const iframes = new Map();
    const windowToSlot = new Map();
    document.querySelectorAll('iframe[data-slot]').forEach((iframe) => {
      const slot = parseInt(iframe.dataset.slot, 10);
      if (!Number.isInteger(slot)) return;
      iframes.set(slot, iframe);
      if (iframe.contentWindow) windowToSlot.set(iframe.contentWindow, slot);
    });

    function getSlotBySource(source) {
      const knownSlot = windowToSlot.get(source);
      if (knownSlot !== undefined) return knownSlot;

      for (const [slot, iframe] of iframes.entries()) {
        if (iframe.contentWindow === source) {
          windowToSlot.set(source, slot);
          return slot;
        }
      }

      return -1;
    }

    function hasRequestId(message) {
      return Object.prototype.hasOwnProperty.call(message, 'id');
    }

    function targetOriginForSlot(slot) {
      const expectedOrigin = getSlotConfig(slot)?.expectedOrigin;
      return typeof expectedOrigin === 'string' ? expectedOrigin : '*';
    }

    function post(source, message, targetOrigin = '*') {
      if (!source || typeof source.postMessage !== 'function') return;
      source.postMessage(message, targetOrigin);
    }

    function respond(source, id, result, targetOrigin = '*') {
      post(source, { jsonrpc: '2.0', id, result }, targetOrigin);
    }

    function respondError(source, id, code, message, targetOrigin = '*') {
      post(source, {
        jsonrpc: '2.0',
        id,
        error: { code, message }
      }, targetOrigin);
    }

    function ackIfRequested(source, message, targetOrigin = '*') {
      if (hasRequestId(message)) respond(source, message.id, {}, targetOrigin);
    }

    function getSlotConfig(slot) {
      return slotConfigs[String(slot)];
    }

    function getHostCapabilities(slot) {
      const config = getSlotConfig(slot);
      const capabilities = {
        logging: {},
        experimental: {
          [COMPONENT_CAPABILITY]: {
            version: '1',
            eventChannel: COMPOSE_METHOD
          }
        }
      };

      // Do not over-advertise: only capability-gated requests with a local
      // endpoint are sent to the serving runtime.
      if (config?.serverTools && config.rpcEndpoint) {
        capabilities.serverTools = { listChanged: false };
      }
      if (config?.serverResources && config.rpcEndpoint) {
        capabilities.serverResources = { listChanged: false };
      }

      return capabilities;
    }

    function measureSlot(slot) {
      const iframe = iframes.get(slot);
      if (!iframe || typeof iframe.getBoundingClientRect !== 'function') return undefined;
      const rect = iframe.getBoundingClientRect();
      const width = Math.max(0, Math.round(Number(rect?.width)));
      const height = Math.max(0, Math.round(Number(rect?.height)));
      if (!Number.isFinite(width) || !Number.isFinite(height) || width === 0 || height === 0) {
        return undefined;
      }
      return { width, height };
    }

    function validSurface(value, knownComponents) {
      if (!value || typeof value !== 'object') return undefined;
      const layout = value.layout;
      if (!layout || !['stack', 'row', 'grid'].includes(layout.type)) return undefined;
      if (layout.columns !== undefined &&
        (!Number.isInteger(layout.columns) || layout.columns < 1 || layout.columns > 12)) {
        return undefined;
      }
      if (layout.type !== 'grid' && layout.columns !== undefined) return undefined;
      if (layout.gap !== undefined && !['none', 'xs', 'sm', 'md', 'lg'].includes(layout.gap)) {
        return undefined;
      }
      if (!Array.isArray(value.components) || value.components.length === 0) return undefined;
      const ids = new Set();
      for (const item of value.components) {
        if (!item || typeof item !== 'object') return undefined;
        if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) return undefined;
        if (typeof item.component !== 'string' || !item.component) return undefined;
        if (item.area !== undefined &&
          (typeof item.area !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(item.area))) {
          return undefined;
        }
        ids.add(item.id);
      }
      if (knownComponents && value.components.some((item) => !knownComponents.has(item.component))) {
        return undefined;
      }
      return value;
    }

    function validComponentCatalog(value) {
      if (!value || typeof value !== 'object') return undefined;
      if (!value.components || typeof value.components !== 'object' || Array.isArray(value.components)) {
        return undefined;
      }
      const entries = Object.entries(value.components);
      if (entries.length === 0) return undefined;
      for (const [id, descriptor] of entries) {
        if (!id || !descriptor || typeof descriptor !== 'object' ||
          typeof descriptor.title !== 'string' || !descriptor.title) return undefined;
        if (descriptor.description !== undefined && typeof descriptor.description !== 'string') {
          return undefined;
        }
        if (!validEventPorts(descriptor.events)) return undefined;
      }
      const known = new Set(entries.map(([id]) => id));
      if (value.defaultSurface !== undefined && !validSurface(value.defaultSurface, known)) {
        return undefined;
      }
      return value;
    }

    function validEventPorts(value) {
      if (value === undefined) return true;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      return validEventNames(value.emits) && validEventNames(value.accepts);
    }

    function validEventNames(value) {
      if (value === undefined) return true;
      if (!Array.isArray(value)) return false;
      const names = new Set();
      for (const name of value) {
        if (typeof name !== 'string' || !name.trim() || names.has(name)) return false;
        names.add(name);
      }
      return true;
    }

    function surfaceContextForSlot(slot) {
      const config = getSlotConfig(slot);
      const instanceId = config?.componentId || String(slot);
      const catalog = componentCatalogs.get(slot);
      if (!catalog) {
        return {
          instanceId,
          status: 'legacy',
          reason: 'component-catalog-unavailable',
          eventChannel: COMPOSE_METHOD,
        };
      }
      const requested = config?.surface;
      const surface = requested || catalog.defaultSurface;
      if (!surface) {
        return {
          instanceId,
          status: 'unresolved',
          reason: 'surface-required',
          eventChannel: COMPOSE_METHOD,
        };
      }
      const known = new Set(Object.keys(catalog.components));
      const missingComponents = [...new Set(
        surface.components
          .map((item) => item.component)
          .filter((component) => !known.has(component))
      )].sort();
      if (missingComponents.length > 0) {
        return {
          instanceId,
          status: 'unresolved',
          reason: 'unknown-components',
          missingComponents,
          eventChannel: COMPOSE_METHOD,
        };
      }
      return {
        instanceId,
        status: 'ready',
        source: requested ? 'requested' : 'default',
        surface,
        eventChannel: COMPOSE_METHOD,
      };
    }

    function resolvedTheme() {
      if (document.body.classList.contains('dark')) return 'dark';
      if (document.documentElement?.classList.contains('light')) return 'light';
      return typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    }

    function hostContextForSlot(slot) {
      const dimensions = measureSlot(slot);
      return {
        theme: resolvedTheme(),
        displayMode: 'inline',
        availableDisplayModes: ['inline'],
        ...(dimensions ? { containerDimensions: dimensions } : {}),
        [SURFACE_CONTEXT]: surfaceContextForSlot(slot),
      };
    }

    function sendHostContextChanged(slot) {
      if (!initializationResponded.has(slot)) return;
      const iframe = iframes.get(slot);
      if (!iframe?.contentWindow) return;
      const context = hostContextForSlot(slot);
      const signature = JSON.stringify(context);
      if (lastHostContexts.get(slot) === signature) return;
      lastHostContexts.set(slot, signature);
      post(iframe.contentWindow, {
        jsonrpc: '2.0',
        method: 'ui/notifications/host-context-changed',
        params: context,
      }, targetOriginForSlot(slot));
    }

    function componentSupports(slot, direction, name) {
      const catalog = componentCatalogs.get(slot);
      if (!catalog) return false;
      const surfaceContext = surfaceContextForSlot(slot);
      if (surfaceContext.status !== 'ready') return false;
      return surfaceContext.surface.components.some((item) =>
        catalog.components[item.component]?.events?.[direction]?.includes(name)
      );
    }

    // Route an event through sync rules, calling
    // deliver(rule, targetSlot, targetIframe) for each matching target.
    function routeEvent(sourceSlot, eventType, deliver) {
      const staticallyDelivered = new Set();
      for (const rule of syncRules) {
        if (rule.from !== sourceSlot) continue;
        if (rule.event !== '*' && rule.event !== eventType) continue;

        const targets = rule.to === '*'
          ? [...iframes.entries()].filter(([slot]) => slot !== sourceSlot)
          : (() => {
            const iframe = iframes.get(rule.to);
            return iframe ? [[rule.to, iframe]] : [];
          })();

        for (const [targetSlot, target] of targets) {
          deliver(rule, targetSlot, target);
          staticallyDelivered.add(JSON.stringify([targetSlot, rule.action]));
        }
      }

      for (const rule of portSyncRules) {
        if (rule.event !== eventType) continue;
        if (!componentSupports(sourceSlot, 'emits', eventType)) continue;
        for (const [targetSlot, target] of iframes.entries()) {
          if (targetSlot === sourceSlot) continue;
          if (!componentSupports(targetSlot, 'accepts', rule.action)) continue;
          const routeKey = JSON.stringify([targetSlot, rule.action]);
          if (staticallyDelivered.has(routeKey)) continue;
          deliver(rule, targetSlot, target);
          staticallyDelivered.add(routeKey);
        }
      }
    }

    // Send a compose event to an iframe (mcp-compose protocol).
    function sendComposeEvent(iframe, targetSlot, action, data, sourceSlot) {
      iframe.contentWindow?.postMessage({
        jsonrpc: '2.0',
        method: COMPOSE_METHOD,
        params: { action, data, sourceSlot, sharedContext }
      }, targetOriginForSlot(targetSlot));
    }

    function sendInitialToolResult(slot, source) {
      const config = getSlotConfig(slot);
      if (!config?.hasInitialToolResult || initialResultsDelivered.has(slot)) return;

      initialResultsDelivered.add(slot);
      post(source, {
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: config.initialToolResult
      }, targetOriginForSlot(slot));
    }

    function allowsMcpMethod(config, method) {
      return ((method === 'tools/call' || method === 'tools/list') &&
          config?.serverTools === true) ||
        ((method === 'resources/read' || method === 'resources/list') &&
          config?.serverResources === true);
    }

    async function relayMcpRequest(source, slot, message) {
      const config = getSlotConfig(slot);
      const targetOrigin = targetOriginForSlot(slot);
      if (!allowsMcpMethod(config, message.method) || !config?.rpcEndpoint) {
        respondError(
          source,
          message.id,
          -32601,
          '[mcp-compose] ' + message.method + ' is not available for slot ' + slot,
          targetOrigin,
        );
        return;
      }

      try {
        const response = await fetch(config.rpcEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            method: message.method,
            params: message.params
          })
        });

        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error('local MCP proxy returned a non-JSON response');
        }

        if (!response.ok) {
          const detail = payload?.error?.message || 'HTTP ' + response.status;
          throw new Error('local MCP proxy failed: ' + detail);
        }

        if (!payload || payload.jsonrpc !== '2.0' ||
          (!Object.prototype.hasOwnProperty.call(payload, 'result') &&
            !Object.prototype.hasOwnProperty.call(payload, 'error'))) {
          throw new Error('local MCP proxy returned an invalid JSON-RPC response');
        }

        // The browser keeps the original request id authoritative, even if a
        // faulty proxy echoes another id. It prevents one slot from resolving
        // an unrelated pending App request.
        if (Object.prototype.hasOwnProperty.call(payload, 'error')) {
          post(source, { jsonrpc: '2.0', id: message.id, error: payload.error }, targetOrigin);
        } else {
          post(source, { jsonrpc: '2.0', id: message.id, result: payload.result }, targetOrigin);
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        respondError(source, message.id, -32603, '[mcp-compose] ' + detail, targetOrigin);
      }
    }

    // Listen for messages from child UIs. Every supported method is bound to
    // an iframe WindowProxy first; messages from arbitrary windows never get
    // host capabilities or local MCP access.
    window.addEventListener('message', (event) => {
      const message = event.data;

      // Skip non-object messages silently (browser extensions, etc.)
      if (!message || typeof message !== 'object') return;

      if (message.jsonrpc !== '2.0') {
        if (message.method || hasRequestId(message)) {
          console.warn('[mcp-compose] Malformed JSON-RPC message (missing jsonrpc: "2.0"):', message);
        }
        return;
      }

      const sourceSlot = getSlotBySource(event.source);
      if (sourceSlot < 0) {
        if (message.method || hasRequestId(message)) {
          console.warn('[mcp-compose] Ignoring message from an unknown iframe:', message.method);
        }
        return;
      }

      // A WindowProxy persists across iframe navigations. Bind it to the
      // configured child origin as well, otherwise a navigated document could
      // inherit this slot's local proxy and initial result capability.
      const sourceConfig = getSlotConfig(sourceSlot);
      if (sourceConfig?.expectedOrigin && event.origin !== sourceConfig.expectedOrigin) {
        console.warn('[mcp-compose] Ignoring message with an unexpected iframe origin:', event.origin);
        return;
      }

      const targetOrigin = targetOriginForSlot(sourceSlot);

      if (message.method === 'ui/initialize') {
        if (!hasRequestId(message)) {
          console.warn('[mcp-compose] ui/initialize must be a JSON-RPC request');
          return;
        }

        const advertisedCatalog = message.params?.appCapabilities?.experimental?.[
          COMPONENT_CAPABILITY
        ];
        const catalog = validComponentCatalog(advertisedCatalog);
        if (catalog) componentCatalogs.set(sourceSlot, catalog);
        const hostContext = hostContextForSlot(sourceSlot);
        lastHostContexts.set(sourceSlot, JSON.stringify(hostContext));
        respond(event.source, message.id, {
          protocolVersion: '${MCP_APPS_PROTOCOL_VERSION}',
          hostInfo: { name: 'mcp-compose', version: '${COMPOSE_VERSION}' },
          hostCapabilities: getHostCapabilities(sourceSlot),
          hostContext
        }, targetOrigin);
        initializationResponded.add(sourceSlot);
        return;
      }

      if (message.method === 'ui/notifications/initialized') {
        // The MCP Apps SDK emits this only after its initialize response was
        // accepted. Sending the initial tool result any earlier races its
        // event-handler registration.
        if (!initializationResponded.has(sourceSlot)) {
          console.warn('[mcp-compose] Ignoring initialized notification before ui/initialize');
          return;
        }
        sendInitialToolResult(sourceSlot, event.source);
        ackIfRequested(event.source, message, targetOrigin);
        return;
      }

      if (message.method === 'ui/message') {
        // Compose ne livre aucun message au modèle : ne jamais acquitter un faux succès.
        if (hasRequestId(message)) {
          respondError(event.source, message.id, -32601, '[mcp-compose] ui/message is not supported', targetOrigin);
        }
        return;
      }

      if (message.method === 'ui/request-display-mode') {
        // Composite panels remain inline. We acknowledge the request rather
        // than advertising a richer display-mode host capability we do not
        // implement.
        if (hasRequestId(message)) {
          respond(event.source, message.id, { mode: 'inline' }, targetOrigin);
        }
        return;
      }

      if (message.method === 'ui/notifications/size-changed') {
        // Layout CSS owns the panel dimensions. Accept the notification (and
        // tolerate an id from non-conforming clients) without making a size
        // capability claim.
        console.debug('[mcp-compose] UI size changed for slot', sourceSlot, message.params);
        ackIfRequested(event.source, message, targetOrigin);
        return;
      }

      if (
        message.method === 'tools/call' || message.method === 'tools/list' ||
        message.method === 'resources/read' || message.method === 'resources/list'
      ) {
        if (!hasRequestId(message)) {
          console.warn('[mcp-compose] ' + message.method + ' must be a JSON-RPC request');
          return;
        }
        void relayMcpRequest(event.source, sourceSlot, message);
        return;
      }

      if (message.method === COMPOSE_METHOD) {
        const eventType = message.params?.event;

        if (!eventType || typeof eventType !== 'string') {
          console.warn('[mcp-compose] ui/compose/event missing or invalid event name:', message);
          return;
        }

        routeEvent(sourceSlot, eventType, (rule, targetSlot, target) => {
          sendComposeEvent(target, targetSlot, rule.action, message.params.data, sourceSlot);
        });

        ackIfRequested(event.source, message, targetOrigin);
        return;
      }

      if (message.method) {
        console.warn('[mcp-compose] Unknown method:', message.method);
      }
    });
    window.addEventListener('resize', () => {
      for (const slot of iframes.keys()) sendHostContextChanged(slot);
    });
    ${tabSwitchingCode}
  `;
}

/**
 * Serialize data for an inline script without allowing a value such as
 * `</script>` to terminate the script element. MCP results are JSON values;
 * this guard preserves those values while making their HTML embedding safe.
 */
function serializeForInlineScript(value: unknown): string {
  const json = JSON.stringify(value) ?? "null";
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
