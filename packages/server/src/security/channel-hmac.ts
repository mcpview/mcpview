/**
 * HMAC Channel Authentication — Inline Script for PostMessage (MCP Apps)
 *
 * Generates an inline `<script>` that signs outgoing JSON-RPC messages
 * from an iframe to its parent via PostMessage (HMAC-SHA256 + anti-replay).
 *
 * The HOST side is responsible for verifying incoming messages using
 * `MessageSigner.verify()`. This script only handles the IFRAME side
 * (signing outgoing).
 *
 * Part of @casys/mcp-server security module. See also:
 * - message-signer.ts (MessageSigner class, HMAC sign/verify)
 *
 * @module server/security/channel-hmac
 */

// ---------------------------------------------------------------------------
// Inline HMAC Script
// ---------------------------------------------------------------------------

/**
 * Generate the inline `<script>` tag for iframe HMAC signing.
 *
 * The script:
 * 1. Embeds the channel secret (invisible to other iframes due to cross-origin)
 * 2. Monkey-patches `window.parent.postMessage` to sign outgoing JSON-RPC
 *
 * Verification of incoming messages is the HOST's responsibility
 * (via `MessageSigner.verify()`), not the iframe's.
 *
 * @param secret - 64-char hex secret from MessageSigner.generateSecret()
 * @returns HTML `<script>` string ready for injection into `<head>`
 */
export function generateHmacScript(secret: string): string {
  return `
<script data-mcp-channel-auth>
(function() {
  'use strict';

  var SECRET_HEX = '${secret}';
  var sendSeq = 0;
  var cryptoKeyPromise = null;

  function hexToBytes(hex) {
    var bytes = new Uint8Array(hex.length / 2);
    for (var i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  function initKey() {
    if (cryptoKeyPromise) return cryptoKeyPromise;
    cryptoKeyPromise = crypto.subtle.importKey(
      'raw', hexToBytes(SECRET_HEX),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    return cryptoKeyPromise;
  }

  function buildPayload(msg, seq) {
    var id = msg.id != null ? msg.id : '';
    var method = msg.method || '';
    var body;
    if (msg.params !== undefined) body = JSON.stringify(msg.params);
    else if (msg.result !== undefined) body = JSON.stringify(msg.result);
    else if (msg.error !== undefined) body = JSON.stringify(msg.error);
    else body = '{}';
    return seq + ':' + id + ':' + method + ':' + body;
  }

  function signMessage(msg) {
    var seq = sendSeq++;
    var payload = buildPayload(msg, seq);
    return initKey().then(function(key) {
      return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    }).then(function(sig) {
      var signed = {};
      for (var k in msg) {
        if (Object.prototype.hasOwnProperty.call(msg, k)) signed[k] = msg[k];
      }
      signed._seq = seq;
      signed._hmac = bytesToHex(new Uint8Array(sig));
      return signed;
    });
  }

  // Monkey-patch outgoing postMessage (iframe -> parent)
  var realPostMessage = window.parent.postMessage.bind(window.parent);
  window.parent.postMessage = function(message, targetOrigin, transfer) {
    if (message && typeof message === 'object' && message.jsonrpc === '2.0') {
      signMessage(message).then(function(signed) {
        realPostMessage(signed, targetOrigin, transfer);
      }).catch(function(err) {
        console.error('[mcp-channel-auth] Sign error:', err);
      });
    } else {
      realPostMessage(message, targetOrigin, transfer);
    }
  };

  initKey();
})();
</script>
`;
}

/**
 * Inject channel authentication script into HTML content.
 *
 * Inserts the HMAC signing script before `</head>` (preferred) or at the start.
 * The injected script signs all outgoing JSON-RPC postMessages from the iframe.
 * The HOST must verify these signatures using `MessageSigner.verify()`.
 *
 * @param html - HTML content to inject into
 * @param secret - 64-char hex secret from MessageSigner.generateSecret()
 * @returns Modified HTML with HMAC signing script injected
 * @throws {Error} If secret is not a valid 64-char hex string
 */
export function injectChannelAuth(html: string, secret: string): string {
  if (!/^[0-9a-f]{64}$/.test(secret)) {
    throw new Error(
      "[injectChannelAuth] Invalid secret: expected 64-char lowercase hex string. " +
        "Use MessageSigner.generateSecret() to create one.",
    );
  }
  const script = generateHmacScript(secret);
  if (html.includes("</head>")) {
    return html.replace("</head>", script + "</head>");
  }
  return script + html;
}
