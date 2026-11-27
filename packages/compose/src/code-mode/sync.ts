import { validateSyncRules } from "../core/sync/validator.ts";
import type { ViewComponentEventPorts } from "../core/types/components.ts";
import type { UiSyncRule } from "../core/types/sync-rules.ts";

/** App-only metadata for explicit, receipt-scoped Compose rules. */
export const SNIPPET_SYNC_META_KEY = "io.mcpview/snippet-sync";

export function isPortName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 &&
    value.trim() === value && value !== "*";
}

export function snippetPorts(
  events: Readonly<Record<string, ViewComponentEventPorts>> | undefined,
  name: string,
): ViewComponentEventPorts | undefined {
  if (!events || !Object.hasOwn(events, name)) return;
  return readSnippetEventPorts(events[name]);
}

export function readSnippetEventPorts(value: unknown): ViewComponentEventPorts | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const ports = value as Record<string, unknown>;
  const names = (values: unknown) =>
    Array.isArray(values) ? [...new Set(values.filter(isPortName))] : [];
  const emits = names(ports.emits);
  const accepts = names(ports.accepts);
  if (emits.length || accepts.length) return { emits, accepts };
}

export function parseSnippetSyncRule(value: unknown): UiSyncRule | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const fields = ["from", "event", "to", "action"];
  if (
    Object.keys(value).length !== fields.length || !fields.every((key) => Object.hasOwn(value, key))
  ) {
    return;
  }
  const { from, event, to, action } = value as Record<string, unknown>;
  if (!isPortName(from) || !isPortName(event) || !isPortName(to) || !isPortName(action)) return;
  return { from, event, to, action };
}

export function supportsSnippetSync(
  rule: UiSyncRule,
  panels: ReadonlyMap<string, ViewComponentEventPorts | undefined>,
): boolean {
  return validateSyncRules([rule], [rule.from, rule.to].filter((id) => panels.has(id))).valid &&
    panels.get(rule.from)?.emits?.includes(rule.event) === true &&
    panels.get(rule.to)?.accepts?.includes(rule.action) === true;
}

export function snippetSyncKey({ from, event, to, action }: UiSyncRule): string {
  return JSON.stringify([from, event, to, action]);
}
