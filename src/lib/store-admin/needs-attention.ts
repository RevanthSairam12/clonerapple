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
  key: 'flagged_payments' | 'refunds_owed' | 'stuck_verifying' | 'failed_notifications' | 'password_reset_mail_failures' | 'spin_daily_cap' | 'free_gift_alerts' | 'reconcile_heartbeat';
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
  spinDailyCapReachedCount: number;
  freeGiftAlertsCount: number;
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
  spinDailyCapReachedCount?: number;
  freeGiftAlertsCount?: number;
  reconcile: ReconcileHeartbeatState;
}): NeedsAttentionItem[] {
  const {
    flaggedPaymentsCount,
    refundsOwedCount,
    refundsOwedPaise,
    stuckVerifyingCount,
    failedNotificationsCount,
    passwordResetMailFailuresCount = 0,
    spinDailyCapReachedCount = 0,
    freeGiftAlertsCount = 0,
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
    ...(spinDailyCapReachedCount > 0
      ? [
          {
            key: 'spin_daily_cap' as const,
            label: 'Spin wheel daily cap reached',
            count: spinDailyCapReachedCount,
            href: '/store-admin/marketing/spin-wheel',
            urgent: true,
            detail: `${spinDailyCapReachedCount} active prize segment${spinDailyCapReachedCount === 1 ? '' : 's'} hit today's daily cap`,
          },
        ]
      : []),
    ...(freeGiftAlertsCount > 0
      ? [
          {
            key: 'free_gift_alerts' as const,
            label: 'Free gift rules need attention',
            count: freeGiftAlertsCount,
            href: '/store-admin/marketing/free-gifts',
            urgent: true,
            detail: `${freeGiftAlertsCount} active free gift rule${freeGiftAlertsCount === 1 ? ' has' : 's have'} unavailable checkouts, low/out stock, inactive SKUs, or reached caps`,
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
      spinDailyCapReachedCount: 0,
      freeGiftAlertsCount: 0,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount: 0,
        refundsOwedCount: 0,
        refundsOwedPaise: 0,
        stuckVerifyingCount: 0,
        failedNotificationsCount: 0,
        passwordResetMailFailuresCount: 0,
        spinDailyCapReachedCount: 0,
        freeGiftAlertsCount: 0,
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
            and coalesce((to_jsonb(orders)->>'is_test')::boolean, false) = false
        ) as flagged_payments,
        (
          select count(*)::int
          from refund_obligations r
          join orders o on o.id = r.order_id
          where r.status = 'PENDING'
            and coalesce((to_jsonb(o)->>'is_test')::boolean, false) = false
        ) as refunds_owed_count,
        (
          select coalesce(sum(r.amount_paise), 0)::bigint
          from refund_obligations r
          join orders o on o.id = r.order_id
          where r.status = 'PENDING'
            and coalesce((to_jsonb(o)->>'is_test')::boolean, false) = false
        ) as refunds_owed_paise,
        (
          select count(*)::int
          from orders
          where status = 'PROCESSING'
            and coalesce((to_jsonb(orders)->>'is_test')::boolean, false) = false
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

    let spinDailyCapReachedCount = 0;
    try {
      const [capRow] = await sql<Array<{ cnt: number | string | null }>>`
        select count(*)::int as cnt
        from spin_wheel_segments s
        join spin_wheel_segment_daily_counts d
          on d.segment_id = s.id
         and d.store_day = (
           now() at time zone coalesce(
             (
               select p.name
               from store_settings ss
               join pg_timezone_names p on p.name = btrim(ss.value)
               where ss.key = 'timezone'
               limit 1
             ),
             'Asia/Kolkata'
           )
         )::date
        where s.is_active = true
          and s.daily_cap is not null
          and d.win_count >= s.daily_cap
      `;
      spinDailyCapReachedCount = Math.max(0, Math.trunc(Number(capRow?.cnt) || 0));
    } catch {
      spinDailyCapReachedCount = 0;
    }

    let freeGiftAlertsCount = 0;
    try {
      const [giftAlertRow] = await sql<Array<{ cnt: number | string | null }>>`
        select count(*)::int as cnt
        from free_gift_rules r
        left join products p on p.id = r.gift_product_id
        left join product_variants pv on pv.id = r.gift_variant_id
        left join stock ps on ps.product_id = r.gift_product_id and ps.variant_id is null
        left join stock vs on vs.product_id = r.gift_product_id and vs.variant_id = r.gift_variant_id
        where r.archived_at is null
          and r.is_active = true
          and (
            r.unavailable_checkout_count > 0
            or p.id is null
            or p.deleted_at is not null
            or p.is_active = false
            or (
              r.gift_variant_id is not null
              and (
                pv.id is null
                or pv.product_id <> r.gift_product_id
                or pv.is_active = false
                or pv.is_purchasable = false
                or pv.retired_at is not null
              )
            )
            or (
              case
                when r.gift_variant_id is not null then
                  coalesce(vs.track_inventory, false)
                  and (coalesce(vs.on_hand, 0) - coalesce(vs.reserved, 0)) <= greatest(0, coalesce(vs.low_stock_threshold, 0))
                else
                  coalesce(ps.track_inventory, false)
                  and (coalesce(ps.on_hand, 0) - coalesce(ps.reserved, 0)) <= greatest(0, coalesce(ps.low_stock_threshold, 0))
              end
            )
            or (
              r.max_gifts_total is not null
              and coalesce(
                (
                  select count(*)
                  from free_gift_redemptions gr
                  where gr.rule_id = r.id
                    and gr.state in ('RESERVED', 'CONSUMED')
                ),
                0
              ) >= r.max_gifts_total
            )
          )
      `;
      freeGiftAlertsCount = Math.max(0, Math.trunc(Number(giftAlertRow?.cnt) || 0));
    } catch {
      freeGiftAlertsCount = 0;
    }

    return {
      flaggedPaymentsCount,
      refundsOwedCount,
      refundsOwedPaise,
      stuckVerifyingCount,
      failedNotificationsCount,
      passwordResetMailFailuresCount,
      spinDailyCapReachedCount,
      freeGiftAlertsCount,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount,
        refundsOwedCount,
        refundsOwedPaise,
        stuckVerifyingCount,
        failedNotificationsCount,
        passwordResetMailFailuresCount,
        spinDailyCapReachedCount,
        freeGiftAlertsCount,
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
      spinDailyCapReachedCount: 0,
      freeGiftAlertsCount: 0,
      reconcile,
      items: buildNeedsAttentionItems({
        flaggedPaymentsCount: 0,
        refundsOwedCount: 0,
        refundsOwedPaise: 0,
        stuckVerifyingCount: 0,
        failedNotificationsCount: 0,
        passwordResetMailFailuresCount: 0,
        spinDailyCapReachedCount: 0,
        freeGiftAlertsCount: 0,
        reconcile,
      }),
    };
  }
}
