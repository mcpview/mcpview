import { createTranslator, type TranslatorSelector } from "./i18n.ts";
import type { ContextBasketLabels } from "./preact/context-basket.tsx";

/** Interface text only; selection labels and group summaries remain caller data. */
export const CONTEXT_BASKET_MESSAGES_EN = {
  active: "Active context",
  items: "Context items",
  remove: "Remove {label} from context",
  clearAll: "Clear context",
  pending: "Updating context…",
  error: "Context update failed",
  retry: "Retry",
  evicted: "Removed oldest item: {label}",
} as const;

export type ContextBasketMessages = {
  readonly [Key in keyof typeof CONTEXT_BASKET_MESSAGES_EN]: string;
};

export const CONTEXT_BASKET_MESSAGES_FR: ContextBasketMessages = {
  active: "Contexte actif",
  items: "Éléments du contexte",
  remove: "Retirer {label} du contexte",
  clearAll: "Vider le contexte",
  pending: "Mise à jour du contexte…",
  error: "Échec de la mise à jour du contexte",
  retry: "Réessayer",
  evicted: "Élément le plus ancien retiré : {label}",
};

export const contextBasketMessages: TranslatorSelector<keyof ContextBasketMessages> =
  createTranslator({
    messages: CONTEXT_BASKET_MESSAGES_EN,
    translations: { fr: CONTEXT_BASKET_MESSAGES_FR },
  });

/** Optional EN/FR kit labels. Pass your own labels to customize any interface text. */
export function contextBasketLabels(locale?: string): ContextBasketLabels {
  const t = contextBasketMessages(locale);
  return {
    active: t("active"),
    items: t("items"),
    clearAll: t("clearAll"),
    pending: t("pending"),
    error: t("error"),
    retry: t("retry"),
    remove: (label) => t("remove", { label }),
    evicted: (label) => t("evicted", { label }),
  };
}
