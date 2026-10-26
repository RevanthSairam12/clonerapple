import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { getSql } from '@/lib/admin/db';

import {
  checkStaffChange,
  STAFF_ROLES,
  validateNewPassword,
  validateNewStaff,
  validateStaffProfile,
  type NewStaffWithPassword,
  type StaffMember,
  type StaffSession,
} from './staff-rules';

export type { StaffMember, StaffSession } from './staff-rules';
import type { StoreRole } from './auth';

/**
 * Store staff accounts and their sessions.
 *
 * Every account lives in `store_admins` — the separate identity store from the
 * content panel. Passwords are bcrypt hashes; plain text is returned exactly
 * once, by the create/reset call, so the owner can hand it over. Nothing in
 * this module ever reads a password hash back to a caller.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store staff must be read and written on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const result = text(value);
  return result || null;
}

function iso(value: unknown): string {
  return nullableIso(value) ?? '';
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type StaffLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'conflict' | 'invalid-input' | 'last-owner'; error: string };

const BCRYPT_ROUNDS = 10;

function roleOf(value: unknown): StoreRole {
  return typeof value === 'string' && (STAFF_ROLES as readonly string[]).includes(value)
    ? (value as StoreRole)
    : 'store_viewer';
}

function staffFromRow(row: Row): StaffMember {
  return {
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
    phone: text(row.phone),
    role: roleOf(row.role),
    isActive: row.is_active === true || text(row.is_active) === 'true',
    mustChangePassword:
      row.must_change_password === true || text(row.must_change_password) === 'true',
    lastLoginAt: nullableIso(row.last_login_at),
    createdAt: iso(row.created_at),
    sessionCount: number(row.session_count),
  };
}

/** An opaque, stable id for a session row. Hashing the stored hash again means
 * the client never sees a value that could match `token_hash` in the table. */
function sessionIdFor(tokenHash: string): string {
  return createHash('sha256').update(tokenHash).digest('hex').slice(0, 16);
}

async function activeOwnerCount(sql: NonNullable<ReturnType<typeof getSql>>): Promise<number> {
  const rows = (await sql`
    select count(*)::int as count
    from store_admins
    where role = 'store_owner' and is_active
  `) as Row[];
  return number(rows[0]?.count);
}

/* ------------------------------------------------------------- reading */

export async function listStaff(): Promise<StaffLoad<StaffMember[]>> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }

  try {
    const rows = (await sql`
      select a.id, a.name, a.email, a.phone, a.role, a.is_active,
             a.must_change_password, a.last_login_at, a.created_at,
             (
               select count(*)::int from store_admin_sessions s
               where s.admin_id = a.id and s.expires_at > now()
             ) as session_count
      from store_admins a
      order by a.is_active desc, a.role asc, a.name asc, a.created_at asc
    `) as Row[];
    return { ok: true, data: rows.map(staffFromRow) };
  } catch {
    console.warn('[store-admin/staff] could not list store staff');
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }
}

export async function getStaff(id: string): Promise<StaffLoad<StaffMember>> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }

  try {
    const rows = (await sql`
      select a.id, a.name, a.email, a.phone, a.role, a.is_active,
             a.must_change_password, a.last_login_at, a.created_at,
             (
               select count(*)::int from store_admin_sessions s
               where s.admin_id = a.id and s.expires_at > now()
             ) as session_count
      from store_admins a
      where a.id = ${id.trim()}
      limit 1
    `) as Row[];
    if (!rows[0]) {
      return { ok: false, reason: 'not-found', error: 'That staff member does not exist.' };
    }
    return { ok: true, data: staffFromRow(rows[0]) };
  } catch {
    console.warn('[store-admin/staff] could not read a staff member');
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }
}

/* ------------------------------------------------------------- writing */

