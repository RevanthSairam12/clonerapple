import type postgres from 'postgres';
import { getSql } from '@/lib/platform/db';
import { deriveDocumentState, projectCustomerDocumentState, type CustomerDocumentMode, type CustomerDocumentState, type DocumentState } from './document-policy';

if (typeof window !== 'undefined') throw new Error('Order document facts are server-only.');

type Sql = postgres.Sql | postgres.TransactionSql;
/** Internal facts loader. Callers MUST authorize ownership/role before using it. */
export async function getDocumentStateUsing(sql: Sql, orderId: string): Promise<DocumentState> {
  const rows = await sql`
    select o.status, o.fulfilment_status, o.channel, o.payment_review_required,
      o.total_paise, o.amount, o.invoice_number, o.invoice_issued_at,
      exists(select 1 from order_status_history h where h.order_id=o.id and h.domain='fulfilment' and h.to_status in ('ON_THE_WAY','DELIVERED')) as shipped,
      coalesce((select sum(p.amount_paise) from order_payments p where p.order_id=o.id and p.status='PAID'),0)::text as captured,
      coalesce((select sum(r.amount_paise) from refunds r where r.order_id=o.id),0)::text as refunded,
      coalesce((select sum(r.amount_paise) from refund_requests r where r.order_id=o.id and not exists(select 1 from refund_request_events e where e.request_id=r.id)),0)::text as pending_refund,
      coalesce((select sum(r.amount_paise) from refund_obligations r where r.order_id=o.id and r.status='PENDING'),0)::text as refund_due,
      (select e.status from refund_request_events e join refund_requests r on r.id=e.request_id where r.order_id=o.id order by e.created_at desc, e.request_id desc limit 1) as last_refund_outcome,
      exists(select 1 from bill_requests b where b.order_id=o.id) as bill_requested
    from orders o where o.id=${orderId}
  `;
  const row = rows[0];
  if (!row) throw new Error('Order document unavailable');
  const total = Number(row.total_paise) || Math.round(Number(row.amount) * 100);
  const captured = Number(row.captured) || (row.status === 'PAID' ? total : 0);
  return deriveDocumentState({
    paymentStatus: String(row.status), fulfilmentStatus: String(row.fulfilment_status),
    channel: String(row.channel), paymentReviewRequired: row.payment_review_required === true,
    shipmentStarted: row.shipped === true, totalPaise: total, capturedPaise: captured,
    refundedPaise: Number(row.refunded), pendingRefundPaise: Number(row.pending_refund),
    refundDuePaise: Number(row.refund_due), lastRefundOutcome: row.last_refund_outcome as string | null,
    invoiceNumber: row.invoice_number as string | null,
    invoiceIssuedAt: row.invoice_issued_at instanceof Date ? row.invoice_issued_at.toISOString() : row.invoice_issued_at as string | null,
    billRequested: row.bill_requested === true,
  });
}
/** Customer DTO: no invoice identity or historical request placeholders on receipts/status. */
export async function getCustomerDocumentStateUsing(sql: Sql, orderId: string, mode?: CustomerDocumentMode): Promise<CustomerDocumentState> {
  return projectCustomerDocumentState(await getDocumentStateUsing(sql, orderId), mode);
}
export async function getCustomerDocumentState(orderId: string, mode?: CustomerDocumentMode): Promise<CustomerDocumentState> {
  const sql = getSql();
  if (!sql) throw new Error('Order document unavailable');
  return getCustomerDocumentStateUsing(sql, orderId, mode);
}

export async function getDocumentState(orderId: string): Promise<DocumentState> {
  const sql = getSql();
  if (!sql) throw new Error('Order document unavailable');
  return getDocumentStateUsing(sql, orderId);
}
