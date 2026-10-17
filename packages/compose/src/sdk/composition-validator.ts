/**
 * Composition validator — validates tool definitions with _meta.ui against sync rules.
 *
 * Performs both structural validation (delegated to core/sync/validator) and
 * semantic validation (emits/accepts coherence with sync rules).
 *
 * @module sdk/composition-validator
 */

import type { UiPortSyncRule, UiSyncRule } from "../core/types/sync-rules.ts";
import { validateSyncRules } from "../core/sync/validator.ts";
import type { UiMetaUi } from "./ui-meta-builder.ts";

/**
 * Issue codes for composition validation.
 *
 * Extends core ErrorCode with SDK-level semantic checks.
 */
export type CompositionIssueCode =
  | "ORPHAN_SYNC_REFERENCE"
  | "CIRCULAR_SYNC_RULE"
  | "ORPHAN_EMIT"
  | "ORPHAN_ACCEPT"
  | "PORT_SYNC_NO_COMPATIBLE_PEER"
  | "SYNC_EVENT_NOT_EMITTED"
  | "SYNC_ACTION_NOT_ACCEPTED";

/**
 * A composition validation issue.
 *
 * @example
 * ```typescript
 * const issue: CompositionIssue = {
 *   code: "ORPHAN_EMIT",
 *   message: 'Tool "erp:customers" emits "filterChanged" but no sync rule routes it',
 *   tool: "erp:customers",
 *   event: "filterChanged",
 * };
 * ```
 */
export interface CompositionIssue {
  /** Machine-readable issue code. */
  code: CompositionIssueCode;

  /** Human-readable description. */
  message: string;

  /** Tool name involved (if applicable). */
  tool?: string;

  /** Event or action name involved (if applicable). */
  event?: string;

  /** Path to the problematic value (for structural issues from core). */
  path?: string;
}

/**
 * Result of composition validation.
 */
export interface CompositionValidationResult {
  /** Whether the composition is valid (no issues). */
  valid: boolean;

  /** List of issues found. */
  issues: CompositionIssue[];
}

/**
 * Minimal shape of a tool definition with `_meta.ui`.
 */
interface ToolWithMeta {
  name: string;
  _meta: { ui: UiMetaUi };
}

/**
 * Validate a set of tool definitions against sync rules.
 *
 * Performs two levels of validation:
 * 1. **Structural** (via core `validateSyncRules`): unknown tool names, circular routes
 * 2. **Semantic**: emits/accepts coherence with sync rule events and actions
 *
 * Tools without `emits`/`accepts` declarations skip semantic checks — they are
 * treated as permissive for backwards compatibility.
 *
 * @param tools - Tool definitions with `_meta.ui` (from `uiMeta()`)
 * @param syncRules - Sync rules to validate against
 * @param portSyncRules - Dynamic policies resolved from active component ports
 * @returns Validation result with issues
 *
 * @example
 * ```typescript
 * import { uiMeta, validateComposition } from "@mcpview/compose";
 *
 * const tools = [
 *   { name: "erp:customers", ...uiMeta({ resourceUri: "ui://erp/customers", emits: ["rowSelected"] }) },
 *   { name: "viz:chart", ...uiMeta({ resourceUri: "ui://viz/chart", accepts: ["rowSelected"] }) },
 * ];
 * const syncRules = [
 *   { from: "erp:customers", event: "rowSelected", to: "viz:chart", action: "highlight" },
 * ];
 *
 * const result = validateComposition(tools, syncRules);
 * if (!result.valid) {
 *   for (const issue of result.issues) {
 *     console.warn(`[${issue.code}] ${issue.message}`);
 *   }
 * }
 * ```
 */