export function generateTemporaryPassword(): string {
  // Ambiguous characters are left out so a password read aloud or copied by
  // hand is not mistyped: no O/0, I/l/1.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(14);
  let out = '';
  for (let index = 0; index < 14; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

export interface CreatedStaff {
  staff: StaffMember;
  /** Shown once to the owner; never stored or returned again. */
  temporaryPassword: string;
}

export async function createStaff(
  input: {
    name?: unknown;
    email?: unknown;
    phone?: unknown;
    role?: unknown;
    password?: unknown;
  },
): Promise<StaffLoad<CreatedStaff>> {
  const validation = validateNewStaff(input);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid-input', error: validation.error };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }

  const value: NewStaffWithPassword = validation.value;
  const temporaryPassword = value.password || generateTemporaryPassword();

  try {
    const existing = (await sql`
      select 1 from store_admins where lower(email) = lower(${value.email}) limit 1
    `) as Row[];
    if (existing[0]) {
      return { ok: false, reason: 'conflict', error: 'That email already has a staff account.' };
    }

    const id = `sa_${randomBytes(8).toString('hex')}`;
    const hash = await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS);
    await sql`
      insert into store_admins (
        id, email, password_hash, name, role, phone,
        is_active, must_change_password, created_at, updated_at
      ) values (
        ${id}, ${value.email}, ${hash}, ${value.name}, ${value.role}, ${value.phone},
        true, true, now(), now()
      )
    `;

    const created = await getStaff(id);
    if (!created.ok) {
      return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
    }
    return { ok: true, data: { staff: created.data, temporaryPassword } };
  } catch {
    console.warn('[store-admin/staff] could not create a staff account');
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }
}

export interface StaffChange {
  name?: unknown;
  phone?: unknown;
  role?: unknown;
  isActive?: unknown;
}

export interface StaffChangeResult {
  before: StaffMember;
  after: StaffMember;
  sessionsRevoked: number;
}

export async function updateStaff(
  id: string,
  input: StaffChange,
  actorId: string,
): Promise<StaffLoad<StaffChangeResult>> {
  const profile = validateStaffProfile({ name: input.name, phone: input.phone });
  if (!profile.ok) {
    return { ok: false, reason: 'invalid-input', error: profile.error };
  }
  const nextRole = input.role === undefined ? undefined : roleOf(input.role);
  if (input.role !== undefined && !(STAFF_ROLES as readonly string[]).includes(String(input.role))) {
    return { ok: false, reason: 'invalid-input', error: 'Choose a valid role.' };
  }
  if (input.isActive !== undefined && typeof input.isActive !== 'boolean') {
    return { ok: false, reason: 'invalid-input', error: 'Status must be true or false.' };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select a.id, a.name, a.email, a.phone, a.role, a.is_active,
               a.must_change_password, a.last_login_at, a.created_at,
               (
                 select count(*)::int from store_admin_sessions s
                 where s.admin_id = a.id and s.expires_at > now()
               ) as session_count
        from store_admins a
        where a.id = ${id.trim()}
        for update of a
      `) as Row[];
      if (!rows[0]) {
        return { ok: false as const, reason: 'not-found' as const, error: 'That staff member does not exist.' };
      }

      const before = staffFromRow(rows[0]);
      const requestedActive = typeof input.isActive === 'boolean' ? input.isActive : undefined;
      const owners = (await tx`
        select count(*)::int as count from store_admins where role = 'store_owner' and is_active
      `) as Row[];
      const check = checkStaffChange({
        actorId,
        targetId: before.id,
        targetRole: before.role,
        targetActive: before.isActive,
        activeOwners: number(owners[0]?.count),
        nextRole,
        nextActive: requestedActive,
      });
      if (!check.ok) {
        return { ok: false as const, reason: 'last-owner' as const, error: check.error };
      }

      const nextName = profile.value.name;
      const nextPhone = profile.value.phone;
      const nextActive = requestedActive ?? before.isActive;

      await tx`
        update store_admins
        set name = ${nextName},
            phone = ${nextPhone},
            role = ${nextRole ?? before.role},
            is_active = ${nextActive},
            updated_at = now()
        where id = ${before.id}
      `;

      let sessionsRevoked = 0;
      if (!nextActive || (nextRole !== undefined && nextRole !== before.role)) {
        const removed = (await tx`
          delete from store_admin_sessions where admin_id = ${before.id} returning 1
        `) as Row[];
        sessionsRevoked = removed.length;
      }

      // Re-read inside the transaction: reading through the pool would wait on
      // this uncommitted row and deadlock.
      const afterRows = (await tx`
        select a.id, a.name, a.email, a.phone, a.role, a.is_active,
               a.must_change_password, a.last_login_at, a.created_at,
               (
                 select count(*)::int from store_admin_sessions s
                 where s.admin_id = a.id and s.expires_at > now()
               ) as session_count
        from store_admins a
        where a.id = ${before.id}
      `) as Row[];
      return {
        ok: true as const,
        data: { before, after: staffFromRow(afterRows[0] ?? rows[0]), sessionsRevoked },
      };
    });
  } catch {
    console.warn('[store-admin/staff] could not update a staff account');
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }
}

export async function resetStaffPassword(
  id: string,
  password: unknown,
): Promise<StaffLoad<{ staff: StaffMember; sessionsRevoked: number }>> {
  const check = validateNewPassword(password);
  if (!check.ok) {
    return { ok: false, reason: 'invalid-input', error: check.error };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id from store_admins where id = ${id.trim()} for update
      `) as Row[];
      if (!rows[0]) {
        return { ok: false as const, reason: 'not-found' as const, error: 'That staff member does not exist.' };
      }

      const hash = await bcrypt.hash(check.value, BCRYPT_ROUNDS);
      await tx`
        update store_admins
        set password_hash = ${hash},
            must_change_password = true,
            password_changed_at = now(),
            updated_at = now()
        where id = ${id.trim()}
      `;
      const removed = (await tx`
        delete from store_admin_sessions where admin_id = ${id.trim()} returning 1
      `) as Row[];

      const afterRows = (await tx`
        select a.id, a.name, a.email, a.phone, a.role, a.is_active,
               a.must_change_password, a.last_login_at, a.created_at,
               (
                 select count(*)::int from store_admin_sessions s
                 where s.admin_id = a.id and s.expires_at > now()
               ) as session_count
        from store_admins a
        where a.id = ${id.trim()}
      `) as Row[];
      return {
        ok: true as const,
        data: {
          staff: staffFromRow(afterRows[0] ?? rows[0]),
          sessionsRevoked: removed.length,
        },
      };
    });
  } catch {
    console.warn('[store-admin/staff] could not reset a staff password');
    return { ok: false, reason: 'unavailable', error: 'Staff are not available.' };
  }
}

