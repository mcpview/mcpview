/** @jsxImportSource preact */
/** Pure presentation structures shared by composable MCP Apps. */

import type { ComponentChildren, JSX } from "preact";
import type { PresentationTone } from "./components.tsx";
import { eventStartedInInteractiveChild } from "./interactive-child.ts";
import { DisclosureChevron } from "./interaction-controls.tsx";

export interface PathBarItem {
  readonly id: string;
  readonly label: ComponentChildren;
  /** Recorded state of that kept level, revealed only by the collapsed disclosure. */
  readonly detail?: ComponentChildren;
}

/** Trailing items kept inline before the leading ones collapse. */
export const PATH_BAR_DEFAULT_MAX_VISIBLE = 3;

export interface PathBarProps {
  /** Accessible name for the navigation landmark. */
  readonly label: string;
  /** Ordered path, including the current item. */
  readonly items: readonly PathBarItem[];
  /** Controlled identity of the current item. */
  readonly currentId: string;
  /** Local navigation callback. The component owns no routing state. */
  readonly onSelect: (id: string) => void;
  /** Inline capacity before the leading items collapse. Defaults to three. */
  readonly maxVisible?: number;
  /** Accessible name of the collapsed disclosure. Omit to never collapse. */
  readonly collapsedLabel?: string;
  /** Accessible name of the leading step-out control. Omit to render none. */
  readonly backLabel?: string;
  readonly className?: string;
}

/**
 * Controlled breadcrumb-like navigation without host or MCP side effects.
 *
 * A one-item path renders nothing: the first level has nothing to leave.
 */
