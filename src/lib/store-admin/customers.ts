import { getSql } from '@/lib/admin/db';

import type { CustomerFilters, CustomerGroup } from './customer-rules';
import { CUSTOMER_PAGE_SIZE } from './customer-rules';
import { maskCustomerEmail, maskCustomerPhone } from './masking';

/**
 * Read-only customer queries for the store admin.
 *
 * Rules enforced here:
 * - Explicit column lists only. `password_hash`, session rows and
 *   `payu_raw_response` are never selected.
 * - Emails and phones leave this module already masked. The only full value
 *   ever returned is through `revealCustomerField()`, which the owner-only,
 *   audited route calls.
 * - Guest customers are orders placed without an account, grouped by their
 *   lower-cased email. They have no account record, so their row id is null
 *   and they cannot be opened, blocked or anonymised from this module.
 */

export { CUSTOMER_PAGE_SIZE } from './customer-rules';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = iso(value);
  return parsed || null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayName(row: Row): string {
  const name = [text(row.first_name), text(row.last_name)]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || '(no name)';
}

/** Escape LIKE wildcards so a search for "50%" is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export type CustomerLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

/* -------------------------------------------------------------- list */

export interface CustomerSummary {
  /** Null for a guest: orders placed without an account. */
  id: string | null;
  kind: 'registered' | 'guest';
  name: string;
  emailMasked: string;
  phoneMasked: string;
  joinedAt: string;
  orderCount: number;
  paidOrderCount: number;
  lifetimeValue: number;
  lastOrderAt: string | null;
  status: 'active' | 'blocked';
  group: CustomerGroup;
}

export interface CustomerListSummary {
  registered: number;
  guests: number;
  blocked: number;
}

export interface CustomerListData {
  customers: CustomerSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  summary: CustomerListSummary;
}

function toSummary(row: Row): CustomerSummary {
  const kind = text(row.kind) === 'guest' ? 'guest' : 'registered';
  const blocked = row.is_blocked === true || text(row.is_blocked) === 'true';
  const latestPhone = text(row.phone) || text(row.latest_phone);
  return {
    id: kind === 'guest' ? null : text(row.id),
    kind,
    name: kind === 'guest' ? '(guest)' : displayName(row),
    emailMasked: maskCustomerEmail(text(row.email)),
    phoneMasked: maskCustomerPhone(latestPhone),
    joinedAt: iso(row.created_at),
    orderCount: number(row.order_count),
    paidOrderCount: number(row.paid_order_count),
    lifetimeValue: number(row.lifetime_value),
    lastOrderAt: nullableIso(row.last_order_at),
    status: blocked ? 'blocked' : 'active',
    group: (text(row.customer_group) || 'retail') as CustomerGroup,
  };
}