/* ------------------------------------------------------- own account */

export async function updateOwnProfile(
  adminId: string,
  input: { name?: unknown; phone?: unknown },
): Promise<StaffLoad<StaffMember>> {
  const profile = validateStaffProfile(input);
  if (!profile.ok) {
    return { ok: false, reason: 'invalid-input', error: profile.error };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Your profile is not available.' };
  }

  try {
    await sql`
      update store_admins
      set name = ${profile.value.name}, phone = ${profile.value.phone}, updated_at = now()
      where id = ${adminId.trim()}
    `;
    return getStaff(adminId);
  } catch {
    console.warn('[store-admin/staff] could not update a profile');
    return { ok: false, reason: 'unavailable', error: 'Your profile is not available.' };
  }
}

export async function changeOwnPassword(input: {
  adminId: string;
  currentTokenHash: string;
  currentPassword: unknown;
  newPassword: unknown;
}): Promise<StaffLoad<{ sessionsRevoked: number }>> {
  const check = validateNewPassword(input.newPassword);
  if (!check.ok) {
    return { ok: false, reason: 'invalid-input', error: check.error };
  }
  if (typeof input.currentPassword !== 'string' || !input.currentPassword) {
    return { ok: false, reason: 'invalid-input', error: 'Enter your current password.' };
  }

  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Your profile is not available.' };
  }

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select password_hash from store_admins where id = ${input.adminId.trim()} for update
      `) as Row[];
      if (!rows[0]) {
        return { ok: false as const, reason: 'not-found' as const, error: 'That account does not exist.' };
      }

      const valid = await bcrypt.compare(input.currentPassword as string, text(rows[0].password_hash));
      if (!valid) {
        return { ok: false as const, reason: 'invalid-input' as const, error: 'Current password is not correct.' };
      }

      const hash = await bcrypt.hash(check.value, BCRYPT_ROUNDS);
      await tx`
        update store_admins
        set password_hash = ${hash},
            must_change_password = false,
            password_changed_at = now(),
            updated_at = now()
        where id = ${input.adminId.trim()}
      `;
      // Other devices are signed out; the session that changed the password
      // stays signed in so the change does not bounce the person to login.
      const removed = (await tx`
        delete from store_admin_sessions
        where admin_id = ${input.adminId.trim()}
          and token_hash <> ${input.currentTokenHash}
        returning 1
      `) as Row[];
      return { ok: true as const, data: { sessionsRevoked: removed.length } };
    });
  } catch {
    console.warn('[store-admin/staff] could not change a password');
    return { ok: false, reason: 'unavailable', error: 'Your profile is not available.' };
  }
}

/* ------------------------------------------------------------ sessions */

export async function listStaffSessions(
  adminId: string,
  currentTokenHash: string | null,
): Promise<StaffLoad<StaffSession[]>> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }

  try {
    // Expired rows are pruned opportunistically, as login already does.
    await sql`delete from store_admin_sessions where expires_at <= now()`;

    const rows = (await sql`
      select token_hash, created_at, expires_at
      from store_admin_sessions
      where admin_id = ${adminId.trim()}
      order by created_at desc
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => {
        const tokenHash = text(row.token_hash);
        return {
          id: sessionIdFor(tokenHash),
          createdAt: iso(row.created_at),
          expiresAt: iso(row.expires_at),
          current: currentTokenHash !== null && tokenHash === currentTokenHash,
        };
      }),
    };
  } catch {
    console.warn('[store-admin/staff] could not list sessions');
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }
}

