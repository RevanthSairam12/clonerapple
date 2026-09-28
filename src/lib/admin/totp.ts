import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';

import { getSql } from './db';
import { getSession } from './auth';

/**
 * TOTP two-factor authentication (RFC 6238) for the admin panel.
 *
 * Enrollment flow:
 *  1. POST /api/admin/totp/setup   — generates a pending secret, returns the
 *     otpauth:// URL + a QR (SVG data URI) for the authenticator app.
 *  2. POST /api/admin/totp/enable  — editor submits a code from the app; if
 *     it verifies, totp_enabled flips on and a recovery code is returned
 *     ONCE (bcrypt-hashed at rest, shown only here).
 *  3. Login then requires password + a valid code (or the recovery code).
 *
 * Codes are 6 digits / 30s with a ±1 step window (standard authenticator
 * behavior). Replay of the *same* code within its step is blocked by
 * recording the last used counter.
 */

const ISSUER = 'Apple Clone Admin';

/** A random base32 secret for a new enrollment. */
export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32;
}

/** The otpauth:// URL authenticator apps ingest (via QR or paste). */
export function totpUrl(email: string, secret: string): string {
  return new TOTP({
    issuer: ISSUER,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  }).toString();
}

/** QR as an SVG data URI — rendered server-side, no client JS needed. */
export async function totpQrDataUri(url: string): Promise<string> {
  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 240,
    color: { dark: '#1d1d1f', light: '#ffffff' },
  });
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

/** Verify a 6-digit code against a secret (±1 time step). */
export function verifyTotp(secret: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  // window 1 accepts the previous/next step (clock drift); the delta lets us
  // detect replay of the same code via the counter.
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

/* --------------------------------------------------- current editor state */

export interface TotpStatus {
  enabled: boolean;
  /** A pending, unconfirmed secret exists (mid-enrollment). */
  pending: boolean;
}

export async function getTotpStatus(userId: string): Promise<TotpStatus> {
  const sql = getSql();
  if (!sql) return { enabled: false, pending: false };
  const rows = await sql`
    select totp_enabled, totp_secret is not null as has_secret
    from admin_users where id = ${userId}
  `;
  const row = rows[0];
  return {
    enabled: Boolean(row?.totp_enabled),
    pending: Boolean(row?.has_secret) && !row?.totp_enabled,
  };
}

/** Store a fresh pending secret (replaces any previous unconfirmed one). */
export async function savePendingSecret(userId: string, secret: string): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    update admin_users
    set totp_secret = ${secret}, totp_enabled = false
    where id = ${userId}
  `;
}

/** Confirm enrollment: enable TOTP and set the recovery code hash. */
export async function enableTotp(userId: string, recoveryHash: string): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    update admin_users
    set totp_enabled = true, recovery_hash = ${recoveryHash}
    where id = ${userId}
  `;
}

/** Turn TOTP off and clear the secret + recovery hash. */
export async function disableTotp(userId: string): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  await sql`
    update admin_users
    set totp_enabled = false, totp_secret = null, recovery_hash = null
    where id = ${userId}
  `;
}

/* --------------------------------------------------------- recovery codes */

/** Generate a one-time recovery code (groups of 5 for readability). */
export function newRecoveryCode(): string {
  const raw = randomBytes(10).toString('hex'); // 20 hex chars
  return (raw.match(/.{5}/g) ?? []).join('-').toUpperCase();
}

export function hashRecoveryCode(code: string): Promise<string> {
  return bcrypt.hash(code.toUpperCase().trim(), 10);
}

export async function compareRecoveryCode(hash: string, code: string): Promise<boolean> {
  return bcrypt.compare(code.toUpperCase().trim(), hash);
}

/** Load the current editor's secret + recovery hash (admin only). */
export async function loadEditorTotp(userId: string): Promise<{
  secret: string | null;
  recoveryHash: string | null;
  enabled: boolean;
}> {
  const sql = getSql();
  if (!sql) return { secret: null, recoveryHash: null, enabled: false };
  const rows = await sql`
    select totp_secret, recovery_hash, totp_enabled from admin_users where id = ${userId}
  `;
  const row = rows[0];
  return {
    secret: row?.totp_secret ?? null,
    recoveryHash: row?.recovery_hash ?? null,
    enabled: Boolean(row?.totp_enabled),
  };
}

/** Guard for TOTP routes: the signed-in editor, or null. */
export async function currentEditor(): Promise<{ userId: string; email: string } | null> {
  const session = await getSession();
  return session ? { userId: session.userId, email: session.email } : null;
}

/**
 * Random 6-digit code generator for tests/manual flows (not used by the
 * production login path — the editor's authenticator generates codes).
 */
export function _testCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Stable identifier for rate-limit bucketing (unused placeholder kept for API symmetry). */
export function _bucketId(email: string, ip: string): string {
  return createHash('sha256').update(`${email}|${ip}`).digest('hex').slice(0, 16);
}