export async function listCustomers(
  filters: CustomerFilters,
  pageSize: number = CUSTOMER_PAGE_SIZE,
): Promise<CustomerLoad<CustomerListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const pattern = `%${escapeLike(filters.query)}%`;
  const offset = (filters.page - 1) * pageSize;

  try {
    const rows = (await sql`
      with registered as (
        select u.id, u.email, u.first_name, u.last_name, u.created_at,
               u.is_blocked, u.customer_group, u.phone,
               coalesce(a.order_count, 0) as order_count,
               coalesce(a.paid_order_count, 0) as paid_order_count,
               coalesce(a.lifetime_value, 0) as lifetime_value,
               a.last_order_at, a.latest_phone
        from users u
        left join lateral (
          select count(*)::int as order_count,
                 count(*) filter (where o.status = 'PAID')::int as paid_order_count,
                 coalesce(sum(o.amount) filter (where o.status = 'PAID'), 0) as lifetime_value,
                 max(o.created_at) as last_order_at,
                 (array_agg(o.customer_phone order by o.created_at desc, o.id desc)
                    filter (where o.customer_phone <> ''))[1] as latest_phone
          from orders o
          where o.user_id = u.id
        ) a on true
        where (
          ${filters.query} = ''
          or u.email ilike ${pattern}
          or (u.first_name || ' ' || u.last_name) ilike ${pattern}
        )
      ),
      guests as (
        select lower(o.customer_email) as email,
               count(*)::int as order_count,
               count(*) filter (where o.status = 'PAID')::int as paid_order_count,
               coalesce(sum(o.amount) filter (where o.status = 'PAID'), 0) as lifetime_value,
               min(o.created_at) as first_order_at,
               max(o.created_at) as last_order_at,
               (array_agg(o.customer_phone order by o.created_at desc, o.id desc)
                  filter (where o.customer_phone <> ''))[1] as latest_phone
        from orders o
        where o.user_id is null and coalesce(o.customer_email, '') <> ''
        group by lower(o.customer_email)
      )
      select rows.*, count(*) over() as total from (
        select 'registered' as kind, id, email, first_name, last_name, created_at,
               is_blocked, customer_group, order_count, paid_order_count,
               lifetime_value, last_order_at, latest_phone, phone
        from registered
        where ${filters.type} <> 'guest'
          and (${filters.status} = 'all' or (${filters.status} = 'blocked') = is_blocked)
          and (${filters.orders} = 'all' or (${filters.orders} = 'yes') = (order_count > 0))
          and (${filters.fromIso}::timestamptz is null or created_at >= ${filters.fromIso})
          and (${filters.toIso}::timestamptz is null or created_at < ${filters.toIso})
          and (${filters.minSpend}::numeric is null or lifetime_value >= ${filters.minSpend})
          and (${filters.maxSpend}::numeric is null or lifetime_value <= ${filters.maxSpend})
        union all
        select 'guest' as kind, null as id, email, '' as first_name, '' as last_name,
               first_order_at as created_at, false as is_blocked, 'retail' as customer_group,
               order_count, paid_order_count, lifetime_value, last_order_at, latest_phone,
               null as phone
        from guests
        where ${filters.type} <> 'registered'
          and (${filters.status} = 'all' or ${filters.status} = 'active')
          and ${filters.orders} <> 'no'
          and (${filters.fromIso}::timestamptz is null or first_order_at >= ${filters.fromIso})
          and (${filters.toIso}::timestamptz is null or first_order_at < ${filters.toIso})
          and (${filters.minSpend}::numeric is null or lifetime_value >= ${filters.minSpend})
          and (${filters.maxSpend}::numeric is null or lifetime_value <= ${filters.maxSpend})
          and (${filters.query} = '' or email ilike ${pattern})
      ) rows
      order by last_order_at desc nulls last, created_at desc, id nulls last
      limit ${pageSize} offset ${offset}
    `) as Row[];

    // count(*) over() gives the unbounded total from the same query. An empty
    // page therefore reports zero; the page component offers a reset link.
    const total = rows.length > 0 ? number(rows[0].total) : 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(filters.page, pageCount);

    const summaryRows = (await sql`
      select
        (select count(*)::int from users) as registered,
        (select count(*)::int from users where is_blocked = true) as blocked,
        (select count(distinct lower(customer_email))::int
           from orders
          where user_id is null and coalesce(customer_email, '') <> '') as guests
    `) as Row[];
    const summaryRow = summaryRows[0] ?? {};

    return {
      ok: true,
      data: {
        customers: rows.map(toSummary),
        total,
        page,
        pageCount,
        pageSize,
        summary: {
          registered: number(summaryRow.registered),
          guests: number(summaryRow.guests),
          blocked: number(summaryRow.blocked),
        },
      },
    };
  } catch {
    console.warn('[store-admin/customers] could not read the customer list');
    return { ok: false, reason: 'unavailable' };
  }
}

export const CUSTOMER_EXPORT_LIMIT = 10000;

export interface CustomerExportData {
  customers: CustomerSummary[];
  truncated: boolean;
}

/**
 * The same filtered rows as the list, capped at 10,000, still masked. A CSV
 * export never carries a full email or phone: that stays behind the audited
 * owner-only reveal.
 */
export async function exportCustomers(
  filters: CustomerFilters,
): Promise<CustomerLoad<CustomerExportData>> {
  const result = await listCustomers({ ...filters, page: 1 }, CUSTOMER_EXPORT_LIMIT);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      customers: result.data.customers,
      truncated: result.data.total > result.data.customers.length,
    },
  };
}

/* ------------------------------------------------------------ detail */

