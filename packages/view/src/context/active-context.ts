/**
 * Contexte actif partagé avec le modèle.
 *
 * Un viewer peut désigner quelques points comme contexte actif. Chaque mise à
 * jour remplace le snapshot complet en un appel ; elle ne déclenche jamais de
 * message et ne contient aucune consigne destinée au modèle.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

interface EmbeddedResourceBlock {
  type: "resource";
  resource: {
    uri: string;
    mimeType: string;
    blob: string;
  };
}

export type ActiveContextContentBlock = TextBlock | EmbeddedResourceBlock;

interface ContextModalities {
  text?: unknown;
  resource?: unknown;
  structuredContent?: unknown;
}

export interface ActiveContextHostCapabilities {
  updateModelContext?: ContextModalities;
}

export interface ActiveContextHost {
  getHostCapabilities(): ActiveContextHostCapabilities | undefined;
  updateModelContext(params: {
    content?: ActiveContextContentBlock[];
    structuredContent?: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Ressource binaire locale, jamais sérialisée dans le snapshot métier. */
export interface ActiveContextLocalResource {
  uri: string;
  mimeType: string;
  bytes: Uint8Array;
  /**
   * Repli JSON/texte optionnel pour un hôte acceptant `text` sans `resource`.
   * Jamais dérivé des octets : une pièce jointe binaire n'en a pas.
   */
  textFallback?: string;
  kind?: "derived" | "attachment";
}

export interface ContextSelectionField {
  label: string;
  value: string;
}

/** Point unique choisi par l'utilisateur dans un viewer. */
export interface ContextSelectionItem {
  /** Identité stable dans la vue, jamais un prompt. */
  id: string;
  /** Titre de la vue qui donne sa provenance au point. */
  view: string;
  /** Identité interne du niveau qui réconcilie ce point, jamais sérialisée. */
  reconcileKey?: string;
  /** Libellé visible du point. */
  label: string;
  /** Valeur visible associée, si elle existe. */
  value?: string;
  fields?: ContextSelectionField[];
  ref?: Record<string, unknown>;
  query?: Record<string, unknown>;
  /** Application-owned metadata, never serialized. */
  metadata?: unknown;
  /**
   * Pièce jointe locale. Omettre conserve la pièce jointe déjà chargée ;
   * fournir explicitement undefined invalide une ressource dérivée obsolète.
   */
  resource?: ActiveContextLocalResource;
}

/** Provenance interne : elle sert à ne réconcilier que la racine rafraîchie. */
export interface ActiveContextSelection {
  scopeKey: string;
  item: ContextSelectionItem;
}

/** Mutation locale rejouable du panier, utilisée pour annuler un seul clic. */
export interface ActiveContextMutation {
  id: number;
  active: boolean;
  /** Vrai tant que l'arbitre de clic peut encore demander son annulation. */
  reversible: boolean;
  apply: (
    current: readonly ActiveContextSelection[],
  ) => ActiveContextSelection[];
}

export interface ActiveContextAddResult {
  selections: ActiveContextSelection[];
  /** Point sorti de la borne, null lors d'une simple actualisation. */
  evicted: ActiveContextSelection | null;
}

export type ActiveContextSnapshotItem = Pick<
  ContextSelectionItem,
  "id" | "view" | "label" | "value" | "fields" | "ref" | "query"
>;

export interface ActiveContextSnapshot extends Record<string, unknown> {
  schema: string;
  version: number;
  items: ActiveContextSnapshotItem[];
}

export type ActiveContextResult =
  | "shared"
  | "cleared"
  | "unsupported"
  | "error"
  | "superseded";

export interface ActiveContextError {
  code:
    | "invalid-snapshot"
    | "resource-too-large"
    | "host-rejection"
    | "transport-error"
    | "timeout";
  message: string;
}
export interface ActiveContextWriteResult {
  result: ActiveContextResult;
  error?: ActiveContextError;
}

type ContextModality = "structuredContent" | "text";

export interface ActiveContextQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ActiveContextMutationCompaction {
  base: ActiveContextSelection[];
  mutations: ActiveContextMutation[];
}

