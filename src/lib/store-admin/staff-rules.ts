/**
 * Pure rules for store staff: role metadata, the capability matrix and the
 * validation shared by the staff screens and the API routes.
 *
 * Database-free so the client form and the server enforce the same limits.
 */

import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  validatePassword,
} from '../auth/validation';

import type { StoreRole } from './auth';

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: StoreRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  sessionCount: number;
}

export interface StaffSession {
  /** Opaque id derived from the stored token hash; never the hash itself. */
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export const STAFF_ROLES: readonly StoreRole[] = [
  'store_owner',
  'store_admin',
  'store_viewer',
];

/**
 * Rank is used by `requireStoreRole`: a higher rank satisfies a lower one.
 * The staff screens read the same order to explain who can do what.
 */
export const ROLE_RANK: Readonly<Record<StoreRole, number>> = {
  store_viewer: 1,
  store_admin: 2,
  store_owner: 3,
};

export const ROLE_LABELS: Readonly<Record<StoreRole, string>> = {
  store_owner: 'Owner',
  store_admin: 'Admin',
  store_viewer: 'Viewer',
};

export const ROLE_SUMMARIES: Readonly<Record<StoreRole, string>> = {
  store_owner:
    'Everything, including staff, settings, PII reveals and destructive exports.',
  store_admin:
    'Day-to-day operations: orders, catalogue, customers, reports and settings — but not staff, roles or owner-only reveals.',
  store_viewer: 'Read-only access to every screen. No writes anywhere.',
};

export interface CapabilityRow {
  group: string;
  capability: string;
  owner: boolean;
  admin: boolean;
  viewer: boolean;
}

/**
 * The 6amMart permission groups mapped onto the three fixed Gadzio roles
 * (design §C.5.2). `capability` is the name a future API can check; today the
 * routes use the role rank directly, and this table drives the UI.
 */
export const CAPABILITY_MATRIX: readonly CapabilityRow[] = [
  { group: 'Dashboard', capability: 'overview.view', owner: true, admin: true, viewer: true },
  { group: 'Orders', capability: 'orders.view', owner: true, admin: true, viewer: true },
  { group: 'Orders', capability: 'orders.edit', owner: true, admin: true, viewer: false },
  { group: 'Orders', capability: 'orders.cancel', owner: true, admin: true, viewer: false },
  { group: 'Orders', capability: 'orders.refund', owner: true, admin: true, viewer: false },
  { group: 'Catalogue', capability: 'catalog.view', owner: true, admin: true, viewer: true },
  { group: 'Catalogue', capability: 'catalog.edit', owner: true, admin: true, viewer: false },
  { group: 'Catalogue', capability: 'catalog.publish', owner: true, admin: true, viewer: false },
  { group: 'Customers', capability: 'customers.view', owner: true, admin: true, viewer: true },
  { group: 'Customers', capability: 'customers.edit', owner: true, admin: true, viewer: false },
  { group: 'Customers', capability: 'customers.reveal', owner: true, admin: false, viewer: false },
  { group: 'Reports', capability: 'reports.view', owner: true, admin: true, viewer: true },
  { group: 'Reports', capability: 'reports.export', owner: true, admin: true, viewer: true },
  { group: 'Settings', capability: 'settings.view', owner: true, admin: true, viewer: true },
  { group: 'Settings', capability: 'settings.edit', owner: true, admin: true, viewer: false },
  { group: 'Staff', capability: 'staff.view', owner: true, admin: true, viewer: false },
  { group: 'Staff', capability: 'staff.edit', owner: true, admin: false, viewer: false },
  { group: 'Notifications', capability: 'notifications.send', owner: true, admin: true, viewer: false },
  { group: 'Reviews', capability: 'reviews.moderate', owner: true, admin: true, viewer: false },
  { group: 'Refunds', capability: 'refunds.manage', owner: true, admin: true, viewer: false },
  { group: 'Point of sale', capability: 'pos.use', owner: true, admin: true, viewer: false },
];

export function hasCapability(role: StoreRole, capability: string): boolean {
  const row = CAPABILITY_MATRIX.find((item) => item.capability === capability);
  if (!row) return false;
  if (role === 'store_owner') return row.owner;
  if (role === 'store_admin') return row.admin;
  return row.viewer;
}

/* ---------------------------------------------------------- validation */

export function isStoreRoleValue(value: unknown): value is StoreRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value);
}

