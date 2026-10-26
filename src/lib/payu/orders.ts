import { getSql } from '@/lib/admin/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { planStockClaim, type StockRowSnapshot } from '@/lib/checkout/stock-rules';
import {
  formatOrderNumber,
  ORDER_NUMBER_COUNTER,
  type OrderNumberSettings,
} from '@/lib/orders/numbering';
import { planFulfilmentAutomation } from '@/lib/orders/fulfilment-automation';
import type { FulfilmentStatus } from '@/lib/store-admin/order-rules';
import { writeAudit } from '@/lib/store-admin/audit';
import { DEFAULT_SETTINGS } from '@/lib/store-admin/settings-rules';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import {
  claimPlannedStock,
  InsufficientStockError,
  reclaimReleasedStock,
  releasedClaimLines,
  releaseClaimedStock,
} from './stock';

/**
 * Order Model and Database Access Layer
 *
 * Manages orders, items snapshot, and idempotent status transitions.
 * Uses PostgreSQL transactions with row locking (SELECT ... FOR UPDATE) to prevent race conditions.
 */

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Order repository must never run in browser code.');
}

export type OrderStatus = 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface OrderItemSnapshot {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

/** A single `order_items` row derived from a resolved cart line. */
export interface OrderItemLine {
  lineNumber: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  currency: string;
}

/**
 * Build the `order_items` rows for an order from the resolved cart snapshot.
 *
 * Each product id is passed through the shared cart-id normaliser so a
 * composite line id (`base::colour::model`) is reduced to its catalog base id
 * before it is persisted — `order_items.product_id` only ever holds base ids.
 * Prices are the resolved (server-authoritative) rupee values; the paise
 * conversion is rounding-free integer math. Exported for unit tests.
 */
export function buildOrderItemLines(
  items: Array<{ id: string; name: string; quantity: number; unitPrice: number; totalPrice: number }>,
  knownBaseIds: readonly string[] = [],
  currency = 'INR',
): OrderItemLine[] {
  return items.map((item, index) => {
    const baseId = normalizeCartLineId(item.id, knownBaseIds).baseId || item.id;
    return {
      lineNumber: index + 1,
      productId: baseId,
      productName: item.name,
      quantity: item.quantity,
      unitPricePaise: Math.round(item.unitPrice * 100),
      lineTotalPaise: Math.round(item.totalPrice * 100),
      currency,
    };
  });
}

export interface Order {
  id: string;
  txnid: string;
  /** Allocated display number; null for orders saved before numbering. */
  orderNumber: number | null;
  userId: string | null;
  items: OrderItemSnapshot[];
  amount: number;
  currency: string;
  status: OrderStatus;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  payuMihpayid: string | null;
  payuMode: string | null;
  payuRawResponse: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

interface RawOrderRow {
  id: string;
  txnid: string;
  order_number?: string | number | null;
  fulfilment_status?: string | null;
  user_id: string | null;
  items: OrderItemSnapshot[] | string;
  amount: string | number;
  currency: string;
  status: OrderStatus;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  payu_mihpayid: string | null;
  payu_mode: string | null;
  payu_raw_response: Record<string, unknown> | string | null;
  created_at: string | Date;
  updated_at: string | Date;
  paid_at: string | Date | null;
}

function mapRowToOrder(row: RawOrderRow): Order {
  let items: OrderItemSnapshot[] = [];
  if (typeof row.items === 'string') {
    try {
      items = JSON.parse(row.items);
    } catch {
      items = [];
    }
  } else if (Array.isArray(row.items)) {
    items = row.items;
  }

  let rawResp: Record<string, unknown> | null = null;
  if (typeof row.payu_raw_response === 'string') {
    try {
      rawResp = JSON.parse(row.payu_raw_response);
    } catch {
      rawResp = null;
    }
  } else if (row.payu_raw_response && typeof row.payu_raw_response === 'object') {
    rawResp = row.payu_raw_response as Record<string, unknown>;
  }

  const orderNumber = Number(row.order_number);

  return {
    id: row.id,
    txnid: row.txnid,
    orderNumber: Number.isSafeInteger(orderNumber) && orderNumber > 0 ? orderNumber : null,
    userId: row.user_id,
    items,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    payuMihpayid: row.payu_mihpayid,
    payuMode: row.payu_mode,
    payuRawResponse: rawResp,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    paidAt: row.paid_at ? new Date(row.paid_at) : null,
  };
}

export interface CreateOrderParams {
  /** Random fallback id. Required only when `numbering` is absent. */
  txnid?: string;
  /** Prefix and starting number from Order settings. */
  numbering?: OrderNumberSettings | null;
  userId?: string | null;
  items: OrderItemSnapshot[];
  /** Server-computed money breakdown, always integer paise. */
  subtotalPaise: number;
  shippingPaise: number;
  totalPaise: number;
  currency?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentMethod?: string;
  pricingSnapshot?: Record<string, unknown>;
  shippingAddress: {
    name: string;
    phone: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
  };
}

export interface CreateOrderResult {
  order: Order;
  /** True when at least one tracked line was decremented. */
  stockClaimed: boolean;
}

type Tx = postgres.TransactionSql;

/**
 * Allocate the next display number from `order_number_counters`.
 *
 * The first update locks the counter row for the rest of the transaction, so
 * concurrent checkouts queue behind it and can never receive the same number.
 * The transaction id is the prefix plus the padded number; if an old order
 * already carries that txnid we take the next one.
 */
async function allocateOrderNumber(
  tx: Tx,
  settings: OrderNumberSettings,
): Promise<{ orderNumber: number; txnid: string }> {
  await tx`
    update order_number_counters
    set next_number = greatest(next_number, ${settings.startNumber})
    where name = ${ORDER_NUMBER_COUNTER}
  `;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const rows = await tx<Array<{ next_number: string | number }>>`
      update order_number_counters
      set next_number = next_number + 1
      where name = ${ORDER_NUMBER_COUNTER}
      returning next_number
    `;
    if (!rows[0]) throw new Error('Order numbering is unavailable.');

    const orderNumber = Number(rows[0].next_number) - 1;
    const txnid = formatOrderNumber(settings.prefix, orderNumber);
    const clash = await tx<Array<{ txnid: string }>>`
      select txnid from orders where txnid = ${txnid} limit 1
    `;
    if (clash.length === 0) return { orderNumber, txnid };
  }

  throw new Error('Could not allocate an order number.');
}

/**
 * Creates a new Order in 'CREATED' status and claims its tracked stock.
 *
 * Everything happens in one transaction: the tracked rows are locked first and
 * re-checked before anything is written, so a cart that no longer fits throws
 * `InsufficientStockError` and leaves no order behind. Amounts are the
 * server-computed paise breakdown; no client-sent price or total is accepted.
 */
export async function createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  return createOrderUsing(sql, params);
}

