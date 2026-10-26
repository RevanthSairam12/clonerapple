import type postgres from 'postgres';

import { getSql } from '@/lib/admin/db';
import type { StoreSettings } from '@/lib/store-admin/settings-rules';

import {
  MAX_NOTIFICATION_ATTEMPTS,
  retryDelaySeconds,
} from './rules';
import {
  deliverNotification,
  type DeliveryInput,
  type DeliveryResult,
} from './providers';
import { readNotificationSettings } from './settings';
import {
  NOTIFICATION_STATUSES,
  type NotificationStatus,
} from './types';

/**
 * Outbox worker.
 *
 * Claiming is one short transaction: rows whose `next_attempt_at` is due are
 * locked with FOR UPDATE SKIP LOCKED and marked SENDING with a new lease. The
 * transaction commits before any network call, so a slow SMTP server never
 * holds a row lock. A second worker sees the first worker's rows as locked and
 * skips them. If a worker dies mid-send, the lease expires and the row becomes
 * claimable again.
 *
 * At-least-once, not exactly-once: a crash between the provider accepting a
 * message and the SENT update can repeat one send. The alternative — holding a
 * transaction open across SMTP — is worse.
 */

type Sql = postgres.Sql;
type Row = Record<string, unknown>;

/** Long enough for a 10s provider timeout with room to spare. */
export const NOTIFICATION_LEASE_MINUTES = 5;

export interface ProcessResult {
  ok: boolean;
  claimed: number;
  sent: number;
  skipped: number;
  /** Failures left QUEUED for another attempt. */
  retried: number;
  /** Terminal failures (permanent, or max attempts reached). */
  failed: number;
}

export interface ProcessOptions {
  sql?: Sql;
  settings?: StoreSettings;
  /** Test seam; the real worker uses deliverNotification with saved settings. */
  deliver?: (input: DeliveryInput) => Promise<DeliveryResult>;
}

interface ClaimedRow {
  id: string;
  eventKey: string;
  audience: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  attempts: number;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function claimedFromRow(row: Row): ClaimedRow {
  return {
    id: text(row.id),
    eventKey: text(row.event_key),
    audience: text(row.audience),
    channel: text(row.channel),
    recipient: text(row.recipient),
    subject: text(row.subject),
    body: text(row.body),
    attempts: Number(row.attempts) || 0,
  };
}

/**
 * Atomically take up to `limit` due rows and lease them. Exported so the
 * concurrency test can prove two callers never receive the same row.
 */
export async function claimNotificationBatch(sql: Sql, limit = 20): Promise<ClaimedRow[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 20)));
  const rows = (await sql.begin(async (tx) => (
    await tx`
      with due as (
        select id
        from notification_outbox
        where status in ('QUEUED', 'SENDING')
          and next_attempt_at <= now()
        order by next_attempt_at asc, created_at asc
        limit ${safeLimit}
        for update skip locked
      )
      update notification_outbox o
      set status = 'SENDING',
          next_attempt_at = now() + interval '5 minutes'
      from due
      where o.id = due.id
      returning o.id, o.event_key, o.audience, o.channel,
                o.recipient, o.subject, o.body, o.attempts
    `
  ))) as Row[];
  return rows.map(claimedFromRow);
}

async function markSent(sql: Sql, row: ClaimedRow): Promise<void> {
  await sql`
    update notification_outbox
    set status = 'SENT', reason = '', attempts = attempts + 1,
        sent_at = now(), next_attempt_at = now()
    where id = ${row.id} and status = 'SENDING'
  `;
}

async function markSkipped(sql: Sql, row: ClaimedRow, reason: string): Promise<void> {
  await sql`
    update notification_outbox
    set status = 'SKIPPED', reason = ${reason.slice(0, 500)},
        attempts = attempts + 1, sent_at = null, next_attempt_at = now()
    where id = ${row.id} and status = 'SENDING'
  `;
}

async function markFailure(
  sql: Sql,
  row: ClaimedRow,
  reason: string,
  permanent: boolean,
): Promise<'retried' | 'failed'> {
  const attempts = row.attempts + 1;
  const terminal = permanent || attempts >= MAX_NOTIFICATION_ATTEMPTS;
  const finalReason = terminal && !permanent
    ? `${reason} (stopped after ${MAX_NOTIFICATION_ATTEMPTS} attempts)`
    : reason;
  const nextAttempt = terminal
    ? new Date()
    : new Date(Date.now() + retryDelaySeconds(attempts) * 1000);

  await sql`
    update notification_outbox
    set status = ${terminal ? 'FAILED' : 'QUEUED'},
        reason = ${finalReason.slice(0, 500)},
        attempts = ${attempts},
        sent_at = null,
        next_attempt_at = ${nextAttempt}
    where id = ${row.id} and status = 'SENDING'
  `;

  return terminal ? 'failed' : 'retried';
}

async function releaseClaims(sql: Sql, rows: ClaimedRow[]): Promise<void> {
  if (rows.length === 0) return;
  await sql`
    update notification_outbox
    set status = 'QUEUED', next_attempt_at = now()
    where id in ${sql(rows.map((row) => row.id))} and status = 'SENDING'
  `;
}

