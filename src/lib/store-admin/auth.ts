import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { clientIp } from '@/lib/admin/auth';
import { getSql } from '@/lib/admin/db';
import { verifyTotp } from '@/lib/admin/totp';

/**
 * Authentication for the store admin panel.
 *
 * This is deliberately parallel to — and completely separate from — the
 * content panel in `src/lib/admin/auth.ts`:
 *
 * - rows live in `store_admins` / `store_admin_sessions`, not `admin_users`;
 * - the cookie is `store_admin_session`, not `admin_session`;
 * - every session carries a role (`store_owner` / `store_admin` /
 *   `store_viewer`) that gates writes.
 *
 * Both panels keep the same security posture: SHA-256 token hashes at rest,
 * 7-day server-side sessions, httpOnly + SameSite=Lax + Secure-in-production
 * cookies, constant-cost password checks for unknown accounts, and a
 * 5-failure / 15-minute lockout per email and per client IP.
 *
 * The pure helpers (`clientIp`, `verifyTotp`) are imported from the existing
 * admin code rather than duplicated. No existing admin file is modified.
 */

export type StoreRole = 'store_owner' | 'store_admin' | 'store_viewer';

export interface StoreSession {
  adminId: string;
  email: string;
  name: string;
  role: StoreRole;
}

const COOKIE_NAME = 'store_admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Compare against a throwaway hash so unknown emails cost the same as known ones. */
const DUMMY_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEe.9k9jRy7B8uXhVh0d2OFqf7YlJmNqZ1u';

const ROLES: readonly StoreRole[] = ['store_owner', 'store_admin', 'store_viewer'];

/** Higher rank satisfies a lower requirement (owner ⊇ admin ⊇ viewer). */
const ROLE_RANK: Record<StoreRole, number> = {
  store_viewer: 1,
  store_admin: 2,
  store_owner: 3,
};

export function isStoreRole(value: unknown): value is StoreRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** True when `role` is at least the level of every role in `required`. */
function roleSatisfies(role: StoreRole, required: StoreRole[]): boolean {
  if (required.length === 0) return true;
  return required.some((r) => ROLE_RANK[role] >= ROLE_RANK[r]);
}

/* ------------------------------------------------------- rate limiting */

interface AttemptRecord {
  failures: number;
  lockedUntil: number;
}

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * In-memory, per-process counters — the same trade-off as the content panel:
 * a restart clears locks, and a multi-instance deploy needs a shared store.
 * Keyed independently from the content panel so one lockout cannot affect
 * the other panel.
 */
const attempts = new Map<string, AttemptRecord>();

function attemptKeys(email: string, ip: string): [string, string] {
  return [`store-admin:email:${email}`, `store-admin:ip:${ip}`];
}

function isLocked(email: string, ip: string): boolean {
  const now = Date.now();
  for (const key of attemptKeys(email, ip)) {
    const record = attempts.get(key);
    if (record && record.lockedUntil > now) return true;
  }
  return false;
}

function recordFailure(email: string, ip: string): void {
  for (const key of attemptKeys(email, ip)) {
    const record = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
    record.failures += 1;
    if (record.failures >= MAX_FAILURES) {
      record.lockedUntil = Date.now() + LOCKOUT_MS;
      record.failures = 0;
    }
    attempts.set(key, record);
  }
}

function recordSuccess(email: string, ip: string): void {
  for (const key of attemptKeys(email, ip)) attempts.delete(key);
}

/* ------------------------------------------------------------- helpers */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toSession(row: Record<string, any>): StoreSession {
  return {
    adminId: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: isStoreRole(row.role) ? row.role : 'store_viewer',
  };
}

/* --------------------------------------------------------------- login */

export type StoreLoginResult =
  | { ok: true; token: string; adminId: string; role: StoreRole }
  | {
      ok: false;
      error: string;
      codeRequired?: boolean;
      retryAfterSec?: number;
      /** HTTP status the route should use. */
      status: 401 | 429;
    };

export async function login(
  email: string,
  password: string,
  totpCode?: string,
): Promise<StoreLoginResult> {
  const sql = getSql();
  if (!sql) {
    return { ok: false, error: 'Database is not configured.', status: 401 };
  }

  const normalized = email.trim().toLowerCase();
  const ip = await clientIp();

  if (isLocked(normalized, ip)) {
    return {
      ok: false,
      error: 'Too many failed attempts. Try again in 15 minutes.',
      retryAfterSec: LOCKOUT_MS / 1000,
      status: 429,
    };
  }

  const rows = await sql`
    select id, email, name, password_hash, role, is_active,
           totp_secret, totp_enabled, recovery_hash
    from store_admins
    where email = ${normalized}
  `;
  const admin = rows[0];

  // Always run bcrypt so a missing account costs the same as a wrong password.
  const valid = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !valid || !admin.is_active) {
    recordFailure(normalized, ip);
    return { ok: false, error: 'Invalid email or password.', status: 401 };
  }

  if (admin.totp_enabled && admin.totp_secret) {
    const code = (totpCode ?? '').trim();
    let codeOk = false;

    if (/^\d{6}$/.test(code)) {
      codeOk = verifyTotp(admin.totp_secret, code);
    } else if (admin.recovery_hash && /^[0-9A-Za-z-]{11,30}$/.test(code)) {
      codeOk = await bcrypt.compare(code.toUpperCase(), admin.recovery_hash);
    }

    if (!codeOk) {
      recordFailure(normalized, ip);
      return {
        ok: false,
        error: code ? 'Invalid verification code.' : 'Verification code required.',
        codeRequired: true,
        status: 401,
      };
    }
  }

  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await sql`
    insert into store_admin_sessions (token_hash, admin_id, expires_at)
    values (${hashToken(token)}, ${admin.id}, ${expires})
  `;
  // Opportunistic cleanup of expired rows.
  await sql`delete from store_admin_sessions where expires_at <= now()`;

  recordSuccess(normalized, ip);

  return {
    ok: true,
    token,
    adminId: admin.id,
    role: isStoreRole(admin.role) ? admin.role : 'store_viewer',
  };
}

/* ----------------------------------------------------------- session */

/** Read the current store-admin session; null when not signed in. */
export async function getStoreSession(): Promise<StoreSession | null> {
  const sql = getSql();
  if (!sql) return null;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await sql`
    select a.id, a.email, a.name, a.role
    from store_admin_sessions s
    join store_admins a on a.id = s.admin_id
    where s.token_hash = ${hashToken(token)}
      and s.expires_at > now()
      and a.is_active
  `;
  const row = rows[0];
  return row ? toSession(row) : null;
}

export async function logout(): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await sql`delete from store_admin_sessions where token_hash = ${hashToken(token)}`;
  }
}

/* -------------------------------------------------------------- guards */

/**
 * API guard: require a signed-in store admin whose role satisfies at least one
 * of `roles`. With no roles, any signed-in store admin passes.
 *
 * Returns a ready-to-return 401/403 response on failure, so routes can write:
 *   const guard = await requireStoreRole('store_admin');
 *   if (!guard.ok) return guard.response;
 *
 * Page code should use `getStoreSession()` and `redirect()` instead.
 */
export async function requireStoreRole(
  ...roles: StoreRole[]
): Promise<
  | { ok: true; session: StoreSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getStoreSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!roleSatisfies(session.role, roles)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    };
  }
  return { ok: true, session };
}

export const storeSessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  } as const,
};

export const STORE_SESSION_COOKIE_NAME = COOKIE_NAME;
