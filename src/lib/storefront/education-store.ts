/**
 * Feature gate for the deferred Education Store (`/in-edu/store`).
 *
 * Hidden across the live storefront, navigation, search, cart, footer, Store
 * Admin Website overview, and `/in-edu/store` route by default (`false`).
 * Set `NEXT_PUBLIC_ENABLE_EDUCATION_STORE=1` when ready to re-enable it later
 * without restoring any deleted code.
 */
export function isEducationStoreEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = (env.NEXT_PUBLIC_ENABLE_EDUCATION_STORE || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on' || raw === 'yes';
}
