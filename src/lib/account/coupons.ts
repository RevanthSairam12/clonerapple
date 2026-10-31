import { getSql } from '@/lib/admin/db';
import { normalizeEmail } from '@/lib/coupons/rules';

export interface CustomerCouponView {
  id: string;
  code: string;
  valueDisplay: string;
  scopeDisplay: string;
  minOrderPaise: number;
  minOrderDisplay: string;
  expiresAt: string | null;
  expiryDisplay: string;
  remainingUses: number | null;
  remainingDisplay: string;
}

export async function listCustomerCoupons(userId: string): Promise<CustomerCouponView[]> {
  const sql = getSql();
  if (!sql) return [];

  // 1. Get customer's email and group
  const userRows = await sql<Array<{ email: string; customer_group: string }>>`
    select email, customer_group
    from users
    where id = ${userId}
    limit 1
  `;
  if (!userRows[0]) return [];

  const userEmail = normalizeEmail(userRows[0].email);
  const userGroup = userRows[0].customer_group || 'retail';

  // Check if customer has any paid order (for only_new_customers check)
  const paidRows = await sql<Array<{ id: string }>>`
    select id
    from orders
    where status = 'PAID'
      and (user_id = ${userId} or (${userEmail} <> '' and lower(customer_email) = ${userEmail}))
    limit 1
  `;
  const hasPaidOrder = paidRows.length > 0;

  // 2. Query active coupons that are PRIVATE (assigned to email or group)
  // Public coupons (both restricted_to_emails and allowed_customer_groups empty/null) are excluded!
  const rows = await sql<Array<{
    id: string;
    code: string;
    type: string;
    value: number;
    scope: string;
    starts_at: string | Date | null;
    ends_at: string | Date | null;
    total_redemption_limit: number | null;
    per_customer_limit: number | null;
    min_order_paise: number | null;
    max_discount_paise: number | null;
    only_new_customers: boolean;
    allowed_customer_groups: string[] | null;
    restricted_to_emails: string[] | null;
  }>>`
    select
      id, code, type, value, scope, starts_at, ends_at,
      total_redemption_limit, per_customer_limit, min_order_paise, max_discount_paise,
      only_new_customers, allowed_customer_groups, restricted_to_emails
    from coupons
    where status = 'active'
      and (starts_at is null or starts_at <= now())
      and (ends_at is null or ends_at > now())
      and (
        (restricted_to_emails is not null and array_length(restricted_to_emails, 1) > 0)
        or (allowed_customer_groups is not null and array_length(allowed_customer_groups, 1) > 0)
      )
    order by created_at desc
  `;

  if (rows.length === 0) return [];

  const eligible: CustomerCouponView[] = [];

  for (const row of rows) {
    // A. If only_new_customers is set, exclude if customer already bought
    if (row.only_new_customers && hasPaidOrder) {
      continue;
    }

    // B. Check privacy match: email whitelist or customer group
    const emails = (row.restricted_to_emails || []).map(normalizeEmail);
    const groups = row.allowed_customer_groups || [];

    const matchesEmail = emails.length > 0 && emails.includes(userEmail);
    const matchesGroup = groups.length > 0 && groups.includes(userGroup);

    // If email restriction is present, customer MUST match email
    if (emails.length > 0 && !matchesEmail) {
      continue;
    }
    // If only group restriction is present, customer MUST match group
    if (emails.length === 0 && groups.length > 0 && !matchesGroup) {
      continue;
    }

    // C. Check total redemption limit
    if (row.total_redemption_limit !== null) {
      const totalRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from coupon_redemptions
        where coupon_id = ${row.id}
          and state in ('RESERVED', 'CONSUMED')
      `;
      const totalUsed = totalRows[0]?.count ?? 0;
      if (totalUsed >= row.total_redemption_limit) {
        continue; // Exhausted
      }
    }

    // D. Check per-customer limit
    let remainingUses: number | null = null;
    let remainingDisplay = 'Available';

    if (row.per_customer_limit !== null) {
      const myRows = await sql<Array<{ count: number }>>`
        select count(*)::int as count
        from coupon_redemptions
        where coupon_id = ${row.id}
          and state in ('RESERVED', 'CONSUMED')
          and (
            customer_user_id = ${userId}
            or (${userEmail} <> '' and lower(customer_email) = ${userEmail})
          )
      `;
      const myUsed = myRows[0]?.count ?? 0;
      remainingUses = Math.max(0, row.per_customer_limit - myUsed);
      if (remainingUses <= 0) {
        continue; // Customer has used up all their uses
      }
      remainingDisplay = `${remainingUses} use${remainingUses === 1 ? '' : 's'} remaining`;
    }

    // E. Format scope
    let scopeDisplay = 'Entire order';
    if (row.scope === 'category') scopeDisplay = 'Selected categories';
    else if (row.scope === 'brand') scopeDisplay = 'Selected brands';
    else if (row.scope === 'product') scopeDisplay = 'Selected products';

    // F. Format value
    const valueNum = Number(row.value) || 0;
    const valueDisplay =
      row.type === 'percent'
        ? `${valueNum}% off`
        : `₹${(valueNum / 100).toLocaleString('en-IN')} off`;

    // G. Format min order
    const minOrderPaise = Number(row.min_order_paise) || 0;
    const minOrderDisplay =
      minOrderPaise > 0
        ? `₹${(minOrderPaise / 100).toLocaleString('en-IN')} min. order`
        : 'No minimum';

    // H. Format expiry
    let expiresAt: string | null = null;
    let expiryDisplay = 'No expiry date';
    if (row.ends_at) {
      const end = new Date(row.ends_at);
      expiresAt = end.toISOString();
      expiryDisplay = `Expires ${end.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })}`;
    }

    eligible.push({
      id: row.id,
      code: row.code,
      valueDisplay,
      scopeDisplay,
      minOrderPaise,
      minOrderDisplay,
      expiresAt,
      expiryDisplay,
      remainingUses,
      remainingDisplay,
    });
  }

  return eligible;
}

export async function getCustomerCouponCount(userId: string): Promise<number> {
  const coupons = await listCustomerCoupons(userId);
  return coupons.length;
}