export function validateComposition(
  tools: ToolWithMeta[],
  syncRules: UiSyncRule[],
  portSyncRules: UiPortSyncRule[] = [],
): CompositionValidationResult {
  const issues: CompositionIssue[] = [];

  // 1. Structural validation via core
  const knownSources = tools.map((t) => t.name);
  const coreResult = validateSyncRules(syncRules, knownSources);
  for (const coreIssue of coreResult.issues) {
    issues.push({
      code: coreIssue.code as CompositionIssueCode,
      message: coreIssue.message,
      path: coreIssue.path,
    });
  }

  // Build lookup maps
  const toolByName = new Map<string, UiMetaUi>();
  for (const t of tools) {
    toolByName.set(t.name, t._meta.ui);
  }

  // Collect which emits/accepts are covered by sync rules
  const routedEmits = new Map<string, Set<string>>(); // toolName -> Set<event>
  const routedAccepts = new Map<string, Set<string>>(); // toolName -> Set<action>

  // 2. Semantic validation of sync rules against emits/accepts
  for (let i = 0; i < syncRules.length; i++) {
    const rule = syncRules[i];
    const sourceMeta = toolByName.get(rule.from);
    const targetMeta = rule.to !== "*" ? toolByName.get(rule.to) : undefined;

    // Check event is in source emits (only if source declares emits)
    if (sourceMeta?.emits) {
      if (!sourceMeta.emits.includes(rule.event)) {
        issues.push({
          code: "SYNC_EVENT_NOT_EMITTED",
          message:
            `Sync rule[${i}] event "${rule.event}" is not declared in emits of "${rule.from}"`,
          tool: rule.from,
          event: rule.event,
          path: `sync[${i}].event`,
        });
      }
    }

    // Check action is in target accepts (only if target declares accepts, skip broadcast)
    if (rule.to !== "*" && targetMeta?.accepts) {
      if (!targetMeta.accepts.includes(rule.action)) {
        issues.push({
          code: "SYNC_ACTION_NOT_ACCEPTED",
          message:
            `Sync rule[${i}] action "${rule.action}" is not declared in accepts of "${rule.to}"`,
          tool: rule.to,
          event: rule.action,
          path: `sync[${i}].action`,
        });
      }
    }

    // Track routed emits/accepts
    if (!routedEmits.has(rule.from)) routedEmits.set(rule.from, new Set());
    routedEmits.get(rule.from)!.add(rule.event);

    if (rule.to === "*") {
      // Broadcast: action covers all non-source tools
      for (const t of tools) {
        if (t.name !== rule.from) {
          if (!routedAccepts.has(t.name)) routedAccepts.set(t.name, new Set());
          routedAccepts.get(t.name)!.add(rule.action);
        }
      }
    } else {
      if (!routedAccepts.has(rule.to)) routedAccepts.set(rule.to, new Set());
      routedAccepts.get(rule.to)!.add(rule.action);
    }
  }

  // Dynamic policies connect every declaring source to every distinct
  // declaring target at runtime. Tool metadata makes that topology
  // inspectable before an iframe is opened; the component catalog confirms
  // it again during the Apps handshake.
  for (let i = 0; i < portSyncRules.length; i++) {
    const rule = portSyncRules[i];
    const sources = tools.filter((tool) => tool._meta.ui.emits?.includes(rule.event));
    const targets = tools.filter((tool) => tool._meta.ui.accepts?.includes(rule.action));
    const hasCompatiblePeer = sources.some((source) =>
      targets.some((target) => target.name !== source.name)
    );
    if (!hasCompatiblePeer) {
      issues.push({
        code: "PORT_SYNC_NO_COMPATIBLE_PEER",
        message:
          `Port sync[${i}] has no distinct tools declaring "${rule.event}" → "${rule.action}"`,
        event: rule.event,
        path: `portSync[${i}]`,
      });
      continue;
    }
    for (const source of sources) {
      if (!targets.some((target) => target.name !== source.name)) continue;
      if (!routedEmits.has(source.name)) routedEmits.set(source.name, new Set());
      routedEmits.get(source.name)!.add(rule.event);
    }
    for (const target of targets) {
      if (!sources.some((source) => source.name !== target.name)) continue;
      if (!routedAccepts.has(target.name)) routedAccepts.set(target.name, new Set());
      routedAccepts.get(target.name)!.add(rule.action);
    }
  }

  // 3. Orphan detection — emits/accepts with no sync rule routing them
  for (const t of tools) {
    const ui = t._meta.ui;

    if (ui.emits) {
      const routed = routedEmits.get(t.name) ?? new Set();
      for (const event of ui.emits) {
        if (!routed.has(event)) {
          issues.push({
            code: "ORPHAN_EMIT",
            message: `Tool "${t.name}" emits "${event}" but no sync rule routes it`,
            tool: t.name,
            event,
          });
        }
      }
    }

    if (ui.accepts) {
      const routed = routedAccepts.get(t.name) ?? new Set();
      for (const action of ui.accepts) {
        if (!routed.has(action)) {
          issues.push({
            code: "ORPHAN_ACCEPT",
            message: `Tool "${t.name}" accepts "${action}" but no sync rule targets it`,
            tool: t.name,
            event: action,
          });
        }
      }
    }
  }

  return { valid: issues.length === 0, issues };
}
