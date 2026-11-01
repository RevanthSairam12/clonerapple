import { createHash, randomBytes, randomInt } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { Secret, TOTP } from 'otpauth';
import QRCode from 'qrcode';

/**
 * TOTP two-factor helpers (RFC 6238).
 *
 * Shared by Store Admin and, until it is removed, the legacy admin panel.
 * These functions are pure — they never touch the database — so enrolment,
 * login and the account-migration script all exercise the same code path.
 *
 * Codes are 6 digits / 30 s with a ±1 step window (standard authenticator
 * clock-drift tolerance). `verifyTotpStep` returns the matched time step so a
 * caller can record it and reject the same code twice (replay protection).
 */

/**
 * Shown as the account/issuer name in authenticator apps. Branding only — it is
 * not part of the secret and changing it does not invalidate existing
 * enrolments (the codes are derived from the secret alone).
 */
const ISSUER = 'Gadzio Admin';
const PERIOD_SECONDS = 30;

function totpFor(secret: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret,
  });
}

/** A random base32 secret for a new enrolment. */
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
    period: PERIOD_SECONDS,
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

/** The code an authenticator app would show right now (also used by tests). */
export function generateTotp(secret: string): string {
  return totpFor(secret).generate();
}

/**
 * Verify a 6-digit code and return the time step it matched, or null.
 *
 * The step is the absolute counter (`floor(now / 30 s) + delta`), so callers
 * can store it and reject a later attempt that resolves to the same step.
 */
export function verifyTotpStep(secret: string, code: string): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totpFor(secret).validate({ token: code, window: 1 });
  if (delta === null) return null;
  return Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + delta;
}

/** Verify a 6-digit code against a secret (±1 time step). */
export function verifyTotp(secret: string, code: string): boolean {
  return verifyTotpStep(secret, code) !== null;
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

export function compareRecoveryCode(hash: string, code: string): Promise<boolean> {
  return bcrypt.compare(code.toUpperCase().trim(), hash);
}

/**
 * Random 6-digit code generator for tests/manual flows (not used by the
 * production login path — the authenticator generates the real code).
 */
export function _testCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Stable identifier for rate-limit bucketing (unused placeholder kept for API symmetry). */
export function _bucketId(email: string, ip: string): string {
  return createHash('sha256').update(`${email}|${ip}`).digest('hex').slice(0, 16);
}
