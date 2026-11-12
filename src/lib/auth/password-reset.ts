import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type postgres from 'postgres';

import {
  isValidEmail,
  normalizeEmail,
  validatePassword,
} from '@/lib/auth/validation';
import { setTransactionTimeouts } from '@/lib/checkout/transaction-guards';
import {
  deliverNotification,
  type DeliveryInput,
  type DeliveryResult,
} from '@/lib/notifications/providers';
import { queueNotification } from '@/lib/notifications/queue';
import { resolveAppBaseUrl } from '@/lib/payu/config';
import { getSql } from '@/lib/platform/db';
import { getStoreSettings } from '@/lib/store-admin/settings';
import type { StoreSettings } from '@/lib/store-admin/settings-rules';

export const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account exists for that email address, we have sent a password reset link.';
export const INVALID_RESET_TOKEN_MESSAGE =
  'This link is invalid or has expired.';

const BCRYPT_ROUNDS = 12;
const CUSTOMER_AUTH_ADVISORY_NAMESPACE = 614201;
const FORGOT_EMAIL_LIMIT = 3;
const FORGOT_IP_LIMIT = 10;
const RESET_IP_LIMIT = 10;
const UNKNOWN_IP_BUCKET = '__unknown__';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rateLimitBucketKey(scope: string, rawKey: string): string {
  return sha256Hex(`${scope}:${rawKey}`);
}

export interface PasswordResetDependencies {
  sql?: postgres.Sql;
  env?: NodeJS.ProcessEnv;
  loadSettings?: () => Promise<StoreSettings>;
  sendDirectEmail?: (
    input: DeliveryInput,
    settings: StoreSettings,
  ) => Promise<DeliveryResult>;
  notifyPasswordChanged?: (user: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
  }) => void;
}

interface ForgotRateLimitOutcome {
  ipLimited: boolean;
  emailLimited: boolean;
  retryAfterSec: number;
}

async function checkAndRecordForgotRateLimit(
  sql: postgres.Sql,
  normalizedEmail: string,
  ip: string,
): Promise<ForgotRateLimitOutcome> {
  const ipKey = rateLimitBucketKey('forgot_ip', ip || UNKNOWN_IP_BUCKET);
  const hasEmail = normalizedEmail.length > 0;
  const emailKey = hasEmail ? rateLimitBucketKey('forgot_email', normalizedEmail) : null;

  const lockKeys = [`forgot_ip:${ipKey}`];
  if (emailKey) lockKeys.push(`forgot_email:${emailKey}`);
  lockKeys.sort();

  return sql.begin(async (tx) => {
    await setTransactionTimeouts(tx, {
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 5_000,
    });

    for (const lockKey of lockKeys) {
      await tx`select pg_advisory_xact_lock(${CUSTOMER_AUTH_ADVISORY_NAMESPACE}, hashtext(${lockKey}))`;
    }

    const [ipStats] = (await tx`
      select
        count(*)::int as cnt,
        coalesce(
          ceil(extract(epoch from ((min(created_at) + interval '1 hour') - now())))::int,
          3600
        ) as retry_after_sec
      from auth_rate_limits
      where scope = 'forgot_ip'
        and bucket_key = ${ipKey}
        and created_at > now() - interval '1 hour'
        and created_at <= now()
    `) as Array<{ cnt: number; retry_after_sec: number }>;

    if ((ipStats?.cnt ?? 0) >= FORGOT_IP_LIMIT) {
      return {
        ipLimited: true,
        emailLimited: false,
        retryAfterSec: Math.max(1, Number(ipStats?.retry_after_sec ?? 3600)),
      };
    }

    await tx`
      insert into auth_rate_limits (scope, bucket_key, created_at)
      values ('forgot_ip', ${ipKey}, now())
    `;

    if (!emailKey) {
      return { ipLimited: false, emailLimited: false, retryAfterSec: 0 };
    }

    const [emailStats] = (await tx`
      select count(*)::int as cnt
      from auth_rate_limits
      where scope = 'forgot_email'
        and bucket_key = ${emailKey}
        and created_at > now() - interval '1 hour'
        and created_at <= now()
    `) as Array<{ cnt: number }>;

    const emailLimited = (emailStats?.cnt ?? 0) >= FORGOT_EMAIL_LIMIT;
    if (!emailLimited) {
      await tx`
        insert into auth_rate_limits (scope, bucket_key, created_at)
        values ('forgot_email', ${emailKey}, now())
      `;
    }

    return { ipLimited: false, emailLimited, retryAfterSec: 0 };
  });
}

