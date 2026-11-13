import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { getSql } from '@/lib/platform/db';
import { writeAudit } from './audit';
import { appendFreeGiftReturnThresholdNoteInTx } from '@/lib/free-gifts/store';
import { isRefundMethod, type RefundMethod } from './return-rules';
import { recordRefundInTx, type RecordRefundInput, type RefundMutation, type ReturnLoad } from './returns';

if (typeof window !== 'undefined') throw new Error('Refund lifecycle must be server-only.');

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;
export type RefundRequestStatus = 'INITIATED' | 'COMPLETED' | 'FAILED' | 'REJECTED';
export interface RefundRequestRow {
  id: string;
  orderId: string;
  txnid: string;
  returnId: string | null;
  amountPaise: number;
  currency: string;
  method: RefundMethod;
  reason: string;
  note: string;
  createdAt: string;
  status: RefundRequestStatus;
  refundId: string | null;
  completedAt: string | null;
}
type Failure = Extract<RefundMutation, { ok: false }> | {
  ok: false; reason: 'already-terminal' | 'return-cap-exceeded'; error: string;
};
export type RefundLifecycleMutation = Failure | {
  ok: true;
  requestId: string;
  orderId: string;
  txnid: string;
  returnId: string | null;
  amountPaise: number;
  remainingPaise: number;
  status: RefundRequestStatus;
  refundId: string | null;
  duplicate: boolean;
};
interface Actor { actorId: string; actorEmail?: string; request?: Request }
export interface InitiateRefundInput extends Actor {
  txnid: string; returnId?: string | null; amountPaise: number;
  method: unknown; reason?: unknown; note?: unknown;
}
const str = (v: unknown) => v == null ? '' : String(v);
const date = (v: unknown) => v instanceof Date ? v.toISOString() : str(v);
const fail = (reason: Failure['reason'], error: string): Failure => ({ ok: false, reason, error });
class RefundFailure extends Error { constructor(readonly result: Failure) { super(result.error); } }

/** Pure capacity gate. Outstanding reservations count, terminal events do not. */
export function checkRefundCapacity(input: {
  amountPaise: number; capturedPaise: number; refundedPaise: number; pendingPaise: number;
  returnRemainingPaise?: number;
}): { ok: true; remainingPaise: number } | Failure {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) {
    return fail('invalid-amount', 'Enter a positive whole-paise refund amount.');
  }
  const remaining = Math.max(0, input.capturedPaise - input.refundedPaise - input.pendingPaise);
  if (input.amountPaise > remaining) {
    return fail('refund-exceeds-captured', 'Completed and initiated refunds cannot exceed the captured payment.');
  }
  if (input.returnRemainingPaise !== undefined && input.amountPaise > input.returnRemainingPaise) {
    return fail('return-cap-exceeded', 'Completed and initiated refunds cannot exceed this return’s goods value.');
  }
  return { ok: true, remainingPaise: remaining - input.amountPaise };
}
export function completionReference(value: unknown): string | null {
  const ref = typeof value === 'string' ? value.trim() : '';
  return ref.length >= 1 && ref.length <= 120 ? ref : null;
}

