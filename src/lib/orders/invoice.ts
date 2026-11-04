import type postgres from 'postgres';
import { sanitizeOrderPrefix, ORDER_NUMBER_PAD } from './numbering';
import { writeAudit } from '@/lib/store-admin/audit';

/** Caller owns the transaction. Invoice issuance rolls back with shipment. */
export async function ensureInvoiceIssuedInTx(
  tx: postgres.TransactionSql,
  orderId: string,
  actorId: string | null,
): Promise<{ number: string; issuedAt: string }> {
  const rows = await tx`select invoice_number, invoice_issued_at from orders where id=${orderId} for update`;
  const order = rows[0];
  if (!order) throw new Error('Invoice order missing');
  if (order.invoice_number && order.invoice_issued_at) {
    return { number: String(order.invoice_number), issuedAt: new Date(order.invoice_issued_at as string).toISOString() };
  }
  const settings = await tx`select value from store_settings where key='invoice_prefix'`;
  const prefix = sanitizeOrderPrefix(settings[0]?.value, 'INV');
  const counters = await tx`update invoice_number_counters set last_number=last_number+1 where name='invoice' returning last_number::text as value`;
  if (!counters[0]) throw new Error('Invoice counter unavailable');
  const value = String(counters[0].value);
  const number = `${prefix}${value.padStart(ORDER_NUMBER_PAD, '0')}`;
  const issued = await tx`update orders set invoice_sequence=${value}, invoice_number=${number}, invoice_issued_at=now() where id=${orderId} returning invoice_issued_at`;
  const audited = await writeAudit({ actorId, action: 'order.invoice.issue', entity: 'order', entityId: orderId,
    after: { invoiceNumber: number }, reason: 'shipment_invoice' }, tx);
  if (!audited) throw new Error('Invoice audit unavailable');
  return { number, issuedAt: new Date(issued[0].invoice_issued_at as string).toISOString() };
}
