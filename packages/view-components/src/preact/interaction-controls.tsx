/** @jsxImportSource preact */
/** Controlled presentation for exploring a reading and pinning it to context. */
import type { JSX } from "preact";

export interface ContextPinButtonProps {
  /** Localized accessible action, including its target. */
  readonly label: string;
  readonly pressed: boolean | "mixed";
  /** Draw two strokes for a collection, including when all or none are pinned. */
  readonly group?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onToggle: (shiftKey: boolean) => void;
}

/** Independent action beside a row, card, or active point. The viewer owns its selection. */
export function ContextPinButton({
  label,
  pressed,
  group = false,
  disabled,
  className,
  onToggle,
}: ContextPinButtonProps): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      class={className ? `mcp-view-context-pin ${className}` : "mcp-view-context-pin"}
      data-context-pin=""
      disabled={disabled}
      draggable={false}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.stopPropagation();
        if (event.repeat) event.preventDefault();
      }}
      onKeyUp={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled && (event.detail ?? 0) <= 1) onToggle(Boolean(event.shiftKey));
      }}
      onDblClick={(event) => event.stopPropagation()}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
      >
        <path class="mcp-view-context-pin-stroke" d={group ? "M9 5v14" : "M12 5v14"} />
        {group && <path class="mcp-view-context-pin-stroke" d="M15 5v14" />}
      </svg>
    </button>
  );
}

export interface DisclosureChevronProps {
  readonly expanded: boolean;
  readonly className?: string;
}

/** Decorative leading glyph. The containing button supplies its label, action and expanded state. */
export function DisclosureChevron({ expanded, className }: DisclosureChevronProps): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      class={className ? `mcp-view-disclosure-chevron ${className}` : "mcp-view-disclosure-chevron"}
      data-expanded={expanded ? "true" : "false"}
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="1.5"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}
