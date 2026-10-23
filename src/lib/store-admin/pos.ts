import { randomBytes } from 'node:crypto';

import { getSql } from '@/lib/admin/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { maskCustomerPhone } from './masking';
import {
  canVoidPosSale,
  cashVariancePaise,
  expectedCashPaise,
  formatReceiptNo,
  validatePosCart,
  type PosPaymentMethod,
} from './pos-rules';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: POS repository must be server-only.');
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

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(number(value)));
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

/* ------------------------------------------------------------- types */

export interface PosCatalogProduct {
  id: string;
  name: string;
  subtitle: string;
  pricePaise: number;
  currency: string;
  onHand: number | null;
  trackInventory: boolean;
}

export interface ShiftSummary {
  id: number;
  staffId: string;
  staffName: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingFloatPaise: number;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  notes: string;
  totalsByMethod: Record<string, number>;
  salesCount: number;
}

export interface PosSaleLine {
  lineNumber: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  currency: string;
}

export interface PosSaleResultData {
  txnid: string;
  receiptNo: string;
  paymentId: number;
  providerRef: string | null;
  lines: PosSaleLine[];
  subtotalPaise: number;
  totalPaise: number;
  method: PosPaymentMethod;
  shiftId: number;
  customerPhoneMasked: string | null;
}

export type PosSaleResult =
  | { ok: true; data: PosSaleResultData }
  | {
      ok: false;
      reason: 'unavailable' | 'not-found' | 'invalid-input' | 'no-open-shift' | 'out-of-stock';
      error: string;
    };

/* -------------------------------------------------------- catalogue */

/**
 * The catalogue products for the POS search, read from the database through
 * the owner connection. Prices are the same server-side source checkout
 * resolves through — the browser never supplies a price.
 */
export type PosCatalogLoad =
  | { ok: true; products: PosCatalogProduct[] }
  | { ok: false; reason: 'unavailable' };

/** Read the live catalogue from the database (owner connection). */
export async function getPosCatalog(): Promise<PosCatalogLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select p.id, p.name, p.subtitle, p.price_paise, p.currency,
             s.on_hand, s.track_inventory
      from products p
      left join stock s on s.product_id = p.id and s.variant_id is null
      where p.is_active and p.deleted_at is null
      order by p.name
    `) as Row[];
    return {
      ok: true,
      products: rows.map((row) => ({
        id: text(row.id),
        name: text(row.name),
        subtitle: text(row.subtitle),
        pricePaise: integer(row.price_paise),
        currency: text(row.currency) || 'INR',
        onHand: row.on_hand === null || row.on_hand === undefined ? null : integer(row.on_hand),
        trackInventory: Boolean(row.track_inventory),
      })),
    };
  } catch {
    console.warn('[store-admin/pos] could not read the catalogue');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ---------------------------------------------------------- shifts */

export type ShiftLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

function totalsByMethodFromRows(rows: Row[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    totals[text(row.method)] = number(row.total_paise);
  }
  return totals;
}

function mapShift(row: Row, methodRows: Row[], salesCount: number): ShiftSummary {
  return {
    id: number(row.id),
    staffId: text(row.staff_id),
    staffName: text(row.staff_name),
    status: row.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
    openedAt: iso(row.opened_at),
    closedAt: row.closed_at ? iso(row.closed_at) : null,
    openingFloatPaise: number(row.opening_float_paise),
    expectedCashPaise: row.expected_cash_paise === null ? null : number(row.expected_cash_paise),
    countedCashPaise: row.counted_cash_paise === null ? null : number(row.counted_cash_paise),
    variancePaise: row.variance_paise === null ? null : number(row.variance_paise),
    notes: text(row.notes),
    totalsByMethod: totalsByMethodFromRows(methodRows),
    salesCount,
  };
}

export async function getOpenShiftForStaff(staffId: string): Promise<
  | { ok: true; shift: { id: number } | null }
  | { ok: false; reason: 'unavailable' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select id from pos_shifts
      where staff_id = ${staffId} and status = 'OPEN'
      limit 1
    `) as Row[];
    return { ok: true, shift: rows[0] ? { id: number(rows[0].id) } : null };
  } catch {
    console.warn('[store-admin/pos] could not read the open shift');
    return { ok: false, reason: 'unavailable' };
  }
}

