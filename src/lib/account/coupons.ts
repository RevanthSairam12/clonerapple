import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { normalizeEmail, type CouponScope, type CouponStatus, type CouponType } from '@/lib/coupons/rules';
import { getStoreSettings } from '@/lib/store-admin/settings';
import {
  customerCanDiscoverCoupon,
  customerCouponView,
  type CustomerCouponView,
  type DiscoverableCoupon,
} from './coupon-rules';

export type { CustomerCouponView } from './coupon-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Account coupons must be read on the server only.');
}

/** Narrow seams for owned-schema tests; production always uses the authoritative getter. */
export type CustomerCouponSettingsLoader = () => Promise<
  | { ok: true; settings: { coupons_enabled: string } }
  | { ok: false; reason: string }
>;

type CouponRow = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
  gift_product_id: string | null;
  gift_variant_id: string | null;
  gift_product_name: string | null;
  scope: CouponScope;
  status: CouponStatus;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  total_redemption_limit: number | null;
  per_customer_limit: number | null;
  min_order_paise: number | null;
  only_new_customers: boolean;
  allowed_customer_groups: string[] | null;
  restricted_to_emails: string[] | null;
  show_to_all_users: boolean;
  assigned_to_emails: string[];
  assigned_customer_groups: string[];
  source: string | null;
  total_used: number;
  mine_used: number;
  database_now: Date | string;
};

/** userId comes from the authenticated account session, never request parameters. */
export async function listCustomerCouponsUsing(
  sql: postgres.ISql,
  userId: string,
  loadSettings: CustomerCouponSettingsLoader,
): Promise<CustomerCouponView[]> {
  if (!userId) return [];
  const configuration = await loadSettings();
  // Do not depend on shipping initialization, or invent enabled settings on failure.
  if (!configuration.ok || configuration.settings.coupons_enabled !== 'on') return [];

  // Read identity from the account row, not the checkout email or client input.
  const users = await sql<Array<{ email: string; customer_group: string | null; has_paid_order: boolean }>>`
    select u.email, u.customer_group,
      exists (
        select 1 from orders o
        where o.status = 'PAID'
          and (o.user_id = u.id or (btrim(u.email) <> '' and lower(o.customer_email) = lower(btrim(u.email))))
      ) as has_paid_order
    from users u where u.id = ${userId} limit 1
  `;
  if (!users[0]) return [];
  const user = users[0];
  const email = normalizeEmail(user.email);
  const group = user.customer_group?.trim().toLowerCase() || null;

  // One batched ledger aggregate for all candidates, not one query per coupon.
  // Global counts never leave this module. RELEASED uses do not consume a limit.
  const rows = await sql<CouponRow[]>`
    with candidates as (
      select id, code, type, value, scope, status, starts_at, ends_at,
        total_redemption_limit, per_customer_limit, min_order_paise,
        only_new_customers, allowed_customer_groups, restricted_to_emails,
        show_to_all_users, assigned_to_emails, assigned_customer_groups,
        (to_jsonb(coupons)->>'gift_product_id') as gift_product_id,
        (to_jsonb(coupons)->>'gift_variant_id') as gift_variant_id,
        null::text as gift_product_name,
        (to_jsonb(coupons)->>'source') as source, created_at
      from coupons
      where status = 'active'
        and (starts_at is null or starts_at <= now())
        and (ends_at is null or ends_at > now())
        and (
          show_to_all_users
          or exists (select 1 from unnest(assigned_to_emails) e where ${email} <> '' and lower(btrim(e)) = ${email})
          or exists (select 1 from unnest(assigned_customer_groups) g where lower(btrim(g)) = ${group})
        )
    ), usage as (
      select r.coupon_id, count(*)::int as total_used,
        count(*) filter (
          where r.customer_user_id = ${userId}
            or (${email} <> '' and lower(r.customer_email) = ${email})
        )::int as mine_used
      from coupon_redemptions r join candidates c on c.id = r.coupon_id
      where r.state in ('RESERVED', 'CONSUMED')
      group by r.coupon_id
    )
    select c.*, coalesce(usage.total_used, 0)::int as total_used,
      coalesce(usage.mine_used, 0)::int as mine_used, now() as database_now
    from candidates c left join usage on usage.coupon_id = c.id
    order by c.created_at desc, c.id
  `;

  const giftProductIds = [
    ...new Set(
      rows
        .map((r) => (typeof r.gift_product_id === 'string' ? r.gift_product_id : ''))
        .filter(Boolean),
    ),
  ];
  const giftNameById = new Map<string, string>();
  if (giftProductIds.length > 0) {
    const [reg] = await sql<Array<{ tbl: string | null }>>`select to_regclass('products')::text as tbl`;
    if (reg?.tbl) {
      const gpRows = await sql<Array<{ id: string; name: string }>>`
        select id, name from products where id = any(${giftProductIds}::text[])
      `;
      for (const gp of gpRows) {
        if (gp.id && gp.name) giftNameById.set(String(gp.id), String(gp.name));
      }
    }
  }

  const result: CustomerCouponView[] = [];
  for (const row of rows) {
    const giftName =
      row.gift_product_name
      ?? (row.gift_product_id ? (giftNameById.get(row.gift_product_id) ?? null) : null);
    const coupon: DiscoverableCoupon = {
      id: row.id,
      code: row.code,
      type: row.type,
      value: Number(row.value),
      giftProductId: row.gift_product_id ?? null,
      giftVariantId: row.gift_variant_id ?? null,
      giftProductName: giftName,
      scope: row.scope,
      status: row.status,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      totalRedemptionLimit: row.total_redemption_limit,
      perCustomerLimit: row.per_customer_limit,
      minOrderPaise: Number(row.min_order_paise) || 0,
      onlyNewCustomers: row.only_new_customers,
      allowedCustomerGroups: row.allowed_customer_groups,
      restrictedToEmails: row.restricted_to_emails,
      showToAllUsers: row.show_to_all_users,
      assignedToEmails: row.assigned_to_emails,
      assignedCustomerGroups: row.assigned_customer_groups,
      source: row.source === 'spin_wheel' ? 'spin_wheel' : 'admin',
    };
    const mine = Number(row.mine_used);
    if (!customerCanDiscoverCoupon(coupon, {
      now: new Date(row.database_now),
      customer: { userId, email, group },
      customerPaidOrderExists: user.has_paid_order,
      customerRedemptions: mine,
      totalRedemptions: Number(row.total_used),
    }, true)) continue;
    result.push(customerCouponView(coupon, mine));
  }
  return result;
}

export async function getCustomerCouponCountUsing(
  sql: postgres.ISql,
  userId: string,
  loadSettings: CustomerCouponSettingsLoader,
): Promise<number> {
  return (await listCustomerCouponsUsing(sql, userId, loadSettings)).length;
}

export async function listCustomerCoupons(userId: string): Promise<CustomerCouponView[]> {
  const sql = getSql();
  if (!sql) return [];
  return listCustomerCouponsUsing(sql, userId, getStoreSettings);
}

export async function getCustomerCouponCount(userId: string): Promise<number> {
  return (await listCustomerCoupons(userId)).length;
}
