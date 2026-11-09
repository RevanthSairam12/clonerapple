import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';

import { clientIp } from '@/lib/platform/client-ip';
import { getSql } from '@/lib/platform/db';
import { verifySecondFactor } from '@/lib/store-admin/totp';

/**
 * Authentication for the store admin panel.
 *
 * This is deliberately parallel to — and completely separate from — the
 * content panel (removed):
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
  /** True until a temporary password has been replaced. */
  mustChangePassword: boolean;
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

/**
 * True when `role` is at least the level of every role in `required`.
 * Exported for the role-matrix test, which asserts the same decision the guard
 * makes for each sensitive route.
 */
export function roleSatisfies(role: StoreRole, required: StoreRole[]): boolean {
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

function isLocked(email: string, ip: string, now: number): boolean {
  for (const key of attemptKeys(email, ip)) {
    const record = attempts.get(key);
    if (record && record.lockedUntil > now) return true;
  }
  return false;
}

function recordFailure(email: string, ip: string, now: number): void {
  for (const key of attemptKeys(email, ip)) {
    const record = attempts.get(key) ?? { failures: 0, lockedUntil: 0 };
    record.failures += 1;
    if (record.failures >= MAX_FAILURES) {
      record.lockedUntil = now + LOCKOUT_MS;
      record.failures = 0;
    }
    attempts.set(key, record);
  }
}

function recordSuccess(email: string, ip: string): void {
  for (const key of attemptKeys(email, ip)) attempts.delete(key);
  totpAttempts.delete(totpKey(email));
}

/**
 * Verification-code attempts are counted per account as well as per IP, so
 * rotating IPs cannot brute-force a 6-digit code. The counter is checked only
 * after the password has been accepted, which stops an unauthenticated caller
 * from locking an account out.
 */
const MAX_TOTP_FAILURES = 10;
const totpAttempts = new Map<string, AttemptRecord>();

function totpKey(email: string): string {
  return `store-admin:totp:${email}`;
}

function isTotpLocked(email: string, now: number): boolean {
  const record = totpAttempts.get(totpKey(email));
  return Boolean(record && record.lockedUntil > now);
}

function recordTotpFailure(email: string, now: number): void {
  const key = totpKey(email);
  const record = totpAttempts.get(key) ?? { failures: 0, lockedUntil: 0 };
  record.failures += 1;
  if (record.failures >= MAX_TOTP_FAILURES) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.failures = 0;
  }
  totpAttempts.set(key, record);
}

export function clearInMemoryAuthAttempts(): void {
  attempts.clear();
  totpAttempts.clear();
}

/* ------------------------------------------------------------- helpers */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return '[redacted email]';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!domain) return '[redacted email]';
  return `${local.slice(0, 1)}***@${domain}`;
}

function toSession(row: Record<string, any>): StoreSession {
  return {
    adminId: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: isStoreRole(row.role) ? row.role : 'store_viewer',
    mustChangePassword:
      row.must_change_password === true || String(row.must_change_password) === 'true',
  };
}

/* --------------------------------------------------------------- login */

export type StoreLoginResult =
  | {
      ok: true;
      token: string;
      adminId: string;
      role: StoreRole;
      mustChangePassword: boolean;
    }
  | {
      ok: false;
      error: string;
      codeRequired?: boolean;
      retryAfterSec?: number;
      /** HTTP status the route should use. */
      status: 401 | 429;
    };

export const MAX_PASSWORD_FAILURES = MAX_FAILURES;
export const MAX_STORE_TOTP_FAILURES = MAX_TOTP_FAILURES;
export const STORE_LOCKOUT_MS = LOCKOUT_MS;

const AUTH_ATTEMPT_ACTION = 'store_admin.auth_attempt';
const AUTH_ATTEMPT_ENTITY = 'store_admin_auth';
const AUTH_ADVISORY_NAMESPACE = 41010;