async function checkAndRecordResetIpLimit(
  sql: postgres.Sql,
  ip: string,
): Promise<{ limited: boolean; retryAfterSec: number }> {
  const ipKey = rateLimitBucketKey('reset_ip', ip || UNKNOWN_IP_BUCKET);
  const lockKey = `reset_ip:${ipKey}`;

  return sql.begin(async (tx) => {
    await setTransactionTimeouts(tx, {
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 5_000,
    });
    await tx`select pg_advisory_xact_lock(${CUSTOMER_AUTH_ADVISORY_NAMESPACE}, hashtext(${lockKey}))`;

    const [stats] = (await tx`
      select
        count(*)::int as cnt,
        coalesce(
          ceil(extract(epoch from ((min(created_at) + interval '1 hour') - now())))::int,
          3600
        ) as retry_after_sec
      from auth_rate_limits
      where scope = 'reset_ip'
        and bucket_key = ${ipKey}
        and created_at > now() - interval '1 hour'
        and created_at <= now()
    `) as Array<{ cnt: number; retry_after_sec: number }>;

    if ((stats?.cnt ?? 0) >= RESET_IP_LIMIT) {
      return {
        limited: true,
        retryAfterSec: Math.max(1, Number(stats?.retry_after_sec ?? 3600)),
      };
    }

    await tx`
      insert into auth_rate_limits (scope, bucket_key, created_at)
      values ('reset_ip', ${ipKey}, now())
    `;

    return { limited: false, retryAfterSec: 0 };
  });
}

async function recordMailFailure(
  sql: postgres.Sql,
  reason: 'mail_not_configured' | 'mail_send_failed' | 'site_address_unconfigured',
): Promise<void> {
  try {
    await sql`
      insert into password_reset_mail_failures (reason, created_at)
      values (${reason}, now())
    `;
  } catch {
    console.warn('[auth/password-reset] Could not record mail failure event.');
  }
}

export function buildPasswordResetEmail(input: {
  storeName: string;
  customerName: string;
  resetUrl: string;
}): { subject: string; html: string } {
  const safeStore = escapeHtml(input.storeName.trim() || 'Gadzio');
  const safeName = escapeHtml(input.customerName.trim() || 'there');
  const safeUrl = escapeHtml(input.resetUrl);

  const subject = `Reset your ${input.storeName.trim() || 'Gadzio'} password`;
  const html = [
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1d1d1f;line-height:1.5;max-width:560px;margin:0 auto;padding:24px;">`,
    `<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">Reset your password</h1>`,
    `<p style="margin:0 0 16px;">Hi ${safeName},</p>`,
    `<p style="margin:0 0 16px;">We received a request to reset your ${safeStore} account password. Use the button below to choose a new password. This link expires in 30 minutes and can only be used once.</p>`,
    `<p style="margin:24px 0;"><a href="${safeUrl}" style="display:inline-block;background:#1d1d1f;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;">Reset password</a></p>`,
    `<p style="margin:0 0 16px;font-size:13px;color:#6e6e73;">Or copy and paste this link into your browser:<br><span style="word-break:break-all;">${safeUrl}</span></p>`,
    `<p style="margin:0;font-size:13px;color:#6e6e73;">If you did not ask to reset your password, you can safely ignore this email. Your password will not change.</p>`,
    `</div>`,
  ].join('');

  return { subject, html };
}

