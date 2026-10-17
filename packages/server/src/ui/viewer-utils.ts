/**
 * MCP Apps Viewer Utilities
 *
 * Shared functions for resolving viewer dist paths and discovering
 * viewer directories. Used by registerViewers() and the build pipeline.
 *
 * @module lib/server/src/ui/viewer-utils
 */

/** Directories to skip during auto-discovery */
const SKIP_DIRS = new Set([
  "shared",
  "dist",
  "node_modules",
  ".cache",
  ".vite",
]);

/**
 * Convert a file:// URL to a filesystem path.
 * Handles Windows drive letters and UNC paths.
 */
function fileUrlToPath(url: URL): string {
  const decoded = decodeURIComponent(url.pathname);
  // Windows: /C:/path → C:/path
  if (/^\/[A-Za-z]:\//.test(decoded)) return decoded.slice(1);
  // UNC: //host/share
  if (url.host.length > 0) return `//${url.host}${decoded}`;
  return decoded;
}

/**
 * Resolve the dist path for a viewer's built index.html.
 *
 * Checks two candidate locations relative to the module URL:
 * 1. ./src/ui/dist/{viewerName}/index.html (Deno dev)
 * 2. ./ui-dist/{viewerName}/index.html     (npm package)
 *
 * @param moduleUrl - import.meta.url of the consumer's server.ts
 * @param viewerName - Viewer directory name (e.g. "invoice-viewer")
 * @param exists - Function to check if a path exists (injectable for tests)
 * @returns Absolute path to index.html, or null if not found
 */
export function resolveViewerDistPath(
  moduleUrl: string,
  viewerName: string,
  exists: (path: string) => boolean,
): string | null {
  // When consumed from JSR or any remote registry, import.meta.url is an
  // HTTPS URL. fileUrlToPath() only handles file:// — passing an HTTPS URL
  // produces a broken UNC-like path ("//jsr.io/..."). Return the raw resolved
  // URL string instead; the caller's exists/readFile callbacks are responsible
  // for handling remote URLs (e.g., via fetch()).
  if (moduleUrl.startsWith("https://") || moduleUrl.startsWith("http://")) {
    const candidates = [
      new URL(`./src/ui/dist/${viewerName}/index.html`, moduleUrl).href,
      new URL(`./ui-dist/${viewerName}/index.html`, moduleUrl).href,
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) return candidate;
    }
    return null;
  }

  const candidates = [
    fileUrlToPath(new URL(`./src/ui/dist/${viewerName}/index.html`, moduleUrl)),
    fileUrlToPath(new URL(`./ui-dist/${viewerName}/index.html`, moduleUrl)),
  ];

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }

  return null;
}

/** Minimal entry returned by a directory reader */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** Injectable filesystem operations for discoverViewers */
export interface DiscoverViewersFS {
  readDir: (path: string) => DirEntry[];
  hasIndexHtml: (uiDir: string, viewerName: string) => boolean;
}

/**
 * Auto-discover viewer directories inside a UI root folder.
 *
 * A viewer is a directory that:
 * - Is not in the skip list (shared, dist, node_modules, .cache, .vite)
 * - Does not start with "."
 * - Contains an index.html file
 *
 * @param uiDir - Absolute path to the UI root directory
 * @param fs - Injectable filesystem operations
 * @returns Sorted array of viewer names
 */
export function discoverViewers(
  uiDir: string,
  fs: DiscoverViewersFS,
): string[] {
  const entries = fs.readDir(uiDir);
  const viewers: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (!fs.hasIndexHtml(uiDir, entry.name)) continue;
    viewers.push(entry.name);
  }

  return viewers.sort();
}