/**
 * The real creation path on a caller-owned connection. Exposed so an
 * integration test can open two dedicated connections and race two buyers for
 * the same last unit.
 */
export async function createOrderUsing(
  sql: postgres.Sql,
  params: CreateOrderParams,
): Promise<CreateOrderResult> {
  const id = `ord_${randomBytes(12).toString('hex')}`;
  const currency = params.currency || 'INR';
  const itemLines = buildOrderItemLines(params.items);

  const subtotalPaise = Math.max(0, Math.trunc(params.subtotalPaise));
  const shippingPaise = Math.max(0, Math.trunc(params.shippingPaise));
  const totalPaise = Math.max(0, Math.trunc(params.totalPaise));
  if (totalPaise !== subtotalPaise + shippingPaise) {
    throw new Error('Order total does not match its money breakdown.');
  }

  return await sql.begin(async (tx) => {
    // 1. Lock stock and decide the claim before creating the order row.
    const productIds = [...new Set(itemLines.map((line) => line.productId))];
    const stockRows = productIds.length === 0
      ? []
      : await tx<StockRowSnapshot[]>`
          select product_id, on_hand, reserved, track_inventory
          from stock
          where variant_id is null and product_id = any(${productIds}::text[])
          for update
        `;
    const plan = planStockClaim(itemLines, stockRows);
    if (!plan.ok) throw new InsufficientStockError(plan.error);

    // 2. Number the order inside the same transaction.
    let txnid = (params.txnid || '').trim();
    let orderNumber: number | null = null;
    if (params.numbering && params.numbering.prefix) {
      const allocated = await allocateOrderNumber(tx, params.numbering);
      txnid = allocated.txnid;
      orderNumber = allocated.orderNumber;
    }
    if (!txnid) throw new Error('An order needs a transaction id.');

    // 3. Persist the order and its snapshot.
    const rows = await tx<RawOrderRow[]>`
      INSERT INTO orders (
        id,
        txnid,
        order_number,
        user_id,
        items,
        amount,
        currency,
        status,
        channel,
        payment_method,
        fulfilment_status,
        subtotal_paise,
        discount_paise,
        shipping_paise,
        total_paise,
        pricing_snapshot,
        customer_name,
        customer_email,
        customer_phone,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${txnid},
        ${orderNumber},
        ${params.userId ?? null},
        ${tx.json(params.items as any)},
        ${(totalPaise / 100).toFixed(2)},
        ${currency},
        'CREATED',
        'web',
        ${params.paymentMethod ?? 'payu'},
        'PENDING',
        ${subtotalPaise},
        0,
        ${shippingPaise},
        ${totalPaise},
        ${tx.json((params.pricingSnapshot ?? {}) as any)},
        ${params.customerName},
        ${params.customerEmail},
        ${params.customerPhone},
        now(),
        now()
      )
      RETURNING *
    `;

    await tx`
      INSERT INTO order_status_history (
        order_id,
        domain,
        actor,
        from_status,
        to_status
      ) VALUES (
        ${rows[0].id},
        'payment',
        'system',
        ${null},
        'CREATED'
      )
    `;

    await tx`
      INSERT INTO order_addresses (
        order_id, address_type, full_name, phone, line1, line2, city, state, postal_code, country
      ) VALUES (
        ${rows[0].id}, 'shipping', ${params.shippingAddress.name}, ${params.shippingAddress.phone},
        ${params.shippingAddress.line1}, ${params.shippingAddress.line2 || null}, ${params.shippingAddress.city},
        ${params.shippingAddress.state}, ${params.shippingAddress.pincode}, 'IN'
      )
    `;

    // Normalised order_items rows: composite cart ids are reduced to catalog
    // base ids here, so every later lookup by product id works.
    for (const line of itemLines) {
      await tx`
        INSERT INTO order_items (
          order_id, line_number, product_id, product_name, quantity,
          unit_price_paise, line_total_paise, currency
        ) VALUES (
          ${rows[0].id}, ${line.lineNumber}, ${line.productId}, ${line.productName},
          ${line.quantity}, ${line.unitPricePaise}, ${line.lineTotalPaise}, ${line.currency}
        )
      `;
    }

    // 4. Apply the claim. A guarded miss rolls the whole transaction back.
    await claimPlannedStock(tx, rows[0].id, plan.claims);

    return { order: mapRowToOrder(rows[0]), stockClaimed: plan.claims.length > 0 };
  });
}

