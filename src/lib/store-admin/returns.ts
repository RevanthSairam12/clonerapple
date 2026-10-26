import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';

import {
  canTransitionReturn,
  checkRefund,
  checkReturnLines,
  isConditionGrade,
  isRefundMethod,
  isReturnStatus,
  restockEligible,
  RETURNING_STATUSES,
  REFUND_REFERENCE_METHODS,
  validateRefundReference,
  validateReturnReason,
  cancellationAllowed,
  type ConditionGrade,
  type RefundMethod,
  type ReturnStatus,
} from './return-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Return and refund records must be server-only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  const result = iso(value);
  return result || null;
}

/* ------------------------------------------------------------- types */

export interface RefundRow {
  id: string;
  orderId: string;
  returnId: string | null;
  amountPaise: number;
  currency: string;
  method: RefundMethod;
  providerRef: string | null;
  reason: string;
  note: string;
  recordedAt: string;
  recordedByEmail: string | null;
}

export interface ReturnItemRow {
  id: number;
  orderItemId: number;
  productName: string;
  productId: string;
  quantity: number;
  unitPricePaise: number;
  conditionGrade: ConditionGrade;
  restock: boolean;
}

export interface ReturnListRow {
  id: string;
  orderId: string;
  txnid: string;
  status: ReturnStatus;
  reason: string;
  source: 'staff' | 'customer';
  itemCount: number;
  quantity: number;
  expectedPaise: number;
  refundedPaise: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReturnDetail extends ReturnListRow {
  customerNote: string;
  staffNote: string;
  createdByEmail: string | null;
  decidedByEmail: string | null;
  decidedAt: string | null;
  receivedAt: string | null;
  refundedAt: string | null;
  items: ReturnItemRow[];
  refunds: RefundRow[];
}

export type ReturnLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

export type ReturnMutation =
  | { ok: true; id: string; status: ReturnStatus }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'invalid-transition'
        | 'not-delivered'
        | 'no-capture'
        | 'invalid-input'
        | 'quantity-exceeds-purchased';
      error: string;
    };

function mutationFailure(
  reason: Extract<ReturnMutation, { ok: false }>['reason'],
  error: string,
): ReturnMutation {
  return { ok: false, reason, error };
}

const REFUND_SELECT = `
  select f.id, f.order_id, f.return_id, f.amount_paise, f.currency, f.method,
         f.provider_ref, f.reason, f.note, f.created_at,
         a.email as recorded_by_email
  from refunds f
  left join store_admins a on a.id = f.recorded_by
`;

function mapRefund(row: Row): RefundRow {
  return {
    id: text(row.id),
    orderId: text(row.order_id),
    returnId: nullableText(row.return_id),
    amountPaise: number(row.amount_paise),
    currency: text(row.currency) || 'INR',
    method: isRefundMethod(row.method) ? row.method : 'other',
    providerRef: nullableText(row.provider_ref),
    reason: text(row.reason),
    note: text(row.note),
    recordedAt: iso(row.created_at),
    recordedByEmail: nullableText(row.recorded_by_email),
  };
}

/** Shared projection; `extraColumns` is appended to the select list. */
function returnListSelect(extraColumns = ''): string {
  return `
    select r.id, r.order_id, o.txnid, r.status, r.reason, r.source,
           r.created_at, r.updated_at,
           (select count(*)::int from return_items ri where ri.return_id = r.id) as item_count,
           coalesce((select sum(ri.quantity)::int from return_items ri where ri.return_id = r.id), 0) as quantity,
           coalesce((
             select sum(ri.quantity * oi.unit_price_paise)::bigint
             from return_items ri join order_items oi on oi.id = ri.order_item_id
             where ri.return_id = r.id
           ), 0) as expected_paise,
           coalesce((select sum(f.amount_paise)::bigint from refunds f where f.return_id = r.id), 0) as refunded_paise${extraColumns}
    from return_requests r
    join orders o on o.id = r.order_id
  `;
}