async function audit(tx: Tx, actor: Actor, action: string, entityId: string, after: Record<string, unknown>) {
  const saved = await writeAudit({ actorId: actor.actorId, actorEmail: actor.actorEmail,
    request: actor.request, action, entity: 'refund_request', entityId, after }, tx);
  if (!saved) throw new Error('Refund audit unavailable');
}
async function position(tx: Tx, order: Row) {
  const [row] = await tx`
    select coalesce((select sum(amount_paise) from order_payments
                      where order_id = ${str(order.id)} and status = 'PAID'), 0)::bigint as captured,
           coalesce((select sum(amount_paise) from refunds where order_id = ${str(order.id)}), 0)::bigint as refunded,
           coalesce((select sum(q.amount_paise) from refund_requests q
                     where q.order_id = ${str(order.id)} and not exists
                       (select 1 from refund_request_events e where e.request_id = q.id)), 0)::bigint as pending
  `;
  const captured = Number(row.captured) || (order.status === 'PAID'
    ? Number(order.total_paise) || Math.round(Number(order.amount) * 100) : 0);
  return { capturedPaise: captured, refundedPaise: Number(row.refunded), pendingPaise: Number(row.pending) };
}
async function lockOrder(tx: Tx, txnid: string) {
  const [order] = await tx`select id, txnid, status, total_paise, amount, currency
    from orders where txnid = ${txnid.trim()} for update`;
  if (!order) throw new RefundFailure(fail('not-found', 'Order not found.'));
  return order;
}
async function returnCapacity(tx: Tx, orderId: string, returnId: string) {
  const [row] = await tx`select id, status from return_requests
    where id = ${returnId} and order_id = ${orderId} for update`;
  if (!row) throw new RefundFailure(fail('not-found', 'Return not found for this order.'));
  if (row.status !== 'RECEIVED') throw new RefundFailure(fail('return-not-received', 'Receive the returned goods before initiating a refund.'));
  const [totals] = await tx`
    select coalesce((select sum(round(greatest(0, oi.line_total_paise - oi.discount_paise)::numeric
                            * ri.quantity / nullif(oi.quantity, 0)))
                     from return_items ri join order_items oi on oi.id = ri.order_item_id
                     where ri.return_id = ${returnId}), 0)::bigint as expected,
           coalesce((select sum(amount_paise) from refunds where return_id = ${returnId}), 0)::bigint as refunded,
           coalesce((select sum(q.amount_paise) from refund_requests q where q.return_id = ${returnId}
                     and not exists (select 1 from refund_request_events e where e.request_id = q.id)), 0)::bigint as pending
  `;
  return Math.max(0, Number(totals.expected) - Number(totals.refunded) - Number(totals.pending));
}
async function initiateInTx(tx: Tx, input: InitiateRefundInput): Promise<Extract<RefundLifecycleMutation, { ok: true }>> {
  if (!isRefundMethod(input.method)) throw new RefundFailure(fail('invalid-input', 'Choose a refund method.'));
  const order = await lockOrder(tx, input.txnid);
  const returnId = input.returnId?.trim() || null;
  const returnRemainingPaise = returnId ? await returnCapacity(tx, str(order.id), returnId) : undefined;
  const totals = await position(tx, order);
  const check = checkRefundCapacity({ ...totals, amountPaise: input.amountPaise, returnRemainingPaise });
  if (!check.ok) throw new RefundFailure(check);
  const requestId = `rreq_${randomBytes(12).toString('hex')}`;
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const rawNote = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';
  const { note } = await appendFreeGiftReturnThresholdNoteInTx(tx, {
    orderId: str(order.id),
    additionalRefundPaise: Math.trunc(input.amountPaise) + totals.pendingPaise,
    existingNote: rawNote,
    maxLength: 500,
  });
  await tx`insert into refund_requests
    (id, order_id, return_id, amount_paise, currency, method, reason, note, created_by, created_at)
    values (${requestId}, ${str(order.id)}, ${returnId}, ${input.amountPaise}, ${str(order.currency) || 'INR'},
            ${input.method}, ${reason}, ${note}, ${input.actorId}, now())`;
  await audit(tx, input, 'refund.initiate', requestId, {
    orderId: str(order.id), returnId, amountPaise: input.amountPaise, status: 'INITIATED',
  });
  return { ok: true, requestId, orderId: str(order.id), txnid: str(order.txnid), returnId,
    amountPaise: input.amountPaise, remainingPaise: check.remainingPaise,
    status: 'INITIATED', refundId: null, duplicate: false };
}
async function transaction<T>(run: (tx: Tx) => Promise<T>, connection?: postgres.Sql): Promise<T | Failure> {
  const sql = connection ?? getSql();
  if (!sql) return fail('unavailable', 'Refund records are not available.');
  try { return await sql.begin(run) as T; }
  catch (error) {
    if (error instanceof RefundFailure) return error.result;
    console.warn('[store-admin/refunds] lifecycle transaction failed');
    return fail('unavailable', 'Refund records are not available.');
  }
}
export async function initiateRefund(input: InitiateRefundInput): Promise<RefundLifecycleMutation> {
  return transaction(tx => initiateInTx(tx, input));
}
/** Schema-pinned caller connection; does not read environment configuration. */
export async function initiateRefundUsing(sql: postgres.Sql, input: InitiateRefundInput): Promise<RefundLifecycleMutation> {
  return transaction(tx => initiateInTx(tx, input), sql);
}

