import type postgres from 'postgres';

import {
  readReconcileHeartbeat,
  type ReconcileHeartbeatState,
} from '@/lib/payu/reconcile-heartbeat';
import { getSql } from '@/lib/platform/db';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin needs-attention queries must run on the server only.');
}

export interface NeedsAttentionItem {
  key: 'flagged_payments' | 'refunds_owed' | 'stuck_verifying' | 'failed_notifications' | 'password_reset_mail_failures' | 'reconcile_heartbeat';
  label: string;
  count: number;
  amountPaise?: number;
  href: string;
  urgent: boolean;
  detail: string;
}

export interface NeedsAttentionSummary {
  flaggedPaymentsCount: number;
  refundsOwedCount: number;
  refundsOwedPaise: number;
  stuckVerifyingCount: number;
  failedNotificationsCount: number;
  passwordResetMailFailuresCount: number;
  reconcile: ReconcileHeartbeatState;
  items: NeedsAttentionItem[];
}

export function buildNeedsAttentionItems(input: {
  flaggedPaymentsCount: number;
  refundsOwedCount: number;
  refundsOwedPaise: number;
  stuckVerifyingCount: number;
  failedNotificationsCount: number;
  passwordResetMailFailuresCount?: number;
  reconcile: ReconcileHeartbeatState;
}): NeedsAttentionItem[] {
  const {
    flaggedPaymentsCount,
    refundsOwedCount,
    refundsOwedPaise,
    stuckVerifyingCount,
    failedNotificationsCount,
    passwordResetMailFailuresCount = 0,
    reconcile,
  } = input;

  return [
    {
      key: 'flagged_payments',
      label: 'Payments flagged for review',
      count: flaggedPaymentsCount,
      href: '/store-admin/payments',
      urgent: flaggedPaymentsCount > 0,
      detail:
        flaggedPaymentsCount > 0
          ? `${flaggedPaymentsCount} order${flaggedPaymentsCount === 1 ? '' : 's'} need manual gateway review`
          : 'No flagged payments',
    },
    {
      key: 'refunds_owed',
      label: 'Refunds owed',
      count: refundsOwedCount,
      amountPaise: refundsOwedPaise,
      href: '/store-admin/payments',
      urgent: refundsOwedCount > 0,
      detail:
        refundsOwedCount > 0
          ? `${refundsOwedCount} pending refund obligation${refundsOwedCount === 1 ? '' : 's'}`
          : 'No pending refund obligations',
    },
    {
      key: 'stuck_verifying',
      label: 'Payments stuck verifying',
      count: stuckVerifyingCount,
      href: '/store-admin/orders?state=PROCESSING',
      urgent: stuckVerifyingCount > 0,
      detail:
        stuckVerifyingCount > 0
          ? `${stuckVerifyingCount} order${stuckVerifyingCount === 1 ? '' : 's'} awaiting gateway confirmation`
          : 'No payments stuck verifying',
    },
    {
      key: 'failed_notifications',
      label: 'Failed notifications',
      count: failedNotificationsCount,
      href: '/store-admin/settings/notifications',
      urgent: failedNotificationsCount > 0,
      detail:
        failedNotificationsCount > 0
          ? `${failedNotificationsCount} outbox message${failedNotificationsCount === 1 ? '' : 's'} failed delivery`
          : 'Outbox healthy',
    },
    ...(passwordResetMailFailuresCount > 0
      ? [
          {
            key: 'password_reset_mail_failures' as const,
            label: 'Password reset mail failures',
            count: passwordResetMailFailuresCount,
            href: '/store-admin/settings/notifications',
            urgent: true,
            detail: `${passwordResetMailFailuresCount} reset email${passwordResetMailFailuresCount === 1 ? '' : 's'} failed or unconfigured in last 24h`,
          },
        ]
      : []),
    {
      key: 'reconcile_heartbeat',
      label: 'Last reconcile run',
      count: reconcile.lastProcessedCount,
      href: '/store-admin/payments',
      urgent: reconcile.stale || Boolean(reconcile.lastError),
      detail: reconcile.lastSuccessAt
        ? `${reconcile.lastProcessedCount} processed${reconcile.lastError ? ` · Error: ${reconcile.lastError}` : ''}`
        : 'No reconcile run recorded yet',
    },
  ];
}