function mapReturnList(row: Row): ReturnListRow {
  return {
    id: text(row.id),
    orderId: text(row.order_id),
    txnid: text(row.txnid),
    status: isReturnStatus(row.status) ? row.status : 'REQUESTED',
    reason: text(row.reason),
    source: row.source === 'customer' ? 'customer' : 'staff',
    itemCount: number(row.item_count),
    quantity: number(row.quantity),
    expectedPaise: number(row.expected_paise),
    refundedPaise: number(row.refunded_paise),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/* -------------------------------------------------------------- reads */

export interface ReturnListData {
  returns: ReturnListRow[];
  counts: Record<ReturnStatus, number>;
}

function emptyCounts(): Record<ReturnStatus, number> {
  return { REQUESTED: 0, APPROVED: 0, RECEIVED: 0, REFUNDED: 0, REJECTED: 0, CANCELLED: 0 };
}

export async function listReturns(input: {
  status?: string;
  limit?: number;
} = {}): Promise<ReturnLoad<ReturnListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  const status = input.status && isReturnStatus(input.status) ? input.status : null;

  try {
    const filter = status === null ? '' : 'where r.status = $1';
    const [rows, countRows] = await Promise.all([
      sql.unsafe(
        `${returnListSelect()}
         ${filter}
         order by r.created_at desc, r.id desc
         limit ${Math.min(Math.max(input.limit ?? 100, 1), 500)}`,
        status === null ? [] : [status],
      ) as Promise<Row[]>,
      sql`
        select status, count(*)::int as count
        from return_requests
        group by status
      ` as Promise<Row[]>,
    ]);

    const counts = emptyCounts();
    for (const row of countRows) {
      if (isReturnStatus(row.status)) counts[row.status] = number(row.count);
    }
    return { ok: true, data: { returns: rows.map(mapReturnList), counts } };
  } catch {
    console.warn('[store-admin/returns] could not list returns');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listOrderReturns(orderId: string): Promise<ReturnLoad<ReturnListRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      ${sql.unsafe(returnListSelect())}
      where r.order_id = ${orderId}
      order by r.created_at desc, r.id desc
      limit 50
    `) as Row[];
    return { ok: true, data: rows.map(mapReturnList) };
  } catch {
    console.warn('[store-admin/returns] could not read the order returns');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listOrderRefunds(orderId: string): Promise<ReturnLoad<RefundRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      ${sql.unsafe(REFUND_SELECT)}
      where f.order_id = ${orderId}
      order by f.created_at desc, f.id desc
      limit 100
    `) as Row[];
    return { ok: true, data: rows.map(mapRefund) };
  } catch {
    console.warn('[store-admin/returns] could not read the order refunds');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface ReturnableLine {
  orderItemId: number;
  productId: string;
  productName: string;
  purchased: number;
  returned: number;
  returnable: number;
  unitPricePaise: number;
}

/** Per-line quantity still available to return on this order. */
export async function orderReturnableLines(orderId: string): Promise<ReturnLoad<ReturnableLine[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select oi.id as order_item_id, oi.product_id, oi.product_name, oi.quantity,
             oi.unit_price_paise,
             coalesce((
               select sum(ri.quantity)::int
               from return_items ri
               join return_requests rr on rr.id = ri.return_id
               where rr.order_id = ${orderId}
                 and rr.status in ${sql([...RETURNING_STATUSES])}
                 and ri.order_item_id = oi.id
             ), 0) as returned
      from order_items oi
      where oi.order_id = ${orderId}
      order by oi.line_number asc
    `) as Row[];
    return {
      ok: true,
      data: rows.map((row) => {
        const purchased = number(row.quantity);
        const returned = number(row.returned);
        return {
          orderItemId: number(row.order_item_id),
          productId: text(row.product_id),
          productName: text(row.product_name),
          purchased,
          returned,
          returnable: Math.max(0, purchased - returned),
          unitPricePaise: number(row.unit_price_paise),
        };
      }),
    };
  } catch {
    console.warn('[store-admin/returns] could not read the returnable lines');
    return { ok: false, reason: 'unavailable' };
  }
}

export async function getReturnDetail(id: string): Promise<ReturnLoad<ReturnDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      ${sql.unsafe(
        returnListSelect(
          `,
           r.customer_note, r.staff_note, r.decided_at, r.received_at, r.refunded_at,
           r.created_by, r.decided_by`,
        ),
      )}
      where r.id = ${id.trim()}
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not-found' };

    const [itemRows, refundRows] = await Promise.all([
      sql`
        select ri.id, ri.order_item_id, ri.quantity, ri.condition_grade, ri.restock,
               oi.product_name, oi.product_id, oi.unit_price_paise
        from return_items ri
        join order_items oi on oi.id = ri.order_item_id
        where ri.return_id = ${id.trim()}
        order by ri.id asc
      ` as Promise<Row[]>,
      sql`
        ${sql.unsafe(REFUND_SELECT)}
        where f.return_id = ${id.trim()}
        order by f.created_at desc, f.id desc
      ` as Promise<Row[]>,
    ]);

    let createdByEmail: string | null = null;
    let decidedByEmail: string | null = null;
    const staffIds = [nullableText(row.created_by), nullableText(row.decided_by)].filter(
      (value): value is string => Boolean(value),
    );
    if (staffIds.length > 0) {
      const emails = (await sql`
        select id, email from store_admins where id in ${sql(staffIds)}
      `) as Row[];
      const byId = new Map(emails.map((entry) => [text(entry.id), text(entry.email)]));
      createdByEmail = byId.get(text(row.created_by)) ?? null;
      decidedByEmail = byId.get(text(row.decided_by)) ?? null;
    }

    return {
      ok: true,
      data: {
        ...mapReturnList(row),
        customerNote: text(row.customer_note),
        staffNote: text(row.staff_note),
        createdByEmail,
        decidedByEmail,
        decidedAt: nullableIso(row.decided_at),
        receivedAt: nullableIso(row.received_at),
        refundedAt: nullableIso(row.refunded_at),
        items: itemRows.map((item) => ({
          id: number(item.id),
          orderItemId: number(item.order_item_id),
          productName: text(item.product_name),
          productId: text(item.product_id),
          quantity: number(item.quantity),
          unitPricePaise: number(item.unit_price_paise),
          conditionGrade: isConditionGrade(item.condition_grade) ? item.condition_grade : 'RESELLABLE',
          restock: Boolean(item.restock),
        })),
        refunds: refundRows.map(mapRefund),
      },
    };
  } catch {
    console.warn('[store-admin/returns] could not read the return');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------- writes */

export interface ReturnLineInput {
  orderItemId?: unknown;
  quantity?: unknown;
  conditionGrade?: unknown;
  restock?: unknown;
}

export async function createReturn(input: {
  txnid: string;
  lines: ReturnLineInput[];
  reason: unknown;
  note?: unknown;
  actorId: string;
}): Promise<ReturnMutation> {
  const reason = validateReturnReason(input.reason);
  if (!reason) {
    return mutationFailure('invalid-input', 'Give a return reason between 3 and 300 characters.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    return mutationFailure('invalid-input', 'Pick at least one item to return.');
  }

  const sql = getSql();
  if (!sql) return mutationFailure('unavailable', 'Return records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, status, fulfilment_status, total_paise, amount
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return mutationFailure('not-found', 'Order not found.');

      const orderId = text(order.id);
      if (text(order.fulfilment_status) !== 'DELIVERED') {
        return mutationFailure('not-delivered', 'Only a delivered order can take a return.');
      }

      const itemRows = (await tx`
        select id, quantity, unit_price_paise, product_name
        from order_items
        where order_id = ${orderId}
        order by line_number asc
      `) as Row[];
      if (itemRows.length === 0) {
        return mutationFailure('invalid-input', 'This order has no item snapshot to return.');
      }
      const byId = new Map(itemRows.map((row) => [number(row.id), row]));

      const returnedRows = (await tx`
        select ri.order_item_id, sum(ri.quantity)::int as returned
        from return_items ri
        join return_requests rr on rr.id = ri.return_id
        where rr.order_id = ${orderId}
          and rr.status in ${tx([...RETURNING_STATUSES])}
        group by ri.order_item_id
      `) as Row[];
      const returnedByItem = new Map(
        returnedRows.map((row) => [number(row.order_item_id), number(row.returned)]),
      );

      const parsed: Array<{ orderItemId: number; quantity: number; grade: ConditionGrade; restock: boolean }> = [];
      for (const line of input.lines) {
        const orderItemId = number(line.orderItemId);
        const quantity = number(line.quantity);
        if (!byId.has(orderItemId)) {
          return mutationFailure('invalid-input', 'A return line points at an item that is not on this order.');
        }
        const grade = line.conditionGrade === undefined ? 'RESELLABLE' : line.conditionGrade;
        if (!isConditionGrade(grade)) {
          return mutationFailure('invalid-input', 'Choose a valid condition grade for every line.');
        }
        parsed.push({ orderItemId, quantity, grade, restock: Boolean(line.restock) });
      }

      const check = checkReturnLines(
        parsed.map((line) => {
          const item = byId.get(line.orderItemId);
          return {
            orderItemId: line.orderItemId,
            quantity: line.quantity,
            purchased: item ? number(item.quantity) : 0,
            alreadyReturned: returnedByItem.get(line.orderItemId) ?? 0,
          };
        }),
        (orderItemId) => number(byId.get(orderItemId)?.unit_price_paise),
      );
      if (!check.ok) {
        return mutationFailure(check.code === 'quantity-exceeds-purchased' ? 'quantity-exceeds-purchased' : 'invalid-input', check.error);
      }

      const id = `ret_${randomBytes(8).toString('hex')}`;
      await tx`
        insert into return_requests (
          id, order_id, status, reason, customer_note, staff_note, source, created_by
        ) values (
          ${id}, ${orderId}, 'REQUESTED', ${reason}, '', ${nullableText(input.note) ?? ''}, 'staff', ${input.actorId}
        )
      `;
      for (const line of parsed) {
        await tx`
          insert into return_items (return_id, order_item_id, quantity, condition_grade, restock)
          values (${id}, ${line.orderItemId}, ${line.quantity}, ${line.grade}, ${line.restock})
        `;
      }

      return { ok: true as const, id, status: 'REQUESTED' as const };
    });
  } catch {
    console.warn('[store-admin/returns] could not create a return');
    return mutationFailure('unavailable', 'Return records are not available.');
  }
}

export type ReturnAction = 'approve' | 'reject' | 'receive' | 'cancel';

const ACTION_TARGET: Record<ReturnAction, ReturnStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  receive: 'RECEIVED',
  cancel: 'CANCELLED',
};

/**
 * Move a return through its workflow. Receiving is the step that restocks:
 * every line flagged `restock` whose grade is resellable or opened adds its
 * quantity back to a tracked product and writes a `stock_movements` row with
 * reason `return`. The stock move happens exactly once because the transition
 * out of APPROVED cannot repeat.
 */
export async function transitionReturn(input: {
  id: string;
  action: ReturnAction;
  note?: unknown;
  actorId: string;
}): Promise<ReturnMutation> {
  const target = ACTION_TARGET[input.action];
  if (!target) return mutationFailure('invalid-input', 'Unknown return action.');

  const sql = getSql();
  if (!sql) return mutationFailure('unavailable', 'Return records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select r.id, r.order_id, r.status, o.txnid
        from return_requests r
        join orders o on o.id = r.order_id
        where r.id = ${input.id.trim()}
        for update of r
      `) as Row[];
      const row = rows[0];
      if (!row) return mutationFailure('not-found', 'Return not found.');

      const current = isReturnStatus(row.status) ? row.status : 'REQUESTED';
      if (!canTransitionReturn(current, target)) {
        return mutationFailure('invalid-transition', `A ${current.toLowerCase()} return cannot be moved to ${target.toLowerCase()}.`);
      }

      const orderId = text(row.order_id);
      const staffNote = typeof input.note === 'string' ? input.note.trim().slice(0, 1000) : '';

      if (target === 'RECEIVED') {
        const items = (await tx`
          select ri.quantity, ri.condition_grade, ri.restock, oi.product_id
          from return_items ri
          join order_items oi on oi.id = ri.order_item_id
          where ri.return_id = ${text(row.id)}
        `) as Row[];

        for (const item of items) {
          const grade = isConditionGrade(item.condition_grade) ? item.condition_grade : 'RESELLABLE';
          if (!restockEligible(grade, Boolean(item.restock))) continue;
          const productId = text(item.product_id);
          if (!productId) continue;
          const quantity = number(item.quantity);
          if (quantity <= 0) continue;

          const stockRows = (await tx`
            select id, track_inventory from stock
            where product_id = ${productId} and variant_id is null
            for update
          `) as Row[];
          const stockRow = stockRows[0];
          if (!stockRow || !Boolean(stockRow.track_inventory)) continue;

          await tx`
            update stock
            set on_hand = on_hand + ${quantity},
                updated_at = now(),
                updated_by = ${input.actorId}
            where id = ${text(stockRow.id)}
          `;
          await tx`
            insert into stock_movements (product_id, variant_id, delta, reason, order_id, created_by)
            values (${productId}, null, ${quantity}, 'return', ${orderId}, ${input.actorId})
          `;
        }
      }

      await tx`
        update return_requests
        set status = ${target},
            staff_note = case when ${staffNote} = '' then staff_note else ${staffNote} end,
            decided_by = case when ${target} in ('APPROVED', 'REJECTED', 'CANCELLED') then ${input.actorId} else decided_by end,
            decided_at = case when ${target} in ('APPROVED', 'REJECTED', 'CANCELLED') then now() else decided_at end,
            received_by = case when ${target} = 'RECEIVED' then ${input.actorId} else received_by end,
            received_at = case when ${target} = 'RECEIVED' then now() else received_at end,
            updated_at = now()
        where id = ${text(row.id)}
      `;

      return { ok: true as const, id: text(row.id), status: target };
    });
  } catch {
    console.warn('[store-admin/returns] could not move the return');
    return mutationFailure('unavailable', 'Return records are not available.');
  }
}