function advertised(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function contextModality(
  caps: ActiveContextHostCapabilities | undefined,
): ContextModality | null {
  if (advertised(caps?.updateModelContext?.structuredContent)) {
    return "structuredContent";
  }
  if (advertised(caps?.updateModelContext?.text)) return "text";
  return null;
}

/** L'hôte sait remplacer le panier actif sous une modalité sûre. */
export function canReplaceActiveContext(
  caps: ActiveContextHostCapabilities | undefined,
): boolean {
  return contextModality(caps) !== null;
}

/** Application-owned wire identity, memory bounds and document membership. */
export interface ActiveContextPolicyConfig {
  schema: string;
  version: number;
  maxItems: number;
  compactUpTo?: number;
  referenceUpTo?: number;
  /** Callbacks project app data; the core always applies its closed wire bounds. */
  compact?: (item: ContextSelectionItem) => ContextSelectionItem;
  reference?: (item: ContextSelectionItem) => ContextSelectionItem;
  /** Required when maxItems permits selections above referenceUpTo. */
  query?: (items: readonly ContextSelectionItem[]) => ContextSelectionItem;
  maxSnapshotBytes?: number;
  onFull?: "evict-oldest" | "reject";
  resourcePolicy?: "latest" | "none";
  refresh?: (
    current: ContextSelectionItem,
    candidate: ContextSelectionItem,
  ) => ContextSelectionItem;
  maxResourceBytes: number;
  maxTextFallbackBytes: number;
  limits: {
    id: number;
    view: number;
    label: number;
    value: number;
    fields?: number;
    fieldLabel?: number;
    fieldValue?: number;
    resourceUri: number;
    resourceMimeType: number;
  };
  /** Identifies the closed subset refreshed by reconcileDocument. */
  documentContains?: (documentId: string, itemId: string) => boolean;
}

/** Bound original context operations; keep this object stable for a viewer. */
export interface ActiveContextPolicy {
  readonly config: Readonly<ActiveContextPolicyConfig>;
  ACTIVE_CONTEXT_SCHEMA: string;
  ACTIVE_CONTEXT_VERSION: number;
  ACTIVE_CONTEXT_MAX_ITEMS: number;
  ACTIVE_CONTEXT_MAX_RESOURCE_BYTES: number;
  ACTIVE_CONTEXT_MAX_TEXT_FALLBACK_BYTES: number;
  ACTIVE_CONTEXT_LIMITS: ActiveContextPolicyConfig["limits"];
  canReplaceActiveContext(
    caps: ActiveContextHostCapabilities | undefined,
  ): boolean;
  canShareActiveContextResource(
    caps: ActiveContextHostCapabilities | undefined,
    resource: ActiveContextLocalResource | undefined,
  ): boolean;
  reconcileActiveContextItem(
    current: ContextSelectionItem,
    candidates: readonly ContextSelectionItem[],
  ): ContextSelectionItem | null;
  sameActiveContextItem(
    left: ContextSelectionItem,
    right: ContextSelectionItem,
  ): boolean;
  sameActiveContextSelections(
    left: readonly ActiveContextSelection[],
    right: readonly ActiveContextSelection[],
  ): boolean;
  addActiveContextSelectionWithEviction(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    item: ContextSelectionItem,
  ): ActiveContextAddResult;
  addActiveContextSelection(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    item: ContextSelectionItem,
  ): ActiveContextSelection[];
  activeContextSelectionsForScope(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
  ): ActiveContextSelection[];
  removeActiveContextSelection(
    current: readonly ActiveContextSelection[],
    target: ActiveContextSelection,
  ): ActiveContextSelection[];
  replayActiveContextMutations(
    mutations: readonly ActiveContextMutation[],
    base?: readonly ActiveContextSelection[],
  ): ActiveContextSelection[];
  compactActiveContextMutations(
    base: readonly ActiveContextSelection[],
    mutations: readonly ActiveContextMutation[],
  ): ActiveContextMutationCompaction;
  reconcileActiveContextSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[];
  reconcileActiveContextViewSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    reconcileKey: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[];
  reconcileActiveContextDocumentSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    documentId: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[];
  createActiveContextQueue(): ActiveContextQueue;
  activeContextSnapshot(
    items: readonly ContextSelectionItem[],
  ): ActiveContextSnapshot;
  activeContextJsonResource(
    uri: string,
    payload: unknown,
  ): ActiveContextLocalResource;
  replaceActiveContext(
    host: ActiveContextHost,
    items: readonly ContextSelectionItem[],
  ): Promise<ActiveContextResult>;
  clearActiveContext(host: ActiveContextHost): Promise<ActiveContextResult>;
  writeActiveContext(
    host: ActiveContextHost,
    items: readonly ContextSelectionItem[],
  ): Promise<ActiveContextWriteResult>;
}

/**
 * Bind application-specific serialization and bounds without changing the
 * acknowledged selection, resource, reconciliation or write-queue algorithms.
 * No application schema or numeric limits are assumed by the shared core.
 */
export function createActiveContextPolicy(
  config: ActiveContextPolicyConfig,
): ActiveContextPolicy {
  if (typeof config.schema !== "string" || config.schema.trim().length === 0) {
    throw new TypeError("Active context schema is empty");
  }
  for (
    const [name, value] of Object.entries({
      version: config.version,
      maxItems: config.maxItems,
      maxResourceBytes: config.maxResourceBytes,
      maxTextFallbackBytes: config.maxTextFallbackBytes,
      id: config.limits?.id,
      view: config.limits?.view,
      label: config.limits?.label,
      value: config.limits?.value,
      resourceUri: config.limits?.resourceUri,
      resourceMimeType: config.limits?.resourceMimeType,
    })
  ) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Active context ${name} must be a positive safe integer`);
    }
  }
  if (config.documentContains !== undefined && typeof config.documentContains !== "function") {
    throw new TypeError("Active context documentContains must be a function");
  }
  const compactUpTo = config.compactUpTo ?? 3;
  const referenceUpTo = config.referenceUpTo ?? 8;
  const maxSnapshotBytes = config.maxSnapshotBytes ?? 8192;
  for (const value of [compactUpTo, referenceUpTo, maxSnapshotBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("Invalid projection bound");
  }
  if (compactUpTo > referenceUpTo) throw new TypeError("compactUpTo exceeds referenceUpTo");
  if (config.maxItems > referenceUpTo && !config.query) {
    throw new TypeError("A query callback is required above referenceUpTo");
  }
  for (const key of ["fields", "fieldLabel", "fieldValue"] as const) {
    const value = config.limits[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new TypeError(`Invalid ${key} bound`);
    }
  }
  if (config.onFull && !["evict-oldest", "reject"].includes(config.onFull)) {
    throw new TypeError("Invalid onFull policy");
  }
  if (config.resourcePolicy && !["latest", "none"].includes(config.resourcePolicy)) {
    throw new TypeError("Invalid resource policy");
  }
  // Snapshot the configuration: later app mutations cannot change wire safety.
  config = { ...config, limits: { ...config.limits } };
  const ACTIVE_CONTEXT_SCHEMA = config.schema;
  const ACTIVE_CONTEXT_VERSION = config.version;
  const ACTIVE_CONTEXT_MAX_ITEMS = config.maxItems;
  const ACTIVE_CONTEXT_MAX_RESOURCE_BYTES = config.maxResourceBytes;
  const ACTIVE_CONTEXT_MAX_TEXT_FALLBACK_BYTES = config.maxTextFallbackBytes;
  const ACTIVE_CONTEXT_LIMITS = { ...config.limits };
  const documentContains = config.documentContains;

  function hasControlCharacter(value: string): boolean {
    for (const character of value) {
      const codePoint = character.codePointAt(0) ?? 0;
      if (codePoint <= 0x1f || codePoint === 0x7f) return true;
    }
    return false;
  }

  function validResourceUri(uri: string): boolean {
    const normalized = uri.trim();
    return normalized.length > 0 &&
      normalized.length <= ACTIVE_CONTEXT_LIMITS.resourceUri &&
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized) &&
      !hasControlCharacter(normalized);
  }

  function validResourceMimeType(mimeType: string): boolean {
    const normalized = mimeType.trim();
    const baseType = normalized.split(";", 1)[0].trim();
    return normalized.length <= ACTIVE_CONTEXT_LIMITS.resourceMimeType &&
      /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(baseType) &&
      !hasControlCharacter(normalized);
  }

  function validLocalResource(
    resource: ActiveContextLocalResource | undefined,
  ): resource is ActiveContextLocalResource {
    return resource !== undefined && resource.bytes instanceof Uint8Array &&
      resource.bytes.byteLength > 0 &&
      resource.bytes.byteLength <= ACTIVE_CONTEXT_MAX_RESOURCE_BYTES &&
      validResourceUri(resource.uri) && validResourceMimeType(resource.mimeType);
  }

  /** Vrai seulement si modalité, ressource et bornes mémoire sont toutes valides. */
  function canShareActiveContextResource(
    caps: ActiveContextHostCapabilities | undefined,
    resource: ActiveContextLocalResource | undefined,
  ): boolean {
    return config.resourcePolicy !== "none" && contextModality(caps) !== null &&
      advertised(caps?.updateModelContext?.resource) &&
      validLocalResource(resource);
  }

  function rejected(result: unknown): boolean {
    return typeof result === "object" && result !== null &&
      "isError" in result && result.isError === true;
  }

  /** Trouve la version courante du même point, ou null s'il a disparu. */
  function reconcileActiveContextItem(
    current: ContextSelectionItem,
    candidates: readonly ContextSelectionItem[],
  ): ContextSelectionItem | null {
    return candidates.find((candidate) => candidate.id === current.id) ?? null;
  }

  /** Vrai si la provenance et la valeur visibles n'ont pas changé. */
  function sameActiveContextItem(
    left: ContextSelectionItem,
    right: ContextSelectionItem,
  ): boolean {
    return left.id === right.id && left.view === right.view &&
      left.reconcileKey === right.reconcileKey &&
      left.label === right.label && left.value === right.value &&
      sameJson(left.fields, right.fields) &&
      sameJson(left.ref, right.ref) &&
      sameJson(left.query, right.query) &&
      left.metadata === right.metadata &&
      sameLocalResource(left.resource, right.resource);
  }

  function sameJson(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function sameLocalResource(
    left: ActiveContextLocalResource | undefined,
    right: ActiveContextLocalResource | undefined,
  ): boolean {
    if (left === right) return true;
    if (
      !left || !right || left.uri !== right.uri ||
      left.mimeType !== right.mimeType || left.kind !== right.kind ||
      left.textFallback !== right.textFallback ||
      left.bytes.byteLength !== right.bytes.byteLength
    ) return false;
    if (left.bytes === right.bytes) return true;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index]) return false;
    }
    return true;
  }

  function withoutLocalResource(
    item: ContextSelectionItem,
  ): ContextSelectionItem {
    const { resource: _resource, ...snapshotItem } = item;
    return snapshotItem;
  }

  function selectionWithoutLocalResource(
    selection: ActiveContextSelection,
  ): ActiveContextSelection {
    return selection.item.resource
      ? { ...selection, item: withoutLocalResource(selection.item) }
      : selection;
  }

  function normalizeSelectionResources(
    selections: readonly ActiveContextSelection[],
  ): ActiveContextSelection[] {
    let newestValidResourceIndex = -1;
    for (let index = selections.length - 1; index >= 0; index -= 1) {
      if (config.resourcePolicy !== "none" && validLocalResource(selections[index].item.resource)) {
        newestValidResourceIndex = index;
        break;
      }
    }
    return selections.map((selection, index) =>
      index === newestValidResourceIndex ? selection : selectionWithoutLocalResource(selection)
    );
  }

  function sameSelection(
    left: ActiveContextSelection,
    right: ActiveContextSelection,
  ): boolean {
    return left.scopeKey === right.scopeKey &&
      sameActiveContextItem(left.item, right.item);
  }

  function sameActiveContextSelections(
    left: readonly ActiveContextSelection[],
    right: readonly ActiveContextSelection[],
  ): boolean {
    return left.length === right.length &&
      left.every((selection, index) => sameSelection(selection, right[index]));
  }

  /**
   * Ajoute ou actualise un point de la racine courante. Un point réactivé devient
   * le plus récent ; au-delà de la borne, le plus ancien sort du snapshot.
   */
  function addActiveContextSelectionWithEviction(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    item: ContextSelectionItem,
  ): ActiveContextAddResult {
    if (item.resource && config.resourcePolicy !== "none") {
      if (
        item.resource.bytes instanceof Uint8Array &&
        item.resource.bytes.byteLength > ACTIVE_CONTEXT_MAX_RESOURCE_BYTES
      ) {
        throw Object.assign(new TypeError("Context resource exceeds configured byte bound"), {
          code: "resource-too-large",
        });
      }
      if (!validLocalResource(item.resource)) throw new TypeError("Invalid context resource");
    }
    if (
      config.onFull === "reject" && current.length >= ACTIVE_CONTEXT_MAX_ITEMS &&
      !current.some((s) => s.scopeKey === scopeKey && s.item.id === item.id)
    ) {
      throw new TypeError("Active context selection is full");
    }
    const normalizedCurrent = normalizeSelectionResources(current);
    const previousItem = normalizedCurrent.find((selection) =>
      selection.scopeKey === scopeKey && selection.item.id === item.id
    )?.item;
    const incomingResource = validLocalResource(item.resource) ? item.resource : undefined;
    const invalidatedResource = "resource" in item && item.resource === undefined;
    const retainedResource = incomingResource ??
      (invalidatedResource ? undefined : previousItem?.resource);
    const normalizedItem = item.resource === retainedResource ? item : {
      ...withoutLocalResource(item),
      ...(retainedResource ? { resource: retainedResource } : {}),
    };
    const next = normalizedCurrent
      .filter((selection) => selection.scopeKey !== scopeKey || selection.item.id !== item.id)
      .map((selection) => incomingResource ? selectionWithoutLocalResource(selection) : selection);
    next.push({ scopeKey, item: normalizedItem });
    const overflow = Math.max(0, next.length - ACTIVE_CONTEXT_MAX_ITEMS);
    return {
      selections: next.slice(-ACTIVE_CONTEXT_MAX_ITEMS),
      evicted: overflow > 0 ? next[overflow - 1] : null,
    };
  }

  function addActiveContextSelection(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    item: ContextSelectionItem,
  ): ActiveContextSelection[] {
    return addActiveContextSelectionWithEviction(current, scopeKey, item)
      .selections;
  }

  /** Isole la racine courante avant un remplacement : deux scopes ne se mélangent jamais. */
  function activeContextSelectionsForScope(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
  ): ActiveContextSelection[] {
    return normalizeSelectionResources(
      current.filter((selection) => selection.scopeKey === scopeKey),
    );
  }

  /** Retire exactement un point, sans toucher aux autres racines. */
  function removeActiveContextSelection(
    current: readonly ActiveContextSelection[],
    target: ActiveContextSelection,
  ): ActiveContextSelection[] {
    return normalizeSelectionResources(
      current.filter((selection) =>
        selection.scopeKey !== target.scopeKey ||
        selection.item.id !== target.item.id
      ),
    );
  }

  /**
   * Rejoue les mutations confirmées dans leur ordre. Désactiver une entrée puis
   * rejouer le journal annule cette opération précise sans restaurer un ancien
   * snapshot qui écraserait les clics plus récents.
   */
  function replayActiveContextMutations(
    mutations: readonly ActiveContextMutation[],
    base: readonly ActiveContextSelection[] = [],
  ): ActiveContextSelection[] {
    let current: ActiveContextSelection[] = base.slice();
    for (const mutation of mutations) {
      if (mutation.active) current = mutation.apply(current);
    }
    return current;
  }

  /**
   * Plie le préfixe qui ne peut plus être annulé dans un snapshot borné. Les
   * closures — et leurs éventuelles ressources binaires — sortent ainsi du
   * journal dès la fin de la fenêtre de double-clic.
   */
  function compactActiveContextMutations(
    base: readonly ActiveContextSelection[],
    mutations: readonly ActiveContextMutation[],
  ): ActiveContextMutationCompaction {
    const firstReversible = mutations.findIndex((mutation) => mutation.reversible);
    const compactCount = firstReversible === -1 ? mutations.length : firstReversible;
    if (compactCount === 0) {
      return { base: base.slice(), mutations: mutations.slice() };
    }
    return {
      base: replayActiveContextMutations(
        mutations.slice(0, compactCount),
        base,
      ),
      mutations: mutations.slice(compactCount),
    };
  }

  /**
   * Actualise uniquement les points de `scopeKey`. Les autres racines restent
   * intactes ; dans la racine rafraîchie, un id absent est retiré.
   */
  function reconcileActiveContextSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[] {
    return reconcileActiveContextSelectionSubset(
      current,
      scopeKey,
      candidates,
      () => true,
    );
  }

  /**
   * Réconcilie uniquement les points produits par une vue nommée.
   *
   * Une racine et ses niveaux imbriqués partagent le même `scopeKey`, mais pas
   * nécessairement le même jeu de données. Un refresh du chart racine ne doit
   * donc jamais supprimer les sélections d'une liste ou d'une fiche ouverte.
   */
  function reconcileActiveContextViewSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    reconcileKey: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[] {
    const itemReconcileKey = (item: ContextSelectionItem) => item.reconcileKey;
    return reconcileActiveContextSelectionSubset(
      current,
      scopeKey,
      candidates.filter((candidate) => itemReconcileKey(candidate) === reconcileKey),
      (id) =>
        current.some((selection) =>
          selection.scopeKey === scopeKey && selection.item.id === id &&
          itemReconcileKey(selection.item) === reconcileKey
        ),
    );
  }

  /**
   * Réconcilie une seule fiche dans une racine de liste.
   *
   * La politique de l'application délimite le sous-ensemble de la fiche : les
   * éléments disparus en sortent, tandis que les autres fiches et pièces jointes
   * déjà sélectionnées dans la même racine restent intactes.
   */
  function reconcileActiveContextDocumentSelections(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    documentId: string,
    candidates: readonly ContextSelectionItem[],
  ): ActiveContextSelection[] {
    if (!documentContains) {
      throw new TypeError("Active context reconcileDocument requires documentContains");
    }
    const belongsToDocument = (id: string) => documentContains(documentId, id);
    return reconcileActiveContextSelectionSubset(
      current,
      scopeKey,
      candidates.filter((candidate) => belongsToDocument(candidate.id)),
      belongsToDocument,
    );
  }

  function reconcileActiveContextSelectionSubset(
    current: readonly ActiveContextSelection[],
    scopeKey: string,
    candidates: readonly ContextSelectionItem[],
    belongsToSubset: (id: string) => boolean,
  ): ActiveContextSelection[] {
    const byId = new Map(
      candidates.map((candidate) => [candidate.id, candidate]),
    );
    const next: ActiveContextSelection[] = [];
    let changed = false;

    for (const selection of current) {
      if (
        selection.scopeKey !== scopeKey ||
        !belongsToSubset(selection.item.id)
      ) {
        next.push(selection);
        continue;
      }
      const candidate = byId.get(selection.item.id);
      if (!candidate) {
        changed = true;
        continue;
      }
      const fresh = config.refresh ? config.refresh(selection.item, candidate) : candidate;
      const refreshedItem = selection.item.resource && !("resource" in fresh)
        ? { ...fresh, resource: selection.item.resource }
        : fresh;
      const refreshed = { scopeKey, item: refreshedItem };
      if (!sameSelection(selection, refreshed)) changed = true;
      next.push(refreshed);
    }

    const normalized = normalizeSelectionResources(next);
    if (normalized.some((selection, index) => selection !== next[index])) {
      changed = true;
    }

    return changed ? normalized : current.slice();
  }

  /**
   * Sérialise les remplacements : une ancienne réponse lente ne peut ainsi
   * repasser après un clic plus récent dans le contexte distant.
   */
  function createActiveContextQueue(): ActiveContextQueue {
    let tail: Promise<void> = Promise.resolve();
    return {
      run<T>(operation: () => Promise<T>): Promise<T> {
        const result = tail.then(operation, operation);
        tail = result.then(() => undefined, () => undefined);
        return result;
      },
    };
  }

  function boundText(value: string, limit: number): string {
    if (typeof value !== "string") throw new TypeError("Context text must be a string");
    const normalized = value.replace(/[\n\r\t]/g, " ").replace(/\p{Cc}/gu, "")
      .replace(/\s+/gu, " ").trim();
    const points = Array.from(normalized);
    return points.length > limit ? points.slice(0, limit - 1).join("") + "…" : normalized;
  }

  function boundRequired(value: string, field: "id" | "view" | "label"): string {
    // Identity must remain tool-resolvable: never truncate or normalize it.
    if (field === "id") {
      if (
        typeof value !== "string" || !value.trim() || hasControlCharacter(value) ||
        Array.from(value).length > ACTIVE_CONTEXT_LIMITS.id
      ) {
        throw new TypeError("Invalid active context id");
      }
      return value;
    }
    const normalized = boundText(value, ACTIVE_CONTEXT_LIMITS[field]);
    if (!normalized) throw new TypeError(`Active context ${field} is empty`);
    return normalized;
  }

  function boundItem(item: ContextSelectionItem): ActiveContextSnapshotItem {
    const value = item.value === undefined
      ? undefined
      : boundText(item.value, ACTIVE_CONTEXT_LIMITS.value);
    const fields = item.fields?.length ? item.fields : undefined;
    if (
      fields && (!ACTIVE_CONTEXT_LIMITS.fields || !ACTIVE_CONTEXT_LIMITS.fieldLabel ||
        !ACTIVE_CONTEXT_LIMITS.fieldValue)
    ) throw new TypeError("Compact field bounds are required");
    return {
      id: boundRequired(item.id, "id"),
      view: boundRequired(item.view, "view"),
      label: boundRequired(item.label, "label"),
      ...(value ? { value } : {}),
      ...(fields
        ? {
          fields: fields.slice(0, ACTIVE_CONTEXT_LIMITS.fields).map((field) => ({
            label: boundText(field.label, ACTIVE_CONTEXT_LIMITS.fieldLabel!),
            value: boundText(field.value, ACTIVE_CONTEXT_LIMITS.fieldValue!),
          })),
        }
        : {}),
      ...(item.ref === undefined ? {} : { ref: closedJson(item.ref) }),
      ...(item.query === undefined ? {} : { query: closedJson(item.query) }),
    };
  }

  function closedJson(value: Record<string, unknown>): Record<string, unknown> {
    // App callbacks own the domain schema. Reject non-JSON values, cycles and
    // excessive payloads instead of silently changing query meaning.
    const seen = new Set<object>();
    function visit(node: unknown, depth: number): void {
      if (depth > 20) throw new TypeError("Context payload nesting exceeds bound");
      if (node === null || typeof node === "boolean") return;
      if (typeof node === "number" && Number.isFinite(node)) return;
      if (typeof node === "string") {
        if (new TextEncoder().encode(node).byteLength > maxSnapshotBytes) {
          throw new TypeError("Context payload too large");
        }
        return;
      }
      if (typeof node !== "object" || seen.has(node)) {
        throw new TypeError("Context payload must be JSON");
      }
      if (!Array.isArray(node) && Object.getPrototypeOf(node) !== Object.prototype) {
        throw new TypeError("Context payload must be plain JSON");
      }
      seen.add(node);
      for (const child of Object.values(node)) visit(child, depth + 1);
      seen.delete(node);
    }
    visit(value, 0);
    const json = JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > maxSnapshotBytes) {
      throw new TypeError("Context payload too large");
    }
    return JSON.parse(json);
  }

  function activeContextSnapshot(items: readonly ContextSelectionItem[]): ActiveContextSnapshot {
    if (items.length > ACTIVE_CONTEXT_MAX_ITEMS) {
      throw new TypeError("Selection exceeds configured capacity");
    }
    let projected: readonly ContextSelectionItem[];
    if (items.length > referenceUpTo) {
      if (!config.query) throw new TypeError("Query callback missing");
      projected = [config.query(items)];
      if (!projected[0]?.query) throw new TypeError("Query callback must return one query item");
    } else if (items.length > compactUpTo) {
      projected = items.map((item) => {
        const reference = config.reference ? config.reference(item) : item;
        const { fields: _fields, query: _query, ...rest } = reference;
        return rest;
      });
    } else projected = items.map((item) => config.compact ? config.compact(item) : item);
    const snapshot: ActiveContextSnapshot = {
      schema: ACTIVE_CONTEXT_SCHEMA,
      version: ACTIVE_CONTEXT_VERSION,
      items: projected.map(boundItem),
    };
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > maxSnapshotBytes) {
      throw new TypeError("Active context snapshot exceeds byte bound");
    }
    return snapshot;
  }

  function activeLocalResource(
    items: readonly ContextSelectionItem[],
  ): ActiveContextLocalResource | undefined {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const resource = items[index].resource;
      if (resource && resource.kind !== "derived") return resource;
    }
    return items.length === 1 ? items[0].resource : undefined;
  }

  function bytesToBase64(bytes: Uint8Array): string {
    // Multiple-of-three chunks concatenate without intermediate base64 padding.
    const chunkSize = 3 * 8192;
    const encoded: string[] = [];
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      let binary = "";
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      for (let index = offset; index < end; index += 1) {
        binary += String.fromCharCode(bytes[index]);
      }
      encoded.push(btoa(binary));
    }
    return encoded.join("");
  }

  function embeddedResource(
    resource: ActiveContextLocalResource,
  ): EmbeddedResourceBlock {
    if (!validLocalResource(resource)) {
      throw new TypeError("Active context resource is invalid or too large");
    }
    return {
      type: "resource",
      resource: {
        uri: resource.uri.trim(),
        mimeType: resource.mimeType.trim(),
        blob: bytesToBase64(resource.bytes),
      },
    };
  }

  function textualResourceMime(mimeType: string): boolean {
    const baseType = mimeType.trim().split(";", 1)[0].trim().toLowerCase();
    return baseType === "application/json" || baseType.startsWith("text/");
  }

  function boundTextFallback(
    resource: ActiveContextLocalResource | undefined,
  ): string | undefined {
    if (!resource || typeof resource.textFallback !== "string") return undefined;
    if (!validResourceMimeType(resource.mimeType)) return undefined;
    if (!textualResourceMime(resource.mimeType)) return undefined;
    if (resource.textFallback.length === 0) return undefined;
    const size = new TextEncoder().encode(resource.textFallback).byteLength;
    if (size === 0 || size > ACTIVE_CONTEXT_MAX_TEXT_FALLBACK_BYTES) {
      return undefined;
    }
    return resource.textFallback;
  }

  /** Ressource JSON locale, avec repli texte seulement sous la borne. */
  function activeContextJsonResource(
    uri: string,
    payload: unknown,
  ): ActiveContextLocalResource {
    const text = JSON.stringify(payload);
    if (typeof text !== "string" || text.length === 0) {
      throw new TypeError("Active context JSON resource is empty");
    }
    const bytes = new TextEncoder().encode(text);
    return {
      uri,
      mimeType: "application/json",
      bytes,
      ...(bytes.byteLength <= ACTIVE_CONTEXT_MAX_TEXT_FALLBACK_BYTES ? { textFallback: text } : {}),
    };
  }

  /**
   * Remplace le contexte du viewer par le panier complet en un seul appel.
   *
   * Le contenu structuré est préféré. Si l'hôte n'accepte que le texte, le même
   * snapshot JSON est envoyé tel quel : aucune phrase impérative n'est ajoutée.
   */
  async function writeActiveContext(
    host: ActiveContextHost,
    items: readonly ContextSelectionItem[],
  ): Promise<ActiveContextWriteResult> {
    const capabilities = host.getHostCapabilities();
    const modality = contextModality(capabilities);
    if (!modality) return { result: "unsupported" };

    let sending = false;
    try {
      const activeItems = items;
      const snapshot = activeContextSnapshot(activeItems);
      const resource = config.resourcePolicy === "none"
        ? undefined
        : activeLocalResource(activeItems);
      if (
        resource && advertised(capabilities?.updateModelContext?.resource) &&
        resource.bytes.byteLength > ACTIVE_CONTEXT_MAX_RESOURCE_BYTES
      ) {
        return {
          result: "error",
          error: {
            code: "resource-too-large",
            message: "Context resource exceeds configured byte bound",
          },
        };
      }
      const resourceBlock = resource &&
          advertised(capabilities?.updateModelContext?.resource)
        ? embeddedResource(resource)
        : undefined;
      const textAdvertised = advertised(capabilities?.updateModelContext?.text);
      const contentAdvertised = textAdvertised ||
        advertised(capabilities?.updateModelContext?.resource);
      const textFallback = !resourceBlock && textAdvertised
        ? boundTextFallback(resource)
        : undefined;
      const supplementalContent: ActiveContextContentBlock[] = resourceBlock
        ? [resourceBlock]
        : textFallback
        ? [{ type: "text", text: textFallback }]
        : [];
      const params = modality === "structuredContent"
        ? {
          structuredContent: snapshot,
          ...(contentAdvertised ? { content: supplementalContent } : {}),
        }
        : {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(snapshot),
            },
            ...supplementalContent,
          ],
        };
      sending = true;
      const result = await host.updateModelContext(params);
      return rejected(result)
        ? {
          result: "error",
          error: { code: "host-rejection", message: "The host rejected the context update" },
        }
        : { result: items.length ? "shared" : "cleared" };
    } catch (cause) {
      return {
        result: "error",
        error: {
          // SDK 1.x ErrorCode.RequestTimeout is -32001. Classification only:
          // never race an uncancellable write with a library-owned timer.
          code: sending && typeof cause === "object" && cause !== null &&
              (("code" in cause && cause.code === -32001) ||
                ("name" in cause && cause.name === "TimeoutError"))
            ? "timeout"
            : sending
            ? "transport-error"
            : "invalid-snapshot",
          message: cause instanceof Error ? cause.message : String(cause),
        },
      };
    }
  }

  async function replaceActiveContext(
    host: ActiveContextHost,
    items: readonly ContextSelectionItem[],
  ): Promise<ActiveContextResult> {
    return (await writeActiveContext(host, items)).result;
  }

  /** Clearing sends the application's canonical empty snapshot. */
  async function clearActiveContext(host: ActiveContextHost): Promise<ActiveContextResult> {
    return (await writeActiveContext(host, [])).result;
  }

  return {
    config: Object.freeze({ ...config, limits: Object.freeze({ ...config.limits }) }),
    ACTIVE_CONTEXT_SCHEMA,
    ACTIVE_CONTEXT_VERSION,
    ACTIVE_CONTEXT_MAX_ITEMS,
    ACTIVE_CONTEXT_MAX_RESOURCE_BYTES,
    ACTIVE_CONTEXT_MAX_TEXT_FALLBACK_BYTES,
    ACTIVE_CONTEXT_LIMITS,
    canReplaceActiveContext,
    canShareActiveContextResource,
    reconcileActiveContextItem,
    sameActiveContextItem,
    sameActiveContextSelections,
    addActiveContextSelectionWithEviction,
    addActiveContextSelection,
    activeContextSelectionsForScope,
    removeActiveContextSelection,
    replayActiveContextMutations,
    compactActiveContextMutations,
    reconcileActiveContextSelections,
    reconcileActiveContextViewSelections,
    reconcileActiveContextDocumentSelections,
    createActiveContextQueue,
    activeContextSnapshot,
    activeContextJsonResource,
    replaceActiveContext,
    clearActiveContext,
    writeActiveContext,
  };
}