/** Revoke one session; returns false when the id does not belong to the account. */
export async function revokeStaffSession(
  adminId: string,
  sessionId: string,
): Promise<StaffLoad<true>> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }

  try {
    const rows = (await sql`
      select token_hash from store_admin_sessions where admin_id = ${adminId.trim()}
    `) as Row[];
    const match = rows.find((row) => sessionIdFor(text(row.token_hash)) === sessionId.trim());
    if (!match) {
      return { ok: false, reason: 'not-found', error: 'That session does not exist.' };
    }
    await sql`
      delete from store_admin_sessions where token_hash = ${text(match.token_hash)}
    `;
    return { ok: true, data: true };
  } catch {
    console.warn('[store-admin/staff] could not revoke a session');
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }
}

export async function revokeAllStaffSessions(
  adminId: string,
  keepTokenHash: string | null,
): Promise<StaffLoad<{ sessionsRevoked: number }>> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }

  try {
    const rows = (await sql`
      delete from store_admin_sessions
      where admin_id = ${adminId.trim()}
        and (${keepTokenHash}::text is null or token_hash <> ${keepTokenHash}::text)
      returning 1
    `) as Row[];
    return { ok: true, data: { sessionsRevoked: rows.length } };
  } catch {
    console.warn('[store-admin/staff] could not revoke sessions');
    return { ok: false, reason: 'unavailable', error: 'Sessions are not available.' };
  }
}
