/**
 * Database side of the coupon rules.
 *
 * Every read and write here runs on the caller's connection. The checkout path
 * passes the transaction that already holds the stock row locks, then locks the
 * coupon row with `for update` before counting uses. That single lock is what
 * makes "the last redemption" usable exactly once: a second buyer waits, then
 * sees the first redemption and is rejected.
 */
import postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

import {
  couponRejectionMessage,
  evaluateCoupon,
  normalizeCouponCode,
  normalizeEmail,
  type CouponContext,
  type CouponDefinition,
  type CouponEvaluation,
  type CouponLine,
  type CouponScope,
  type CouponStatus,
  type CouponTarget,
  type CouponType,
} from './rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Coupon data must be read on the server only.');
}

type SqlLike = postgres.Sql | postgres.TransactionSql;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function textArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((entry) => String(entry)).filter(Boolean);
}

function mapTarget(row: Record<string, unknown>): CouponTarget {
  return {
    productId: row.product_id ? text(row.product_id) : null,
    categoryId: row.category_id ? text(row.category_id) : null,
    brandId: row.brand_id ? text(row.brand_id) : null,
  };
}

function mapCoupon(
  row: Record<string, unknown>,
  targets: CouponTarget[],
): CouponDefinition {
  return {
    id: text(row.id),
    code: text(row.code),
    name: text(row.name),
    type: text(row.type) as CouponType,
    value: Number(row.value) || 0,
    scope: text(row.scope) as CouponScope,
    status: text(row.status) as CouponStatus,
    startsAt: (row.starts_at as string | Date | null) ?? null,
    endsAt: (row.ends_at as string | Date | null) ?? null,
    totalRedemptionLimit: nullableInt(row.total_redemption_limit),
    perCustomerLimit: nullableInt(row.per_customer_limit),
    minOrderPaise: Number(row.min_order_paise) || 0,
    maxDiscountPaise: nullableInt(row.max_discount_paise),
    onlyNewCustomers: Boolean(row.only_new_customers),
    allowWithSalePrice: Boolean(row.allow_with_sale_price),
    allowedCustomerGroups: textArray(row.allowed_customer_groups),
    restrictedToEmails: textArray(row.restricted_to_emails)?.map(normalizeEmail) ?? null,
    targets,
  };
}

async function loadTargets(sql: SqlLike, couponId: string): Promise<CouponTarget[]> {
  const rows = (await sql`
    select product_id, category_id, brand_id
    from coupon_targets
    where coupon_id = ${couponId}
    order by id
  `) as Array<Record<string, unknown>>;
  return rows.map(mapTarget);
}

function parseTargetsJson(raw: unknown): CouponTarget[] {
  let list: unknown = raw;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map(mapTarget);
}

/**
 * Load a coupon and its targets in a single database round trip. `forUpdate`
 * is used inside the order transaction (`FOR UPDATE OF c`); the validation
 * endpoint uses the plain read.
 */
export async function loadCouponDefinition(
  sql: SqlLike,
  code: string,
  options: { forUpdate?: boolean } = {},
): Promise<CouponDefinition | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const rows = (options.forUpdate
    ? await sql`
        select
          c.*,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'product_id', ct.product_id,
                'category_id', ct.category_id,
                'brand_id', ct.brand_id
              )
              order by ct.id
            )
            from coupon_targets ct
            where ct.coupon_id = c.id
          ), '[]'::jsonb) as targets_json
        from coupons c
        where upper(c.code) = ${normalized}
        for update of c
      `
    : await sql`
        select
          c.*,
          coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'product_id', ct.product_id,
                'category_id', ct.category_id,
                'brand_id', ct.brand_id
              )
              order by ct.id
            )
            from coupon_targets ct
            where ct.coupon_id = c.id
          ), '[]'::jsonb) as targets_json
        from coupons c
        where upper(c.code) = ${normalized}
        limit 1
      `) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return null;
  const targets =
    'targets_json' in row
      ? parseTargetsJson(row.targets_json)
      : await loadTargets(sql, text(row.id));
  return mapCoupon(row, targets);
}

export interface CouponCustomerIdentity {
  userId: string | null;
  email: string;
  group: string | null;
}

/**
 * Read the database clock, customer group, prior paid-order flag, and total/personal
 * redemption counts in a single database round trip.
 */