export interface StoreLoginOptions {
  /** Optional database client override (used by multi-instance and concurrency tests). */
  sql?: NonNullable<ReturnType<typeof getSql>>;
  /** Optional client IP override. */
  ip?: string | null;
  /** Optional clock override (ISO string, Date, or epoch ms) for deterministic expiry tests. */
  now?: Date | string | number;
}

interface DistributedLockoutSummary {
  emailPasswordFailures: number;
  ipPasswordFailures: number;
  totpFailures: number;
  passwordRetryAfterSec: number;
  totpRetryAfterSec: number;
}

function summarizeAttemptRows(
  rows: ReadonlyArray<Record<string, unknown>>,
  emailHash: string,
  ipHash: string | null,
): DistributedLockoutSummary {
  let emailPasswordFailures = 0;
  let ipPasswordFailures = 0;
  let totpFailures = 0;
  let emailResetSeen = false;
  let ipResetSeen = false;
  let passwordRetryAfterSec = LOCKOUT_MS / 1000;
  let totpRetryAfterSec = LOCKOUT_MS / 1000;

  for (const row of rows) {
    const entityId = String(row.entity_id ?? '');
    const rowIpHash = row.ip_hash ? String(row.ip_hash) : null;
    const status = String(row.status ?? '');
    const reason = String(row.reason ?? '');
    const retrySec = Math.max(1, Math.min(LOCKOUT_MS / 1000, Number(row.retry_after_sec) || LOCKOUT_MS / 1000));

    if (entityId === emailHash && !emailResetSeen) {
      if (status === 'ok') {
        emailResetSeen = true;
      } else if (reason === 'password_failure') {
        emailPasswordFailures += 1;
        if (emailPasswordFailures === MAX_FAILURES) {
          passwordRetryAfterSec = retrySec;
        }
      } else if (reason === 'totp_failure') {
        totpFailures += 1;
        if (totpFailures === MAX_TOTP_FAILURES) {
          totpRetryAfterSec = retrySec;
        }
      }
    }

    if (ipHash && rowIpHash === ipHash && !ipResetSeen) {
      if (status === 'ok') {
        ipResetSeen = true;
      } else if (reason === 'password_failure') {
        ipPasswordFailures += 1;
        if (ipPasswordFailures === MAX_FAILURES && emailPasswordFailures < MAX_FAILURES) {
          passwordRetryAfterSec = retrySec;
        }
      }
    }
  }

  return {
    emailPasswordFailures,
    ipPasswordFailures,
    totpFailures,
    passwordRetryAfterSec,
    totpRetryAfterSec,
  };
}