export type RefundMutation =
  | {
      ok: true;
      refundId: string;
      orderId: string;
      txnid: string;
      returnId: string | null;
      amountPaise: number;
      remainingPaise: number;
      returnClosed: boolean;
    }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'invalid-input'
        | 'invalid-amount'
        | 'refund-exceeds-captured'
        | 'return-not-received';
      error: string;
    };

function refundFailure(
  reason: Extract<RefundMutation, { ok: false }>['reason'],
  error: string,
): RefundMutation {
  return { ok: false, reason, error };
}

/**
 * Record a manual refund. The invariant is checked inside a locked transaction
 * that reads the captured total from PAID payment rows and the refunded total
 * from the refunds table, so two concurrent refunds cannot overshoot.
 */
export async function recordRefund(input: {
  txnid: string;
  returnId?: string | null;
  amountPaise: number;
  method: unknown;
  providerRef: unknown;
  reason: unknown;
  note: unknown;
  actorId: string;
}): Promise<RefundMutation> {
  if (!isRefundMethod(input.method)) {
    return refundFailure('invalid-input', 'Choose a refund method.');
  }
  const method = input.method;
  const providerRef = validateRefundReference(method, input.providerRef);
  if (providerRef === null && REFUND_REFERENCE_METHODS.includes(method)) {
    return refundFailure('invalid-input', 'UPI and bank transfer refunds need a reference.');
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';

  const sql = getSql();
  if (!sql) return refundFailure('unavailable', 'Refund records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, status, total_paise, amount, currency
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return refundFailure('not-found', 'Order not found.');

      const orderId = text(order.id);
      const currency = text(order.currency) || 'INR';

      let returnId: string | null = null;
      let expectedPaise = 0;
      if (input.returnId) {
        const returnRows = (await tx`
          select id, status from return_requests
          where id = ${input.returnId.trim()} and order_id = ${orderId}
          for update
        `) as Row[];
        const returnRow = returnRows[0];
        if (!returnRow) return refundFailure('not-found', 'Return not found for this order.');
        if (text(returnRow.status) !== 'RECEIVED') {
          return refundFailure('return-not-received', 'Receive the returned goods before recording a refund.');
        }
        returnId = text(returnRow.id);

        const expectedRows = (await tx`
          select coalesce(sum(ri.quantity * oi.unit_price_paise)::bigint, 0) as expected
          from return_items ri
          join order_items oi on oi.id = ri.order_item_id
          where ri.return_id = ${returnId}
        `) as Row[];
        expectedPaise = number(expectedRows[0]?.expected);
      }

      const capturedRows = (await tx`
        select coalesce(sum(amount_paise)::bigint, 0) as captured
        from order_payments
        where order_id = ${orderId} and status = 'PAID'
      `) as Row[];
      let capturedPaise = number(capturedRows[0]?.captured);
      if (capturedPaise === 0 && text(order.status) === 'PAID') {
        capturedPaise = number(order.total_paise) || Math.round(number(order.amount) * 100);
      }

      const refundedRows = (await tx`
        select coalesce(sum(amount_paise)::bigint, 0) as refunded
        from refunds
        where order_id = ${orderId}
      `) as Row[];
      const refundedPaise = number(refundedRows[0]?.refunded);

      const check = checkRefund({
        amountPaise: Math.trunc(input.amountPaise),
        capturedPaise,
        refundedPaise,
      });
      if (!check.ok) return refundFailure(check.code, check.error);

      const refundId = `ref_${randomBytes(8).toString('hex')}`;
      await tx`
        insert into refunds (
          id, order_id, return_id, amount_paise, currency, method,
          provider_ref, reason, note, recorded_by
        ) values (
          ${refundId}, ${orderId}, ${returnId}, ${Math.trunc(input.amountPaise)}, ${currency},
          ${method}, ${providerRef}, ${reason}, ${note}, ${input.actorId}
        )
      `;

      let returnClosed = false;
      if (returnId && expectedPaise > 0) {
        const paidRows = (await tx`
          select coalesce(sum(amount_paise)::bigint, 0) as refunded
          from refunds
          where return_id = ${returnId}
        `) as Row[];
        if (number(paidRows[0]?.refunded) >= expectedPaise) {
          await tx`
            update return_requests
            set status = 'REFUNDED', refunded_at = now(), updated_at = now()
            where id = ${returnId}
          `;
          returnClosed = true;
        }
      }

      return {
        ok: true as const,
        refundId,
        orderId,
        txnid: text(order.txnid),
        returnId,
        amountPaise: Math.trunc(input.amountPaise),
        remainingPaise: check.remainingPaise,
        returnClosed,
      };
    });
  } catch {
    console.warn('[store-admin/returns] could not record a refund');
    return refundFailure('unavailable', 'Refund records are not available.');
  }
}

