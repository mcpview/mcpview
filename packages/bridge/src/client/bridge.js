/**
 * MCP Apps Bridge — Client-side runtime.
 *
 * Injected by the resource server into MCP App HTML pages.
 * Intercepts postMessage calls from the MCP App class, routes them
 * to the resource server via WebSocket, and dispatches responses
 * back as MessageEvents.
 *
 * Query parameters (set by the resource server on the <script> tag):
 *   - platform: platform runtime identifier
 *   - session: session ID created by the resource server
 *   - auth: "1" when the server requires WebSocket auth
 *
 * @module bridge.js
 */
(function () {
  "use strict";

  var currentScript = document.currentScript;
  if (!currentScript) {
    console.error("[bridge.js] Cannot find own <script> element.");
    return;
  }

  var scriptUrl = new URL(currentScript.src);
  var PLATFORM = scriptUrl.searchParams.get("platform") || "generic";
  var SESSION_ID = scriptUrl.searchParams.get("session");
  var AUTH_REQUIRED = scriptUrl.searchParams.get("auth") === "1";
  var DEBUG = scriptUrl.searchParams.get("debug") === "1";

  if (!SESSION_ID) {
    console.error("[bridge.js] Missing 'session' query parameter.");
    return;
  }

  var WS_BASE = scriptUrl.origin;
  var WS_URL = WS_BASE.replace(/^http/, "ws") + "/bridge?session=" + SESSION_ID;

  function log() {
    if (DEBUG) {
      console.log.apply(
        console,
        ["[bridge.js]"].concat(Array.prototype.slice.call(arguments)),
      );
    }
  }

  function isJsonRpc(msg) {
    return msg && typeof msg === "object" && msg.jsonrpc === "2.0";
  }

  function isRequest(msg) {
    return "method" in msg && "id" in msg;
  }

  function isResponse(msg) {
    return ("result" in msg || "error" in msg) && "id" in msg;
  }

  function getTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (_err) {
      return "UTC";
    }
  }

  function getPreferredTheme() {
    try {
      return window.matchMedia &&
          window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch (_err) {
      return "light";
    }
  }

  function buildGenericHostContext(platformType) {
    var nav = window.navigator || {};
    return {
      theme: getPreferredTheme(),
      styles: { variables: {} },
      platform: platformType || "web",
      locale: nav.language,
      timeZone: getTimeZone(),
      containerDimensions: {
        width: typeof window.innerWidth === "number"
          ? window.innerWidth
          : undefined,
        height: typeof window.innerHeight === "number"
          ? window.innerHeight
          : undefined,
      },
    };
  }

  function createGenericRuntime(name) {
    return {
      name: name || "generic",
      getHostContext: function () {
        return buildGenericHostContext(
          window.parent === window ? "web" : "mobile",
        );
      },
      buildAuthMessage: function () {
        return null;
      },
      openLink: function (url) {
        window.open(url, "_blank");
      },
      onReady: function () {},
      subscribeLifecycle: function (emitHostContextChanged) {
        var media = null;
        var themeHandler = function () {
          var ctx = buildGenericHostContext(
            window.parent === window ? "web" : "mobile",
          );
          emitHostContextChanged({ theme: ctx.theme, styles: ctx.styles });
        };
        var resizeHandler = function () {
          emitHostContextChanged({
            containerDimensions: {
              width: typeof window.innerWidth === "number"
                ? window.innerWidth
                : undefined,
              height: typeof window.innerHeight === "number"
                ? window.innerHeight
                : undefined,
            },
          });
        };

        window.addEventListener("resize", resizeHandler);

        if (window.matchMedia) {
          media = window.matchMedia("(prefers-color-scheme: dark)");
          if (typeof media.addEventListener === "function") {
            media.addEventListener("change", themeHandler);
          } else if (typeof media.addListener === "function") {
            media.addListener(themeHandler);
          }
        }

        return function () {
          window.removeEventListener("resize", resizeHandler);
          if (!media) return;
          if (typeof media.removeEventListener === "function") {
            media.removeEventListener("change", themeHandler);
          } else if (typeof media.removeListener === "function") {
            media.removeListener(themeHandler);
          }
        };
      },
    };
  }

  function getTelegramWebApp() {
    return window.Telegram && window.Telegram.WebApp
      ? window.Telegram.WebApp
      : null;
  }

  function buildTelegramHostContext() {
    var tg = getTelegramWebApp();
    if (!tg) {
      return buildGenericHostContext("mobile");
    }

    var themeParams = tg.themeParams || {};
    var variables = {};
    var keys = Object.keys(themeParams);
    for (var i = 0; i < keys.length; i++) {
      variables["--tg-" + keys[i].replace(/_/g, "-")] = themeParams[keys[i]];
    }

    return {
      theme: tg.colorScheme === "dark" ? "dark" : "light",
      styles: { variables: variables },
      platform: "mobile",
      locale: tg.initDataUnsafe && tg.initDataUnsafe.user
        ? tg.initDataUnsafe.user.language_code
        : (window.navigator && window.navigator.language),
      timeZone: getTimeZone(),
      containerDimensions: {
        width: typeof window.innerWidth === "number"
          ? window.innerWidth
          : undefined,
        height: tg.viewportStableHeight || window.innerHeight || undefined,
      },
    };
  }

  function createTelegramRuntime() {
    var generic = createGenericRuntime("telegram");
    return {
      name: "telegram",
      getHostContext: buildTelegramHostContext,
      buildAuthMessage: function () {
        var tg = getTelegramWebApp();
        if (!tg || !tg.initData) {
          return null;
        }
        return {
          type: "auth",
          platform: "telegram",
          payload: { initData: tg.initData },
          initData: tg.initData,
        };
      },
      openLink: function (url) {
        var tg = getTelegramWebApp();
        if (tg && typeof tg.openLink === "function") {
          tg.openLink(url);
          return;
        }
        generic.openLink(url);
      },
      onReady: function () {
        var tg = getTelegramWebApp();
        if (!tg) return;
        if (typeof tg.ready === "function") {
          tg.ready();
        }
        if (!tg.isExpanded && typeof tg.expand === "function") {
          tg.expand();
        }
      },
      subscribeLifecycle: function (emitHostContextChanged) {
        var tg = getTelegramWebApp();
        if (!tg || typeof tg.onEvent !== "function") {
          return generic.subscribeLifecycle(emitHostContextChanged);
        }

        var themeHandler = function () {
          var ctx = buildTelegramHostContext();
          emitHostContextChanged({ theme: ctx.theme, styles: ctx.styles });
        };
        var viewportHandler = function () {
          emitHostContextChanged({
            containerDimensions: {
              width: typeof window.innerWidth === "number"
                ? window.innerWidth
                : undefined,
              height: tg.viewportStableHeight || window.innerHeight ||
                undefined,
            },
          });
        };

        tg.onEvent("themeChanged", themeHandler);
        tg.onEvent("viewportChanged", viewportHandler);

        return function () {
          if (typeof tg.offEvent !== "function") return;
          tg.offEvent("themeChanged", themeHandler);
          tg.offEvent("viewportChanged", viewportHandler);
        };
      },
    };
  }

  function getLiffSdk() {
    return window.liff || null;
  }

  function createLineRuntime() {
    var generic = createGenericRuntime("line");
    return {
      name: "line",
      getHostContext: function () {
        var ctx = buildGenericHostContext("mobile");
        return {
          theme: ctx.theme,
          styles: ctx.styles,
          platform: "mobile",
          locale: ctx.locale,
          timeZone: ctx.timeZone,
          containerDimensions: ctx.containerDimensions,
        };
      },
      buildAuthMessage: function () {
        var liff = getLiffSdk();
        if (!liff || typeof liff.getAccessToken !== "function") {
          return null;
        }
        var accessToken = liff.getAccessToken();
        if (!accessToken) {
          return null;
        }
        return {
          type: "auth",
          platform: "line",
          payload: { accessToken: accessToken },
          accessToken: accessToken,
        };
      },
      openLink: function (url) {
        generic.openLink(url);
      },
      onReady: function () {},
      subscribeLifecycle: generic.subscribeLifecycle,
    };
  }

  var platformFactories = {
    telegram: createTelegramRuntime,
    line: createLineRuntime,
  };

  var platformRuntime = platformFactories[PLATFORM]
    ? platformFactories[PLATFORM]()
    : createGenericRuntime(PLATFORM);

  var pendingRequests = {};
  var REQUEST_TIMEOUT_MS = 30000;
  var appInitialized = false;
  var earlyNotifications = [];
  var ws = null;
  var reconnectAttempts = 0;
  var MAX_RECONNECT = 5;
  var authenticated = !AUTH_REQUIRED;

  function trackRequest(id) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        delete pendingRequests[id];
        reject(
          new Error(
            "Request " + id + " timed out after " + REQUEST_TIMEOUT_MS + "ms",
          ),
        );
      }, REQUEST_TIMEOUT_MS);

      pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };
    });
  }

  function resolveRequest(id, result) {
    var entry = pendingRequests[id];
    if (entry) {
      clearTimeout(entry.timer);
      delete pendingRequests[id];
      entry.resolve(result);
    }
  }

  function rejectRequest(id, error) {
    var entry = pendingRequests[id];
    if (entry) {
      clearTimeout(entry.timer);
      delete pendingRequests[id];
      entry.reject(error);
    }
  }

  var _realPostMessage = window.postMessage.bind(window);
  var originalPostMessage = window.parent !== window
    ? window.parent.postMessage.bind(window.parent)
    : null;

  function dispatchToApp(message) {
    log(
      "-> App:",
      message.method || ("id" in message ? "response#" + message.id : "?"),
    );
    _realPostMessage(message, scriptUrl.origin);
  }

  function queueOrDispatchNotification(message) {
    if (!appInitialized) {
      log("Queueing notification:", message.method);
      earlyNotifications.push(message);
      return;
    }
    dispatchToApp(message);
  }

  function emitHostContextChanged(params) {
    queueOrDispatchNotification({
      jsonrpc: "2.0",
      method: "ui/notifications/host-context-changed",
      params: params,
    });
  }

  function dispatchReady(detail) {
    window.dispatchEvent(
      new CustomEvent("mcp-bridge-ready", {
        detail: Object.assign(
          { platform: PLATFORM, session: SESSION_ID },
          detail || {},
        ),
      }),
    );
  }

  function dispatchAuthError(errorMessage) {
    window.dispatchEvent(
      new CustomEvent("mcp-bridge-auth-error", {
        detail: { error: errorMessage },
      }),
    );
  }

  function handleInitialize(requestId) {
    var hostCtx = platformRuntime.getHostContext();
    var response = {
      jsonrpc: "2.0",
      id: requestId,
      result: {
        protocolVersion: "2025-11-25",
        hostInfo: {
          name: "@mcpview/bridge",
          version: "0.2.0",
        },
        hostCapabilities: {
          serverTools: { listChanged: false },
          serverResources: { listChanged: false },
          logging: {},
          openLinks: {},
        },
        hostContext: hostCtx,
      },
    };

    dispatchToApp(response);
    appInitialized = true;

    if (earlyNotifications.length > 0) {
      log("Flushing", earlyNotifications.length, "early notification(s)");
      for (var i = 0; i < earlyNotifications.length; i++) {
        dispatchToApp(earlyNotifications[i]);
      }
      earlyNotifications = [];
    }
  }

  function connectWs() {
    log("Connecting to", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = function () {
      log("WebSocket connected");
      reconnectAttempts = 0;
      authenticated = !AUTH_REQUIRED;
      platformRuntime.onReady();

      if (!AUTH_REQUIRED) {
        dispatchReady();
        return;
      }

      var authMessage = platformRuntime.buildAuthMessage
        ? platformRuntime.buildAuthMessage()
        : null;

      if (!authMessage) {
        dispatchAuthError(
          "Authentication required but no auth payload is available for platform " +
            PLATFORM + ".",
        );
        return;
      }

      log("Sending auth for platform", PLATFORM);
      ws.send(JSON.stringify(authMessage));
    };

    ws.onmessage = function (event) {
      try {
        var msg = JSON.parse(event.data);

        if (msg && msg.type === "auth_ok") {
          authenticated = true;
          dispatchReady({
            principalId: msg.principalId,
            userId: msg.userId,
            username: msg.username,
          });
          return;
        }

        if (msg && msg.type === "auth_error") {
          console.error("[bridge.js] Authentication failed:", msg.error);
          dispatchAuthError(msg.error);
          return;
        }

        if (!isJsonRpc(msg)) return;

        if (isResponse(msg)) {
          if ("error" in msg) {
            rejectRequest(msg.id, msg.error);
          } else {
            resolveRequest(msg.id, msg.result);
          }
          return;
        }

        if ("method" in msg && !("id" in msg)) {
          queueOrDispatchNotification(msg);
        }
      } catch (err) {
        console.warn("[bridge.js] Failed to parse WS message:", err);
      }
    };

    ws.onclose = function () {
      log("WebSocket disconnected");
      ws = null;
      authenticated = false;
      if (reconnectAttempts < MAX_RECONNECT) {
        reconnectAttempts++;
        var delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000);
        log("Reconnecting in", delay, "ms (attempt", reconnectAttempts + ")");
        setTimeout(connectWs, delay);
      }
    };

    ws.onerror = function () {
      log("WebSocket error");
    };
  }

  function sendToServer(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn(
        "[bridge.js] WebSocket not connected. Dropping message:",
        message,
      );
      return;
    }
    if (AUTH_REQUIRED && !authenticated) {
      console.warn(
        "[bridge.js] Not authenticated yet. Dropping message:",
        message,
      );
      return;
    }
    ws.send(JSON.stringify(message));
  }

  function interceptPostMessage() {
    if (window.parent === window) {
      log("Intercepting window.postMessage (standalone mode)");
      var origSelf = window.postMessage.bind(window);
      window.postMessage = function (message, targetOrigin, transfer) {
        if (isJsonRpc(message)) {
          handleOutgoing(message);
        } else {
          origSelf(message, targetOrigin, transfer);
        }
      };
      return;
    }

    log("Intercepting window.parent.postMessage (iframe mode)");
    window.parent.postMessage = function (message, targetOrigin, transfer) {
      if (isJsonRpc(message)) {
        handleOutgoing(message);
      } else if (originalPostMessage) {
        originalPostMessage(message, targetOrigin, transfer);
      }
    };
  }

  function handleOutgoing(message) {
    log("<- App:", message.method || "response");

    if (message.method === "ui/initialize" && "id" in message) {
      handleInitialize(message.id);
      return;
    }

    if (message.method === "ui/open-link" && "id" in message) {
      var url = message.params && message.params.url;
      if (url) {
        platformRuntime.openLink(url);
      }
      dispatchToApp({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }

    sendToServer(message);

    if (isRequest(message)) {
      trackRequest(message.id)
        .then(function (result) {
          dispatchToApp({ jsonrpc: "2.0", id: message.id, result: result });
        })
        .catch(function (err) {
          dispatchToApp({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32603, message: err.message || String(err) },
          });
        });
    }
  }

  interceptPostMessage();
  platformRuntime.subscribeLifecycle(emitHostContextChanged);
  connectWs();

  log(
    "Bridge initialized for",
    PLATFORM,
    "(auth required:",
    AUTH_REQUIRED + ")",
  );
})();
