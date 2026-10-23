import { getSql } from '@/lib/admin/db';

import { maskCustomerEmail, maskCustomerPhone } from './masking';
import {
  isSaleState,
  ORDERS_PAGE_SIZE,
  type OrderListData,
  type OrderLoad,
  type OrderSummary,
  type SaleState,
  SALE_STATES,
} from './orders';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(number(value)));
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  const result = iso(value);
  return result || null;
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function maskName(value: unknown): string {
  const parts = text(value).trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map((part) => `${part.slice(0, 1)}***`).join(' ') : '[redacted name]';
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function emptyCounts(): Record<SaleState, number> {
  return Object.fromEntries(SALE_STATES.map((state) => [state, 0])) as Record<SaleState, number>;
}

function summary(row: Row): OrderSummary {
  const saleState = isSaleState(row.sale_state) ? row.sale_state : 'PENDING';
  return {
    id: text(row.id),
    txnid: text(row.txnid),
    customer: {
      nameMasked: maskName(row.customer_name),
      emailMasked: maskCustomerEmail(text(row.customer_email)),
      phoneMasked: maskCustomerPhone(text(row.customer_phone)),
    },
    saleState,
    paymentStatus: text(row.status),
    fulfilmentStatus: text(row.fulfilment_status) as OrderSummary['fulfilmentStatus'],
    amount: number(row.amount),
    currency: text(row.currency) || 'INR',
    totalPaise: integer(row.total_paise),
    scheduledFor: nullableIso(row.scheduled_for),
    deliverySlot: nullableText(row.delivery_slot),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    paidAt: nullableIso(row.paid_at),
  };
}

/** Read-only POS view kept separate from the protected order repository. */
export async function listPosOrders(options: {
  query?: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  page?: number;
} = {}): Promise<OrderLoad<OrderListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const query = (options.query ?? '').trim().slice(0, 100);
  const dateFrom = options.dateFrom || null;
  const dateTo = options.dateTo || null;
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const pattern = `%${escapeLike(query)}%`;

  try {
    const [countRows, rows] = await Promise.all([
      sql`
        select s.sale_state, count(*)::int as count
        from order_sale_state s
        join orders o on o.id = s.id
        where s.channel = 'pos'
          and (${query === ''} or o.txnid ilike ${pattern} escape '\\')
          and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
          and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
        group by s.sale_state
      `,
      sql`
        select s.id, s.txnid, s.status, s.fulfilment_status, s.sale_state,
               s.amount, s.currency, s.total_paise, s.scheduled_for,
               s.delivery_slot, s.created_at, s.updated_at, s.paid_at,
               o.customer_name, o.customer_email, o.customer_phone
        from order_sale_state s
        join orders o on o.id = s.id
        where s.channel = 'pos'
          and (${query === ''} or o.txnid ilike ${pattern} escape '\\')
          and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
          and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
        order by s.created_at desc, s.id desc
        limit ${ORDERS_PAGE_SIZE} offset ${(requestedPage - 1) * ORDERS_PAGE_SIZE}
      `,
    ]);

    const counts = emptyCounts();
    for (const row of countRows as Row[]) {
      if (isSaleState(row.sale_state)) counts[row.sale_state] = integer(row.count);
    }
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));

    return {
      ok: true,
      data: {
        orders: (rows as Row[]).map(summary),
        total,
        page: Math.min(requestedPage, pageCount),
        pageCount,
        pageSize: ORDERS_PAGE_SIZE,
        query,
        state: null,
        dateFrom,
        dateTo,
        counts,
      },
    };
  } catch {
    console.warn('[store-admin/orders] could not read the POS order list');
    return { ok: false, reason: 'unavailable' };
  }
}