/**
 * Retrieves an order by unique txnid.
 */
export async function getOrderByTxnid(txnid: string): Promise<Order | null> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');

  const rows = await sql<RawOrderRow[]>`
    SELECT * FROM orders WHERE txnid = ${txnid} LIMIT 1
  `;

  if (!rows || rows.length === 0) return null;
  return mapRowToOrder(rows[0]);
}

/**
 * Retrieves an order by internal ID.
 */
export async function getOrderById(id: string): Promise<Order | null> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');

  const rows = await sql<RawOrderRow[]>`
    SELECT * FROM orders WHERE id = ${id} LIMIT 1
  `;

  if (!rows || rows.length === 0) return null;
  return mapRowToOrder(rows[0]);
}

export interface TransitionStatusParams {
  txnid: string;
  targetStatus: OrderStatus;
  mihpayid?: string | null;
  mode?: string | null;
  rawResponse?: Record<string, unknown> | null;
  /** Customer-safe reason recorded when the target is CANCELLED. */
  cancelReason?: string | null;
}

export interface TransitionResult {
  transitioned: boolean;
  previousStatus: OrderStatus;
  order: Order;
  firstTimePaid: boolean;
  /** True when a claim was returned to stock by this transition. */
  stockReleased: boolean;
  /** True when a late payment took its released units back from stock. */
  stockReclaimed: boolean;
  /** True when a late payment could not re-claim stock and needs a human. */
  paymentReviewRequired: boolean;
  /** Fulfilment statuses applied because the order became PAID. */
  fulfilmentSteps: FulfilmentStatus[];
}

