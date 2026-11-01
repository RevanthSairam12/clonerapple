import { getSql } from '@/lib/platform/db';
import { getSession } from './auth';

/**
 * Legacy TOTP storage on `admin_users`, plus a re-export of the pure helpers.
 *
 * Legacy-only: Store Admin stores its own secrets on `store_admins` through
 * `@/lib/store-admin/totp`. This module disappears with the panel.
 */
export * from '@/lib/platform/totp';

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