export async function readCouponCustomerContext(
  sql: SqlLike,
  couponId: string,
  customer: CouponCustomerIdentity,
): Promise<CouponContext> {
  const userId = customer.userId || null;
  const email = normalizeEmail(customer.email);
  const suppliedGroup = customer.group;

  const rows = (await sql`
    select
      now() as now,
      case
        when ${userId}::text is not null and ${suppliedGroup === null} then (
          select u.customer_group
          from users u
          where u.id = ${userId}
          limit 1
        )
        else ${suppliedGroup}::text
      end as resolved_group,
      exists (
        select 1
        from orders o
        where o.status = 'PAID'
          and (
            (${userId}::text is not null and o.user_id = ${userId})
            or (${email} <> '' and lower(o.customer_email) = ${email})
          )
      ) as paid_order_exists,
      count(cr.id)::int as total,
      count(cr.id) filter (
        where (${userId}::text is not null and cr.customer_user_id = ${userId})
           or (${email} <> '' and lower(cr.customer_email) = ${email})
      )::int as mine
    from (select 1) as one
    left join coupon_redemptions cr
      on cr.coupon_id = ${couponId}
     and cr.state in ('RESERVED', 'CONSUMED')
  `) as Array<Record<string, unknown>>;

  const row = rows[0] ?? {};
  const now = new Date(String(row.now ?? new Date().toISOString()));
  const group =
    suppliedGroup !== null
      ? suppliedGroup
      : row.resolved_group
        ? text(row.resolved_group)
        : null;

  return {
    now,
    subtotalPaise: 0,
    shippingPaise: 0,
    customer: { userId, email, group },
    customerPaidOrderExists: Boolean(row.paid_order_exists),
    customerRedemptions: Number(row.mine ?? 0),
    totalRedemptions: Number(row.total ?? 0),
  };
}

export interface CouponCartContext {
  lines: ReadonlyArray<CouponLine>;
  subtotalPaise: number;
  shippingPaise: number;
  customer: CouponCustomerIdentity;
}

/** Evaluate a locked (or freshly read) coupon against a resolved cart. */
export async function evaluateCouponFromDatabase(
  sql: SqlLike,
  coupon: CouponDefinition,
  cart: CouponCartContext,
): Promise<CouponEvaluation> {
  const context = await readCouponCustomerContext(sql, coupon.id, cart.customer);
  return evaluateCoupon({
    coupon,
    lines: cart.lines,
    context: {
      ...context,
      subtotalPaise: Math.max(0, Math.trunc(cart.subtotalPaise)),
      shippingPaise: Math.max(0, Math.trunc(cart.shippingPaise)),
    },
  });
}

export interface CouponLookup {
  coupon: CouponDefinition | null;
  evaluation: CouponEvaluation;
}

/**
 * One entry point for the validation endpoint: load, count, decide.
 * A missing code and a malformed code answer the same generic message.
 */
export async function lookupCouponForCart(
  sql: SqlLike,
  code: string,
  cart: CouponCartContext,
): Promise<CouponLookup> {
  const coupon = await loadCouponDefinition(sql, code);
  if (!coupon) {
    return {
      coupon: null,
      evaluation: {
        ok: false,
        reason: 'not_found',
        message: couponRejectionMessage('not_found'),
      },
    };
  }
  return {
    coupon,
    evaluation: await evaluateCouponFromDatabase(sql, coupon, cart),
  };
}

export async function insertReservedRedemption(
  sql: SqlLike,
  input: {
    couponId: string;
    orderId: string;
    customerUserId: string | null;
    customerEmail: string;
    discountPaise: number;
  },
): Promise<void> {
  await sql`
    insert into coupon_redemptions (
      coupon_id, order_id, customer_user_id, customer_email, discount_paise, state
    ) values (
      ${input.couponId},
      ${input.orderId},
      ${input.customerUserId},
      ${normalizeEmail(input.customerEmail)},
      ${Math.max(0, Math.trunc(input.discountPaise))},
      'RESERVED'
    )
    on conflict (coupon_id, order_id) do nothing
  `;
}

/**
 * Is the redemption ledger deployed on this connection's search path?
 *
 * A coupon use is bookkeeping: if the ledger is absent, the sale, the stock
 * release and the payment transition must still go through. Asking the
 * catalogue first keeps the statement out of the transaction — an error would
 * abort it even if caught. The failure that matters — giving a discount for an
 * unverified code — is handled on the checkout path, which refuses to price a
 * code at all; these lifecycle calls are only no-ops.
 */
