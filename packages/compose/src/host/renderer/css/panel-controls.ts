/** Shared styles for the controls around mounted Compose viewers. */
export function getPanelControlsCss(): string {
  return `
    [data-compose-board] {
      position: relative;
      --compose-ink: var(--board-muted, var(--mcc-text-secondary, #5b6268));
      --compose-active: var(--board-focus, var(--mcc-accent-color, #286cb7));
    }
    [data-compose-panel] { position: relative; min-width: 0; min-height: 0; }
    .compose-viewer {
      align-self: start;
      height: var(--compose-native-height, 100%);
    }
    #container[data-compose-intrinsic] {
      height: auto;
      align-content: start;
      grid-auto-rows: auto;
    }
    #container[data-compose-intrinsic] > .compose-viewer {
      height: var(--compose-native-height, 200px);
    }
    .compose-viewer > iframe {
      display: block; width: 100%; height: 100%; border: 0;
    }
    button[data-compose-grip] {
      position: absolute; z-index: 4; top: 0; left: 2px;
      display: block; width: 18px; height: 16px;
      margin: 0; padding: 0; border: 0; border-radius: 3px;
      background: transparent; color: var(--compose-ink);
      cursor: grab; touch-action: none; user-select: none;
    }
    button[data-compose-grip][hidden] { display: none; }
    button[data-compose-grip]::before {
      content: ""; position: absolute; top: 4px; left: 8px;
      width: 2px; height: 2px; border-radius: 50%; opacity: 0;
      background: currentColor;
      box-shadow: -4.25px 1.75px, -6px 6px;
    }
    [data-compose-grip]:focus-visible, [data-compose-corner]:focus-visible {
      outline: 2px solid var(--compose-active); outline-offset: -2px;
    }
    [data-compose-moving] [data-compose-grip] { cursor: grabbing; }
    [data-compose-dragging] iframe { pointer-events: none; }
    button[data-compose-corner] {
      position: absolute; z-index: 3; bottom: 0; right: 0; width: 18px; height: 18px;
      padding: 0; margin: 0; min-width: 0; min-height: 0; border: 0; border-radius: 0;
      color: var(--compose-ink); background: transparent; cursor: nwse-resize;
      touch-action: none; user-select: none;
    }
    [data-compose-corner]::after {
      content: ""; position: absolute; bottom: 3px; right: 3px; width: 9px; height: 9px;
      background: linear-gradient(135deg, transparent 43%, currentColor 45% 52%, transparent 54% 68%, currentColor 70% 77%, transparent 79%);
      opacity: 0; pointer-events: none;
    }
    :where([data-compose-panel]:hover) button[data-compose-grip]::before,
    :where([data-compose-panel]:hover) [data-compose-corner]::after { opacity: .4; }
    button[data-compose-grip]:is(:hover, :focus-visible, :active, [aria-pressed="true"])::before,
    [data-compose-corner]:is(:hover, :focus-visible, :active)::after { opacity: 1; color: var(--compose-active); }
    @media (pointer: coarse) {
      button[data-compose-grip] { width: 24px; height: 24px; }
      button[data-compose-corner] { width: 26px; height: 26px; }
      button[data-compose-grip]::before,
      [data-compose-corner]::after { opacity: .5; }
    }
    @media (forced-colors: active) {
      button[data-compose-grip]::before { color: ButtonText; forced-color-adjust: none; }
      [data-compose-corner]::after { color: ButtonText; forced-color-adjust: none; }
    }
    [data-compose-drop-preview] {
      position: absolute; inset: 0; z-index: 5; pointer-events: none; box-sizing: border-box;
      display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 6px;
      border: 1.5px dashed var(--compose-active); border-radius: inherit;
      background: color-mix(in srgb, var(--board-bg, var(--mcc-bg-primary, Canvas)) 90%, transparent);
      color: color-mix(in srgb, var(--compose-active) 42%, transparent);
    }
    [data-compose-drop-preview]::before, [data-compose-drop-preview]::after {
      content: ""; width: min(36%, 80px); height: 5px; border-radius: 3px; background: currentColor;
    }
    [data-compose-drop-preview]::after { width: min(24%, 54px); }
    .tab-bar [data-compose-drop-preview]::before { width: min(50%, 32px); height: 3px; }
    .tab-bar [data-compose-drop-preview]::after { display: none; }
    @media (forced-colors: active) {
      [data-compose-drop-preview] { border-color: Highlight; background: Canvas; color: GrayText; }
      [data-compose-drop-preview]::before, [data-compose-drop-preview]::after {
        background: GrayText; forced-color-adjust: none;
      }
    }
  `;
}