/* ------------------------------------------------------ cancellations */

export interface CancellationReason {
  id: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

export async function listCancellationReasons(
  activeOnly = false,
): Promise<{ ok: true; reasons: CancellationReason[] } | { ok: false; reason: 'unavailable' }> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id, label, sort_order, is_active
      from cancellation_reasons
      where (${activeOnly} is false or is_active)
      order by sort_order asc, label asc
    `) as Row[];
    return {
      ok: true,
      reasons: rows.map((row) => ({
        id: text(row.id),
        label: text(row.label),
        sortOrder: number(row.sort_order),
        isActive: Boolean(row.is_active),
      })),
    };
  } catch {
    console.warn('[store-admin/returns] could not read cancellation reasons');
    return { ok: false, reason: 'unavailable' };
  }
}

export type CancelOrderMutation =
  | { ok: true; orderId: string; txnid: string; previousStatus: string; paymentStatus: string }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'already-cancelled'
        | 'already-delivered'
        | 'owner-required'
        | 'invalid-input';
      error: string;
    };

/** Cancel an order before delivery with a catalogue reason. */
export async function cancelOrder(input: {
  txnid: string;
  reasonId: unknown;
  note: unknown;
  actorId: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
}): Promise<CancelOrderMutation> {
  const reasonId = typeof input.reasonId === 'string' ? input.reasonId.trim() : '';
  if (!reasonId) {
    return { ok: false, reason: 'invalid-input', error: 'Choose a cancellation reason.' };
  }
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Order records are not available.' };

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, status, fulfilment_status
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return { ok: false as const, reason: 'not-found' as const, error: 'Order not found.' };

      const allowed = cancellationAllowed({
        paymentStatus: text(order.status),
        fulfilmentStatus: text(order.fulfilment_status),
      });
      if (!allowed.ok) {
        return { ok: false as const, reason: allowed.code, error: allowed.error };
      }
      if (text(order.fulfilment_status) === 'ON_THE_WAY' && input.role !== 'store_owner') {
        return {
          ok: false as const,
          reason: 'owner-required' as const,
          error: 'Only the owner can cancel an order that is already on the way.',
        };
      }

      const reasonRows = (await tx`
        select id, label from cancellation_reasons
        where id = ${reasonId} and is_active
        limit 1
      `) as Row[];
      const reason = reasonRows[0];
      if (!reason) {
        return { ok: false as const, reason: 'invalid-input' as const, error: 'Choose an active cancellation reason.' };
      }

      const previousStatus = text(order.fulfilment_status);
      const paymentStatus = text(order.status);
      const label = text(reason.label);

      await tx`
        update orders
        set fulfilment_status = 'CANCELED',
            status = case when status in ('CREATED', 'PENDING') then 'CANCELLED' else status end,
            cancelled_at = now(),
            cancel_reason = ${note ? `${label} — ${note}` : label},
            cancellation_reason_id = ${text(reason.id)},
            cancelled_by = ${input.actorId},
            updated_at = now()
        where id = ${text(order.id)}
      `;

      await tx`
        update order_deliveries
        set status = 'CANCELED', updated_at = now()
        where order_id = ${text(order.id)}
      `;

      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status, note)
        values (${text(order.id)}, 'fulfilment', 'store_admin', ${previousStatus}, 'CANCELED', ${note || null})
      `;

