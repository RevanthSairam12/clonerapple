import crypto from 'node:crypto';
import type postgres from 'postgres';
import { getSql } from '@/lib/platform/db';

export const DEFAULT_BILL_REASONS: Array<{ id: string; label: string }> = [
  { id: 'warranty', label: 'Warranty claim' },
  { id: 'accounting', label: 'Tax / accounting record' },
  { id: 'reimbursement', label: 'Employer / business reimbursement' },
  { id: 'personal', label: 'Personal record' },
];

export async function listBillReasonsUsing(
  sql: postgres.Sql | postgres.TransactionSql | null | undefined,
): Promise<Array<{ id: string; label: string }>> {
  if (!sql) return DEFAULT_BILL_REASONS;
  try {
    const rows = await sql`
      select id, label
      from bill_request_reasons
      where is_active = true
      order by sort_order asc, id asc
    `;
    if (rows.length === 0) return DEFAULT_BILL_REASONS;
    return rows.map((row) => ({
      id: String(row.id),
      label: String(row.label),
    }));
  } catch {
    return DEFAULT_BILL_REASONS;
  }
}

export async function listBillReasons(): Promise<Array<{ id: string; label: string }>> {
  return listBillReasonsUsing(getSql());
}

export async function getBillRequest(
  orderId: string,
): Promise<{ reasonLabel: string; otherText: string; createdAt: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`select reason_label,other_text,created_at from bill_requests where order_id=${orderId}`;
  const row = rows[0];
  return row
    ? {
        reasonLabel: String(row.reason_label),
        otherText: String(row.other_text),
        createdAt: new Date(row.created_at as string).toISOString(),
      }
    : null;
}

export class BillRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function validateBillReason(input: { reasonId: unknown; otherText?: unknown }) {
  const reasonId = typeof input.reasonId === 'string' ? input.reasonId.trim() : '';
  const otherText = typeof input.otherText === 'string' ? input.otherText.trim() : '';
  if (
    !reasonId ||
    reasonId.length > 100 ||
    (reasonId === 'other' && (!otherText || otherText.length > 300)) ||
    (reasonId !== 'other' && otherText)
  ) {
    throw new BillRequestError('Choose a reason; Other requires 1–300 characters.', 400);
  }
  return { reasonId, otherText };
}

/**
 * Record the customer's reason for viewing/downloading a delivered order's invoice.
 */
export async function requestBillUsing(
  sql: postgres.Sql,
  userId: string,
  txnid: string,
  input?: unknown,
): Promise<{ ok: true }> {
  const orders = await sql`
    select id, status, fulfilment_status, payment_review_required, invoice_number, invoice_issued_at
    from orders
    where txnid = ${txnid} and user_id = ${userId}
  `;
  const order = orders[0];
  if (!order) throw new BillRequestError('Order not found.', 404);

  const { reasonId, otherText } = validateBillReason(
    (input && typeof input === 'object' ? input : {}) as {
      reasonId: unknown;
      otherText?: unknown;
    },
  );

  const eligible =
    order.status === 'PAID' &&
    order.payment_review_required !== true &&
    order.fulfilment_status === 'DELIVERED' &&
    Boolean(order.invoice_number && order.invoice_issued_at);
  if (!eligible) {
    throw new BillRequestError(
      'Invoice is available after the order is delivered and the invoice is generated.',
      409,
    );
  }

  let dbReasonId: string | null = null;
  let reasonLabel = '';
  let dbOtherText = '';

  if (reasonId === 'other') {
    dbReasonId = null;
    reasonLabel = 'Other';
    dbOtherText = otherText;
  } else {
    const reasonRows = await sql`
      select id, label
      from bill_request_reasons
      where id = ${reasonId} and is_active = true
    `;
    if (reasonRows[0]) {
      dbReasonId = String(reasonRows[0].id);
      reasonLabel = String(reasonRows[0].label);
      dbOtherText = '';
    } else {
      const fallback = DEFAULT_BILL_REASONS.find((item) => item.id === reasonId);
      if (!fallback) {
        throw new BillRequestError('Choose a valid reason.', 400);
      }
      dbReasonId = null;
      reasonLabel = fallback.label;
      dbOtherText = fallback.label;
    }
  }

  const requestId = crypto.randomUUID();
  await sql`
    insert into bill_requests (id, order_id, user_id, reason_id, reason_label, other_text)
    values (${requestId}, ${String(order.id)}, ${userId}, ${dbReasonId}, ${reasonLabel}, ${dbOtherText})
    on conflict (order_id) do nothing
  `;
  return { ok: true };
}

export async function requestBill(
  userId: string,
  txnid: string,
  input?: unknown,
): Promise<{ ok: true }> {
  const sql = getSql();
  if (!sql) throw new BillRequestError('Bill requests are unavailable.', 503);
  return requestBillUsing(sql, userId, txnid, input);
}