export const STAFF_NAME_MAX = 100;
export const STAFF_PHONE_MAX = 40;
export const STAFF_PHONE_RE = /^[0-9+()\-\s.]{0,40}$/;

export function normalizeStaffPhone(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export type StaffValidation<T> = { ok: true; value: T } | { ok: false; error: string };

export interface NewStaffInput {
  name: string;
  email: string;
  phone: string;
  role: StoreRole;
}

export interface NewStaffWithPassword extends NewStaffInput {
  password: string;
}

export function validateNewStaff(input: {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  role?: unknown;
  password?: unknown;
}): StaffValidation<NewStaffWithPassword> {
  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: 'Name is required.' };

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: 'Enter a valid email address.' };

  const phone = normalizeStaffPhone(input.phone);
  if (phone.length > STAFF_PHONE_MAX) {
    return { ok: false, error: `Phone must be ${STAFF_PHONE_MAX} characters or fewer.` };
  }
  if (!STAFF_PHONE_RE.test(phone)) {
    return { ok: false, error: 'Phone may only contain digits, spaces, + ( ) - and dots.' };
  }

  if (!isStoreRoleValue(input.role)) {
    return { ok: false, error: 'Choose a valid role.' };
  }

  // An empty password means "generate one on the server"; a supplied password
  // must still pass the shared policy.
  const password = typeof input.password === 'string' ? input.password : '';
  if (password) {
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) return { ok: false, error: passwordCheck.error };
  }

  return { ok: true, value: { name, email, phone, role: input.role, password } };
}

export function validateStaffProfile(input: {
  name?: unknown;
  phone?: unknown;
}): StaffValidation<{ name: string; phone: string }> {
  const name = normalizeName(input.name);
  if (!name) return { ok: false, error: 'Name is required.' };

  const phone = normalizeStaffPhone(input.phone);
  if (phone.length > STAFF_PHONE_MAX) {
    return { ok: false, error: `Phone must be ${STAFF_PHONE_MAX} characters or fewer.` };
  }
  if (!STAFF_PHONE_RE.test(phone)) {
    return { ok: false, error: 'Phone may only contain digits, spaces, + ( ) - and dots.' };
  }

  return { ok: true, value: { name, phone } };
}

export function validateNewPassword(password: unknown): StaffValidation<string> {
  const check = validatePassword(password);
  if (!check.ok) return { ok: false, error: check.error };
  return { ok: true, value: password as string };
}

/* ------------------------------------------------------- safety rules */

/**
 * A staff row may not lock the panel out of itself:
 * - nobody may change their own role;
 * - nobody may deactivate their own account;
 * - the last active owner may not be demoted or deactivated.
 */
export function checkStaffChange(input: {
  actorId: string;
  targetId: string;
  targetRole: StoreRole;
  targetActive: boolean;
  activeOwners: number;
  nextRole?: StoreRole;
  nextActive?: boolean;
}): { ok: true } | { ok: false; error: string } {
  const roleChanges = input.nextRole !== undefined && input.nextRole !== input.targetRole;
  const deactivates = input.nextActive === false && input.targetActive;

  if (input.actorId === input.targetId) {
    if (roleChanges) return { ok: false, error: 'You cannot change your own role.' };
    if (deactivates) return { ok: false, error: 'You cannot deactivate your own account.' };
  }

  const removesAnOwner =
    input.targetRole === 'store_owner' &&
    input.targetActive &&
    ((input.nextRole !== undefined && input.nextRole !== 'store_owner') ||
      input.nextActive === false);

  if (removesAnOwner && input.activeOwners <= 1) {
    return {
      ok: false,
      error: 'The store needs at least one active owner. Promote another owner first.',
    };
  }

  return { ok: true };
}
