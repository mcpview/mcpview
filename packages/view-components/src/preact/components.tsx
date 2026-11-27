/** @jsxImportSource preact */
/** Shared Preact presentation primitives for composable MCP Apps. */

import { eventStartedInInteractiveChild } from "./interactive-child.ts";
import { createElement, render } from "preact";
import { useId } from "preact/hooks";
import { DisclosureChevron } from "./interaction-controls.tsx";
import { useVisualItemGestures } from "./visual-item-gestures.ts";
import type { ComponentChildren, JSX } from "preact";

export type PresentationTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface StackProps {
  readonly gap?: "xs" | "sm" | "md" | "lg";
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Simple vertical composition primitive; it carries no domain semantics. */
export function Stack({ gap = "md", className, children }: StackProps): JSX.Element {
  return (
    <div class={classes("mcp-view-stack", className)} data-gap={gap}>
      {children}
    </div>
  );
}

export interface RowProps {
  readonly label?: string;
  readonly responsive?: boolean;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Horizontal fact or control row; its contents and meaning remain caller-owned. */
export function Row({
  label,
  responsive = false,
  className,
  children,
}: RowProps): JSX.Element {
  return (
    <div
      aria-label={label}
      class={classes(
        "mcp-view-row",
        responsive ? "mcp-view-row-responsive" : undefined,
        className,
      )}
      role={label ? "group" : undefined}
    >
      {children}
    </div>
  );
}

export interface CardProps {
  readonly title?: ComponentChildren;
  readonly eyebrow?: ComponentChildren;
  readonly actions?: ComponentChildren;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** The canonical MCP component container. */
export function Card({
  title,
  eyebrow,
  actions,
  className,
  children,
}: CardProps): JSX.Element {
  return (
    <section class={classes("mcp-view-card", className)}>
      {(title || eyebrow || actions) && (
        <header class="mcp-view-card-header">
          <div class="mcp-view-card-heading">
            {eyebrow && <p class="mcp-view-card-eyebrow">{eyebrow}</p>}
            {title && <h2 class="mcp-view-card-title">{title}</h2>}
          </div>
          {actions && <div class="mcp-view-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export interface BadgeProps {
  readonly tone?: PresentationTone;
  readonly children?: ComponentChildren;
  readonly className?: string;
}

export interface BadgeGroupProps {
  readonly label: string;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Accessible wrapping group for compact status and classification badges. */
export function BadgeGroup({
  label,
  className,
  children,
}: BadgeGroupProps): JSX.Element {
  return (
    <div
      aria-label={label}
      class={classes("mcp-view-badges", className)}
      role="group"
    >
      {children}
    </div>
  );
}

/** Compact status or classification label. */
export function Badge({ tone = "neutral", children, className }: BadgeProps): JSX.Element {
  return (
    <span
      class={classes("mcp-view-badge", className)}
      data-tone={tone}
    >
      {children}
    </span>
  );
}

export interface MetricItem {
  readonly id: string;
  readonly label: ComponentChildren;
  readonly value: ComponentChildren;
  readonly unit?: ComponentChildren;
  readonly detail?: ComponentChildren;
  readonly tone?: PresentationTone;
}

export interface MetricGridProps {
  readonly items: readonly MetricItem[];
  readonly className?: string;
}

export interface MetricProps extends Omit<MetricItem, "id"> {
  readonly id?: string;
  readonly className?: string;
}

/** One unit-bearing reading. Callers remain responsible for the value and its tone. */
export function Metric({
  id,
  label,
  value,
  unit,
  detail,
  tone = "neutral",
  className,
}: MetricProps): JSX.Element {
  return (
    <article
      class={classes("mcp-view-metric", className)}
      data-metric={id}
      data-tone={tone}
    >
      <span class="mcp-view-metric-label">{label}</span>
      <strong class="mcp-view-metric-value">{value}</strong>
      {unit && <small class="mcp-view-metric-unit">{unit}</small>}
      {detail && <small class="mcp-view-metric-detail">{detail}</small>}
    </article>
  );
}

/** Responsive, container-aware metrics with stable semantic slots. */
export function MetricGrid({ items, className }: MetricGridProps): JSX.Element {
  return (
    <div class={classes("mcp-view-metrics", className)}>
      {items.map((metric) => <Metric {...metric} key={metric.id} />)}
    </div>
  );
}

export interface KeyValueItem {
  readonly id: string;
  readonly label: ComponentChildren;
  readonly value: ComponentChildren;
}

/**
 * `inspector` (default): mono key, value flush right, hairline between rows.
 * `facts`: one aligned label column, each value read right after its label.
 */
export type KeyValueLayout = "inspector" | "facts";

export interface KeyValueListProps {
  readonly items: readonly KeyValueItem[];
  readonly layout?: KeyValueLayout;
  readonly className?: string;
}

/** Provenance and identity facts with safe wrapping for hashes and URIs. */
export function KeyValueList({
  items,
  layout = "inspector",
  className,
}: KeyValueListProps): JSX.Element {
  return (
    <dl
      class={classes("mcp-view-key-values", className)}
      data-layout={layout === "inspector" ? undefined : layout}
    >
      {items.map((item) => (
        <div class="mcp-view-key-value" key={item.id}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface DataTableColumn<TRow> {
  readonly id: string;
  readonly label: ComponentChildren;
  readonly align?: "left" | "right";
  readonly render: (row: TRow) => ComponentChildren;
}

export interface DataTableDisclosure {
  /** Localized accessible action, including the row identity. */
  readonly label: string;
  /** Supply only for locally expandable details. */
  readonly expanded?: boolean;
  readonly controls?: string;
  readonly onOpen: () => void;
}

export interface DataTableProps<TRow> {
  readonly label: string;
  readonly rows: readonly TRow[];
  readonly columns: readonly DataTableColumn<TRow>[];
  readonly rowKey: (row: TRow) => string | number;
  /** Returns context membership when contextSelection is supplied. */
  readonly selected?: (row: TRow) => boolean;
  readonly onSelect?: (row: TRow) => void;
  /** Opt into context gestures. The consumer controls membership through selected. */
  readonly contextSelection?: {
    /** Double-click, long press or Shift+Space toggles one row. */
    readonly onToggle: (row: TRow) => void;
    /** Rectangle selection adds these rows to the existing context. */
    readonly onAdd?: (rows: readonly TRow[]) => void;
    /** Spoken row status; default labels are in English. */
    readonly labels?: {
      readonly selected: string;
      readonly unselected: string;
    };
  };
  /** A row with a disclosure opens on activation. Other rows keep their optional selection action. */
  readonly getDisclosure?: (row: TRow) => DataTableDisclosure | undefined;
  readonly emptyLabel?: string;
  readonly className?: string;
}

/** Accessible compact table; selection behavior is opt-in and keyboard-safe. */
export function DataTable<TRow>({
  label,
  rows,
  columns,
  rowKey,
  selected,
  onSelect,
  contextSelection,
  getDisclosure,
  emptyLabel = "No matching data",
  className,
}: DataTableProps<TRow>): JSX.Element {
  const statusId = useId();
  const describeSelection = contextSelection !== undefined && selected !== undefined;
  const items = rows.map((row) => {
    const key = rowKey(row);
    return {
      row,
      key,
      id: typeof key === "string" ? `s:${key}` : `n:${key}`,
      disclosure: getDisclosure?.(row),
    };
  });
  const byId = new Map(contextSelection ? items.map((item) => [item.id, item]) : []);
  const gestureRoot = useVisualItemGestures<HTMLTableSectionElement>({
    onActivate: (id) => {
      const item = byId.get(id);
      if (!item) return;
      if (item.disclosure) item.disclosure.onOpen();
      else onSelect?.(item.row);
    },
    onToggle: contextSelection && ((id) => {
      const item = byId.get(id);
      if (item) contextSelection.onToggle(item.row);
    }),
    onAdd: contextSelection?.onAdd && ((ids) => {
      const added = ids.flatMap((id) => {
        const item = byId.get(id);
        return item ? [item.row] : [];
      });
      contextSelection.onAdd?.(added);
    }),
  });

  if (rows.length === 0) {
    return (
      <div
        aria-label={label}
        class={classes("mcp-view-table-wrap", className)}
        role="status"
      >
        <EmptyState>{emptyLabel}</EmptyState>
      </div>
    );
  }
  return (
    <div class={classes("mcp-view-table-wrap", className)}>
      <table class="mcp-view-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                data-align={column.align ?? "left"}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          ref={contextSelection ? gestureRoot : undefined}
          data-visual-selection-surface={contextSelection?.onAdd ? "" : undefined}
        >
          {items.map(({ row, key, id, disclosure }) => {
            const interactive = disclosure !== undefined || onSelect !== undefined;
            const isSelected = selected?.(row);
            const choose = disclosure ? disclosure.onOpen : () => onSelect?.(row);
            return (
              <tr
                aria-describedby={describeSelection
                  ? `${statusId}-${isSelected ? "selected" : "unselected"}`
                  : undefined}
                aria-selected={selected ? isSelected : undefined}
                aria-keyshortcuts={contextSelection ? "Shift+Space" : undefined}
                class={isSelected && !contextSelection ? "mcp-view-selected" : undefined}
                data-mcp-view-context-row={contextSelection && isSelected ? "selected" : undefined}
                data-interactive={interactive || contextSelection ? "true" : undefined}
                data-visual-item={contextSelection ? id : undefined}
                data-visual-no-activate={contextSelection && !interactive ? "" : undefined}
                data-visual-selection-start={contextSelection?.onAdd ? "" : undefined}
                key={key}
                tabIndex={contextSelection || (interactive && !disclosure) ? 0 : undefined}
                onClick={interactive && !contextSelection
                  ? (event) => {
                    if (eventStartedInInteractiveChild(event.currentTarget, event.target)) return;
                    choose();
                  }
                  : undefined}
                onKeyDown={interactive && !contextSelection
                  ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    choose();
                  }
                  : undefined}
              >
                {columns.map((column, index) => (
                  <td key={column.id} data-align={column.align ?? "left"}>
                    {index === 0 && disclosure && (
                      <button
                        type="button"
                        class="mcp-view-table-disclosure"
                        data-visual-immediate-activate={contextSelection ? "" : undefined}
                        aria-label={disclosure.label}
                        aria-expanded={disclosure.expanded}
                        aria-controls={disclosure.controls}
                        onClick={(event) => {
                          event.stopPropagation();
                          disclosure.onOpen();
                        }}
                      >
                        <DisclosureChevron expanded={disclosure.expanded === true} />
                      </button>
                    )}
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {describeSelection && (
        <>
          <span hidden id={`${statusId}-selected`}>
            {contextSelection.labels?.selected ?? "Selected for context"}
          </span>
          <span hidden id={`${statusId}-unselected`}>
            {contextSelection.labels?.unselected ?? "Not selected for context"}
          </span>
        </>
      )}
    </div>
  );
}

export interface ButtonProps {
  readonly type?: "button" | "submit" | "reset";
  readonly pressed?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
  readonly className?: string;
  readonly onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
  readonly children?: ComponentChildren;
}

/** Small dashboard-safe action, never a product-wide navigation control. */
export function Button({
  type = "button",
  pressed,
  disabled,
  title,
  className,
  onClick,
  children,
}: ButtonProps): JSX.Element {
  return (
    <button
      aria-pressed={pressed}
      class={classes("mcp-view-button", className)}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type={type}
    >
      {children}
    </button>
  );
}

export interface ToolbarProps {
  readonly label: string;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

export interface TextInputProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly type?: "text" | "search";
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onValueInput?: (value: string) => void;
}

/** Compact controlled text input with a mandatory accessible label. */
export function TextInput({
  label,
  value,
  placeholder,
  type = "search",
  disabled,
  className,
  onValueInput,
}: TextInputProps): JSX.Element {
  return (
    <input
      aria-label={label}
      class={classes("mcp-view-text-input", className)}
      disabled={disabled}
      onInput={(event) => onValueInput?.(event.currentTarget.value)}
      placeholder={placeholder}
      type={type}
      value={value}
    />
  );
}

export interface CodeBlockProps {
  readonly label?: string;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Bounded preformatted content for expressions, source excerpts, and exact text. */
export function CodeBlock({ label, className, children }: CodeBlockProps): JSX.Element {
  return (
    <pre aria-label={label} class={classes("mcp-view-code-block", className)}>
      <code>{children}</code>
    </pre>
  );
}

export interface InlineCodeProps {
  readonly title?: string;
  readonly className?: string;
  readonly children?: ComponentChildren;
}

/** Inline exact text with safe wrapping for fingerprints, identifiers, and URIs. */
export function InlineCode({
  title,
  className,
  children,
}: InlineCodeProps): JSX.Element {
  return (
    <code class={classes("mcp-view-inline-code", className)} title={title}>
      {children}
    </code>
  );
}

export function Toolbar({
  label,
  className,
  children,
}: ToolbarProps): JSX.Element {
  return (
    <div
      aria-label={label}
      class={classes("mcp-view-toolbar", className)}
      role="group"
    >
      {children}
    </div>
  );
}

export interface EmptyStateProps {
  readonly children?: ComponentChildren;
  readonly className?: string;
}

export function EmptyState({
  children,
  className,
}: EmptyStateProps): JSX.Element {
  return <p class={classes("mcp-view-empty", className)}>{children}</p>;
}

export interface SkeletonProps {
  /** Accessible description of what is still loading. */
  readonly label: string;
  /** Placeholder lines drawn inside the frame. Defaults to three. */
  readonly lines?: number;
  readonly className?: string;
}

/**
 * Frame-first loading placeholder: the structure of a recorded view appears
 * before its values, so nothing shifts once the values arrive.
 */
export function Skeleton({ label, lines = 3, className }: SkeletonProps): JSX.Element {
  if (!Number.isInteger(lines) || lines < 1) {
    throw new RangeError("Skeleton lines must be a positive integer");
  }
  return (
    <div
      aria-busy="true"
      aria-label={label}
      class={classes("mcp-view-skeleton", className)}
      role="status"
    >
      {Array.from(
        { length: lines },
        (_unused, index) => <span aria-hidden="true" class="mcp-view-skeleton-line" key={index} />,
      )}
    </div>
  );
}

export interface MessageProps {
  readonly tone?: PresentationTone;
  readonly children?: ComponentChildren;
  readonly className?: string;
}

/** Compact inline notice that keeps surrounding values visible. */
export function Message({
  tone = "neutral",
  children,
  className,
}: MessageProps): JSX.Element {
  return (
    <div
      class={classes("mcp-view-message", className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export interface NoticeGroupProps {
  /** Accessible name and visible heading for the group. */
  readonly label: string;
  /** Caller-formatted notices. Nothing is rendered when there are none. */
  readonly items: readonly ComponentChildren[];
  readonly tone?: PresentationTone;
  /** Caller-formatted statement about entries that were left out. */
  readonly omittedLabel?: ComponentChildren;
  readonly className?: string;
}

/**
 * Short notices gathered under one severity heading.
 *
 * Renders nothing when there is nothing to say, so a caller never has to guard
 * the call site. Truncation is stated by the caller: the group displays the
 * notices it was handed and never counts what it was not.
 */
export function NoticeGroup({
  label,
  items,
  tone = "neutral",
  omittedLabel,
  className,
}: NoticeGroupProps): JSX.Element | null {
  // `{count && `${count} more`}` yields 0 and `{text && text}` yields "" for a
  // caller who means nothing was left out. Counting those as content would
  // render the very group this contract promises to hide.
  const omitted = omittedLabel !== undefined && omittedLabel !== null &&
    omittedLabel !== false && omittedLabel !== "" && omittedLabel !== 0;
  if (items.length === 0 && !omitted) return null;
  return (
    <section
      aria-label={label}
      class={classes("mcp-view-notice-group", className)}
      data-tone={tone}
      // One live region for the group, not one per notice. Wrapping each item
      // in Message announced N separate alerts for what reads on screen as a
      // single severity heading with its list underneath.
      role={tone === "danger" ? "alert" : "status"}
    >
      <strong class="mcp-view-notice-group-label">{label}</strong>
      <ul class="mcp-view-notice-group-items">
        {items.map((item, index) => <li class="mcp-view-notice-group-item" key={index}>{item}</li>)}
      </ul>
      {omitted && <small class="mcp-view-notice-group-omitted">{omittedLabel}</small>}
    </section>
  );
}

export interface StatusMessageMount {
  readonly title?: ComponentChildren;
  readonly tone?: PresentationTone;
  readonly busy?: boolean;
  readonly className?: string;
  /** Existing host to render into. Without one a detached `div` is created. */
  readonly container?: HTMLElement;
}

/**
 * Render a `StateMessage` into a real DOM node and hand that node back.
 *
 * `defineView` returns a native element, so every viewer built on it has to
 * bridge Preact to the DOM itself. Hand-written bridges drift — the tone, the
 * alert role and the class stop matching between surfaces of the same product.
 * This is that bridge, so one status looks like every other status.
 */
export function renderStatusMessage(
  detail: ComponentChildren,
  options: StatusMessageMount = {},
): HTMLElement {
  const host = options.container ?? document.createElement("div");
  render(
    createElement(
      StateMessage,
      {
        busy: options.busy,
        className: options.className,
        title: options.title,
        tone: options.tone,
      },
      detail,
    ),
    host,
  );
  // Without a container the caller mounts what comes back — typically as the
  // return of `defineView`, which hands its element straight to the router.
  // Returning the bare wrapper gave them a div carrying neither the class nor
  // the alert role, so `replaceChildren` produced a root that no viewer stylesheet
  // and no assistive technology could see. The container form returns the node
  // the caller already owns.
  if (options.container) return options.container;
  const rendered = host.firstElementChild;
  if (!rendered) throw new Error("renderStatusMessage rendered no element");
  return rendered as HTMLElement;
}

export interface CrossSelectionProps {
  readonly label: ComponentChildren;
  readonly value: ComponentChildren;
  readonly status?: ComponentChildren;
  readonly className?: string;
}

/** Read-only projection of a selection coordinated by an owning host. */
export function CrossSelection({
  label,
  value,
  status,
  className,
}: CrossSelectionProps): JSX.Element {
  return (
    <div class={classes("mcp-view-cross-selection", className)} role="status">
      <span class="mcp-view-cross-selection-label">{label}</span>
      <strong class="mcp-view-cross-selection-value">{value}</strong>
      {status && <span class="mcp-view-cross-selection-status">{status}</span>}
    </div>
  );
}

export interface StateMessageProps {
  readonly title?: ComponentChildren;
  readonly tone?: PresentationTone;
  readonly busy?: boolean;
  readonly children?: ComponentChildren;
  readonly className?: string;
}

export function StateMessage({
  title,
  tone = "neutral",
  busy,
  children,
  className,
}: StateMessageProps): JSX.Element {
  return (
    <div
      aria-busy={busy}
      class={classes("mcp-view-state", className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {busy && <span aria-hidden="true" class="mcp-view-state-busy" />}
      {title && <strong>{title}</strong>}
      {children && <div class="mcp-view-state-detail">{children}</div>}
    </div>
  );
}

function classes(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(" ");
}
