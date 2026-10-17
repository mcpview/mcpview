/**
 * Structured error base class for @mcpview/view.
 *
 * All errors thrown by the SDK extend this class with a stable `.code`
 * field (machine-parseable) and optional structured data. Agents and
 * tooling should match on `.code`, not on `.message`.
 *
 * @module
 */

export type MCPViewErrorCode =
  | "INVALID_CONFIG_ROOT"
  | "INVALID_CONFIG_VIEWS"
  | "INVALID_CONFIG_INITIAL_VIEW"
  | "ORPHAN_INITIAL_VIEW"
  | "MISSING_RENDER"
  | "MISSING_SERVER_TOOLS_CAPABILITY"
  | "MISSING_SAMPLING_CAPABILITY"
  | "INVALID_SAMPLE_ARGS"
  | "UNKNOWN_TOOL"
  | "HANDSHAKE_NO_CAPABILITIES"
  | "NO_PARENT_WINDOW"
  | "UNKNOWN_VIEW"
  | "ROUTER_NOT_INITIALIZED";

export interface MCPViewErrorData {
  readonly code: MCPViewErrorCode;
  readonly [key: string]: unknown;
}

export class MCPViewError extends Error {
  readonly code: MCPViewErrorCode;
  readonly data: Readonly<Record<string, unknown>>;

  constructor(
    code: MCPViewErrorCode,
    message: string,
    data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "MCPViewError";
    this.code = code;
    this.data = Object.freeze({ ...data });
  }
}
