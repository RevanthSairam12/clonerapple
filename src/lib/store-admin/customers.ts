import { getSql } from '@/lib/admin/db';

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
 * - `users` has no phone column: the phone shown is the one supplied on the
 *   customer's most recent order (`orders.customer_phone`). Adding a phone to
 *   `users` would need its own migration and is deliberately not done here.
 */

export const CUSTOMERS_PAGE_SIZE = 25;

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

/** Escape LIKE wildcards so a search for "50%" is a literal search. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function displayName(row: Row): string {
  const name = [text(row.first_name), text(row.last_name)]
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || '(no name)';
}

/* -------------------------------------------------------------- list */

export interface CustomerSummary {
  id: string;
  name: string;
  emailMasked: string;
  phoneMasked: string;
  joinedAt: string;
  orderCount: number;
  lastOrderAt: string | null;
}

export interface CustomerListData {
  customers: CustomerSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
}

export type CustomerLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

export async function listCustomers(options: {
  query?: string;
  page?: number;
}): Promise<CustomerLoad<CustomerListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const search = (options.query ?? '').trim().slice(0, 100);
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);

  try {
    // A single WHERE shape for both the count and the page: an empty search
    // matches everything, so no dynamic SQL fragments are needed.
    const pattern = `%${escapeLike(search)}%`;

    const countRows = (await sql`
      select count(*)::int as total
      from users u
      where (
        ${search} = ''
        or u.email ilike ${pattern}
        or (u.first_name || ' ' || u.last_name) ilike ${pattern}
      )
    `) as Row[];
    const total = number((countRows[0] ?? {}).total);
    const pageCount = Math.max(1, Math.ceil(total / CUSTOMERS_PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const offset = (page - 1) * CUSTOMERS_PAGE_SIZE;

    const rows = (await sql`
      select u.id, u.email, u.first_name, u.last_name, u.created_at,
             ord.order_count, ord.last_order_at, ord.latest_phone
      from users u
      left join lateral (
        select count(*)::int as order_count,
               max(o.created_at) as last_order_at,
               (array_agg(o.customer_phone order by o.created_at desc, o.id desc)
                  filter (where o.customer_phone <> ''))[1] as latest_phone
        from orders o
        where o.user_id = u.id
      ) ord on true
      where (
        ${search} = ''
        or u.email ilike ${pattern}
        or (u.first_name || ' ' || u.last_name) ilike ${pattern}
      )
      order by u.created_at desc, u.id
      limit ${CUSTOMERS_PAGE_SIZE} offset ${offset}
    `) as Row[];

    const customers: CustomerSummary[] = rows.map((row) => ({
      id: text(row.id),
      name: displayName(row),
      emailMasked: maskCustomerEmail(text(row.email)),
      phoneMasked: maskCustomerPhone(text(row.latest_phone)),
      joinedAt: iso(row.created_at),
      orderCount: number(row.order_count),
      lastOrderAt: nullableIso(row.last_order_at),
    }));

    return {
      ok: true,
      data: {
        customers,
        total,
        page,
        pageCount,
        pageSize: CUSTOMERS_PAGE_SIZE,
        query: search,
      },
    };
  } catch {
    console.warn('[store-admin/customers] could not read the customer list');
    return { ok: false, reason: 'unavailable' };
  }
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

export interface CustomerDetail {
  id: string;
  name: string;
  emailMasked: string;
  phoneMasked: string;
  joinedAt: string;
  orderCount: number;
  lastOrderAt: string | null;
  orders: CustomerOrderSummary[];
  /** True when the customer has more orders than the 100 shown. */
  ordersTruncated: boolean;
}

const ORDER_DETAIL_LIMIT = 100;

export async function getCustomerDetail(
  id: string,
): Promise<CustomerLoad<CustomerDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const customerId = id.trim();
  if (!customerId) return { ok: false, reason: 'not-found' };

  try {
    const userRows = (await sql`
      select u.id, u.email, u.first_name, u.last_name, u.created_at
      from users u
      where u.id = ${customerId}
      limit 1
    `) as Row[];
    const user = userRows[0];
    if (!user) return { ok: false, reason: 'not-found' };

    const [orderRows, countRows, phoneRows] = await Promise.all([
      sql`
        select o.txnid, o.amount, o.currency, o.status,
               o.created_at, o.paid_at
        from orders o
        where o.user_id = ${customerId}
        order by o.created_at desc, o.id desc
        limit ${ORDER_DETAIL_LIMIT}
      `,
      sql`
        select count(*)::int as total from orders o
        where o.user_id = ${customerId}
      `,
      sql`
        select o.customer_phone
        from orders o
        where o.user_id = ${customerId}
        order by o.created_at desc, o.id desc
        limit 1
      `,
    ]);

    const rows = orderRows as Row[];
    const orderCount = number(((countRows as Row[])[0] ?? {}).total);
    const latestPhone = text(((phoneRows as Row[])[0] ?? {}).customer_phone);

    const orders: CustomerOrderSummary[] = rows.map((row) => ({
      txnid: text(row.txnid),
      amount: number(row.amount),
      currency: text(row.currency) || 'INR',
      status: text(row.status),
      createdAt: iso(row.created_at),
      paidAt: nullableIso(row.paid_at),
    }));

    return {
      ok: true,
      data: {
        id: text(user.id),
        name: displayName(user),
        emailMasked: maskCustomerEmail(text(user.email)),
        phoneMasked: maskCustomerPhone(latestPhone),
        joinedAt: iso(user.created_at),
        orderCount,
        lastOrderAt: orders.length > 0 ? orders[0].createdAt : null,
        orders,
        ordersTruncated: orderCount > orders.length,
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
      select o.customer_phone
      from orders o
      where o.user_id = ${customerId}
      order by o.created_at desc, o.id desc
      limit 1
    `) as Row[];
    const phone = text((rows[0] ?? {}).customer_phone).trim();
    return phone ? { ok: true, value: phone } : { ok: false, reason: 'no-value' };
  } catch {
    console.warn('[store-admin/customers] could not reveal a customer field');
    return { ok: false, reason: 'unavailable' };
  }
}
