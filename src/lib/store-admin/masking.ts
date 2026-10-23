/**
 * Display masking for the store admin Customers pages.
 *
 * These helpers are deliberately separate from the audit log's masking in
 * `src/lib/store-admin/audit.ts`: the audit masks for permanent storage, while
 * these produce the values staff see in the read-only UI. Every role sees the
 * same masked output; only the audited reveal endpoint returns a full value.
 *
 * Pure module — no database or Next.js imports.
 */

/** `ravi.kumar@example.com` → `r***@example.com`. */
export function maskCustomerEmail(value: string | null | undefined): string {
  const email = (value ?? '').trim();
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return '[redacted email]';

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * `9876543210` → `98******10` (keep the first two and last two digits).
 * Anything shorter than five digits is masked completely.
 */
export function maskCustomerPhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) return '[redacted phone]';
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`;
}
