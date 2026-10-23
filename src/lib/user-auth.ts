import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getSql } from './admin/db';
import {
  isValidEmail,
  normalizeEmail,
  normalizeName,
  passwordByteLength,
  PASSWORD_MAX_BYTES,
} from './auth/validation';
import { checkRateLimit } from './payu/rate-limit';

/**
 * Consumer-facing authentication for Apple ID-style sign-in/sign-up.
 * Separate from the admin auth — these are end-user accounts.
 *
 * Security properties:
 * - Passwords hashed with bcrypt (cost 12).
 * - Tokens stored as SHA-256 hashes — a database leak cannot be replayed.
 * - Unknown emails run a dummy bcrypt compare to prevent timing side-channels.
 * - Rate limiting per email and per IP.
 */

const COOKIE_NAME = 'user_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BCRYPT_ROUNDS = 12;

/** Compare against a throwaway hash so unknown emails cost the same. */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.9k9jRy7B8uXhVh0d2OFqf7YlJmNqZ1u';

export interface UserSession {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

/* ------------------------------------------------------- rate limiting */

interface AttemptRecord {
  failures: number;
  lockedUntil: number;
}

const MAX_FAILURES = 8;
const LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes

const attempts = new Map<string, AttemptRecord>();

function attemptKeys(email: string, ip: string): [string, string] {
  return [`user-email:${email}`, `user-ip:${ip}`];
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

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Request rate limits, applied per client IP and per email address.
 *
 * `checkRateLimit` is the same in-memory sliding-window limiter used by the
 * PayU routes. It is per-process: a restart clears the counters and a
 * multi-instance deploy needs a shared store for a hard guarantee. The
 * failure lockout below (`MAX_FAILURES`) stays in place as a second layer.
 */
const SIGNUP_IP_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 };
const SIGNUP_EMAIL_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 };
const SIGNIN_IP_LIMIT = { limit: 60, windowMs: 5 * 60 * 1000 };
const SIGNIN_EMAIL_LIMIT = { limit: 20, windowMs: 5 * 60 * 1000 };

function tooManyRequests(
  email: string,
  ip: string,
  scope: 'signup' | 'signin',
): number | null {
  const ipLimit =
    scope === 'signup' ? SIGNUP_IP_LIMIT : SIGNIN_IP_LIMIT;
  const emailLimit =
    scope === 'signup' ? SIGNUP_EMAIL_LIMIT : SIGNIN_EMAIL_LIMIT;

  const ipResult = checkRateLimit(`user-${scope}-ip:${ip}`, ipLimit);
  if (!ipResult.allowed) return Math.max(1, ipResult.retryAfterSec);

  const emailResult = checkRateLimit(
    `user-${scope}-email:${email}`,
    emailLimit,
  );
  if (!emailResult.allowed) return Math.max(1, emailResult.retryAfterSec);

  return null;
}

/* ---------------------------------------------------------- helpers */

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/* ------------------------------------------------------------- sign up */

export async function signUp(
  email: string,
  password: string,
  firstName: string,
  lastName: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string; retryAfterSec?: number }
> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database is not configured.' };

  const normalized = normalizeEmail(email);
  const ip = await clientIp();

  const limited = tooManyRequests(normalized, ip, 'signup');
  if (limited !== null) {
    return {
      ok: false,
      error: 'Too many sign-up attempts. Please try again later.',
      retryAfterSec: limited,
    };
  }

  // Check for existing user
  const existing = await sql`select id from users where email = ${normalized}`;
  if (existing.length > 0) {
    return { ok: false, error: 'An account with this email already exists.' };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const userId = randomBytes(16).toString('hex');
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    insert into users (id, email, password_hash, first_name, last_name)
    values (${userId}, ${normalized}, ${passwordHash}, ${normalizeName(firstName)}, ${normalizeName(lastName)})
  `;

  await sql`
    insert into user_sessions (token_hash, user_id, expires_at)
    values (${tokenHash}, ${userId}, ${expires})
  `;

  return { ok: true, token };
}

/* ------------------------------------------------------------- sign in */

export async function signIn(
  email: string,
  password: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string; retryAfterSec?: number }
> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database is not configured.' };

  const normalized = normalizeEmail(email);
  const ip = await clientIp();

  const limited = tooManyRequests(normalized, ip, 'signin');
  if (limited !== null) {
    return {
      ok: false,
      error: 'Too many sign-in attempts. Please try again shortly.',
      retryAfterSec: limited,
    };
  }

  if (isLocked(normalized, ip)) {
    return {
      ok: false,
      error: 'Too many failed attempts. Please try again in 10 minutes.',
      retryAfterSec: LOCKOUT_MS / 1000,
    };
  }

  // An address that cannot be an account, or a password bcrypt would truncate,
  // can never match. Still pay for one bcrypt compare so the response time does
  // not distinguish "impossible input" from "unknown account".
  if (
    !isValidEmail(normalized) ||
    passwordByteLength(password) > PASSWORD_MAX_BYTES
  ) {
    await bcrypt.compare(password, DUMMY_HASH);
    recordFailure(normalized, ip);
    return { ok: false, error: 'Invalid email or password.' };
  }

  const rows = await sql`
    select id, password_hash, first_name, last_name
    from users where email = ${normalized}
  `;
  const user = rows[0];

  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    recordFailure(normalized, ip);
    return { ok: false, error: 'Invalid email or password.' };
  }

  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await sql`
    insert into user_sessions (token_hash, user_id, expires_at)
    values (${tokenHash}, ${user.id}, ${expires})
  `;
  // Opportunistic cleanup
  await sql`delete from user_sessions where expires_at <= now()`;

  recordSuccess(normalized, ip);
  return { ok: true, token };
}

/* ----------------------------------------------------------- session */

export async function getUserSession(): Promise<UserSession | null> {
  const sql = getSql();
  if (!sql) return null;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await sql`
    select u.id, u.email, u.first_name, u.last_name, u.phone
    from user_sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now()
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone || null,
  };
}

export async function updateUserProfile(
  userId: string,
  input: { firstName: string; lastName: string; phone: string },
): Promise<UserSession | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<Array<{ id: string; email: string; first_name: string; last_name: string; phone: string | null }>>`
    update users
    set first_name = ${normalizeName(input.firstName)}, last_name = ${normalizeName(input.lastName)},
      phone = ${input.phone || null}, updated_at = now()
    where id = ${userId}
    returning id, email, first_name, last_name, phone
  `;
  const row = rows[0];
  return row
    ? { userId: row.id, email: row.email, firstName: row.first_name, lastName: row.last_name, phone: row.phone }
    : null;
}

export async function changeUserPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'Database is not configured.' };
  const store = await cookies();
  const currentToken = store.get(COOKIE_NAME)?.value;
  if (!currentToken) return { ok: false, error: 'Authentication required.' };
  const rows = await sql<Array<{ password_hash: string }>>`
    select password_hash from users where id = ${userId} limit 1
  `;
  if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
    return { ok: false, error: 'Current password is incorrect.' };
  }
  if (passwordByteLength(newPassword) < 8 || passwordByteLength(newPassword) > PASSWORD_MAX_BYTES) {
    return { ok: false, error: 'New password must be 8 to 72 UTF-8 bytes.' };
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await sql`update users set password_hash = ${passwordHash}, updated_at = now() where id = ${userId}`;
  await sql`delete from user_sessions where user_id = ${userId} and token_hash <> ${hashToken(currentToken)}`;
  return { ok: true };
}

export async function userLogout(): Promise<void> {
  const sql = getSql();
  if (!sql) return;

  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await sql`delete from user_sessions where token_hash = ${hashToken(token)}`;
  }
}

export const userSessionCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  } as const,
};