      return {
        ok: true as const,
        orderId: text(order.id),
        txnid: text(order.txnid),
        previousStatus,
        paymentStatus,
      };
    });
  } catch {
    console.warn('[store-admin/returns] could not cancel the order');
    return { ok: false as const, reason: 'unavailable' as const, error: 'Order records are not available.' };
  }
}

export type ReasonMutation =
  | { ok: true; reason: CancellationReason }
  | { ok: false; reason: 'unavailable' | 'invalid-input' | 'not-found'; error: string };

/** Create or update a cancellation reason. Rows are never deleted; deactivate. */
export async function saveCancellationReason(input: {
  id?: unknown;
  label: unknown;
  sortOrder: unknown;
  isActive: unknown;
}): Promise<ReasonMutation> {
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label.length < 1 || label.length > 120) {
    return { ok: false, reason: 'invalid-input', error: 'Give a label between 1 and 120 characters.' };
  }
  const sortOrder = Number.isInteger(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
  if (sortOrder < 0 || sortOrder > 9999) {
    return { ok: false, reason: 'invalid-input', error: 'Sort order must be between 0 and 9999.' };
  }
  const isActive = input.isActive === undefined ? true : Boolean(input.isActive);

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Reference data is not available.' };

  try {
    const id =
      typeof input.id === 'string' && /^[a-z0-9_]{3,64}$/.test(input.id.trim())
        ? input.id.trim()
        : `reason_${randomBytes(5).toString('hex')}`;

    const rows = (await sql`
      insert into cancellation_reasons (id, label, sort_order, is_active)
      values (${id}, ${label}, ${sortOrder}, ${isActive})
      on conflict (id) do update
        set label = excluded.label,
            sort_order = excluded.sort_order,
            is_active = excluded.is_active,
            updated_at = now()
      returning id, label, sort_order, is_active
    `) as Row[];
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not-found', error: 'Reason was not saved.' };
    return {
      ok: true,
      reason: {
        id: text(row.id),
        label: text(row.label),
        sortOrder: number(row.sort_order),
        isActive: Boolean(row.is_active),
      },
    };
  } catch {
    console.warn('[store-admin/returns] could not save a cancellation reason');
    return { ok: false, reason: 'unavailable', error: 'Reference data is not available.' };
  }
}

/** Total captured vs refunded for an order — used by the refund form header. */
export async function orderRefundPosition(txnid: string): Promise<
  | { ok: true; capturedPaise: number; refundedPaise: number; remainingPaise: number }
  | { ok: false; reason: 'unavailable' | 'not-found' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select o.id, o.status, o.total_paise, o.amount,
             coalesce((select sum(p.amount_paise) from order_payments p
                       where p.order_id = o.id and p.status = 'PAID'), 0)::bigint as captured,
             coalesce((select sum(f.amount_paise) from refunds f
                       where f.order_id = o.id), 0)::bigint as refunded
      from orders o
      where o.txnid = ${txnid.trim()}
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return { ok: false, reason: 'not-found' };
    let captured = number(row.captured);
    if (captured === 0 && text(row.status) === 'PAID') {
      captured = number(row.total_paise) || Math.round(number(row.amount) * 100);
    }
    const refunded = number(row.refunded);
    return { ok: true, capturedPaise: captured, refundedPaise: refunded, remainingPaise: Math.max(0, captured - refunded) };
  } catch {
    console.warn('[store-admin/returns] could not read the refund position');
    return { ok: false, reason: 'unavailable' };
  }
}