/**
 * Reason stored on an order whose payment was captured after its stock was
 * released and could not be taken back. Safe to show in Store Admin: no PII.
 */
export const LATE_PAYMENT_REVIEW_REASON =
  'Payment captured after the order was cancelled; the released stock could not be re-claimed. Review stock and any refund manually.';

/**
 * Apply Order settings to a freshly paid order. Every step is a legal
 * transition from `order-rules.ts`; nothing is written when the target is not
 * ahead of the current status.
 */
async function applyPaidOrderAutomation(
  tx: Tx,
  orderId: string,
  fromStatus: string,
): Promise<FulfilmentStatus[]> {
  const rows = await tx<Array<{ key: string; value: string }>>`
    select key, value from store_settings
    where key in ('auto_confirm', 'default_fulfilment_status')
  `;
  const values = new Map(rows.map((row) => [row.key, String(row.value)]));

  const steps = planFulfilmentAutomation(fromStatus, {
    autoConfirm:
      (values.get('auto_confirm') ?? DEFAULT_SETTINGS.auto_confirm) === 'on',
    defaultStatus:
      values.get('default_fulfilment_status') ?? DEFAULT_SETTINGS.default_fulfilment_status,
  });

  let previous = fromStatus;
  for (const step of steps) {
    await tx`
      update orders
      set fulfilment_status = ${step}, updated_at = now()
      where id = ${orderId}
    `;
    await tx`
      insert into order_status_history (order_id, domain, actor, from_status, to_status)
      values (${orderId}, 'fulfilment', 'system', ${previous}, ${step})
    `;
    previous = step;
  }

  return steps;
}

/**
 * Transitions order status idempotently and atomically with row locking.
 * Returns firstTimePaid=true only if this call moved the order from non-PAID to PAID.
 *
 * A failed or cancelled unpaid order gives its claimed stock back in the same
 * transaction; the ledger makes a duplicate callback a no-op. A late PAID
 * callback for such an order tries to take the released units back atomically;
 * when it cannot, the payment is still recorded but the order is flagged for
 * manual review and an audit row is written after the commit.
 */
export async function transitionOrderStatus(params: TransitionStatusParams): Promise<TransitionResult> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');

  const result = await transitionOrderStatusUsing(sql, params);

  if (result.paymentReviewRequired) {
    await writeAudit({
      action: 'payment.late_capture_review',
      entity: 'order',
      entityId: result.order.txnid,
      status: 'flagged',
      reason: 'stock_unavailable_for_reclaim',
      after: {
        previousStatus: result.previousStatus,
        status: result.order.status,
        stockReclaimed: false,
      },
      route: 'payment-verification',
    });
    console.warn(
      `[payu] late payment for ${result.order.txnid} could not re-claim stock; flagged for review`,
    );
  }

  return result;
}

