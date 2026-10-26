import { getSql } from '@/lib/admin/db';

import { rangeDays, type RangeKey } from './analytics';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: The transaction ledger must be read on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function integer(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? Math.max(0, Math.trunc(result)) : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

export type TransactionChannel = 'online' | 'pos' | 'manual';

export function isTransactionChannel(value: unknown): value is TransactionChannel {
  return value === 'online' || value === 'pos' || value === 'manual';
}

export interface TransactionRow {
  txnid: string;
  channel: string;
  method: string;
  status: string;
  amountPaise: number;
  currency: string;
  reference: string;
  recordedAt: string;
}

export type TransactionLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' };

/**
 * Payment-level ledger for the export.
 *
 * Every recorded `order_payments` row is one line. A gateway order that was
 * settled without a recorded payment row (the PayU flow marks the order paid
 * directly) still appears once, from the order columns, so the export never
 * loses a captured payment. Multiple partial payments therefore produce
 * multiple lines, which is what a ledger should show.
 */
export async function listTransactionsForExport(options: {
  range: RangeKey;
  channel?: TransactionChannel | null;
  limit?: number;
}): Promise<TransactionLoad<TransactionRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const days = rangeDays(options.range);
  const channel = options.channel ?? null;
  const limit = Math.min(Math.max(options.limit ?? 10_000, 1), 20_000);

  try {
    const rows = (await sql`
      select
        o.txnid,
        coalesce(
          p.channel,
          case when o.channel = 'pos' then 'pos' else 'online' end
        ) as channel,
        coalesce(
          nullif(p.method, ''),
          nullif(o.payment_method, ''),
          case when o.channel = 'pos' then 'cash' else 'payu' end
        ) as method,
        coalesce(p.status, o.status) as status,
        coalesce(p.amount_paise, o.total_paise, round(o.amount * 100)::bigint) as amount_paise,
        o.currency,
        coalesce(p.provider_ref, o.payu_mihpayid, '') as reference,
        coalesce(p.paid_at, o.paid_at, p.created_at, o.created_at) as recorded_at
      from orders o
      left join order_payments p on p.order_id = o.id
      where (p.id is not null or o.status = 'PAID')
        and coalesce(p.paid_at, o.paid_at, p.created_at, o.created_at)
            >= now() - make_interval(days => ${days})
        and (
          ${channel}::text is null
          or coalesce(
            p.channel,
            case when o.channel = 'pos' then 'pos' else 'online' end
          ) = ${channel}
        )
      order by recorded_at desc, o.txnid desc
      limit ${limit}
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        txnid: text(row.txnid),
        channel: text(row.channel),
        method: text(row.method),
        status: text(row.status),
        amountPaise: integer(row.amount_paise),
        currency: text(row.currency) || 'INR',
        reference: text(row.reference),
        recordedAt: iso(row.recorded_at),
      })),
    };
  } catch {
    console.warn('[store-admin/transactions] could not read the transaction ledger');
    return { ok: false, reason: 'unavailable' };
  }
}
