/**
 * Result-driven MCP App lifecycle over one component registry.
 *
 * Import as `@mcpview/components/surface`. This entry carries the
 * `@mcpview/view` App runtime (ext-apps); the package root stays free of it.
 *
 * @module
 */

export { startSurfaceApp, SurfaceAppError } from "./src/surface-app.ts";
export type {
  SurfaceAppContext,
  SurfaceAppErrorCode,
  SurfaceAppHandle,
  SurfaceAppOptions,
  SurfaceAppRuntime,
  SurfaceAppState,
  SurfaceDisplayState,
  SurfaceHostAccess,
  SurfaceLabel,
  SurfaceMessageKind,
  SurfaceProjection,
  SurfaceStatus,
  SurfaceStatusTone,
  SurfaceToolResult,
  SurfaceViewerSession,
} from "./src/surface-app.ts";
