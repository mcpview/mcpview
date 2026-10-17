/** @jsxImportSource preact */
/** Generic, domain-neutral presentation shell for one semantic object. */

import type { ComposedSemanticRef } from "@mcpview/contracts";
import type { ComponentChildren, JSX, VNode } from "preact";
import { Card, type CardProps, type PresentationTone } from "./components.tsx";

export type SemanticElementDensity = "chip" | "row" | "card";

export interface SemanticListProps {
  readonly label: string;
  readonly scrollable?: boolean;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Bounded group for row-density semantic objects; it owns no domain ordering. */
export function SemanticList({
  label,
  scrollable = false,
  className,
  children,
}: SemanticListProps): JSX.Element {
  return (
    <div
      aria-label={label}
      class={classes("mcp-view-semantic-list", className)}
      data-scrollable={scrollable ? "true" : undefined}
      role="group"
    >
      {children}
    </div>
  );
}

export interface CollectionCardProps
  extends
    Pick<CardProps, "title" | "eyebrow" | "actions" | "className" | "children">,
    Pick<SemanticListProps, "label" | "scrollable"> {}

/** Card-hosted SemanticList that keeps a single outer border. */
export function CollectionCard({
  label,
  title,
  eyebrow,
  actions,
  scrollable = false,
  className,
  children,
}: CollectionCardProps): JSX.Element {
  return (
    <Card
      title={title}
      eyebrow={eyebrow}
      actions={actions}
      className={classes("mcp-view-collection-card", className)}
    >
      <SemanticList label={label} scrollable={scrollable}>
        {children}
      </SemanticList>
    </Card>
  );
}

export interface ElementIdentProps {
  readonly label: ComponentChildren;
  readonly detail?: ComponentChildren;
  readonly marker?: ComponentChildren;
  readonly className?: string;
}

/** Required human-facing identity slot. Its content is already resolved by the caller. */
export function ElementIdent({
  label,
  detail,
  marker,
  className,
}: ElementIdentProps): JSX.Element {
  return (
    <header class={classes("mcp-view-element-ident", className)} data-element-slot="ident">
      {isPresent(marker) && <span class="mcp-view-element-ident-marker">{marker}</span>}
      <span class="mcp-view-element-ident-copy">
        <strong class="mcp-view-element-ident-label">{label}</strong>
        {isPresent(detail) && <small class="mcp-view-element-ident-detail">{detail}</small>}
      </span>
    </header>
  );
}

export interface ElementReadingProps {
  readonly value: ComponentChildren;
  readonly label?: ComponentChildren;
  readonly unit?: ComponentChildren;
  readonly detail?: ComponentChildren;
  readonly className?: string;
}

/** Resolved measurement or documentary reading; no unit is guessed. */
export function ElementReading({
  value,
  label,
  unit,
  detail,
  className,
}: ElementReadingProps): JSX.Element {
  return (
    <div class={classes("mcp-view-element-reading", className)} data-element-slot="reading">
      {isPresent(label) && <span class="mcp-view-element-reading-label">{label}</span>}
      <span class="mcp-view-element-reading-measure">
        <strong class="mcp-view-element-reading-value">{value}</strong>
        {isPresent(unit) && <span class="mcp-view-element-reading-unit">{unit}</span>}
      </span>
      {isPresent(detail) && <small class="mcp-view-element-reading-detail">{detail}</small>}
    </div>
  );
}

export interface ElementLimitProps {
  readonly operator: ComponentChildren;
  readonly value: ComponentChildren;
  readonly label?: ComponentChildren;
  readonly unit?: ComponentChildren;
  readonly detail?: ComponentChildren;
  readonly className?: string;
}

/** Caller-declared limit statement; never infers a range, measurement, or verdict. */
export function ElementLimit({
  operator,
  value,
  label,
  unit,
  detail,
  className,
}: ElementLimitProps): JSX.Element {
  return (
    <div class={classes("mcp-view-element-limit", className)} data-element-slot="reading">
      {isPresent(label) && <span class="mcp-view-element-limit-label">{label}</span>}
      <span class="mcp-view-element-limit-statement">
        <span class="mcp-view-element-limit-operator">{operator}</span>
        <strong class="mcp-view-element-limit-value">{value}</strong>
        {isPresent(unit) && <span class="mcp-view-element-limit-unit">{unit}</span>}
      </span>
      {isPresent(detail) && <small class="mcp-view-element-limit-detail">{detail}</small>}
    </div>
  );
}

export interface ElementVerdictProps {
  readonly value: ComponentChildren;
  readonly label?: ComponentChildren;
  readonly className?: string;
}

export interface ElementBodyProps {
  readonly children?: ComponentChildren;
  readonly className?: string;
}

/** Optional provider-owned visualization slot, such as a gauge or compact domain plot. */
export function ElementBody({ children, className }: ElementBodyProps): JSX.Element {
  return (
    <div class={classes("mcp-view-element-body", className)} data-element-slot="body">
      {children}
    </div>
  );
}

export interface ElementSectionProps {
  /** Visible heading and accessible name of the group; the caller words it. */
  readonly title: string;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/**
 * One titled group inside an ElementBody. A datasheet body is sections, not one
 * list: each fact belongs to exactly one, and the section names what its facts are.
 */
export function ElementSection({
  title,
  className,
  children,
}: ElementSectionProps): JSX.Element {
  return (
    <div
      aria-label={title}
      class={classes("mcp-view-element-section", className)}
      data-element-slot="section"
      role="group"
    >
      <span class="mcp-view-element-section-title">{title}</span>
      {children}
    </div>
  );
}

/** Caller-authored verdict. Tone remains an explicit SemanticElement concern. */
export function ElementVerdict({
  value,
  label,
  className,
}: ElementVerdictProps): JSX.Element {
  return (
    <div class={classes("mcp-view-element-verdict", className)} data-element-slot="verdict">
      {isPresent(label) && <span class="mcp-view-element-verdict-label">{label}</span>}
      <strong class="mcp-view-element-verdict-value">{value}</strong>
    </div>
  );
}

export interface ElementProvenanceProps {
  readonly value: ComponentChildren;
  readonly label?: ComponentChildren;
  readonly className?: string;
}

/** Exact caller-provided provenance such as a source, revision, or fingerprint. */
export function ElementProvenance({
  value,
  label,
  className,
}: ElementProvenanceProps): JSX.Element {
  return (
    <footer
      class={classes("mcp-view-element-provenance", className)}
      data-element-slot="provenance"
    >
      {isPresent(label) && <span class="mcp-view-element-provenance-label">{label}</span>}
      <span class="mcp-view-element-provenance-value">{value}</span>
    </footer>
  );
}

export interface SemanticElementProps {
  /** Structured identity only. This component never resolves or dereferences it. */
  readonly reference: ComposedSemanticRef;
  /** Presentation density. A whole viewer is deliberately not a density. */
  readonly density: SemanticElementDensity;
  /** Explicit visual verdict. Omit when the object has no warranted verdict. */
  readonly tone?: PresentationTone;
  /** Explicit current selection; presentation and accessible state stay kit-owned. */
  readonly selected?: boolean;
  /** Every semantic object must provide a resolved identity slot. */
  readonly ident: VNode<ElementIdentProps>;
  readonly reading?:
    | VNode<ElementReadingProps | ElementLimitProps>
    | readonly VNode<ElementReadingProps | ElementLimitProps>[];
  readonly body?: VNode<ElementBodyProps> | readonly VNode<ElementBodyProps>[];
  readonly verdict?: VNode<ElementVerdictProps>;
  readonly provenance?: VNode<ElementProvenanceProps>;
  readonly activationLabel?: string;
  readonly onActivate?: (reference: ComposedSemanticRef) => void;
  readonly className?: string;
}

/**
 * Render one semantic object without owning domain vocabulary or reference resolution.
 *
 * The same slots survive chip, row, and card composition. When a tone is explicitly
 * supplied, an inline-start verdict border is invariant across all three densities.
 */
export function SemanticElement({
  reference,
  density,
  tone,
  selected,
  ident,
  reading,
  body,
  verdict,
  provenance,
  activationLabel,
  onActivate,
  className,
}: SemanticElementProps): JSX.Element {
  if (!ident) throw new TypeError("SemanticElement requires an ElementIdent slot");

  const interactive = onActivate !== undefined;
  const activate = (): void => onActivate?.(reference);
  return (
    <div
      aria-current={!interactive && selected ? "true" : undefined}
      aria-label={interactive ? activationLabel : undefined}
      aria-pressed={interactive && selected !== undefined ? selected : undefined}
      class={classes(
        "mcp-view-semantic-element",
        selected ? "mcp-view-selected" : undefined,
        className,
      )}
      data-density={density}
      data-interactive={interactive ? "true" : undefined}
      data-selected={selected === undefined ? undefined : String(selected)}
      data-semantic-domain={reference.domain}
      data-semantic-id={reference.id}
      data-semantic-kind={reference.kind}
      data-basis-fingerprint={reference.basisFingerprint}
      data-tone={tone}
      role={interactive ? "button" : undefined}
      style={tone ? { borderInlineStart: verdictBorder(tone) } : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive
        ? (event) => {
          if (eventStartedInInteractiveChild(event.currentTarget, event.target)) return;
          activate();
        }
        : undefined}
      onKeyDown={interactive
        ? (event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          activate();
        }
        : undefined}
    >
      {ident}
      {isPresent(reading) && (
        <div class="mcp-view-element-readings" data-element-slot="readings">
          {reading}
        </div>
      )}
      {body}
      {verdict}
      {provenance}
    </div>
  );
}

const INTERACTIVE_CHILD_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
].join(",");

function eventStartedInInteractiveChild(
  element: HTMLDivElement,
  target: EventTarget | null,
): boolean {
  const candidate = target as (Element & { closest?: (selector: string) => Element | null }) | null;
  if (!candidate || typeof candidate.closest !== "function") return false;
  const interactive = candidate.closest(INTERACTIVE_CHILD_SELECTOR);
  return interactive !== null && interactive !== element && element.contains(interactive);
}

function verdictBorder(tone: PresentationTone): string {
  const color = {
    neutral: "var(--mcp-view-muted, currentColor)",
    info: "var(--mcp-view-accent, currentColor)",
    success: "var(--mcp-view-success, currentColor)",
    warning: "var(--mcp-view-warning, currentColor)",
    danger: "var(--mcp-view-danger, currentColor)",
  }[tone];
  return `var(--mcp-view-semantic-verdict-border-width, 3px) solid ${color}`;
}

function isPresent(value: ComponentChildren): boolean {
  if (value === undefined || value === null || value === false) return false;
  return !(Array.isArray(value) && value.length === 0);
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
