import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';

/**
 * Durable "a refund is owed" records.
 *
 * A verified capture that cannot be fulfilled — its reserved units were
 * released and the shelf is empty — still took the customer's money. The order
 * becomes PAID and flagged for review, and one obligation row records the
 * amount that must go back. Recording a manual refund against the order closes
 * the obligation once refunds cover it; the obligation itself is never
 * deleted, and the refund rows stay append-only.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Refund obligations must be handled on the server only.');
}

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

export const REFUND_OBLIGATION_REASON =
  'Payment was verified after the reserved stock had been released and the units were no longer available.';

export interface RefundObligationInput {
  orderId: string;
  amountPaise: number;
  reason?: string;
}

export interface RefundObligationCreated {
  id: string | null;
  created: boolean;
  amountPaise: number;
}

/**
 * Create the single pending obligation for an order. The partial unique index
 * `one pending per order` makes a duplicate callback or a second reconcile
 * pass a no-op rather than a second refund request.
 */
export async function createRefundObligationInTx(
  tx: Tx,
  input: RefundObligationInput,
): Promise<RefundObligationCreated> {
  const amountPaise = Math.max(0, Math.trunc(input.amountPaise));
  if (amountPaise === 0) return { id: null, created: false, amountPaise: 0 };

  const rows = (await tx`
    insert into refund_obligations (id, order_id, amount_paise, reason)
    values (
      ${`rfo_${randomBytes(8).toString('hex')}`},
      ${input.orderId},
      ${amountPaise},
      ${(input.reason ?? REFUND_OBLIGATION_REASON).slice(0, 300)}
    )
    on conflict (order_id) where status = 'PENDING' do nothing
    returning id
  `) as Row[];

  if (rows[0]) return { id: String(rows[0].id), created: true, amountPaise };

  const existing = (await tx`
    select id from refund_obligations
    where order_id = ${input.orderId} and status = 'PENDING'
    limit 1
  `) as Row[];
  return {
    id: existing[0] ? String(existing[0].id) : null,
    created: false,
    amountPaise,
  };
}

/**
 * Close every pending obligation that the refunds recorded against the order
 * now cover. Called inside the refund transaction, after the new refund row is
 * written, so the check sees the updated total. Returns the closed ids.
 */
export async function closeRefundObligationsInTx(
  tx: Tx,
  orderId: string,
): Promise<string[]> {
  const totals = (await tx`
    select
      coalesce((select sum(amount_paise) from refunds where order_id = ${orderId}), 0)::bigint as refunded,
      (select id from refunds where order_id = ${orderId} order by created_at desc, id desc limit 1) as last_refund_id
  `) as Row[];
  const refunded = Number(totals[0]?.refunded ?? 0);
  const lastRefundId = totals[0]?.last_refund_id ? String(totals[0].last_refund_id) : null;
  if (refunded <= 0) return [];

  const closed = (await tx`
    update refund_obligations
    set status = 'RECORDED',
        refund_id = ${lastRefundId},
        updated_at = now()
    where order_id = ${orderId}
      and status = 'PENDING'
      and amount_paise <= ${refunded}
    returning id
  `) as Row[];
  return closed.map((row) => String(row.id));
}

export interface PendingRefundObligation {
  id: string;
  orderId: string;
  txnid: string;
  amountPaise: number;
  reason: string;
  createdAt: string;
}

/** Operational view: money owed but not yet recorded as refunded. */
export async function listPendingRefundObligations(
  limit = 100,
): Promise<PendingRefundObligation[]> {
  const sql = getSql();
  if (!sql) return [];
  try {
    const rows = (await sql`
      select r.id, r.order_id, o.txnid, r.amount_paise, r.reason, r.created_at
      from refund_obligations r
      join orders o on o.id = r.order_id
      where r.status = 'PENDING'
      order by r.created_at asc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      orderId: String(row.order_id),
      txnid: String(row.txnid),
      amountPaise: Number(row.amount_paise) || 0,
      reason: String(row.reason ?? ''),
      createdAt: row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ''),
    }));
  } catch {
    console.warn('[payu/refunds] could not list pending refund obligations');
    return [];
  }
}