export type OpenShiftResult =
  | { ok: true; shiftId: number }
  | { ok: false; reason: 'unavailable' | 'shift-open' | 'invalid-input'; error: string };

/** Open a shift with an opening float. One open shift per staff member. */
export async function openShift(input: {
  staffId: string;
  openingFloatPaise: number;
}): Promise<OpenShiftResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  try {
    return await sql.begin(async (tx) => {
      const existing = (await tx`
        select id from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
      `) as Row[];
      if (existing[0]) {
        return { ok: false as const, reason: 'shift-open' as const, error: 'You already have an open shift.' };
      }
      const rows = (await tx`
        insert into pos_shifts (staff_id, opening_float_paise)
        values (${input.staffId}, ${input.openingFloatPaise})
        returning id
      `) as Row[];
      return { ok: true as const, shiftId: number(rows[0]?.id ?? 0) };
    });
  } catch {
    console.warn('[store-admin/pos] could not open a shift');
    return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  }
}

export type CloseShiftResult =
  | {
      ok: true;
      shift: ShiftSummary;
    }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-input'; error: string };

/**
 * Close the caller's open shift with a counted cash drawer. The expected
 * cash (opening float + cash PAID in the shift − cash refunds in the shift)
 * and variance are computed and stored, never trusted from the browser.
 */