export async function getNeedsAttentionSummary(
  sqlOverride?: postgres.Sql,
): Promise<NeedsAttentionSummary> {
  const sql = sqlOverride ?? getSql();
  const reconcile = await readReconcileHeartbeat(sqlOverride);

  if (!sql) {
    return {
      flaggedPaymentsCount: 0,
      refundsOwedCount: 0,
      refundsOwedPaise: 0,
      stuckVerifyingCount: 0,
      failedNotificationsCount: 0,
      passwordResetMailFailuresCount: 0,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount: 0,
        refundsOwedCount: 0,
        refundsOwedPaise: 0,
        stuckVerifyingCount: 0,
        failedNotificationsCount: 0,
        passwordResetMailFailuresCount: 0,
        reconcile,
      }),
    };
  }

  try {
    const [row] = await sql<
      Array<{
        flagged_payments: number | string | null;
        refunds_owed_count: number | string | null;
        refunds_owed_paise: number | string | null;
        stuck_verifying: number | string | null;
        failed_notifications: number | string | null;
      }>
    >`
      select
        (
          select count(*)::int
          from orders
          where payment_review_required = true
        ) as flagged_payments,
        (
          select count(*)::int
          from refund_obligations
          where status = 'PENDING'
        ) as refunds_owed_count,
        (
          select coalesce(sum(amount_paise), 0)::bigint
          from refund_obligations
          where status = 'PENDING'
        ) as refunds_owed_paise,
        (
          select count(*)::int
          from orders
          where status = 'PROCESSING'
        ) as stuck_verifying,
        (
          select count(*)::int
          from notification_outbox
          where status = 'FAILED'
        ) as failed_notifications
    `;

    const flaggedPaymentsCount = Math.max(0, Math.trunc(Number(row?.flagged_payments) || 0));
    const refundsOwedCount = Math.max(0, Math.trunc(Number(row?.refunds_owed_count) || 0));
    const refundsOwedPaise = Math.max(0, Math.trunc(Number(row?.refunds_owed_paise) || 0));
    const stuckVerifyingCount = Math.max(0, Math.trunc(Number(row?.stuck_verifying) || 0));
    const failedNotificationsCount = Math.max(0, Math.trunc(Number(row?.failed_notifications) || 0));

    let passwordResetMailFailuresCount = 0;
    try {
      const [resetFailRow] = await sql<Array<{ cnt: number | string | null }>>`
        select count(*)::int as cnt
        from password_reset_mail_failures
        where created_at > now() - interval '24 hours'
      `;
      passwordResetMailFailuresCount = Math.max(0, Math.trunc(Number(resetFailRow?.cnt) || 0));
    } catch {
      passwordResetMailFailuresCount = 0;
    }

    return {
      flaggedPaymentsCount,
      refundsOwedCount,
      refundsOwedPaise,
      stuckVerifyingCount,
      failedNotificationsCount,
      passwordResetMailFailuresCount,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount,
        refundsOwedCount,
        refundsOwedPaise,
        stuckVerifyingCount,
        failedNotificationsCount,
        passwordResetMailFailuresCount,
        reconcile,
      }),
    };
  } catch {
    return {
      flaggedPaymentsCount: 0,
      refundsOwedCount: 0,
      refundsOwedPaise: 0,
      stuckVerifyingCount: 0,
      failedNotificationsCount: 0,
      passwordResetMailFailuresCount: 0,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount: 0,
        refundsOwedCount: 0,
        refundsOwedPaise: 0,
        stuckVerifyingCount: 0,
        failedNotificationsCount: 0,
        passwordResetMailFailuresCount: 0,
        reconcile,
      }),
    };
  }
}