export interface CustomerOrderSummary {
  txnid: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

export interface CustomerAddress {
  id: string;
  name: string;
  phoneMasked: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export interface CustomerPayment {
  id: string;
  source: 'gateway' | 'recorded';
  reference: string;
  method: string;
  amount: number;
  status: string;
  reviewStatus: string;
  createdAt: string;
  paidAt: string | null;
  providerRefMasked: string;
}

export interface CustomerDetail {
  id: string;
  name: string;
  emailMasked: string;
  phoneMasked: string;
  joinedAt: string;
  status: 'active' | 'blocked';
  blockedAt: string | null;
  blockedReason: string;
  anonymised: boolean;
  group: CustomerGroup;
  lastLoginAt: string | null;
  orderCount: number;
  paidOrderCount: number;
  lifetimeValue: number;
  averageOrderValue: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  orders: CustomerOrderSummary[];
  /** True when the customer has more orders than the 100 shown. */
  ordersTruncated: boolean;
  addresses: CustomerAddress[];
  payments: CustomerPayment[];
}

const ORDER_DETAIL_LIMIT = 100;
const ADDRESS_LIMIT = 50;
const PAYMENT_LIMIT = 60;

function maskReference(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export async function getCustomerDetail(
  id: string,
): Promise<CustomerLoad<CustomerDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const customerId = id.trim();
  if (!customerId) return { ok: false, reason: 'not-found' };

  try {
    const userRows = (await sql`
      select u.id, u.email, u.phone, u.first_name, u.last_name, u.created_at,
             u.is_blocked, u.blocked_at, u.blocked_reason, u.anonymised_at,
             u.customer_group, u.last_login_at
      from users u
      where u.id = ${customerId}
      limit 1
    `) as Row[];
    const user = userRows[0];
    if (!user) return { ok: false, reason: 'not-found' };

    const [orderRows, statsRows, addressRows, recordedRows, gatewayRows] =
      await Promise.all([
        sql`
          select o.txnid, o.amount, o.currency, o.status,
                 o.created_at, o.paid_at
          from orders o
          where o.user_id = ${customerId}
          order by o.created_at desc, o.id desc
          limit ${ORDER_DETAIL_LIMIT}
        `,
        sql`
          select count(*)::int as order_count,
                 count(*) filter (where o.status = 'PAID')::int as paid_order_count,
                 coalesce(sum(o.amount) filter (where o.status = 'PAID'), 0) as lifetime_value,
                 min(o.created_at) as first_order_at,
                 max(o.created_at) as last_order_at,
                 (array_agg(o.customer_phone order by o.created_at desc, o.id desc)
                    filter (where o.customer_phone <> ''))[1] as latest_phone
          from orders o
          where o.user_id = ${customerId}
        `,
        sql`
          select id, name, phone, line1, line2, city, state, pincode,
                 is_default, created_at
          from customer_addresses
          where user_id = ${customerId} and deleted_at is null
          order by is_default desc, created_at desc
          limit ${ADDRESS_LIMIT}
        `,
        sql`
          select p.id, p.order_id, o.txnid, p.channel, p.method, p.amount_paise,
                 p.status, p.provider_ref, p.review_status, p.created_at, p.paid_at
          from order_payments p
          join orders o on o.id = p.order_id
          where o.user_id = ${customerId}
          order by p.created_at desc, p.id desc
          limit ${PAYMENT_LIMIT}
        `,
        sql`
          select o.id, o.txnid, o.amount, o.status, o.payu_mode, o.payu_mihpayid,
                 o.created_at, o.paid_at
          from orders o
          where o.user_id = ${customerId} and o.payu_mihpayid is not null
          order by o.created_at desc, o.id desc
          limit ${PAYMENT_LIMIT}
        `,
      ]);

    const rows = orderRows as Row[];
    const stats = (statsRows as Row[])[0] ?? {};
    const orderCount = number(stats.order_count);
    const paidOrderCount = number(stats.paid_order_count);
    const lifetimeValue = number(stats.lifetime_value);
    const latestPhone = text(stats.latest_phone);

    const orders: CustomerOrderSummary[] = rows.map((row) => ({
      txnid: text(row.txnid),
      amount: number(row.amount),
      currency: text(row.currency) || 'INR',
      status: text(row.status),
      createdAt: iso(row.created_at),
      paidAt: nullableIso(row.paid_at),
    }));

    const addresses: CustomerAddress[] = (addressRows as Row[]).map((row) => ({
      id: text(row.id),
      name: text(row.name),
      phoneMasked: maskCustomerPhone(text(row.phone)),
      line1: text(row.line1),
      line2: text(row.line2),
      city: text(row.city),
      state: text(row.state),
      pincode: text(row.pincode),
      isDefault: row.is_default === true || text(row.is_default) === 'true',
    }));

    const recorded: CustomerPayment[] = (recordedRows as Row[]).map((row) => ({
      id: `pay_${text(row.id)}`,
      source: 'recorded',
      reference: text(row.txnid),
      method: text(row.method),
      amount: number(row.amount_paise) / 100,
      status: text(row.status),
      reviewStatus: text(row.review_status),
      createdAt: iso(row.created_at),
      paidAt: nullableIso(row.paid_at),
      providerRefMasked: maskReference(text(row.provider_ref)),
    }));

    const gateway: CustomerPayment[] = (gatewayRows as Row[]).map((row) => ({
      id: `gw_${text(row.id)}`,
      source: 'gateway',
      reference: text(row.txnid),
      method: text(row.payu_mode) ? `PayU · ${text(row.payu_mode)}` : 'PayU',
      amount: number(row.amount),
      status: text(row.status),
      reviewStatus: '',
      createdAt: iso(row.created_at),
      paidAt: nullableIso(row.paid_at),
      providerRefMasked: maskReference(text(row.payu_mihpayid)),
    }));

    const payments = [...gateway, ...recorded]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, PAYMENT_LIMIT);

    return {
      ok: true,
      data: {
        id: text(user.id),
        name: displayName(user),
        emailMasked: maskCustomerEmail(text(user.email)),
        phoneMasked: maskCustomerPhone(text(user.phone) || latestPhone),
        joinedAt: iso(user.created_at),
        status:
          user.is_blocked === true || text(user.is_blocked) === 'true'
            ? 'blocked'
            : 'active',
        blockedAt: nullableIso(user.blocked_at),
        blockedReason: text(user.blocked_reason),
        anonymised: Boolean(nullableIso(user.anonymised_at)),
        group: (text(user.customer_group) || 'retail') as CustomerGroup,
        lastLoginAt: nullableIso(user.last_login_at),
        orderCount,
        paidOrderCount,
        lifetimeValue,
        averageOrderValue: paidOrderCount > 0 ? lifetimeValue / paidOrderCount : 0,
        firstOrderAt: nullableIso(stats.first_order_at),
        lastOrderAt: nullableIso(stats.last_order_at),
        orders,
        ordersTruncated: orderCount > orders.length,
        addresses,
        payments,
      },
    };
  } catch {
    console.warn('[store-admin/customers] could not read the customer record');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------ reveal */

export type RevealField = 'email' | 'phone';

export function isRevealField(value: unknown): value is RevealField {
  return value === 'email' || value === 'phone';
}

export type RevealResult =
  | { ok: true; value: string }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'no-value' };

/**
 * Return one unmasked field for the owner-only reveal endpoint.
 * Everything about *when* this may be called lives in the route; this function
 * only fetches the single requested column.
 */
export async function revealCustomerField(
  id: string,
  field: RevealField,
): Promise<RevealResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const customerId = id.trim();
  if (!customerId) return { ok: false, reason: 'not-found' };

  try {
    if (field === 'email') {
      const rows = (await sql`
        select u.email from users u where u.id = ${customerId} limit 1
      `) as Row[];
      const email = text((rows[0] ?? {}).email).trim();
      return email ? { ok: true, value: email } : { ok: false, reason: 'not-found' };
    }

    const rows = (await sql`
      select coalesce(
               nullif(u.phone, ''),
               (select o.customer_phone
                  from orders o
                 where o.user_id = u.id
                 order by o.created_at desc, o.id desc
                 limit 1)
             ) as phone
      from users u
      where u.id = ${customerId}
      limit 1
    `) as Row[];
    const phone = text((rows[0] ?? {}).phone).trim();
    return phone ? { ok: true, value: phone } : { ok: false, reason: 'no-value' };
  } catch {
    console.warn('[store-admin/customers] could not reveal a customer field');
    return { ok: false, reason: 'unavailable' };
  }
}