export async function closeShift(input: {
  staffId: string;
  countedCashPaise: number;
  notes: string | null;
}): Promise<CloseShiftResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, opening_float_paise from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
        limit 1
      `) as Row[];
      const open = rows[0];
      if (!open) {
        return { ok: false as const, reason: 'not-found' as const, error: 'You have no open shift.' };
      }
      const shiftId = number(open.id);
      const openingFloatPaise = number(open.opening_float_paise);

      const cashRows = (await tx`
        select
          coalesce(sum(amount_paise) filter (where status = 'PAID'), 0)::bigint as sales,
          coalesce(sum(amount_paise) filter (where status in ('REFUNDED','PARTIALLY_REFUNDED')), 0)::bigint as refunds
        from order_payments
        where pos_shift_id = ${shiftId} and method = 'cash'
      `) as Row[];
      const cashSales = number(cashRows[0]?.sales);
      const cashRefunds = number(cashRows[0]?.refunds);

      // Expected cash and variance come from the shared pure rules, so the
      // stored drawer figures and the tested helper can never drift apart.
      const expected = expectedCashPaise(openingFloatPaise, cashSales, cashRefunds);
      const variance = cashVariancePaise(input.countedCashPaise, expected);

      const shiftRows = (await tx`
        update pos_shifts
        set status = 'CLOSED',
            closed_at = now(),
            expected_cash_paise = ${expected},
            counted_cash_paise = ${input.countedCashPaise},
            variance_paise = ${variance},
            notes = coalesce(${input.notes}, notes)
        where id = ${shiftId}
        returning id, staff_id, status, opened_at, closed_at,
                  opening_float_paise, expected_cash_paise,
                  counted_cash_paise, variance_paise, notes
      `) as Row[];

      const methodRows = (await tx`
        select method, coalesce(sum(amount_paise), 0)::bigint as total_paise
        from order_payments
        where pos_shift_id = ${shiftId} and status = 'PAID'
        group by method
      `) as Row[];

      const salesRows = (await tx`
        select count(*)::int as sales
        from orders
        where pos_shift_id = ${shiftId}
      `) as Row[];

      return {
        ok: true as const,
        shift: mapShift(shiftRows[0], methodRows, integer(salesRows[0]?.sales)),
      };
    });
  } catch {
    console.warn('[store-admin/pos] could not close a shift');
    return { ok: false, reason: 'unavailable', error: 'Shifts are not available.' };
  }
}

export async function getCurrentShift(staffId: string): Promise<
  | { ok: true; shift: ShiftSummary | null }
  | { ok: false; reason: 'unavailable' }
> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = (await sql`
      select s.id, s.staff_id, s.status, s.opened_at, s.closed_at,
             s.opening_float_paise, s.expected_cash_paise,
             s.counted_cash_paise, s.variance_paise, s.notes,
             a.name as staff_name
      from pos_shifts s
      join store_admins a on a.id = s.staff_id
      where s.staff_id = ${staffId}
      order by s.opened_at desc, s.id desc
      limit 1
    `) as Row[];
    const row = rows[0];
    if (!row) return { ok: true, shift: null };

    const [methodRows, salesRows] = await Promise.all([
      sql`
        select method, coalesce(sum(amount_paise), 0)::bigint as total_paise
        from order_payments
        where pos_shift_id = ${number(row.id)} and status = 'PAID'
        group by method
      `,
      sql`
        select count(*)::int as sales
        from orders
        where pos_shift_id = ${number(row.id)}
      `,
    ]);
    return { ok: true, shift: mapShift(row, methodRows as Row[], integer((salesRows as Row[])[0]?.sales)) };
  } catch {
    console.warn('[store-admin/pos] could not read the shift');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ------------------------------------------------------------- sale */

/**
 * Create one POS sale in a single locked transaction:
 * order (channel 'pos', payment PAID, fulfilment DELIVERED) + order_items +
 * order_payments + receipt number + stock decrement + stock movements.
 *
 * Prices are read from the `products` table inside the same transaction, so
 * the price shown by the POS catalogue (`getPosCatalog`, which reads
 * `products.price_paise`) and the price charged here are one source of truth.
 * The client sends product ids and quantities only — a price never crosses
 * the wire.
 */
export async function createPosSale(input: {
  lines: unknown;
  method: PosPaymentMethod;
  providerRef: string | null;
  customerPhone: string | null;
  staffId: string;
}): Promise<PosSaleResult> {
  const cart = validatePosCart(input.lines);
  if (!cart.ok) return { ok: false, reason: 'invalid-input', error: cart.error };

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Order records are not available.' };

  const txnid = `POS-${randomBytes(9).toString('hex').toUpperCase()}`;
  const orderId = `ord_${randomBytes(12).toString('hex')}`;
  const customerPhone = input.customerPhone?.trim() || null;

  try {
    return await sql.begin(async (tx) => {
      // The shift must be open for the whole transaction.
      const shiftRows = (await tx`
        select id from pos_shifts
        where staff_id = ${input.staffId} and status = 'OPEN'
        for update
        limit 1
      `) as Row[];
      const shift = shiftRows[0];
      if (!shift) {
        return { ok: false as const, reason: 'no-open-shift' as const, error: 'Open a shift before ringing up sales.' };
      }
      const shiftId = number(shift.id);

      // Receipt number: allocated under the counter row lock, never reused.
      const counterRows = (await tx`
        update receipt_counters
        set next_number = next_number + 1
        where name = 'pos_receipt'
        returning next_number
      `) as Row[];
      if (!counterRows[0]) {
        return { ok: false as const, reason: 'unavailable' as const, error: 'Receipt numbering is not available.' };
      }
      const receiptNo = formatReceiptNo(number(counterRows[0].next_number) - 1);

      // Price every line from the database catalogue inside this transaction.
      // An inactive or missing product stops the whole sale rather than
      // silently pricing it from a stale static catalogue.
      const lines: PosSaleLine[] = [];
      for (let index = 0; index < cart.lines.length; index += 1) {
        const cartLine = cart.lines[index];
        const baseId = normalizeCartLineId(cartLine.id).baseId || cartLine.id;
        const productRows = (await tx`
          select id, name, price_paise
          from products
          where id = ${baseId} and is_active and deleted_at is null
          limit 1
        `) as Row[];
        const product = productRows[0];
        if (!product) {
          return {
            ok: false as const,
            reason: 'not-found' as const,
            error: `Product '${cartLine.id}' is not in the active catalogue.`,
          };
        }
        const unitPricePaise = integer(product.price_paise);
        lines.push({
          lineNumber: index + 1,
          productId: text(product.id),
          productName: text(product.name),
          quantity: cartLine.quantity,
          unitPricePaise,
          lineTotalPaise: unitPricePaise * cartLine.quantity,
          currency: 'INR',
        });
      }
      const subtotalPaise = lines.reduce((sum, line) => sum + line.lineTotalPaise, 0);
      const itemsSnapshot = lines.map((line) => ({
        id: line.productId,
        name: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPricePaise / 100,
        totalPrice: line.lineTotalPaise / 100,
      }));

      const orderRows = (await tx`
        insert into orders (
          id, txnid, items, amount, currency, status,
          customer_name, customer_email, customer_phone,
          channel, fulfilment_status, payment_method,
          subtotal_paise, discount_paise, shipping_paise, total_paise,
          staff_id, paid_at, pos_shift_id, pos_receipt_no,
          created_at, updated_at
        ) values (
          ${orderId}, ${txnid}, ${tx.json(itemsSnapshot)}, ${subtotalPaise / 100}, 'INR', 'PAID',
          'POS customer', '', ${customerPhone ?? ''},
          'pos', 'DELIVERED', ${input.method},
          ${subtotalPaise}, 0, 0, ${subtotalPaise},
          ${input.staffId}, now(), ${shiftId}, ${receiptNo},
          now(), now()
        )
        returning id, txnid
      `) as Row[];
      const createdId = text(orderRows[0].id);

      for (const line of lines) {
        await tx`
          insert into order_items (
            order_id, line_number, product_id, product_name,
            quantity, unit_price_paise, line_total_paise, currency
          ) values (
            ${createdId}, ${line.lineNumber}, ${line.productId}, ${line.productName},
            ${line.quantity}, ${line.unitPricePaise}, ${line.lineTotalPaise}, 'INR'
          )
        `;
      }

      const paymentRows = (await tx`
        insert into order_payments (
          order_id, channel, method, amount_paise, status,
          provider_ref, paid_at, received_by_staff_id, pos_shift_id
        ) values (
          ${createdId}, 'pos', ${input.method}, ${subtotalPaise}, 'PAID',
          ${input.providerRef}, now(), ${input.staffId}, ${shiftId}
        )
        returning id
      `) as Row[];

      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${createdId}, 'payment', 'store_admin', null, 'PAID')
      `;

      // Stock: tracked products decrement with a guard; untracked products
      // skip the decrement but still write the movement row.
      for (const line of lines) {
        const stockRows = (await tx`
          select on_hand, track_inventory from stock
          where product_id = ${line.productId} and variant_id is null
          for update
        `) as Row[];
        const stockRow = stockRows[0];
        if (stockRow && Boolean(stockRow.track_inventory)) {
          const updated = (await tx`
            update stock
            set on_hand = on_hand - ${line.quantity},
                updated_at = now(), updated_by = ${input.staffId}
            where product_id = ${line.productId}
              and variant_id is null
              and on_hand >= ${line.quantity}
            returning on_hand
          `) as Row[];
          if (!updated[0]) {
            return {
              ok: false as const,
              reason: 'out-of-stock' as const,
              error: `Not enough stock for ${line.productName}.`,
            };
          }
        }
        await tx`
          insert into stock_movements (product_id, delta, reason, order_id, created_by)
          values (${line.productId}, ${-line.quantity}, 'sale', ${createdId}, ${input.staffId})
        `;
      }

      return {
        ok: true as const,
        data: {
          txnid: text(orderRows[0].txnid),
          receiptNo,
          paymentId: number(paymentRows[0]?.id),
          providerRef: input.providerRef,
          lines,
          subtotalPaise,
          totalPaise: subtotalPaise,
          method: input.method,
          shiftId,
          customerPhoneMasked: customerPhone ? maskCustomerPhone(customerPhone) : null,
        },
      };
    });
  } catch {
    console.warn('[store-admin/pos] the sale transaction failed');
    return { ok: false, reason: 'unavailable', error: 'The sale could not be recorded.' };
  }
}