export function PathBar({
  label,
  items,
  currentId,
  onSelect,
  maxVisible = PATH_BAR_DEFAULT_MAX_VISIBLE,
  collapsedLabel,
  backLabel,
  className,
}: PathBarProps): JSX.Element | null {
  validatePath(items, currentId, maxVisible);
  if (items.length < 2) return null;

  const collapsed = collapsedLabel !== undefined && items.length > maxVisible
    ? items.slice(0, items.length - maxVisible)
    : [];
  const visible = items.slice(collapsed.length);
  const currentIndex = items.findIndex((item) => item.id === currentId);
  const previous = currentIndex > 0 ? items[currentIndex - 1] : undefined;

  return (
    <nav aria-label={label} class={classes("mcp-view-path-bar", className)}>
      {backLabel !== undefined && previous !== undefined && (
        <button
          aria-label={backLabel}
          class="mcp-view-path-bar-back"
          onClick={() => onSelect(previous.id)}
          type="button"
        >
          <span aria-hidden="true">‹</span>
        </button>
      )}
      {collapsed.length > 0 && (
        <details class="mcp-view-path-bar-collapsed">
          <summary aria-label={collapsedLabel} class="mcp-view-path-bar-collapsed-summary">
            <span aria-hidden="true">{`…${collapsed.length}`}</span>
          </summary>
          <ul class="mcp-view-path-bar-kept">
            {collapsed.map((item, index) => (
              <li key={item.id}>
                <button
                  class="mcp-view-path-bar-kept-button"
                  onClick={() => onSelect(item.id)}
                  type="button"
                >
                  <span aria-hidden="true" class="mcp-view-path-bar-kept-rank">{index + 1}</span>
                  <span class="mcp-view-path-bar-kept-label">{item.label}</span>
                  {item.detail !== undefined && (
                    <small class="mcp-view-path-bar-kept-detail">{item.detail}</small>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <ol class="mcp-view-path-bar-list">
        {visible.map((item) => {
          const current = item.id === currentId;
          return (
            <li
              class="mcp-view-path-bar-item"
              data-current={current ? "true" : undefined}
              key={item.id}
            >
              {current
                ? (
                  <span aria-current="page" class="mcp-view-path-bar-current">
                    {item.label}
                  </span>
                )
                : (
                  <button
                    class="mcp-view-path-bar-button"
                    onClick={() => onSelect(item.id)}
                    type="button"
                  >
                    {item.label}
                  </button>
                )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Where one available drill-down leads. */
export type DrillHintDirection = "in-view" | "to-model";

interface DrillHintBaseProps {
  readonly label: ComponentChildren;
  readonly direction: DrillHintDirection;
  readonly className?: string;
}

interface StaticDrillHintProps extends DrillHintBaseProps {
  readonly onActivate?: undefined;
  readonly actionLabel?: never;
}

interface InteractiveDrillHintProps extends DrillHintBaseProps {
  readonly onActivate: () => void;
  /** Accessible action name, supplied together with the callback. */
  readonly actionLabel: string;
}

export type DrillHintProps = StaticDrillHintProps | InteractiveDrillHintProps;

/**
 * Affordance for one available drill-down.
 *
 * Without a callback the hint degrades to plain text and shows no glyph, so a
 * host that cannot follow it never advertises a step that does not exist.
 */
export function DrillHint(props: DrillHintProps): JSX.Element {
  const className = classes("mcp-view-drill-hint", props.className);
  if (props.onActivate === undefined) {
    return (
      <span class={className} data-degraded="true" data-direction={props.direction}>
        {props.label}
      </span>
    );
  }
  return (
    <button
      aria-label={props.actionLabel}
      class={className}
      data-direction={props.direction}
      onClick={props.onActivate}
      type="button"
    >
      {props.direction === "in-view" && <DisclosureChevron expanded={false} />}
      <span class="mcp-view-drill-hint-label">{props.label}</span>
      {props.direction === "to-model" && (
        <span aria-hidden="true" class="mcp-view-drill-hint-glyph">~</span>
      )}
    </button>
  );
}

/** Shape of one recorded level, so a path never hides what it opens onto. */
export type ViewKind = "list" | "chart" | "record";

export interface TypeBadgeProps {
  readonly kind: ViewKind;
  /** Caller-provided wording. The kit never translates or invents a label. */
  readonly label: ComponentChildren;
  readonly className?: string;
}

/** Names what one level is, next to the path that reached it. */
export function TypeBadge({ kind, label, className }: TypeBadgeProps): JSX.Element {
  return (
    <span class={classes("mcp-view-type-badge", className)} data-kind={kind}>
      {label}
    </span>
  );
}

export interface StaleBannerAction {
  readonly label: string;
  readonly onActivate: () => void;
}

export interface StaleBannerProps {
  /** Caller-formatted sentence, including the instant those values were recorded. */
  readonly message: ComponentChildren;
  readonly tone?: PresentationTone;
  readonly action?: StaleBannerAction;
  readonly className?: string;
}

/**
 * Marks the surrounding values as recorded earlier without hiding them.
 *
 * The banner refetches nothing and never replaces a dated value with a gap.
 */
export function StaleBanner({
  message,
  tone = "warning",
  action,
  className,
}: StaleBannerProps): JSX.Element {
  return (
    <div
      class={classes("mcp-view-stale-banner", className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span class="mcp-view-stale-banner-message">{message}</span>
      {action && (
        <button
          class="mcp-view-stale-banner-action"
          onClick={action.onActivate}
          type="button"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface Slot3DProps {
  /** Accessible name of the reserved area. */
  readonly label: string;
  /** Caller-provided wording for the reserved state. */
  readonly statusLabel: ComponentChildren;
  /** A provider-owned renderer. Without one the slot stays visibly reserved. */
  readonly children?: ComponentChildren;
  readonly className?: string;
}

/** Reserved area for a provider-owned 3D pose. The kit renders no geometry. */
export function Slot3D({ label, statusLabel, children, className }: Slot3DProps): JSX.Element {
  const reserved = children === undefined || children === null || children === false;
  return (
    <figure
      aria-label={label}
      class={classes("mcp-view-slot-3d", className)}
      data-reserved={reserved ? "true" : undefined}
      role="group"
    >
      <div class="mcp-view-slot-3d-frame">
        {reserved ? <span aria-hidden="true" class="mcp-view-slot-3d-mark" /> : children}
      </div>
      <figcaption class="mcp-view-slot-3d-status">{statusLabel}</figcaption>
    </figure>
  );
}

export interface TreeListNode {
  readonly id: string;
  readonly label: ComponentChildren;
  /** Caller-provided type wording, such as a package, part, or attribute. */
  readonly typeLabel?: ComponentChildren;
  readonly detail?: ComponentChildren;
  /** Caller-computed coverage wording. The kit counts nothing. */
  readonly coverageLabel?: ComponentChildren;
  readonly tone?: PresentationTone;
  readonly children?: readonly TreeListNode[];
}

export interface TreeListProps {
  /** Accessible name for the tree. */
  readonly label: string;
  readonly nodes: readonly TreeListNode[];
  /** Controlled expansion. The component keeps no local disclosure state. */
  readonly expandedIds: readonly string[];
  readonly onToggle: (id: string) => void;
  /** Accessible name shared by every disclosure control. */
  readonly toggleLabel: string;
  readonly selectedId?: string;
  /** Omit to render a read-only tree with no selection affordance. */
  readonly onSelect?: (id: string) => void;
  readonly className?: string;
}

/** Controlled hierarchy with caller-owned type wording and coverage. */
export function TreeList({
  label,
  nodes,
  expandedIds,
  onToggle,
  toggleLabel,
  selectedId,
  onSelect,
  className,
}: TreeListProps): JSX.Element {
  validateTree(nodes);
  const expanded = new Set(expandedIds);
  return (
    <ul
      aria-label={label}
      class={classes("mcp-view-tree-list", className)}
      role="tree"
    >
      {nodes.map((node) => (
        <TreeListItem
          expanded={expanded}
          key={node.id}
          level={1}
          node={node}
          onSelect={onSelect}
          onToggle={onToggle}
          selectedId={selectedId}
          toggleLabel={toggleLabel}
        />
      ))}
    </ul>
  );
}

interface TreeListItemProps {
  readonly node: TreeListNode;
  readonly level: number;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (id: string) => void;
  readonly toggleLabel: string;
  readonly selectedId: string | undefined;
  readonly onSelect: ((id: string) => void) | undefined;
}

function TreeListItem({
  node,
  level,
  expanded,
  onToggle,
  toggleLabel,
  selectedId,
  onSelect,
}: TreeListItemProps): JSX.Element {
  const children = node.children ?? [];
  const open = children.length > 0 && expanded.has(node.id);
  const selected = selectedId === node.id;
  return (
    <li
      aria-expanded={children.length > 0 ? open : undefined}
      aria-level={level}
      aria-selected={onSelect === undefined ? undefined : selected}
      class="mcp-view-tree-list-item"
      data-tone={node.tone}
      role="treeitem"
    >
      <div
        class="mcp-view-tree-list-row"
        style={{ paddingInlineStart: `${(level - 1) * 0.9}rem` }}
        onClick={children.length > 0 && !onSelect
          ? (event) => {
            if (eventStartedInInteractiveChild(event.currentTarget, event.target)) return;
            onToggle(node.id);
          }
          : undefined}
      >
        {children.length > 0
          ? (
            <button
              aria-expanded={open}
              aria-label={toggleLabel}
              class="mcp-view-tree-list-twisty"
              onClick={(event) => {
                event.stopPropagation();
                onToggle(node.id);
              }}
              type="button"
            >
              <DisclosureChevron expanded={open} />
            </button>
          )
          : <span aria-hidden="true" class="mcp-view-tree-list-twisty" data-empty="true" />}
        {node.typeLabel !== undefined && (
          <span class="mcp-view-tree-list-type">{node.typeLabel}</span>
        )}
        {onSelect === undefined
          ? <span class="mcp-view-tree-list-label">{node.label}</span>
          : (
            <button
              class="mcp-view-tree-list-label"
              onClick={() => onSelect(node.id)}
              type="button"
            >
              {node.label}
            </button>
          )}
        {node.detail !== undefined && <span class="mcp-view-tree-list-detail">{node.detail}</span>}
        {node.coverageLabel !== undefined && (
          <span class="mcp-view-tree-list-coverage" data-tone={node.tone}>
            {node.coverageLabel}
          </span>
        )}
      </div>
      {open && (
        <ul class="mcp-view-tree-list-group" role="group">
          {children.map((child) => (
            <TreeListItem
              expanded={expanded}
              key={child.id}
              level={level + 1}
              node={child}
              onSelect={onSelect}
              onToggle={onToggle}
              selectedId={selectedId}
              toggleLabel={toggleLabel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export interface LimitGaugeLimit {
  /** Position of the caller-provided limit on the same finite scale. */
  readonly value: number;
  /** Visible description of that recorded limit. */
  readonly label: string;
}

export interface LimitGaugeProps {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly value: number;
  /** Caller-formatted reading, including its unit when applicable. */
  readonly valueLabel: string;
  /** Caller-provided state text; the gauge never derives a verdict. */
  readonly statusLabel: string;
  readonly tone: PresentationTone;
  readonly limit?: LimitGaugeLimit;
  readonly className?: string;
}

/** Finite meter with an optional caller-supplied limit marker and explicit status text. */
export function LimitGauge({
  label,
  min,
  max,
  value,
  valueLabel,
  statusLabel,
  tone,
  limit,
  className,
}: LimitGaugeProps): JSX.Element {
  validateGaugeRange(min, max, value, limit);
  const markerPosition = limit === undefined
    ? undefined
    : `${((limit.value - min) / (max - min)) * 100}%`;

  return (
    <div
      class={classes("mcp-view-limit-gauge", className)}
      data-tone={tone}
    >
      <span class="mcp-view-limit-gauge-label">{label}</span>
      <div class="mcp-view-limit-gauge-track">
        <meter
          aria-label={label}
          aria-valuetext={`${valueLabel}; ${statusLabel}`}
          class="mcp-view-limit-gauge-meter"
          min={min}
          max={max}
          value={value}
        />
        {limit && (
          <span
            aria-hidden="true"
            class="mcp-view-limit-gauge-marker"
            style={{ left: markerPosition }}
          />
        )}
      </div>
      <span class="mcp-view-limit-gauge-reading">{valueLabel}</span>
      <span class="mcp-view-limit-gauge-status" data-tone={tone}>{statusLabel}</span>
      {limit && <span class="mcp-view-limit-gauge-limit">{limit.label}</span>}
    </div>
  );
}

export interface ArtifactFingerprint {
  readonly algorithm: string;
  readonly digest: string;
}

export interface ArtifactVerification {
  /** Literal verification state supplied by the caller. */
  readonly label: ComponentChildren;
  readonly tone: PresentationTone;
}

interface ArtifactRowBaseProps {
  readonly label: ComponentChildren;
  readonly kind?: ComponentChildren;
  readonly uri: string;
  readonly fingerprint?: ArtifactFingerprint;
  /** Caller-formatted byte size or other bounded size description. */
  readonly sizeLabel?: ComponentChildren;
  readonly verification?: ArtifactVerification;
  readonly className?: string;
}

interface StaticArtifactRowProps extends ArtifactRowBaseProps {
  readonly onActivate?: undefined;
  readonly actionLabel?: never;
}

interface InteractiveArtifactRowProps extends ArtifactRowBaseProps {
  readonly onActivate: () => void;
  /** Accessible action name, supplied together with the callback. */
  readonly actionLabel: string;
}

export type ArtifactRowProps = StaticArtifactRowProps | InteractiveArtifactRowProps;

/** Immutable-artifact presentation; verification is displayed, never inferred or performed. */
export function ArtifactRow(props: ArtifactRowProps): JSX.Element {
  const content = (
    <>
      <span class="mcp-view-artifact-row-identity">
        {props.kind && <span class="mcp-view-artifact-row-kind">{props.kind}</span>}
        <strong class="mcp-view-artifact-row-label">{props.label}</strong>
      </span>
      <code class="mcp-view-artifact-row-uri">{props.uri}</code>
      {props.fingerprint && (
        <span class="mcp-view-artifact-row-fingerprint">
          <span>{props.fingerprint.algorithm}</span>
          <code>{props.fingerprint.digest}</code>
        </span>
      )}
      {props.sizeLabel && <span class="mcp-view-artifact-row-size">{props.sizeLabel}</span>}
      {props.verification && (
        <span
          class="mcp-view-artifact-row-verification"
          data-tone={props.verification.tone}
        >
          {props.verification.label}
        </span>
      )}
    </>
  );
  const className = classes("mcp-view-artifact-row", props.className);

  if (props.onActivate) {
    return (
      <button
        aria-label={props.actionLabel}
        class={className}
        onClick={props.onActivate}
        type="button"
      >
        {content}
      </button>
    );
  }
  return <article class={className}>{content}</article>;
}

function validatePath(
  items: readonly PathBarItem[],
  currentId: string,
  maxVisible: number,
): void {
  if (items.length === 0) throw new TypeError("PathBar items must not be empty");
  if (!Number.isInteger(maxVisible) || maxVisible < 1) {
    throw new RangeError("PathBar maxVisible must be a positive integer");
  }
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id.trim()) throw new TypeError("PathBar item ids must be non-empty");
    if (ids.has(item.id)) throw new TypeError(`PathBar item id ${item.id} is duplicated`);
    ids.add(item.id);
  }
  if (!ids.has(currentId)) throw new TypeError("PathBar currentId must identify one item");
}

function validateTree(nodes: readonly TreeListNode[]): void {
  if (nodes.length === 0) throw new TypeError("TreeList nodes must not be empty");
  const ids = new Set<string>();
  const walk = (candidates: readonly TreeListNode[]): void => {
    for (const node of candidates) {
      if (!node.id.trim()) throw new TypeError("TreeList node ids must be non-empty");
      if (ids.has(node.id)) throw new TypeError(`TreeList node id ${node.id} is duplicated`);
      ids.add(node.id);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
}

function validateGaugeRange(
  min: number,
  max: number,
  value: number,
  limit: LimitGaugeLimit | undefined,
): void {
  for (const [name, candidate] of [["min", min], ["max", max], ["value", value]] as const) {
    if (!Number.isFinite(candidate)) throw new TypeError(`LimitGauge ${name} must be finite`);
  }
  if (max <= min) throw new RangeError("LimitGauge max must be greater than min");
  if (value < min || value > max) {
    throw new RangeError("LimitGauge value must be within min and max");
  }
  if (limit === undefined) return;
  if (!Number.isFinite(limit.value)) throw new TypeError("LimitGauge limit must be finite");
  if (limit.value < min || limit.value > max) {
    throw new RangeError("LimitGauge limit must be within min and max");
  }
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