export async function processForgotPasswordWork(
  input: {
    normalizedEmail: string;
    ip: string;
    emailLimited: boolean;
  },
  deps: PasswordResetDependencies = {},
): Promise<{ ok: boolean; reason: string }> {
  if (input.emailLimited || !isValidEmail(input.normalizedEmail)) {
    return { ok: true, reason: 'skipped' };
  }

  const sql = deps.sql ?? getSql();
  if (!sql) return { ok: false, reason: 'db_unconfigured' };

  const env = deps.env ?? process.env;
  const rows = (await sql`
    select id, email, first_name, last_name, is_blocked, anonymised_at
    from users
    where email = ${input.normalizedEmail}
    limit 1
  `) as Array<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    is_blocked: boolean;
    anonymised_at: Date | string | null;
  }>;

  const user = rows[0];
  if (!user || user.is_blocked || user.anonymised_at) {
    return { ok: true, reason: 'ineligible' };
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(rawToken);
  const ipHash = input.ip ? sha256Hex(input.ip) : null;

  await sql.begin(async (tx) => {
    await setTransactionTimeouts(tx);
    await tx`
      update password_reset_tokens
      set invalidated_at = now()
      where user_id = ${user.id}
        and used_at is null
        and invalidated_at is null
    `;
    await tx`
      insert into password_reset_tokens (
        user_id, token_hash, expires_at, created_at, request_ip_hash
      ) values (
        ${user.id},
        ${tokenHash},
        now() + interval '30 minutes',
        now(),
        ${ipHash}
      )
    `;
  });

  const baseUrlResult = resolveAppBaseUrl(env);
  if (!baseUrlResult.ok) {
    console.warn(
      '[auth/password-reset] Configured site address is missing or insecure; password reset email not sent.',
    );
    await recordMailFailure(sql, 'site_address_unconfigured');
    return { ok: false, reason: 'site_address_unconfigured' };
  }

  const resetUrl = `${baseUrlResult.baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  let settings: StoreSettings;
  if (deps.loadSettings) {
    settings = await deps.loadSettings();
  } else {
    const loaded = await getStoreSettings();
    if (!loaded.ok) {
      await recordMailFailure(sql, 'mail_not_configured');
      return { ok: false, reason: 'mail_not_configured' };
    }
    settings = loaded.settings;
  }

  const { subject, html } = buildPasswordResetEmail({
    storeName: settings.trade_name || 'Gadzio',
    customerName: `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim(),
    resetUrl,
  });

  const sendEmailFn = deps.sendDirectEmail ?? deliverNotification;
  let delivery: DeliveryResult;
  try {
    delivery = await sendEmailFn(
      {
        channel: 'email',
        recipient: user.email,
        subject,
        body: html,
      },
      settings,
    );
  } catch {
    delivery = { outcome: 'FAILED', reason: 'mail send failed', permanent: false };
  }

  if (delivery.outcome !== 'SENT') {
    const failureReason =
      delivery.outcome === 'SKIPPED' ? 'mail_not_configured' : 'mail_send_failed';
    await recordMailFailure(sql, failureReason);
    return { ok: false, reason: failureReason };
  }

  return { ok: true, reason: 'sent' };
}

export async function requestPasswordReset(
  input: { email: unknown; ip: string },
  deps: PasswordResetDependencies = {},
): Promise<
  | {
      ok: true;
      status: 200;
      message: string;
      deferredWork: () => Promise<{ ok: boolean; reason: string }>;
    }
  | {
      ok: false;
      status: 429 | 500;
      error: string;
      retryAfterSec?: number;
    }
