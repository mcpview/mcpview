/**
 * Base CSS with theme variables for light/dark mode.
 *
 * @module renderer/css/base
 */

/**
 * Generate base CSS with theme CSS custom properties.
 *
 * Supports:
 * - Light mode (default)
 * - Dark mode via `body.dark` class
 * - System preference via `prefers-color-scheme: dark`
 *
 * @returns CSS string
 *
 * @example
 * ```typescript
 * const css = getBaseCss();
 * // Contains --mcc-border-color, --mcc-bg-primary, etc.
 * ```
 */
export function getBaseCss(): string {
  return `
    :root {
      --mcc-border-color: #e0e0e0;
      --mcc-bg-secondary: #f5f5f5;
      --mcc-bg-primary: #ffffff;
      --mcc-bg-hover: #e8e8e8;
      --mcc-text-secondary: #51565a;
      --mcc-accent-color: #1a73e8;
    }
    body.dark {
      --mcc-border-color: #3a3a3a;
      --mcc-bg-secondary: #2a2a2a;
      --mcc-bg-primary: #1a1a1a;
      --mcc-bg-hover: #3a3a3a;
      --mcc-text-secondary: #c2c5c8;
      --mcc-accent-color: #8ab4f8;
    }
    @media (prefers-color-scheme: dark) {
      :root:not(.light) {
        --mcc-border-color: #3a3a3a;
        --mcc-bg-secondary: #2a2a2a;
        --mcc-bg-primary: #1a1a1a;
        --mcc-bg-hover: #3a3a3a;
        --mcc-text-secondary: #c2c5c8;
        --mcc-accent-color: #8ab4f8;
      }
    }
  `;
}
