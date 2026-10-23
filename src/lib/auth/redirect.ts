/**
 * Redirect validation for the customer auth flow.
 *
 * Only a same-origin, relative path may be used as a post-sign-in destination.
 * The rules reject the classic open-redirect shapes:
 *
 *   https://evil.example     absolute URL (also anything with a scheme)
 *   //evil.example           protocol-relative URL
 *   /\evil.example           backslash, which browsers normalise to "/"
 *   /%09/evil.example        control characters smuggled in
 *   /\u0000...
 *
 * Anything that fails returns the caller's fallback (default "/").
 *
 * This module is pure and has no server-only imports, so both the server page
 * and the client form can use it.
 */

const MAX_REDIRECT_LENGTH = 2048;
const BASE_ORIGIN = 'https://gadzio.invalid';
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Return `value` when it is a safe same-origin relative path, otherwise
 * `fallback` (which is always returned as-is).
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;

  const raw = value.trim();
  if (!raw || raw.length > MAX_REDIRECT_LENGTH) return fallback;

  // Must be a relative path. This also rejects any scheme ("https:",
  // "javascript:", "data:") because those never start with "/".
  if (!raw.startsWith('/')) return fallback;

  // Protocol-relative ("//host") and any backslash (browsers treat "\" as "/"
  // for special schemes, so "/\host" becomes "//host").
  if (raw.startsWith('//') || raw.includes('\\')) return fallback;

  // Control characters can be stripped by parsers, changing the effective path.
  if (CONTROL_CHARS.test(raw)) return fallback;

  // Final structural check: resolve against a fixed origin and confirm it did
  // not escape to another host or gain a scheme.
  try {
    const url = new URL(raw, BASE_ORIGIN);
    if (url.protocol !== 'https:') return fallback;
    if (url.origin !== BASE_ORIGIN) return fallback;
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return raw;
}
