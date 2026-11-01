import type { StoreRole } from '@/lib/store-admin/auth';

/**
 * Website (storefront content and theme) permissions.
 *
 * Decision recorded in MERGE_PLAN.md: only the store owner may change what
 * customers see. Store admins and viewers can open the Website screens and
 * read the current values, but every write route and every Save button checks
 * this one helper.
 */
export function canEditWebsite(role: StoreRole | null | undefined): boolean {
  return role === 'store_owner';
}

/** Roles that may write website content, theme or media through the Website group. */
export const WEBSITE_EDIT_ROLES: readonly StoreRole[] = ['store_owner'];
