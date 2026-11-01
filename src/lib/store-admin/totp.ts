import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { getSql } from '@/lib/platform/db';
import {
  compareRecoveryCode,
  hashRecoveryCode,
  newRecoveryCode,
  newTotpSecret,
  totpQrDataUri,
  totpUrl,
  verifyTotpStep,
} from '@/lib/platform/totp';

/**
 * Store Admin two-factor authentication, stored on `store_admins`.
 *
 * Safeguards chosen with the merge decisions:
 * - the QR code and setup key are shown once, and enrolment only completes
 *   after a valid code is entered;
 * - ten one-time backup codes are generated at enrolment, hashed at rest and
 *   shown once;
 * - the time step of every accepted code is recorded, so the same code cannot
 *   be replayed inside its 30-second window;
 * - disabling needs the current password and a valid code;
 * - a store owner can reset another staff member's two-factor, audited, so
 *   nobody is permanently locked out.
 *
 * Secrets and backup codes never leave this module in logs or audit rows.
 */

export const BACKUP_CODE_COUNT = 10;

export interface TotpState {
  enabled: boolean;
  /** A secret exists but has not been confirmed yet. */
  pending: boolean;
  backupCodesRemaining: number;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

export async function getTotpState(adminId: string): Promise<TotpState> {
  const sql = getSql();
  if (!sql) return { enabled: false, pending: false, backupCodesRemaining: 0 };

  const rows = await sql`
    select totp_enabled, totp_secret is not null as has_secret
    from store_admins where id = ${adminId}
  `;
  const codes = await sql`
    select count(*)::int as n from store_admin_recovery_codes
    where admin_id = ${adminId} and used_at is null
  `;
  const row = rows[0];
  return {
    enabled: Boolean(row?.totp_enabled),
    pending: Boolean(row?.has_secret) && !row?.totp_enabled,
    backupCodesRemaining: codes[0]?.n ?? 0,
  };
}

/** Start (or restart) enrolment. Returns the secret, URL and QR once. */
export async function startEnrollment(
  adminId: string,
  email: string,
): Promise<Result<{ secret: string; otpauthUrl: string; qr: string }>> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'The database is not configured.', status: 503 };

  const secret = newTotpSecret();
  await sql`
    update store_admins
    set totp_secret = ${secret}, totp_enabled = false, totp_last_step = null
    where id = ${adminId}
  `;

  const otpauthUrl = totpUrl(email, secret);
  const qr = await totpQrDataUri(otpauthUrl);
  return { ok: true, data: { secret, otpauthUrl, qr } };
}

/** Confirm enrolment with a code from the app; returns the backup codes once. */
export async function confirmEnrollment(
  adminId: string,
  rawCode: unknown,
): Promise<Result<{ backupCodes: string[] }>> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'The database is not configured.', status: 503 };

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Enter the 6-digit code from your authenticator app.', status: 400 };
  }

  const rows = await sql`select totp_secret from store_admins where id = ${adminId}`;
  const secret = rows[0]?.totp_secret as string | undefined;
  if (!secret) return { ok: false, error: 'Start the setup again to get a new key.', status: 409 };

  const step = verifyTotpStep(secret, code);
  if (step === null) {
    return { ok: false, error: 'That code is not valid. Wait for the next one and try again.', status: 400 };
  }

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => newRecoveryCode());
  const hashes = await Promise.all(codes.map((value) => hashRecoveryCode(value)));

  await sql.begin(async (tx) => {
    await tx`
      update store_admins
      set totp_enabled = true, totp_last_step = ${step}, recovery_hash = null
      where id = ${adminId}
    `;
    await tx`delete from store_admin_recovery_codes where admin_id = ${adminId}`;
    for (const hash of hashes) {
      await tx`
        insert into store_admin_recovery_codes (id, admin_id, code_hash)
        values (${randomUUID()}, ${adminId}, ${hash})
      `;
    }
  });

  return { ok: true, data: { backupCodes: codes } };
}

/** Turn two-factor off. Requires the current password and a valid code. */
export async function disableTotp(
  adminId: string,
  password: unknown,
  rawCode: unknown,
): Promise<Result<true>> {
  const sql = getSql();
  if (!sql) return { ok: false, error: 'The database is not configured.', status: 503 };

  const rows = await sql`
    select password_hash, totp_secret, totp_enabled, recovery_hash
    from store_admins where id = ${adminId}
  `;
  const admin = rows[0];
  if (!admin) return { ok: false, error: 'Account not found.', status: 404 };

  const passwordOk =
    typeof password === 'string' &&
    password.length > 0 &&
    (await bcrypt.compare(password, admin.password_hash as string));
  if (!passwordOk) {
    return { ok: false, error: 'Your current password is not correct.', status: 400 };
  }

  if (admin.totp_enabled) {
    const ok =
      Boolean(admin.totp_secret) &&
      (await verifySecondFactor(
        adminId,
        admin.totp_secret as string,
        admin.recovery_hash as string | null,
        rawCode,
      ));
    if (!ok) {
      return { ok: false, error: 'Enter a valid authenticator or backup code.', status: 400 };
    }
  }

  await sql.begin(async (tx) => {
    await tx`
      update store_admins
      set totp_enabled = false, totp_secret = null, recovery_hash = null, totp_last_step = null
      where id = ${adminId}
    `;
    await tx`delete from store_admin_recovery_codes where admin_id = ${adminId}`;
  });
  return { ok: true, data: true };
}

/**
 * Verify a second factor at login or before disabling.
 *
 * Accepts a 6-digit authenticator code (with replay protection), a legacy
 * single recovery code (`recovery_hash`), or one of the hashed backup codes.
 */
export async function verifySecondFactor(
  adminId: string,
  secret: string,
  legacyRecoveryHash: string | null,
  rawCode: unknown,
): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;

  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!code) return false;

  if (/^\d{6}$/.test(code)) {
    const step = verifyTotpStep(secret, code);
    if (step === null) return false;
    // Accept only a step strictly newer than the last one used.
    const rows = await sql`
      update store_admins set totp_last_step = ${step}
      where id = ${adminId}
        and (totp_last_step is null or totp_last_step < ${step})
      returning id
    `;
    return rows.length > 0;
  }

  // A migrated legacy account may still hold a single recovery code.
  if (legacyRecoveryHash && /^[0-9A-Za-z-]{11,30}$/.test(code)) {
    if (await compareRecoveryCode(legacyRecoveryHash, code)) {
      await sql`update store_admins set recovery_hash = null where id = ${adminId}`;
      return true;
    }
  }

  // One-time backup codes: mark the matching code used in the same statement
  // that checks it, so two concurrent logins cannot both consume it.
  const candidates = await sql`
    select id, code_hash from store_admin_recovery_codes
    where admin_id = ${adminId} and used_at is null
  `;
  const needle = code.toUpperCase();
  for (const row of candidates) {
    if (await bcrypt.compare(needle, row.code_hash as string)) {
      const used = await sql`
        update store_admin_recovery_codes set used_at = now()
        where id = ${row.id} and used_at is null
        returning id
      `;
      return used.length > 0;
    }
  }
  return false;
}

/** Owner-only reset for another staff member. Clears the secret and codes. */
export async function resetStaffTotp(adminId: string): Promise<boolean> {
  const sql = getSql();
  if (!sql) return false;
  const rows = await sql`
    update store_admins
    set totp_enabled = false, totp_secret = null, recovery_hash = null, totp_last_step = null
    where id = ${adminId}
    returning id
  `;
  await sql`delete from store_admin_recovery_codes where admin_id = ${adminId}`;
  return rows.length > 0;
}
