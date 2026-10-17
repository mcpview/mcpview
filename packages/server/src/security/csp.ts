/**
 * Content Security Policy helpers for MCP Apps HTML resources.
 *
 * Provides CSP header generation and HTML meta tag injection to protect
 * against XSS and unauthorized resource loading in MCP App iframes.
 *
 * @module lib/server/security/csp
 */

/** Options for generating a CSP header value. */
export interface CspOptions {
  /** Additional allowed script sources (e.g. CDN URLs). */
  readonly scriptSources?: readonly string[];
  /** Additional allowed connect sources (e.g. WebSocket endpoints). */
  readonly connectSources?: readonly string[];
  /** Additional allowed image sources (e.g. tile servers). */
  readonly imgSources?: readonly string[];
  /** Additional allowed frame ancestors. */
  readonly frameAncestors?: readonly string[];
  /**
   * Allow `'unsafe-inline'` for scripts and styles (default: true).
   * MCP Apps typically need inline scripts/styles for single-file HTML UIs.
   */
  readonly allowInline?: boolean;
}

/**
 * Build a Content-Security-Policy header value.
 *
 * Uses `default-src 'none'` as the baseline (deny-all), then explicitly allows
 * only what MCP App UIs need. Inline scripts/styles are allowed by default
 * since MCP Apps are typically single-file HTML with inline code.
 *
 * @param options - CSP configuration
 * @returns CSP header value string
 */
export function buildCspHeader(options: CspOptions = {}): string {
  const allowInline = options.allowInline !== false;
  const inlineDirective = allowInline ? " 'unsafe-inline'" : "";

  const scriptSrc = [
    `'self'${inlineDirective}`,
    ...(options.scriptSources ?? []),
  ].join(" ");
  const connectSrc = ["'self'", ...(options.connectSources ?? [])].join(" ");
  const frameAncestors = ["'self'", ...(options.frameAncestors ?? [])].join(
    " ",
  );

  return [
    `default-src 'none'`,
    `script-src ${scriptSrc}`,
    `style-src 'self'${inlineDirective}`,
    `img-src 'self' data: ${(options.imgSources ?? []).join(" ")}`.trim(),
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `frame-ancestors ${frameAncestors}`,
    `base-uri 'self'`,
  ].join("; ");
}

/**
 * Inject a CSP meta tag into HTML content.
 *
 * Inserts `<meta http-equiv="Content-Security-Policy" content="...">` right
 * after the opening `<head>` tag. If no `<head>` tag exists, prepends to content.
 *
 * This provides CSP enforcement even when HTTP headers are unavailable
 * (e.g. STDIO transport where there are no HTTP response headers).
 *
 * @param html - Original HTML content
 * @param cspValue - CSP header value (from buildCspHeader)
 * @returns HTML with injected CSP meta tag
 */
export function injectCspMetaTag(html: string, cspValue: string): string {
  const escaped = cspValue.replace(/"/g, "&quot;");
  const metaTag =
    `<meta http-equiv="Content-Security-Policy" content="${escaped}">`;

  // Inject right after <head> (case-insensitive, handles attributes)
  const headMatch = html.match(/<head[^>]*>/i);
  if (headMatch && headMatch.index !== undefined) {
    const insertPos = headMatch.index + headMatch[0].length;
    return html.slice(0, insertPos) + metaTag + html.slice(insertPos);
  }

  // Fallback: prepend to content
  return metaTag + html;
}