export async function login(
  email: string,
  password: string,
  totpCode?: string,
  options: StoreLoginOptions = {},
): Promise<StoreLoginResult> {
  const sql = options.sql ?? getSql();
  if (!sql) {
    return { ok: false, error: 'Database is not configured.', status: 401 };
  }

  const normalized = email.trim().toLowerCase();
  const ip = (options.ip !== undefined ? options.ip ?? '' : await clientIp()).trim();
  const emailHash = hashToken(normalized);
  const ipHash = ip ? hashToken(ip) : null;
  const maskedEmail = maskEmail(normalized);

  const nowOverrideIso =
    options.now !== undefined ? new Date(options.now).toISOString() : null;
  const clock = nowOverrideIso
    ? [{ now: nowOverrideIso }]
    : await sql`select now() as now`;
  const now = new Date(clock[0].now).getTime();
  if (!Number.isFinite(now)) return { ok: false, status: 401, error: 'Sign-in is temporarily unavailable.' };
  const effectiveNowIso = new Date(now).toISOString();

  const rows = await sql`
    select id, email, name, password_hash, role, is_active, must_change_password,
           totp_secret, totp_enabled, recovery_hash
    from store_admins
    where email = ${normalized}
  `;
  const admin = rows[0];

  // Always run bcrypt outside the transaction lock so a missing account costs
  // the same as a wrong password and CPU hashing never holds a DB lock.
  const valid = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  const token = randomBytes(32).toString('hex');

  const outcome = await sql.begin(async (tx) => {
    // 1. Serialize concurrent login attempts for this email and client IP across
    //    all serverless instances using transaction-scoped advisory locks in a
    //    deterministic sorted order.
    const lockKeys = [`sa_auth_email:${emailHash}`];
    if (ipHash) lockKeys.push(`sa_auth_ip:${ipHash}`);
    lockKeys.sort();
    for (const lockKey of lockKeys) {
      await tx`select pg_advisory_xact_lock(${AUTH_ADVISORY_NAMESPACE}, hashtext(${lockKey}))`;
    }

    // 2. Read recent authentication attempt rows from store_admin_audit under
    //    the advisory lock.
    const attemptRows = (await tx`
      select
        entity_id,
        ip_hash,
        status,
        reason,
        ceil(extract(epoch from ((created_at + interval '15 minutes') - ${effectiveNowIso}::timestamptz)))::int as retry_after_sec
      from store_admin_audit
      where action = ${AUTH_ATTEMPT_ACTION}
        and entity = ${AUTH_ATTEMPT_ENTITY}
        and (entity_id = ${emailHash} or (${ipHash}::text is not null and ip_hash = ${ipHash}))
        and created_at > ${effectiveNowIso}::timestamptz - interval '15 minutes'
        and created_at <= ${effectiveNowIso}::timestamptz
      order by created_at desc, id desc
      limit 100
    `) as Array<Record<string, unknown>>;

    const summary = summarizeAttemptRows(attemptRows, emailHash, ipHash);
    const dbPasswordLocked =
      summary.emailPasswordFailures >= MAX_FAILURES ||
      summary.ipPasswordFailures >= MAX_FAILURES;

    if (dbPasswordLocked || (attemptRows.length === 0 && isLocked(normalized, ip, now))) {
      return {
        ok: false as const,
        error: 'Too many failed attempts. Try again in 15 minutes.',
        retryAfterSec: dbPasswordLocked ? summary.passwordRetryAfterSec : LOCKOUT_MS / 1000,
        status: 429 as const,
      };
    }

    if (!admin || !valid || !admin.is_active) {
      await tx`
        insert into store_admin_audit (
          actor_id, actor_email, action, entity, entity_id,
          route, status, reason, ip_hash, created_at
        ) values (
          ${admin?.id ?? null},
          ${maskedEmail},
          ${AUTH_ATTEMPT_ACTION},
          ${AUTH_ATTEMPT_ENTITY},
          ${emailHash},
          '/api/store-admin/auth/login',
          ${'denied'},
          ${'password_failure'},
          ${ipHash},
          ${effectiveNowIso}::timestamptz
        )
      `;
      recordFailure(normalized, ip, now);
      return { ok: false as const, error: 'Invalid email or password.', status: 401 as const };
    }

    if (admin.totp_enabled && admin.totp_secret) {
      const code = (totpCode ?? '').trim();
      const dbTotpLocked = summary.totpFailures >= MAX_TOTP_FAILURES;

      if (dbTotpLocked || (attemptRows.length === 0 && isTotpLocked(normalized, now))) {
        return {
          ok: false as const,
          error: 'Too many incorrect verification codes. Try again in 15 minutes.',
          codeRequired: true,
          retryAfterSec: dbTotpLocked ? summary.totpRetryAfterSec : LOCKOUT_MS / 1000,
          status: 429 as const,
        };
      }

      const codeOk = await verifySecondFactor(
        admin.id,
        admin.totp_secret as string,
        (admin.recovery_hash as string | null) ?? null,
        code,
        tx,
      );

      if (!codeOk) {
        await tx`
          insert into store_admin_audit (
            actor_id, actor_email, action, entity, entity_id,
            route, status, reason, ip_hash, created_at
          ) values (
            ${admin.id},
            ${maskedEmail},
            ${AUTH_ATTEMPT_ACTION},
            ${AUTH_ATTEMPT_ENTITY},
            ${emailHash},
            '/api/store-admin/auth/login',
            ${'denied'},
            ${'totp_failure'},
            ${ipHash},
            ${effectiveNowIso}::timestamptz
          )
        `;
        // TOTP failures are counted independently from password failures.
        recordTotpFailure(normalized, now);
        return {
          ok: false as const,
          error: code ? 'Invalid verification code.' : 'Verification code required.',
          codeRequired: true,
          status: 401 as const,
        };
      }
    }

    // Serialize session issuance against removal, deactivation and password resets.
    const live = await tx`
      select id from store_admins where id = ${admin.id}
        and is_active and removed_at is null and password_hash = ${admin.password_hash}
      for update
    `;
    if (!live.length) {
      return { ok: false as const, error: 'Invalid email or password.', status: 401 as const };
    }
    await tx`
      insert into store_admin_sessions (token_hash, admin_id, expires_at)
      values (${hashToken(token)}, ${admin.id}, now() + interval '7 days')
    `;
    await tx`update store_admins set last_login_at = now() where id = ${admin.id}`;
    await tx`
      insert into store_admin_audit (
        actor_id, actor_email, action, entity, entity_id,
        route, status, reason, ip_hash, created_at
      ) values (
        ${admin.id},
        ${maskedEmail},
        ${AUTH_ATTEMPT_ACTION},
        ${AUTH_ATTEMPT_ENTITY},
        ${emailHash},
        '/api/store-admin/auth/login',
        ${'ok'},
        ${'login_ok'},
        ${ipHash},
        ${effectiveNowIso}::timestamptz
      )
    `;

    recordSuccess(normalized, ip);
    return {
      ok: true as const,
      token,
      adminId: admin.id as string,
      role: isStoreRole(admin.role) ? admin.role : ('store_viewer' as StoreRole),
      mustChangePassword:
        admin.must_change_password === true || String(admin.must_change_password) === 'true',
    };
  });

  if (!outcome.ok) return outcome;

  // Opportunistic cleanup of expired rows.
  await sql`delete from store_admin_sessions where expires_at <= now()`;

  return outcome;
}

