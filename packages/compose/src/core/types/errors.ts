/**
 * Structured error types with machine-readable codes.
 *
 * @module types/errors
 */

/**
 * Error codes for mcp-compose operations.
 *
 * @example
 * ```typescript
 * import { ErrorCode } from "@mcpview/compose";
 *
 * if (issue.code === ErrorCode.ORPHAN_SYNC_REFERENCE) {
 *   console.log("Sync rule references unknown tool:", issue.message);
 * }
 * ```
 */
export enum ErrorCode {
  /** A sync rule references a tool name not present in collected resources. */
  ORPHAN_SYNC_REFERENCE = "ORPHAN_SYNC_REFERENCE",
  /** A sync rule creates a circular route (from === to). */
  CIRCULAR_SYNC_RULE = "CIRCULAR_SYNC_RULE",
  /** Invalid layout value. */
  INVALID_LAYOUT = "INVALID_LAYOUT",
  /** Tool result does not contain valid UI metadata. */
  NO_UI_METADATA = "NO_UI_METADATA",
  /** Missing required resourceUri in UI metadata. */
  MISSING_RESOURCE_URI = "MISSING_RESOURCE_URI",
  /** No resources provided to composer. */
  EMPTY_RESOURCES = "EMPTY_RESOURCES",
}

/**
 * Structured validation issue.
 *
 * @example
 * ```typescript
 * const issue: ValidationIssue = {
 *   code: ErrorCode.ORPHAN_SYNC_REFERENCE,
 *   message: 'Sync rule references unknown tool "unknown:tool"',
 *   path: "sync[0].from",
 * };
 * ```
 */
export interface ValidationIssue {
  /** Machine-readable error code. */
  code: ErrorCode;

  /** Human-readable description. */
  message: string;

  /** Path to the problematic value (e.g., `"sync[0].from"`). */
  path?: string;
}

/**
 * Result of sync rule validation.
 *
 * @example
 * ```typescript
 * const result: ValidationResult = {
 *   valid: false,
 *   issues: [{ code: ErrorCode.ORPHAN_SYNC_REFERENCE, message: "..." }],
 * };
 * ```
 */
export interface ValidationResult {
  /** Whether all rules are valid. */
  valid: boolean;

  /** List of validation issues found. */
  issues: ValidationIssue[];
}