export async function processNotificationOutbox(
  limit = 20,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const result: ProcessResult = {
    ok: false,
    claimed: 0,
    sent: 0,
    skipped: 0,
    retried: 0,
    failed: 0,
  };

  const sql = options.sql ?? getSql();
  if (!sql) return result;

  let claimed: ClaimedRow[];
  try {
    claimed = await claimNotificationBatch(sql, limit);
  } catch {
    console.warn('[notifications] could not claim queued messages');
    return result;
  }

  result.claimed = claimed.length;
  if (claimed.length === 0) {
    result.ok = true;
    return result;
  }

  let deliver = options.deliver;
  if (!deliver) {
    let settings = options.settings;
    if (!settings) {
      try {
        settings = await readNotificationSettings(sql);
      } catch {
        await releaseClaims(sql, claimed).catch(() => {});
        console.warn('[notifications] could not read mail and SMS settings');
        return result;
      }
    }
    const configured = settings;
    deliver = (input) => deliverNotification(input, configured);
  }

  for (const row of claimed) {
    try {
      if (row.channel === 'inapp') {
        if (row.audience === 'customer') {
          await markSkipped(sql, row, 'no customer in-app inbox');
          result.skipped += 1;
        } else {
          await markSent(sql, row);
          result.sent += 1;
        }
        continue;
      }

      if (row.channel !== 'email' && row.channel !== 'sms') {
        await markSkipped(sql, row, 'unknown delivery channel');
        result.skipped += 1;
        continue;
      }

      const delivery = await deliver({
        channel: row.channel,
        recipient: row.recipient,
        subject: row.subject,
        body: row.body,
      });

      if (delivery.outcome === 'SENT') {
        await markSent(sql, row);
        result.sent += 1;
      } else if (delivery.outcome === 'SKIPPED') {
        await markSkipped(sql, row, delivery.reason || 'delivery skipped');
        result.skipped += 1;
      } else {
        const outcome = await markFailure(sql, row, delivery.reason || 'delivery failed', delivery.permanent);
        result[outcome] += 1;
      }
    } catch {
      try {
        const outcome = await markFailure(sql, row, 'delivery failed', false);
        result[outcome] += 1;
      } catch {
        result.failed += 1;
      }
    }
  }

  result.ok = true;
  return result;
}

export interface RetryResult {
  ok: boolean;
  error?: string;
}

/** Put a terminal FAILED row back in the queue with a fresh attempt budget. */
export async function retryNotification(id: string, sqlOverride?: Sql): Promise<RetryResult> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return { ok: false, error: 'Notifications are not available.' };
  if (!id.trim()) return { ok: false, error: 'Which message?' };

  try {
    const rows = (await sql`
      update notification_outbox
      set status = 'QUEUED', attempts = 0, reason = '',
          sent_at = null, next_attempt_at = now()
      where id = ${id.trim()} and status = 'FAILED'
      returning id
    `) as Row[];
    if (rows.length === 0) {
      return { ok: false, error: 'Only a failed message can be retried.' };
    }
    return { ok: true };
  } catch {
    console.warn('[notifications] could not retry a failed message');
    return { ok: false, error: 'Could not retry that message.' };
  }
}

export interface NotificationLogRow {
  id: string;
  eventKey: string;
  channel: string;
  audience: string;
  recipientMasked: string;
  status: NotificationStatus;
  reason: string;
  attempts: number;
  createdAt: Date;
}

export type NotificationLogLoad =
  | {
      ok: true;
      counts: Record<NotificationStatus, number>;
      rows: NotificationLogRow[];
    }
  | { ok: false; reason: 'unavailable' };

function emptyCounts(): Record<NotificationStatus, number> {
  return Object.fromEntries(
    NOTIFICATION_STATUSES.map((status) => [status, 0]),
  ) as Record<NotificationStatus, number>;
}

/**
 * Read-only delivery log. Only `recipient_masked` leaves the database; the
 * full recipient, subject and body never reach an admin screen.
 */
export async function getNotificationDeliveryLog(options: {
  status?: NotificationStatus | null;
  limit?: number;
  sql?: Sql;
} = {}): Promise<NotificationLogLoad> {
  const sql = options.sql ?? getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const status = options.status && (NOTIFICATION_STATUSES as readonly string[]).includes(options.status)
    ? options.status
    : null;
  const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 100)));

  try {
    const countRows = (await sql`
      select status, count(*)::int as count
      from notification_outbox
      group by status
    `) as Row[];
    const counts = emptyCounts();
    for (const row of countRows) {
      const key = String(row.status) as NotificationStatus;
      if (key in counts) counts[key] = Number(row.count) || 0;
    }

    const rows = (await sql`
      select id, event_key, channel, audience, recipient_masked,
             status, reason, attempts, created_at
      from notification_outbox
      where (${status}::text is null or status = ${status})
      order by created_at desc
      limit ${limit}
    `) as Row[];

    return {
      ok: true,
      counts,
      rows: rows.map((row) => ({
        id: text(row.id),
        eventKey: text(row.event_key),
        channel: text(row.channel),
        audience: text(row.audience),
        recipientMasked: text(row.recipient_masked),
        status: text(row.status) as NotificationStatus,
        reason: text(row.reason),
        attempts: Number(row.attempts) || 0,
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
      })),
    };
  } catch {
    console.warn('[notifications] could not read the delivery log');
    return { ok: false, reason: 'unavailable' };
  }
}