> {
  const sql = deps.sql ?? getSql();
  if (!sql) {
    return {
      ok: true,
      status: 200,
      message: FORGOT_PASSWORD_GENERIC_MESSAGE,
      deferredWork: async () => ({ ok: false, reason: 'db_unconfigured' }),
    };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const rate = await checkAndRecordForgotRateLimit(sql, normalizedEmail, input.ip);
  if (rate.ipLimited) {
    return {
      ok: false,
      status: 429,
      error: 'Too many password reset requests. Please try again later.',
      retryAfterSec: rate.retryAfterSec,
    };
  }

  return {
    ok: true,
    status: 200,
    message: FORGOT_PASSWORD_GENERIC_MESSAGE,
    deferredWork: () =>
      processForgotPasswordWork(
        {
          normalizedEmail,
          ip: input.ip,
          emailLimited: rate.emailLimited,
        },
        deps,
      ),
  };
}

export async function resetCustomerPassword(
  input: {
    token: unknown;
    password: unknown;
    confirmPassword: unknown;
    ip: string;
  },
  deps: PasswordResetDependencies = {},
): Promise<
  | { ok: true; status: 200; redirectTo: string }
  | { ok: false; status: 400 | 429 | 500; error: string; retryAfterSec?: number }
> {
  const sql = deps.sql ?? getSql();
  if (!sql) {
    return { ok: false, status: 500, error: 'Database is not configured.' };
  }

  const rate = await checkAndRecordResetIpLimit(sql, input.ip);
  if (rate.limited) {
    return {
      ok: false,
      status: 429,
      error: 'Too many password reset attempts. Please try again later.',
      retryAfterSec: rate.retryAfterSec,
    };
  }

  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const confirmPassword =
    typeof input.confirmPassword === 'string' ? input.confirmPassword : '';

  if (password !== confirmPassword) {
    return { ok: false, status: 400, error: 'Passwords do not match.' };
  }

  const policyCheck = validatePassword(password);
  if (!policyCheck.ok) {
    return { ok: false, status: 400, error: policyCheck.error };
  }

  if (!token) {
    return { ok: false, status: 400, error: INVALID_RESET_TOKEN_MESSAGE };
  }

  const tokenHash = sha256Hex(token);

  // Cheaply verify token existence & validity before paying for bcrypt.
  const precheck = (await sql`
    select t.id
    from password_reset_tokens t
    join users u on u.id = t.user_id
    where t.token_hash = ${tokenHash}
      and t.used_at is null
      and t.invalidated_at is null
      and t.expires_at > now()
      and u.is_blocked = false
      and u.anonymised_at is null
    limit 1
  `) as Array<{ id: number }>;

  if (!precheck[0]) {
    return { ok: false, status: 400, error: INVALID_RESET_TOKEN_MESSAGE };
  }

  // Compute bcrypt hash outside the transaction lock.
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const txResult = await sql.begin(async (tx) => {
    await setTransactionTimeouts(tx);

    const lockedRows = (await tx`
      select
        t.id as token_id,
        t.user_id,
        t.used_at,
        t.invalidated_at,
        (t.expires_at <= now()) as is_expired,
        u.email,
        u.first_name,
        u.last_name,
        u.phone
      from password_reset_tokens t
      join users u on u.id = t.user_id
      where t.token_hash = ${tokenHash}
        and u.is_blocked = false
        and u.anonymised_at is null
      for update of t
    `) as Array<{
      token_id: number;
      user_id: string;
      used_at: Date | string | null;
      invalidated_at: Date | string | null;
      is_expired: boolean;
      email: string;
      first_name: string;
      last_name: string;
      phone: string | null;
    }>;

    const row = lockedRows[0];
    if (!row || row.used_at || row.invalidated_at || row.is_expired) {
      return { ok: false as const };
    }

    await tx`
      update users
      set password_hash = ${passwordHash}, updated_at = now()
      where id = ${row.user_id}
    `;

    await tx`
      update password_reset_tokens
      set used_at = now()
      where id = ${row.token_id}
    `;

    await tx`
      update password_reset_tokens
      set invalidated_at = now()
      where user_id = ${row.user_id}
        and id <> ${row.token_id}
        and used_at is null
        and invalidated_at is null
    `;

    await tx`
      delete from user_sessions
      where user_id = ${row.user_id}
    `;

    return {
      ok: true as const,
      user: {
        userId: row.user_id,
        email: row.email,
        firstName: row.first_name,
        lastName: row.last_name,
        phone: row.phone ?? null,
      },
    };
  });

  if (!txResult.ok) {
    return { ok: false, status: 400, error: INVALID_RESET_TOKEN_MESSAGE };
  }

  const notify =
    deps.notifyPasswordChanged ??
    ((user) => {
      queueNotification(
        'password_reset',
        { type: 'customer', id: user.userId },
        {
          customerName: `${user.firstName} ${user.lastName}`.trim(),
          customerEmail: user.email,
          customerPhone: user.phone ?? null,
          customerLink: '/account',
        },
      );
    });

  notify(txResult.user);

  return { ok: true, status: 200, redirectTo: '/auth?reset=success' };
}

export async function prunePasswordResetArtifacts(
  sqlOverride?: postgres.Sql,
): Promise<{
  deletedRateLimits: number;
  deletedTokens: number;
  deletedMailFailures: number;
}> {
  const sql = sqlOverride ?? getSql();
  if (!sql) {
    return { deletedRateLimits: 0, deletedTokens: 0, deletedMailFailures: 0 };
  }

  const rateRows = (await sql`
    delete from auth_rate_limits
    where created_at < now() - interval '2 hours'
    returning id
  `) as Array<{ id: number }>;

  const tokenRows = (await sql`
    delete from password_reset_tokens
    where expires_at < now() - interval '24 hours'
       or used_at < now() - interval '24 hours'
       or invalidated_at < now() - interval '24 hours'
    returning id
  `) as Array<{ id: number }>;

  const failureRows = (await sql`
    delete from password_reset_mail_failures
    where created_at < now() - interval '7 days'
    returning id
  `) as Array<{ id: number }>;

  return {
    deletedRateLimits: rateRows.length,
    deletedTokens: tokenRows.length,
    deletedMailFailures: failureRows.length,
  };
}