export interface ResolveRefundInput extends Actor {
  txnid: string; requestId: string; status: 'COMPLETED' | 'FAILED' | 'REJECTED'; providerRef?: unknown;
}
async function resolveInTx(tx: Tx, input: ResolveRefundInput): Promise<{
  lifecycle: Extract<RefundLifecycleMutation, { ok: true }>;
  refund?: Extract<RefundMutation, { ok: true }>;
}> {
  // All lifecycle paths lock order, request, then return. Initiation locks order then return.
  const order = await lockOrder(tx, input.txnid);
  const [q] = await tx`select * from refund_requests where id = ${input.requestId}
    and order_id = ${str(order.id)} for update`;
  if (!q) throw new RefundFailure(fail('not-found', 'Refund request not found for this order.'));
  const [existing] = await tx`select status, refund_id from refund_request_events where request_id = ${str(q.id)}`;
  const totals = await position(tx, order);
  const base = { ok: true as const, requestId: str(q.id), orderId: str(order.id), txnid: str(order.txnid),
    returnId: q.return_id ? str(q.return_id) : null, amountPaise: Number(q.amount_paise) };
  if (existing) {
    if (existing.status !== input.status) throw new RefundFailure(fail('already-terminal', 'This refund request already has a terminal result.'));
    return { lifecycle: { ...base, status: existing.status as RefundRequestStatus,
      refundId: existing.refund_id ? str(existing.refund_id) : null,
      remainingPaise: Math.max(0, totals.capturedPaise - totals.refundedPaise - totals.pendingPaise), duplicate: true } };
  }
  let refund: Extract<RefundMutation, { ok: true }> | undefined;
  if (input.status === 'COMPLETED') {
    const providerRef = completionReference(input.providerRef);
    if (!providerRef) throw new RefundFailure(fail('invalid-input', 'Every completed refund needs a reference of 1–120 characters.'));
    // Recheck all reservations against capture before replacing this one with a ledger row.
    const check = checkRefundCapacity({ ...totals, amountPaise: Number(q.amount_paise),
      pendingPaise: totals.pendingPaise - Number(q.amount_paise) });
    if (!check.ok) throw new RefundFailure(check);
    const result = await recordRefundInTx(tx, { ...input, returnId: base.returnId,
      amountPaise: Number(q.amount_paise), method: q.method, providerRef, reason: q.reason, note: q.note,
      refundRequestId: str(q.id) });
    if (!result.ok) throw new RefundFailure(result);
    refund = result;
  }
  await tx`insert into refund_request_events (request_id, status, refund_id, created_by, created_at)
    values (${str(q.id)}, ${input.status}, ${refund?.refundId ?? null}, ${input.actorId}, now())`;
  const remainingPaise = Math.max(0, totals.capturedPaise - totals.refundedPaise - totals.pendingPaise
    + (input.status === 'COMPLETED' ? 0 : Number(q.amount_paise)));
  await audit(tx, input, `refund.${input.status.toLowerCase()}`, str(q.id), {
    orderId: base.orderId, returnId: base.returnId, status: input.status,
    amountPaise: base.amountPaise, refundId: refund?.refundId ?? null,
  });
  return { lifecycle: { ...base, status: input.status, refundId: refund?.refundId ?? null,
    remainingPaise, duplicate: false }, refund };
}
export async function resolveRefundRequest(input: ResolveRefundInput): Promise<RefundLifecycleMutation> {
  if (!['COMPLETED', 'FAILED', 'REJECTED'].includes(input.status)) return fail('invalid-input', 'Choose a terminal refund status.');
  return transaction(async tx => (await resolveInTx(tx, input)).lifecycle);
}
/** Schema-pinned caller connection, with exactly the production transaction path. */
export async function resolveRefundRequestUsing(sql: postgres.Sql, input: ResolveRefundInput): Promise<RefundLifecycleMutation> {
  if (!['COMPLETED', 'FAILED', 'REJECTED'].includes(input.status)) return fail('invalid-input', 'Choose a terminal refund status.');
  return transaction(async tx => (await resolveInTx(tx, input)).lifecycle, sql);
}
export async function recordCompletedRefund(input: RecordRefundInput, connection?: postgres.Sql): Promise<RefundMutation> {
  if (!completionReference(input.providerRef)) return fail('invalid-input', 'Every completed refund needs a reference of 1–120 characters.') as RefundMutation;
  const result = await transaction(async tx => {
    const initiated = await initiateInTx(tx, input);
    const completed = await resolveInTx(tx, { ...input, requestId: initiated.requestId, status: 'COMPLETED' });
    return { ...completed.refund!, remainingPaise: completed.lifecycle.remainingPaise };
  }, connection);
  // The legacy contract has fewer denial codes; retain its existing API shape.
  if (!result.ok && (result.reason === 'return-cap-exceeded' || result.reason === 'already-terminal')) {
    return { ok: false, reason: 'invalid-input', error: result.error };
  }
  return result as RefundMutation;
}

