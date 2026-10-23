import { randomBytes } from 'node:crypto';
import { getSql } from '@/lib/admin/db';
import { maskCustomerEmail, maskCustomerPhone } from './masking';
import { canTransitionRequest, type RequestStatus, type RequestType, validateCustomerRequestState } from '@/lib/account/request-rules';
import { isWithinReturnWindow } from '@/lib/account/rules';
import { RETURN_WINDOW_DAYS } from '@/lib/account/config';

export const REQUESTS_UNAVAILABLE_MESSAGE = 'Requests unavailable: apply migrations 0014-0016';

export interface OrderRequestListItem {
  id: string;
  txnid: string;
  type: RequestType;
  status: RequestStatus;
  customerName: string;
  customerEmail: string;
  createdAt: Date;
}

export interface OrderRequestDetail extends OrderRequestListItem {
  orderId: string;
  customerPhone: string;
  reason: string;
  adminNote: string | null;
  amount: number;
  paymentStatus: string;
  fulfilmentStatus: string;
  updatedAt: Date;
}

export interface OrderRequestListData {
  requests: OrderRequestListItem[];
  counts: Record<RequestStatus, number>;
}

export type OrderRequestLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

function emptyRequestCounts(): Record<RequestStatus, number> {
  return { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, REJECTED: 0 };
}

/** Log the real failure without any customer or request data. */
function warnUnavailable(op: string, error: unknown): void {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.warn(`[store-admin/requests] ${op} failed; apply migrations 0014-0016. Cause: ${raw.replace(/\s+/g, ' ').slice(0, 200)}`);
}

type RequestRow = {
  id: string; order_id: string; txnid: string; type: RequestType; status: RequestStatus; reason: string;
  admin_note: string | null; created_at: string | Date; updated_at: string | Date; amount: string | number;
  payment_status: string; fulfilment_status: string; first_name: string; last_name: string; email: string; phone: string;
};

function mapList(row: RequestRow): OrderRequestListItem {
  const customerName = `${row.first_name} ${row.last_name}`.trim().split(/\s+/).filter(Boolean).map((part) => `${part.slice(0, 1)}***`).join(' ') || '[redacted name]';
  return {
    id: row.id, txnid: row.txnid, type: row.type, status: row.status,
    customerName, customerEmail: maskCustomerEmail(row.email), createdAt: new Date(row.created_at),
  };
}

function mapDetail(row: RequestRow): OrderRequestDetail {
  return { ...mapList(row), orderId: row.order_id, customerPhone: maskCustomerPhone(row.phone), reason: row.reason, adminNote: row.admin_note, amount: Number(row.amount), paymentStatus: row.payment_status, fulfilmentStatus: row.fulfilment_status, updatedAt: new Date(row.updated_at) };
}

const SELECT = `
  select r.id, r.order_id, o.txnid, r.type, r.status, r.reason, r.admin_note, r.created_at, r.updated_at,
    o.amount, o.status as payment_status, o.fulfilment_status,
    u.first_name, u.last_name, u.email, coalesce(u.phone, o.customer_phone) as phone
  from order_requests r
  join orders o on o.id = r.order_id
  join users u on u.id = r.user_id
`;