/** The transition on a caller-owned connection; used by integration tests. */
export async function transitionOrderStatusUsing(
  sql: postgres.Sql,
  params: TransitionStatusParams,
): Promise<TransitionResult> {
  return await sql.begin(async (tx) => {
    // Acquire exclusive row lock
    const lockedRows = await tx<RawOrderRow[]>`
      SELECT * FROM orders WHERE txnid = ${params.txnid} FOR UPDATE
    `;

    if (!lockedRows || lockedRows.length === 0) {
      throw new Error(`Order with txnid '${params.txnid}' not found.`);
    }

    const current = mapRowToOrder(lockedRows[0]);
    const previousStatus = current.status;
    const currentFulfilment = String(lockedRows[0].fulfilment_status ?? 'PENDING');

    // If order is already PAID, do not overwrite or trigger duplicate fulfillment
    if (previousStatus === 'PAID') {
      return {
        transitioned: false,
        previousStatus,
        order: current,
        firstTimePaid: false,
        stockReleased: false,
        stockReclaimed: false,
        paymentReviewRequired: false,
        fulfilmentSteps: [],
      };
    }

    // If already in target status, return idempotently
    if (previousStatus === params.targetStatus) {
      return {
        transitioned: false,
        previousStatus,
        order: current,
        firstTimePaid: false,
        stockReleased: false,
        stockReclaimed: false,
        paymentReviewRequired: false,
        fulfilmentSteps: [],
      };
    }

    const isBecomingPaid = params.targetStatus === 'PAID';
    const paidAt = isBecomingPaid ? new Date() : (current.paidAt || null);
    const cancelledAt = params.targetStatus === 'CANCELLED' ? new Date() : null;

    const updatedRows = await tx<RawOrderRow[]>`
      UPDATE orders
      SET
        status = ${params.targetStatus},
        payu_mihpayid = COALESCE(${params.mihpayid ?? null}, payu_mihpayid),
        payu_mode = COALESCE(${params.mode ?? null}, payu_mode),
        payu_raw_response = COALESCE(${params.rawResponse ? tx.json(params.rawResponse as any) : null}, payu_raw_response),
        paid_at = ${paidAt},
        cancelled_at = COALESCE(${cancelledAt}, cancelled_at),
        cancel_reason = COALESCE(${params.cancelReason ?? null}, cancel_reason),
        updated_at = now()
      WHERE txnid = ${params.txnid}
      RETURNING *
    `;

    const updated = mapRowToOrder(updatedRows[0]);

    await tx`
      INSERT INTO order_status_history (
        order_id,
        domain,
        actor,
        from_status,
        to_status,
        payu_mihpayid,
        payu_mode
      ) VALUES (
        ${updated.id},
        'payment',
        'payu',
        ${previousStatus},
        ${params.targetStatus},
        ${params.mihpayid ?? null},
        ${params.mode ?? null}
      )
    `;

    // Only an unpaid claim is released. A PAID order keeps its stock until a
    // return is received, which restocks through the existing return flow.
    let stockReleased = false;
    if (
      (params.targetStatus === 'FAILED' || params.targetStatus === 'CANCELLED') &&
      (previousStatus === 'CREATED' || previousStatus === 'PENDING')
    ) {
      stockReleased = await releaseClaimedStock(tx, updated.id);
    }

    // A payment that arrives after the unpaid order was cancelled or failed
    // must not silently sell stock that is already back on the shelf. Re-take
    // exactly what the release ledger gave back; if any unit is gone, claim
    // nothing and flag the order. The row lock above makes duplicate callbacks
    // no-ops, so the same units can never be taken twice.
    const isLatePaid =
      isBecomingPaid && (previousStatus === 'CANCELLED' || previousStatus === 'FAILED');
    let stockReclaimed = false;
    let paymentReviewRequired = false;
    if (isLatePaid) {
      const released = await releasedClaimLines(tx, updated.id);
      if (released.length > 0) {
        const reclaim = await reclaimReleasedStock(tx, updated.id, released);
        stockReclaimed = reclaim.ok;
        paymentReviewRequired = !reclaim.ok;
        if (!reclaim.ok) {
          await tx`
            UPDATE orders
            SET payment_review_required = true,
                payment_review_reason = ${LATE_PAYMENT_REVIEW_REASON},
                updated_at = now()
            WHERE id = ${updated.id}
          `;
        }
      }
    }

    // A flagged late payment stays where it is for a human to handle; the
    // payment is captured, but auto-confirm must not pretend the stock exists.
    let fulfilmentSteps: FulfilmentStatus[] = [];
    if (isBecomingPaid && !paymentReviewRequired) {
      fulfilmentSteps = await applyPaidOrderAutomation(tx, updated.id, currentFulfilment);
    }

    const finalRows = fulfilmentSteps.length > 0
      ? await tx<RawOrderRow[]>`SELECT * FROM orders WHERE id = ${updated.id} LIMIT 1`
      : updatedRows;

    return {
      transitioned: true,
      previousStatus,
      order: mapRowToOrder(finalRows[0]),
      firstTimePaid: isBecomingPaid,
      stockReleased,
      stockReclaimed,
      paymentReviewRequired,
      fulfilmentSteps,
    };
  });
}

/**
 * Finds orders stuck in CREATED or PENDING older than specified minutes.
 * Used by reconciliation worker.
 */
export async function findStaleOrders(staleMinutes: number = 15, limit: number = 50): Promise<Order[]> {
  const sql = getSql();
  if (!sql) return [];

  const rows = await sql<RawOrderRow[]>`
    SELECT * FROM orders
    WHERE status IN ('CREATED', 'PENDING')
      AND created_at <= now() - (${staleMinutes} || ' minutes')::interval
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return rows.map(mapRowToOrder);
}
