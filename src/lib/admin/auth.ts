import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getSql } from './db';
import { verifyTotp } from './totp';

/**
 * Email+password auth for the admin panel. Sessions are server-side rows in
 * admin_sessions; the browser holds only an opaque httpOnly cookie token.
 *
 * Security properties:
 * - Tokens are stored as SHA-256 hashes — a database leak cannot be replayed.
 * - Unknown emails run a dummy bcrypt compare so response timing does not
 *   reveal whether an account exists.
 * - Failed logins are rate-limited per email and per client IP (lockout).
 */

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Compare against a throwaway hash so unknown emails cost the same as known ones. */
const DUMMY_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEe.9k9jRy7B8uXhVh0d2OFqf7YlJmNqZ1u';

export interface EditorSession {
  userId: string;
  email: string;
  name: string;
}

/* ------------------------------------------------------- rate limiting */

interface AttemptRecord {
  failures: number;
  lockedUntil: number;
}

const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

// In-memory counters; reset on server restart, which is an acceptable
// trade-off for this panel (a restart clears locks, not protection entirely —
// the window just re-opens for one round of attempts).
const attempts = new Map<string, AttemptRecord>();

function attemptKeys(email: string, ip: string): [string, string] {
  return [`email:${email}`, `ip:${ip}`];
}

/** True when either the email or the IP is currently locked out. */
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

/** Best-effort client IP from proxy headers; '' when unknown. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    ''
  );
}

/* ------------------------------------------------------------- login */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Verify credentials; returns a session token cookie value on success. */
export async function login(
  email: string,
  password: string,
  totpCode?: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string; codeRequired?: boolean; retryAfterSec?: number }
> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database is not configured (DATABASE_URL missing).' };

  const normalized = email.toLowerCase();
  const ip = await clientIp();
  if (isLocked(normalized, ip)) {
    return {
      ok: false,
      error: 'Too many failed attempts. Try again in 15 minutes.',
      retryAfterSec: LOCKOUT_MS / 1000,
    };
  }

  const rows = await sql`
    select id, password_hash, totp_secret, totp_enabled, recovery_hash
    from admin_users where email = ${normalized}
  `;
  const user = rows[0];

  // Always run bcrypt — a missing user costs the same as a wrong password,
  // so timing does not reveal registered emails.
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    recordFailure(normalized, ip);
    return { ok: false, error: 'Invalid email or password.' };
  }

  // Second factor: a TOTP-enabled account refuses to issue a session without
  // a valid code. The code (or recovery code) is checked in the same request
  // — there is no half-authenticated state to hijack. A wrong/missing code
  // counts toward the lockout exactly like a wrong password.
  if (user.totp_enabled && user.totp_secret) {
    const code = (totpCode ?? '').trim();
    let codeOk = false;

    if (/^\d{6}$/.test(code) && typeof user.totp_secret === 'string') {
      codeOk = verifyTotp(user.totp_secret, code);
    } else if (user.recovery_hash && /^[0-9A-Za-z-]{11,30}$/.test(code)) {
      // Recovery codes look like XXXXX-XXXXX-XXXXX-XXXXX; try it only when
      // it's not shaped like a TOTP code.
      codeOk = await bcrypt.compare(code.toUpperCase(), user.recovery_hash);
    }

    if (!codeOk) {
      recordFailure(normalized, ip);
      return {
        ok: false,
        error: code ? 'Invalid verification code.' : 'Verification code required.',
        codeRequired: true,
      };
    }
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_MS);
  await sql`
    insert into admin_sessions (token_hash, user_id, expires_at)
    values (${tokenHash}, ${user.id}, ${expires})
  `;
  // Opportunistic cleanup: drop expired rows.
  await sql`delete from admin_sessions where expires_at <= now()`;

  recordSuccess(normalized, ip);
  return { ok: true, token };
}

/** Read the current session from the request cookies; null when not signed in. */
export async function getSession(): Promise<EditorSession | null> {
  const sql = getSql();
  if (!sql) return null;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await sql`
    select u.id, u.email, u.name
    from admin_sessions s
    join admin_users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()
  `;
  const row = rows[0];
  if (!row) return null;
  return { userId: row.id, email: row.email, name: row.name };
}

/** Delete the current session (logout). */
export async function logout(): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await sql`delete from admin_sessions where token_hash = ${hashToken(token)}`;
  }
}

export const sessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  } as const,
};