/* ------------------------------------------------------------- void */

export type VoidResult =
  | { ok: true; txnid: string; orderId: string; receiptNo: string; reason: string }
  | {
      ok: false;
      reason:
        | 'unavailable'
        | 'not-found'
        | 'invalid-input'
        | 'closed-shift'
        | 'not-pos'
        | 'forbidden';
      error: string;
    };

/**
 * Void a POS sale (owner only, shift still open): order CANCELLED, POS
 * payment CANCELLED, stock restocked through stock_movements, history and
 * audit rows. The receipt number is never reused — it stays on the order.
 */
export async function voidPosSale(input: {
  txnid: string;
  staffId: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  reason: string;
}): Promise<VoidResult> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable', error: 'Order records are not available.' };

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, channel, status, fulfilment_status,
               pos_shift_id, pos_receipt_no, cancel_reason
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return { ok: false as const, reason: 'not-found' as const, error: 'Order not found.' };
      if (order.pos_shift_id === null) {
        return { ok: false as const, reason: 'closed-shift' as const, error: 'This sale has no shift recorded.' };
      }

      // Lock the shift row so a close racing this void serialises against it:
      // a sale can never be voided into a drawer that has already closed.
      const shiftRows = (await tx`
        select status from pos_shifts
        where id = ${number(order.pos_shift_id)}
        for update
      `) as Row[];
      const shiftStatus = text(shiftRows[0]?.status) === 'OPEN' ? 'OPEN' : 'CLOSED';

      const check = canVoidPosSale({
        role: input.role,
        channel: text(order.channel),
        shiftStatus,
        orderStatus: text(order.status),
        fulfilmentStatus: text(order.fulfilment_status),
        hasReason: Boolean(input.reason.trim()),
      });
      if (!check.ok) {
        const reason =
          text(order.channel) !== 'pos'
            ? ('not-pos' as const)
            : input.role !== 'store_owner'
              ? ('forbidden' as const)
              : shiftStatus !== 'OPEN'
                ? ('closed-shift' as const)
                : ('invalid-input' as const);
        return { ok: false as const, reason, error: check.error };
      }

      const orderId = text(order.id);
      const receiptNo = text(order.pos_receipt_no);

      const itemRows = (await tx`
        select product_id, quantity, product_name from order_items
        where order_id = ${orderId}
      `) as Row[];

      await tx`
        update orders
        set status = 'CANCELLED',
            fulfilment_status = 'CANCELED',
            cancelled_at = now(),
            cancel_reason = ${input.reason},
            updated_at = now()
        where id = ${orderId}
      `;

      await tx`
        update order_payments
        set status = 'CANCELLED', updated_at = now()
        where order_id = ${orderId} and channel = 'pos'
      `;

      // Restock mirrors the sale: only a tracked product's on_hand moves. The
      // movement row is written either way so the ledger stays complete.
      // Incrementing an untracked product would drift its stock upward,
      // because createPosSale never decremented it.
      for (const item of itemRows) {
        const productId = text(item.product_id);
        if (!productId) continue;
        const quantity = integer(item.quantity);
        const stockRows = (await tx`
          select track_inventory from stock
          where product_id = ${productId} and variant_id is null
          for update
        `) as Row[];
        if (stockRows[0] && Boolean(stockRows[0].track_inventory)) {
          await tx`
            update stock
            set on_hand = on_hand + ${quantity},
                updated_at = now(), updated_by = ${input.staffId}
            where product_id = ${productId} and variant_id is null
          `;
        }
        await tx`
          insert into stock_movements (product_id, delta, reason, order_id, created_by)
          values (${productId}, ${quantity}, 'return', ${orderId}, ${input.staffId})
        `;
      }

      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${orderId}, 'payment', 'store_admin', ${text(order.status)}, 'CANCELLED')
      `;

      return { ok: true as const, txnid: text(order.txnid), orderId, receiptNo, reason: input.reason };
    });
  } catch {
    console.warn('[store-admin/pos] the void transaction failed');
    return { ok: false, reason: 'unavailable', error: 'The sale could not be voided.' };
  }
}

/* --------------------------------------------------------- dashboard */

export type DashboardShiftLoad =
  | {
      ok: true;
      data: {
        openShiftId: number | null;
        openShiftCount: number;
        todayPosTotalPaise: number;
      };
    }
  | { ok: false; reason: 'unavailable' };

export async function getPosDashboard(): Promise<DashboardShiftLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const [openRows, totalRows] = await Promise.all([
      sql`
        select count(*)::int as open_count,
               min(id)::int as first_open_id
        from pos_shifts
        where status = 'OPEN'
      `,
      sql`
        select coalesce(sum(p.amount_paise), 0)::bigint as today_total
        from order_payments p
        join orders o on o.id = p.order_id
        where p.channel = 'pos'
          and p.status = 'PAID'
          and p.paid_at >= current_date
      `,
    ]);
    const openRow = (openRows as Row[])[0];
    const totalRow = (totalRows as Row[])[0];
    return {
      ok: true,
      data: {
        openShiftId: openRow ? number(openRow.first_open_id) || null : null,
        openShiftCount: openRow ? integer(openRow.open_count) : 0,
        todayPosTotalPaise: number(totalRow?.today_total),
      },
    };
  } catch {
    console.warn('[store-admin/pos] could not read the dashboard totals');
    return { ok: false, reason: 'unavailable' };
  }
}

/* ---------------------------------------------------------- receipt */

export interface ReceiptData {
  txnid: string;
  receiptNo: string;
  createdAt: string;
  lines: PosSaleLine[];
  subtotalPaise: number;
  totalPaise: number;
  method: PosPaymentMethod | null;
  providerRef: string | null;
  cashierName: string;
  customerPhoneMasked: string | null;
}

export type ReceiptLoad =
  | { ok: true; receipt: ReceiptData }
  | { ok: false; reason: 'unavailable' | 'not-found' | 'not-pos' };

export async function getPosReceipt(txnid: string): Promise<ReceiptLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const orderRows = (await sql`
      select o.id, o.txnid, o.channel, o.pos_receipt_no, o.created_at,
             o.subtotal_paise, o.total_paise, o.payment_method,
             o.customer_phone, a.name as cashier_name
      from orders o
      join store_admins a on a.id = o.staff_id
      where o.txnid = ${txnid.trim()}
      limit 1
    `) as Row[];
    const order = orderRows[0];
    if (!order) return { ok: false, reason: 'not-found' };
    if (text(order.channel) !== 'pos') return { ok: false, reason: 'not-pos' };

    const itemRows = (await sql`
      select line_number, product_id, product_name, quantity,
             unit_price_paise, line_total_paise, currency
      from order_items
      where order_id = ${text(order.id)}
      order by line_number asc
    `) as Row[];

    const paymentRows = (await sql`
      select provider_ref from order_payments
      where order_id = ${text(order.id)} and channel = 'pos'
      order by id desc
      limit 1
    `) as Row[];

    const lines: PosSaleLine[] = itemRows.map((row) => ({
      lineNumber: integer(row.line_number),
      productId: text(row.product_id),
      productName: text(row.product_name),
      quantity: integer(row.quantity) || 1,
      unitPricePaise: integer(row.unit_price_paise),
      lineTotalPaise: integer(row.line_total_paise),
      currency: text(row.currency) || 'INR',
    }));

    return {
      ok: true,
      receipt: {
        txnid: text(order.txnid),
        receiptNo: text(order.pos_receipt_no),
        createdAt: iso(order.created_at),
        lines,
        subtotalPaise: integer(order.subtotal_paise),
        totalPaise: integer(order.total_paise),
        method: (['cash', 'upi', 'card_machine'] as const).includes(
          text(order.payment_method) as PosPaymentMethod,
        )
          ? (text(order.payment_method) as PosPaymentMethod)
          : null,
        providerRef: nullableText(paymentRows[0]?.provider_ref),
        cashierName: text(order.cashier_name),
        customerPhoneMasked: nullableText(order.customer_phone)
          ? maskCustomerPhone(text(order.customer_phone))
          : null,
      },
    };
  } catch {
    console.warn('[store-admin/pos] could not read the receipt');
    return { ok: false, reason: 'unavailable' };
  }
}
