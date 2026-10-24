import {
  type ActiveContextHost,
  type ActiveContextPolicyConfig,
  type ContextSelectionItem,
} from "../active-context.ts";
export const config: ActiveContextPolicyConfig = {
  schema: "example.parts/context",
  version: 7,
  maxItems: 100,
  maxResourceBytes: 20,
  maxTextFallbackBytes: 8,
  maxSnapshotBytes: 8192,
  limits: {
    id: 80,
    view: 20,
    label: 20,
    value: 20,
    resourceUri: 80,
    resourceMimeType: 40,
    fields: 2,
    fieldLabel: 10,
    fieldValue: 10,
  },
  compact: (item) => item,
  reference: (item) => ({ ...item, value: item.value }),
  query: (items) => ({
    id: "selection-query",
    view: "Parts",
    label: `${items.length} parts`,
    query: { tool: "parts_list", ids: items.map((item) => item.id) },
  }),
};
export function item(id: string, group = "parts"): ContextSelectionItem {
  return {
    id,
    view: "Parts",
    label: `Part ${id}`,
    value: "ready",
    fields: [{ label: "Status", value: "ready" }],
    reconcileKey: group,
  };
}
export function host(modalities: Record<string, unknown> = { structuredContent: {} }) {
  const calls: Parameters<ActiveContextHost["updateModelContext"]>[0][] = [];
  const app: ActiveContextHost = {
    getHostCapabilities: () => ({ updateModelContext: modalities }),
    updateModelContext: (params) => {
      calls.push(params);
      return Promise.resolve({});
    },
  };
  return { app, calls };
}