/** Enqueue only: never drain the outbox or authenticate to SMTP in a refund action. */
export async function enqueueRefundLifecycleNotification(result: Extract<RefundLifecycleMutation, { ok: true }>): Promise<void> {
  if (result.status !== 'INITIATED' && result.status !== 'COMPLETED') return;
  try {
    const [{ getOrderByTxnid }, { orderNotificationContext }, { enqueueNotification }] = await Promise.all([
      import('@/lib/payu/orders'), import('@/lib/notifications/order-context'), import('@/lib/notifications/enqueue'),
    ]);
    const order = await getOrderByTxnid(result.txnid);
    if (!order) return;
    await enqueueNotification(result.status === 'INITIATED' ? 'refund_pending' : 'refund_completed',
      { type: 'order', id: result.txnid }, orderNotificationContext(order, {
        refundPaise: result.amountPaise,
        orderStatus: result.status === 'INITIATED' ? 'Refund Initiated' : 'Refund Successful',
        token: `refund-lifecycle:${result.requestId}:${result.status}`,
      }));
  } catch { console.warn('[store-admin/refunds] notification enqueue failed'); }
}

/** Staff-authorized callers only; no customer identity or full PII is projected. */
export async function getRefundRequests(txnid: string): Promise<ReturnLoad<RefundRequestRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = await sql`select q.*, o.txnid, e.status, e.refund_id, e.created_at as terminal_at
      from refund_requests q join orders o on o.id = q.order_id
      left join refund_request_events e on e.request_id = q.id
      where o.txnid = ${txnid.trim()} order by q.created_at desc, q.id desc`;
    return { ok: true, data: rows.map(q => ({ id: str(q.id), orderId: str(q.order_id), txnid: str(q.txnid),
      returnId: q.return_id ? str(q.return_id) : null, amountPaise: Number(q.amount_paise),
      currency: str(q.currency), method: q.method as RefundMethod, reason: str(q.reason), note: str(q.note),
      createdAt: date(q.created_at), status: (q.status || 'INITIATED') as RefundRequestStatus,
      refundId: q.refund_id ? str(q.refund_id) : null,
      completedAt: q.status === 'COMPLETED' ? date(q.terminal_at) : null })) };
  } catch {
    console.warn('[store-admin/refunds] lifecycle read failed');
    return { ok: false, reason: 'unavailable' };
  }
}
