import type postgres from 'postgres';
import { getSql } from '@/lib/platform/db';

/** Retired customer UI seam. Keep historical reason rows, but never load new choices. */
export async function listBillReasons(): Promise<Array<{ id: string; label: string }>> {
  return [];
}
export async function getBillRequest(orderId: string): Promise<{ reasonLabel: string; otherText: string; createdAt: string } | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql`select reason_label,other_text,created_at from bill_requests where order_id=${orderId}`;
  const row = rows[0];
  return row ? { reasonLabel: String(row.reason_label), otherText: String(row.other_text), createdAt: new Date(row.created_at as string).toISOString() } : null;
}
export class BillRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function validateBillReason(input: { reasonId: unknown; otherText?: unknown }) {
  const reasonId = typeof input.reasonId === 'string' ? input.reasonId.trim() : '';
  const otherText = typeof input.otherText === 'string' ? input.otherText.trim() : '';
  if (!reasonId || reasonId.length > 100 || (reasonId === 'other' && (!otherText || otherText.length > 300)) || (reasonId !== 'other' && otherText)) {
    throw new BillRequestError('Choose a reason; Other requires 1–300 characters.', 400);
  }
  return { reasonId, otherText };
}
/** Retired mutation: authorize ownership before returning Gone, including old requests. */
export async function requestBillUsing(sql: postgres.Sql, userId: string, txnid: string, _input?: unknown): Promise<never> {
  const orders = await sql`select id from orders where txnid=${txnid} and user_id=${userId}`;
  if (!orders[0]) throw new BillRequestError('Order not found.', 404);
  throw new BillRequestError('Bill requests have been retired. Payment receipts are available after payment; invoices are available after delivery.', 410);
}
export async function requestBill(userId: string, txnid: string, input?: unknown): Promise<never> {
  const sql = getSql();
  if (!sql) throw new BillRequestError('Bill requests are unavailable.', 503);
  return requestBillUsing(sql, userId, txnid, input);
}
