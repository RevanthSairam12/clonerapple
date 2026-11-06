/** Pure theme-value rules. No database or React imports. */

/**
 * Colour settings are interpolated into a `<style>` element in the root
 * layout. A value must therefore be a complete CSS colour on its own, never a
 * fragment that can close the element or add another declaration.
 *
 * Accepts #rgb, #rrggbb and #rrggbbaa only.
 */
export const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const THEME_COLOR_KEYS: ReadonlySet<string> = new Set([
  'oppoPrimaryColor',
  'oppoGreenDark',
  'oppoGreenLight',
]);

export function isThemeColorKey(key: string): boolean {
  return THEME_COLOR_KEYS.has(key);
}

export function isThemeHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

/** The trimmed colour, or null when the stored value is not a valid hex. */
export function safeThemeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return HEX_COLOR_RE.test(text) ? text : null;
}
