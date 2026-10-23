/**
 * Shared credential validation for customer sign-up and sign-in.
 *
 * Pure helpers only — no database, no Next.js imports — so the client form and
 * the API routes apply exactly the same rules.
 *
 * Password length is checked in *bytes*: bcrypt silently truncates input to 72
 * bytes, so a longer password would authenticate on its first 72 bytes only.
 */

export const EMAIL_MAX_LENGTH = 254;
export const NAME_MAX_LENGTH = 100;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

/**
 * Intentionally the same shape used by the checkout route: a single "@", no
 * whitespace, and a dot somewhere in the domain. Full RFC 5322 validation is
 * not useful here — the address is never proof of ownership until verification
 * exists.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, then lowercase. Returns "" for non-strings. */
export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const email = value.trim();
  return (
    email.length > 0 &&
    email.length <= EMAIL_MAX_LENGTH &&
    EMAIL_RE.test(email)
  );
}

/** UTF-8 byte length, matching what bcrypt sees. */
export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type PasswordCheck =
  | { ok: true }
  | { ok: false; error: string };

export function validatePassword(value: unknown): PasswordCheck {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    };
  }
  if (passwordByteLength(value) > PASSWORD_MAX_BYTES) {
    return {
      ok: false,
      error: `Password must be at most ${PASSWORD_MAX_BYTES} bytes.`,
    };
  }
  return { ok: true };
}

/** Trim a person's name and cap its stored length. */
export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, NAME_MAX_LENGTH);
}