export async function listOrderRequests(status?: string): Promise<OrderRequestLoad<OrderRequestListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  const normalized = status && ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED'].includes(status) ? status : '';
  try {
    // Two branches on purpose: the unfiltered query contains no $1 at all, so
    // it never runs with an unbound parameter.
    const rows = normalized === ''
      ? await sql.unsafe<RequestRow[]>(`${SELECT} order by r.created_at desc limit 100`, [])
      : await sql.unsafe<RequestRow[]>(`${SELECT} where r.status = $1 order by r.created_at desc limit 100`, [normalized]);
    const countRows = await sql<Array<{ status: RequestStatus; count: string }>>`select status, count(*)::text as count from order_requests group by status`;
    const counts = emptyRequestCounts();
    for (const row of countRows) counts[row.status] = Number(row.count);
    return { ok: true, data: { requests: rows.map(mapList), counts } };
  } catch (error) {
    warnUnavailable('list', error);
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getOpenOrderRequestCount(): Promise<OrderRequestLoad<{ count: number }>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = await sql<Array<{ count: string }>>`
      select count(*)::text as count from order_requests where status in ('OPEN', 'IN_PROGRESS')
    `;
    return { ok: true, data: { count: Number(rows[0]?.count || 0) } };
  } catch (error) {
    warnUnavailable('open-count', error);
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getOrderRequestDetail(id: string): Promise<OrderRequestLoad<OrderRequestDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = await sql.unsafe<RequestRow[]>(`${SELECT} where r.id = $1 limit 1`, [id]);
    return rows[0]
      ? { ok: true, data: mapDetail(rows[0]) }
      : { ok: false, reason: 'not-found' };
  } catch (error) {
    warnUnavailable('detail', error);
    return { ok: false, reason: 'unavailable' };
  }
}

export async function createCustomerOrderRequest(userId: string, txnid: string, type: RequestType, reason: string): Promise<OrderRequestDetail> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const orderRows = await sql<Array<{ id: string; fulfilment_status: string; delivered_at: string | Date | null }>>`
    select o.id, o.fulfilment_status, d.delivered_at
    from orders o left join order_deliveries d on d.order_id = o.id
    where o.txnid = ${txnid} and o.user_id = ${userId} limit 1
  `;
  const order = orderRows[0];
  if (!order) throw new Error('Order not found.');
  const rule = validateCustomerRequestState({ type, fulfilmentStatus: order.fulfilment_status || 'PENDING', deliveredAt: order.delivered_at });
  if (!rule.ok) throw new Error(rule.error);
  const trimmedReason = reason.trim().slice(0, 500);
  if (!trimmedReason) throw new Error('A reason is required.');
  const existing = await sql<Array<{ id: string }>>`
    select id from order_requests where order_id = ${order.id} and type = ${type} and status in ('OPEN', 'IN_PROGRESS') limit 1
  `;
  if (existing[0]) throw new Error('There is already an open request of this type for this order.');
  const id = `req_${randomBytes(12).toString('hex')}`;
  await sql`insert into order_requests (id, order_id, user_id, type, reason) values (${id}, ${order.id}, ${userId}, ${type}, ${trimmedReason})`;
  const created = await getOrderRequestDetail(id);
  if (!created.ok) throw new Error('Could not read the new request.');
  return created.data;
}

export async function transitionOrderRequest(id: string, status: RequestStatus, adminNote: string, adminId: string) {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  const currentLoad = await getOrderRequestDetail(id);
  if (!currentLoad.ok) throw new Error('Request not found.');
  const current = currentLoad.data;
  if (!canTransitionRequest(current.status, status) && current.status !== status) throw new Error('That request status change is not allowed.');
  const note = adminNote.trim().slice(0, 500);
  try {
    await sql`update order_requests set status = ${status}, admin_note = ${note || null}, resolved_by = case when ${status} in ('RESOLVED', 'REJECTED') then ${adminId} else resolved_by end, updated_at = now() where id = ${id}`;
    await sql`insert into order_status_history (order_id, domain, actor, from_status, to_status, note) values (${current.orderId}, ${current.type === 'help' ? 'fulfilment' : 'refund'}, 'system', ${current.fulfilmentStatus}, ${current.fulfilmentStatus}, ${`Request ${current.id} marked ${status}.`})`;
  } catch (error) {
    warnUnavailable('update', error);
    throw new Error('Requests are unavailable: apply migrations 0014-0016.');
  }
  const after = await getOrderRequestDetail(id);
  if (!after.ok) throw new Error('Could not read the updated request.');
  return { before: current.status, after: after.data };
}

export function canRequestReturn(deliveredAt: Date | string | null): boolean {
  return isWithinReturnWindow(deliveredAt, new Date(), RETURN_WINDOW_DAYS);
}