async function couponLedgerPresent(sql: SqlLike): Promise<boolean> {
  const rows = (await sql`
    select to_regclass('coupon_redemptions') as name
  `) as Array<{ name: unknown }>;
  return Boolean(rows[0]?.name);
}

/** RESERVED -> CONSUMED. A duplicate callback finds nothing and is a no-op. */
export async function consumeCouponInTx(
  sql: SqlLike,
  orderId: string,
): Promise<boolean> {
  if (!(await couponLedgerPresent(sql))) return false;
  const rows = (await sql`
    update coupon_redemptions
    set state = 'CONSUMED', consumed_at = now(), release_reason = null
    where order_id = ${orderId} and state = 'RESERVED'
    returning id
  `) as Array<{ id: unknown }>;
  return rows.length > 0;
}

/** RESERVED -> RELEASED. A consumed use is never taken back here. */
export async function releaseCouponInTx(
  sql: SqlLike,
  orderId: string,
  reason: string,
): Promise<boolean> {
  if (!(await couponLedgerPresent(sql))) return false;
  const rows = (await sql`
    update coupon_redemptions
    set state = 'RELEASED',
        released_at = now(),
        release_reason = ${reason.slice(0, 300)}
    where order_id = ${orderId} and state = 'RESERVED'
    returning id
  `) as Array<{ id: unknown }>;
  return rows.length > 0;
}

/**
 * Refunds do not normally give a coupon use back. When the store setting
 * `refunds_restore_coupon` is on and the refund covers the whole order, this
 * releases the consumed use so the customer can use the code again.
 */
export async function releaseConsumedCouponOnRefund(
  sql: SqlLike,
  orderId: string,
  reason: string,
): Promise<boolean> {
  if (!(await couponLedgerPresent(sql))) return false;
  const rows = (await sql`
    update coupon_redemptions
    set state = 'RELEASED',
        released_at = now(),
        release_reason = ${reason.slice(0, 300)}
    where order_id = ${orderId} and state = 'CONSUMED'
    returning id
  `) as Array<{ id: unknown }>;
  return rows.length > 0;
}

export type RestoreOutcome = 'restored' | 'limit-unavailable' | 'none';

/**
 * A verified payment that arrives after its use was released: take the use
 * back when both limits still allow it, otherwise leave the row released and
 * let the caller flag the captured order for review. The order stays paid
 * either way; the customer is never charged again.
 */
export async function restoreCouponAfterLatePayment(
  sql: SqlLike,
  orderId: string,
): Promise<RestoreOutcome> {
  if (!(await couponLedgerPresent(sql))) return 'none';
  const rows = (await sql`
    select r.id, r.coupon_id, r.customer_user_id, r.customer_email, r.state,
           c.total_redemption_limit, c.per_customer_limit
    from coupon_redemptions r
    join coupons c on c.id = r.coupon_id
    where r.order_id = ${orderId}
    for update of r
  `) as Array<Record<string, unknown>>;

  const row = rows[0];
  if (!row) return 'none';
  if (text(row.state) !== 'RELEASED') return 'none';

  const couponId = text(row.coupon_id);
  const userId = row.customer_user_id ? text(row.customer_user_id) : null;
  const email = normalizeEmail(row.customer_email);
  const totalLimit = nullableInt(row.total_redemption_limit);
  const perCustomerLimit = nullableInt(row.per_customer_limit);

  const counts = (await sql`
    select
      count(*)::int as total,
      count(*) filter (
        where (${userId}::text is not null and customer_user_id = ${userId})
           or (${email} <> '' and lower(customer_email) = ${email})
      )::int as mine
    from coupon_redemptions
    where coupon_id = ${couponId}
      and state in ('RESERVED', 'CONSUMED')
      and id <> ${text(row.id)}
  `) as Array<Record<string, unknown>>;

  const total = Number(counts[0]?.total ?? 0);
  const mine = Number(counts[0]?.mine ?? 0);
  if (totalLimit !== null && total >= totalLimit) return 'limit-unavailable';
  if (perCustomerLimit !== null && mine >= perCustomerLimit) return 'limit-unavailable';

  const updated = (await sql`
    update coupon_redemptions
    set state = 'CONSUMED', consumed_at = now()
    where id = ${text(row.id)} and state = 'RELEASED'
    returning id
  `) as Array<{ id: unknown }>;
  return updated.length > 0 ? 'restored' : 'none';
}

/** Read-only helper used by the validation endpoint and tests. */
export function couponConnection(): postgres.Sql | null {
  return getSql();
}