/* ----------------------------------------------------------- session */

/** Read the current store-admin session; null when not signed in. */
export async function getStoreSessionForToken(token: string): Promise<StoreSession | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`
    select a.id, a.email, a.name, a.role, a.must_change_password
    from store_admin_sessions s
    join store_admins a on a.id = s.admin_id
    where s.token_hash = ${hashToken(token)}
      and s.expires_at > now()
      and a.is_active and a.removed_at is null
  `;
  return rows[0] ? toSession(rows[0]) : null;
}

export async function getStoreSession(options: { allowPasswordChange?: boolean } = {}): Promise<StoreSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await getStoreSessionForToken(token);
  if (session?.mustChangePassword && !options.allowPasswordChange) {
    redirect('/store-admin/change-password');
  }
  return session;
}

/**
 * SHA-256 of the current session cookie. Used to mark "this device" in the
 * session list and to keep the current session alive when a password changes.
 * Never send this value to the browser.
 */
export async function currentStoreTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  return token ? hashToken(token) : null;
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
  ...requirements: Array<StoreRole | { allowPasswordChange: true }>
): Promise<
  | { ok: true; session: StoreSession }
  | { ok: false; response: NextResponse }
> {
  const roles = requirements.filter((value): value is StoreRole => typeof value === 'string');
  const allowPasswordChange = requirements.some((value) => typeof value === 'object' && value.allowPasswordChange);
  const session = await getStoreSession({ allowPasswordChange: true });
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({
        error: 'Your account was removed or deactivated. Contact the store owner.',
        redirect: '/store-admin/login?reason=account-unavailable',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } }),
    };
  }
  if (session.mustChangePassword && !allowPasswordChange) {
    return {
      ok: false,
      response: NextResponse.json({
        error: 'Change your temporary password before continuing.',
        code: 'password_change_required',
        redirect: '/store-admin/change-password',
      }, { status: 403 }),
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
