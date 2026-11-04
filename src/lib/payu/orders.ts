import { getSql } from '@/lib/platform/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import {
  addMinutes,
  addSeconds,
  DEFAULT_RESERVATION_POLICY,
  MAX_CONSECUTIVE_RECONCILE_FAILURES,
  nextReconcileAt,
  type ReservationPolicy,
  type ReservationState,
} from '@/lib/checkout/reservation-rules';
import { planStockClaim, type StockIdentity } from '@/lib/checkout/stock-rules';
import { readCheckoutConfigurationUsing } from '@/lib/checkout/settings';
import { quoteShipping, type ShippingPolicy } from '@/lib/checkout/shipping-rules';
import { resolveCartItemsFromDbUsing } from './db-catalog';
import type { CartPricingInput, PricedCart } from './db-pricing';
import {
  formatOrderNumber,
  ORDER_NUMBER_COUNTER,
  type OrderNumberSettings,
} from '@/lib/orders/numbering';
import { planFulfilmentAutomation } from '@/lib/orders/fulfilment-automation';
import { CouponRejectedError, TotalChangedError } from '@/lib/coupons/errors';
import {
  couponRejectionMessage,
  couponSnapshot,
  normalizeCouponCode,
  type CouponDefinition,
  type CouponEvaluation,
  type CouponLine,
} from '@/lib/coupons/rules';
import {
  consumeCouponInTx,
  evaluateCouponFromDatabase,
  insertReservedRedemption,
  loadCouponDefinition,
  releaseCouponInTx,
  restoreCouponAfterLatePayment,
} from '@/lib/coupons/store';
import type { FulfilmentStatus } from '@/lib/store-admin/order-rules';
import { writeAudit } from '@/lib/store-admin/audit';
import { DEFAULT_SETTINGS } from '@/lib/store-admin/settings-rules';
import { randomBytes } from 'node:crypto';
import type postgres from 'postgres';

import { createRefundObligationInTx } from './refund-obligations';
import { safePaymentSummary } from './verify';
import {
  claimPlannedStock,
  lockStockIdentities,
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

export type OrderStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED';

export type { ReservationState };

/**
 * Raised when a gateway payment id (`mihpayid`) is already attached to a
 * different order. The partial unique index `idx_orders_mihpayid_unique`
 * enforces this at the database level; this error turns the violation into a
 * safe, catchable outcome so a replayed capture can never mark a second order
 * paid.
 */
export class DuplicateGatewayPaymentError extends Error {
  readonly mihpayid: string;

  constructor(mihpayid: string) {
    super('This gateway payment is already attached to another order.');
    this.name = 'DuplicateGatewayPaymentError';
    this.mihpayid = mihpayid;
  }
}

/** A concurrent verification must not replace this order's gateway identity. */
export class GatewayIdentityConflictError extends Error {
  constructor() {
    super('Gateway payment identity conflicts with the order.');
    this.name = 'GatewayIdentityConflictError';
  }
}

/** Postgres unique-violation code (`23505`). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && (error as { code?: unknown }).code === '23505'
  );
}

/** True when a unique violation came from the gateway-payment index. */
function isMihpayidConflict(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const detail = [
    (error as { constraint_name?: unknown }).constraint_name,
    (error as { constraint?: unknown }).constraint,
    (error as { message?: unknown }).message,
  ]
    .filter((part) => typeof part === 'string')
    .join(' ')
    .toLowerCase();
  return detail.includes('mihpayid');
}

export interface OrderItemSnapshot {
  id: string;
  variantId?: string | null;
  variantSku?: string | null;
  variantLabel?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  /** Scope metadata used only while a coupon is being evaluated. */
  categoryId?: string | null;
  brandId?: string | null;
  onSale?: boolean;
}

/** A single `order_items` row derived from a resolved cart line. */
export interface OrderItemLine {
  lineNumber: number;
  productId: string;
  variantId?: string | null;
  variantSku?: string | null;
  variantLabel?: string | null;
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
  items: Array<OrderItemSnapshot>,
  knownBaseIds: readonly string[] = [],
  currency = 'INR',
): OrderItemLine[] {
  return items.map((item, index) => {
    const baseId = normalizeCartLineId(item.id, knownBaseIds).baseId || item.id;
    return {
      lineNumber: index + 1,
      productId: baseId,
      ...(item.variantId ? { variantId: item.variantId, variantSku: item.variantSku, variantLabel: item.variantLabel } : {}),
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
  /** The money breakdown, integer paise. `amount` is `totalPaise / 100`. */
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  couponId: string | null;
  couponCode: string | null;
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
  /** Flash-sale hold: NONE for legacy/POS rows. */
  reservationState: ReservationState;
  reservationExpiresAt: Date | null;
  reservationReleasedAt: Date | null;
  reservationReleasedReason: string;
  /** End of the safe recovery window for an ambiguous payment. */
  processingDeadline: Date | null;
  paymentReviewRequired: boolean;
  paymentReviewReason: string;
  reconcileAttempts: number;
  consecutiveReconcileFailures: number;
  nextReconcileAt: Date | null;
}

interface RawOrderRow {
  id: string;
  txnid: string;
  order_number?: string | number | null;
  fulfilment_status?: string | null;
  user_id: string | null;
  items: OrderItemSnapshot[] | string;
  amount: string | number;
  subtotal_paise?: string | number | null;
  discount_paise?: string | number | null;
  shipping_paise?: string | number | null;
  total_paise?: string | number | null;
  coupon_id?: string | null;
  coupon_code?: string | null;
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
  reservation_state?: string | null;
  reservation_expires_at?: string | Date | null;
  reservation_released_at?: string | Date | null;
  reservation_released_reason?: string | null;
  processing_deadline?: string | Date | null;
  payment_review_required?: boolean | null;
  payment_review_reason?: string | null;
  reconcile_attempts?: string | number | null;
  consecutive_reconcile_failures?: string | number | null;
  next_reconcile_at?: string | Date | null;
}

function reservationStateOf(value: unknown): ReservationState {
  return value === 'ACTIVE' || value === 'CONSUMED' || value === 'RELEASED' || value === 'EXPIRED'
    ? value
    : 'NONE';
}

function dateOrNull(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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
    subtotalPaise: Math.max(
      0,
      Math.round(Number(row.subtotal_paise ?? Number(row.amount) * 100)),
    ),
    discountPaise: Math.max(0, Math.round(Number(row.discount_paise ?? 0))),
    shippingPaise: Math.max(0, Math.round(Number(row.shipping_paise ?? 0))),
    totalPaise: Math.max(
      0,
      Math.round(Number(row.total_paise ?? Number(row.amount) * 100)),
    ),
    couponId: row.coupon_id ? String(row.coupon_id) : null,
    couponCode: row.coupon_code ? String(row.coupon_code) : null,
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
    reservationState: reservationStateOf(row.reservation_state),
    reservationExpiresAt: dateOrNull(row.reservation_expires_at),
    reservationReleasedAt: dateOrNull(row.reservation_released_at),
    reservationReleasedReason: String(row.reservation_released_reason ?? ''),
    processingDeadline: dateOrNull(row.processing_deadline),
    paymentReviewRequired: Boolean(row.payment_review_required),
    paymentReviewReason: String(row.payment_review_reason ?? ''),
    reconcileAttempts: Math.max(0, Math.trunc(Number(row.reconcile_attempts) || 0)),
    consecutiveReconcileFailures: Math.max(
      0,
      Math.trunc(Number(row.consecutive_reconcile_failures) || 0),
    ),
    nextReconcileAt: dateOrNull(row.next_reconcile_at),
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
  /** Provisional items + shipping. Recomputed when a coupon applies. */
  totalPaise: number;
  currency?: string;
  /**
   * A coupon to lock, re-validate and apply inside this transaction. The code
   * is the only client input; the discount and total are computed here.
   */
  coupon?: {
    code: string;
    /** The signed-in customer's group, if any. Guests pass null. */
    customerGroup?: string | null;
    /** Advisory display total; a mismatch aborts before the order is written. */
    expectedTotalPaise?: number | null;
  } | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  paymentMethod?: string;
  pricingSnapshot?: Record<string, unknown>;
  /**
   * Active checkout window. Zero (the POS/default) creates a legacy row with
   * no reservation: stock is still claimed, but no timed hold is recorded.
   */
  reservationSeconds?: number;
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

/** Web checkout accepts identities and display expectations, never charge amounts. */
export type WebCreateOrderParams = Omit<
  CreateOrderParams,
  'items' | 'subtotalPaise' | 'shippingPaise' | 'totalPaise' | 'pricingSnapshot'
> & {
  cartItems: CartPricingInput[];
  expectedTotalPaise?: number | null;
};

export interface LazilyExpiredReservation {
  txnid: string;
  previousStatus: OrderStatus;
  status: OrderStatus;
  state: 'RELEASED' | 'EXPIRED';
  stockReleased: boolean;
}

export interface CreateOrderResult {
  order: Order;
  /** True when at least one tracked line was decremented. */
  stockClaimed: boolean;
  /**
   * Reservations whose deadline had already passed and whose stock was given
   * back by this checkout when the claim did not fit. Normally empty: the
   * reconcile worker expires them first.
   */
  expiredReservations: LazilyExpiredReservation[];
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
export async function createOrder(params: WebCreateOrderParams): Promise<CreateOrderResult> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');
  return createOrderUsing(sql, params);
}

/**
 * Return stock held by reservations whose deadline has already passed on the
 * database clock, for the products this checkout wants.
 *
 * The reconcile worker is the normal expiry path, but a checkout must not
 * depend on the scheduler being up: when the cron is late while a product is
 * sold out, the next customer would be refused a unit that is really free.
 * This runs inside the order transaction after the stock rows are locked, so it
 * cannot race the worker, a verified payment (which locks the order row) or a
 * second checkout.
 *
 * A CREATED/PENDING row is cancelled exactly like the worker's expiry path; a
 * FAILED/CANCELLED row keeps its status and moves to RELEASED (the grace rule);
 * a PROCESSING row keeps its status, loses its claim and is scheduled for an
 * immediate verification so the worker still flags an unresolved payment. The
 * order row lock and the `reservation_state = 'ACTIVE'` guard make a duplicate
 * call — worker or checkout — a no-op.
 */
export async function releaseExpiredReservationsForProducts(
  tx: Tx,
  productIds: readonly string[],
  identities?: readonly StockIdentity[],
): Promise<LazilyExpiredReservation[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const requested = (identities || ids.map(productId => ({productId,variantId:null}))).map(line => ({product_id:line.productId,variant_id:line.variantId || null}));
  if (ids.length === 0) return [];

  const rows = await tx<Array<{ id: string; txnid: string; status: string }>>`
    select o.id, o.txnid, o.status
    from orders o
    where o.reservation_state = 'ACTIVE'
      and o.reservation_expires_at is not null
      and o.reservation_expires_at <= now()
      and o.status <> 'PAID'
      and exists (
        select 1 from order_items oi
        where oi.order_id = o.id
          and exists (select 1 from jsonb_to_recordset(${tx.json(requested)}::jsonb) as wanted(product_id text,variant_id text)
            where wanted.product_id=oi.product_id and wanted.variant_id is not distinct from oi.variant_id)
      )
    order by o.id asc
    for update of o
  `;

  const expired: LazilyExpiredReservation[] = [];

  for (const row of rows) {
    const orderId = String(row.id);
    const previousStatus = String(row.status) as OrderStatus;
    const stockReleased = await releaseClaimedStock(tx, orderId);
    await releaseCouponInTx(tx, orderId, 'reservation expired');

    const grace = previousStatus === 'FAILED' || previousStatus === 'CANCELLED';
    const processing = previousStatus === 'PROCESSING';
    const state = grace ? 'RELEASED' : 'EXPIRED';
    const status: OrderStatus = grace || processing ? previousStatus : 'CANCELLED';
    const reason = grace
      ? previousStatus === 'FAILED'
        ? 'payment failed; the grace window has ended'
        : 'payment cancelled; the grace window has ended'
      : processing
        ? 'payment verification window closed; the claim was released'
        : 'The checkout window closed before payment was confirmed.';

    await tx`
      update orders
      set reservation_state = ${state},
          reservation_released_at = now(),
          reservation_released_reason = ${reason},
          -- A closed processing window keeps its deadline so the worker can
          -- see that the safe recovery window ended and flag the payment.
          processing_deadline = case when ${processing} then processing_deadline else null end,
          next_reconcile_at = case when ${processing} then now() else null end,
          status = ${status},
          cancelled_at = case when ${status} = 'CANCELLED' then coalesce(cancelled_at, now()) else cancelled_at end,
          cancel_reason = case when ${status} = 'CANCELLED' then ${reason} else cancel_reason end,
          updated_at = now()
      where id = ${orderId} and reservation_state = 'ACTIVE'
    `;

    if (status !== previousStatus) {
      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${orderId}, 'payment', 'system', ${previousStatus}, ${status})
      `;
    }

    expired.push({ txnid: String(row.txnid), previousStatus, status, state, stockReleased });
  }

  return expired;
}

/**
 * The real creation path on a caller-owned connection. Exposed so an
 * integration test can open two dedicated connections and race two buyers for
 * the same last unit.
 */
export async function createOrderUsing(
  sql: postgres.Sql,
  params: CreateOrderParams | WebCreateOrderParams,
): Promise<CreateOrderResult> {
  const id = `ord_${randomBytes(12).toString('hex')}`;
  const currency = params.currency || 'INR';
  const web = 'cartItems' in params ? params : null;
  const legacy = 'items' in params ? params : null;
  if (web && (!Array.isArray(web.cartItems) || web.cartItems.length === 0)) {
    throw new Error('Cart must contain at least one item.');
  }
  const lockIds = web
    ? web.cartItems.map((item) => {
        const baseId = normalizeCartLineId(item?.id).baseId;
        if (!baseId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 50) {
          throw new Error('Invalid cart item or quantity.');
        }
        return baseId;
      })
    : buildOrderItemLines(legacy!.items).map((line) => line.productId);
  const reservationSeconds = Math.max(0, Math.trunc(params.reservationSeconds ?? 0));

  return await sql.begin(async (tx) => {
    // Shared configuration fence: activation cannot race a parent-only checkout.
    await tx`select pg_advisory_xact_lock_shared(513031,3)`;
    let items = legacy?.items ?? [];
    let itemLines = buildOrderItemLines(items);
    let subtotalPaise = Math.max(0, Math.trunc(legacy?.subtotalPaise ?? 0));
    let shippingPaise = Math.max(0, Math.trunc(legacy?.shippingPaise ?? 0));
    let totalPaise = Math.max(0, Math.trunc(legacy?.totalPaise ?? 0));
    let discountPaise = 0;
    let cart: PricedCart | null = null;
    let shippingPolicy: ShippingPolicy | undefined;
    let pricingSnapshot = legacy?.pricingSnapshot ?? {};
    if (legacy && !params.coupon?.code && totalPaise !== subtotalPaise + shippingPaise) {
      throw new Error('Order total does not match its money breakdown.');
    }
    const productIds = [...new Set(lockIds)].sort();
    const requestedIdentities = (web ? web.cartItems.map(item => ({productId: normalizeCartLineId(item.id).baseId || item.id,variantId:item.variantId || null})) : itemLines);
    const requestedRecords = requestedIdentities.map(line => ({product_id:line.productId,variant_id:line.variantId || null}));

    // Lock affected existing orders before any inventory row. Include every line
    // of those orders in the sorted stock lock set, because expiry releases whole
    // orders atomically. Sibling-only reservations do not match this request.
    const affectedOrders = await tx<Array<{id:string}>>`
      select o.id from orders o where o.reservation_state='ACTIVE' and exists(
        select 1 from order_items oi,jsonb_to_recordset(${tx.json(requestedRecords)}::jsonb) as wanted(product_id text,variant_id text)
        where oi.order_id=o.id and oi.product_id=wanted.product_id and oi.variant_id is not distinct from wanted.variant_id)
      order by o.id for update of o`;
    const affectedLines = affectedOrders.length ? await tx<Array<{product_id:string;variant_id:string|null}>>`
      select distinct product_id,variant_id from order_items where order_id=any(${affectedOrders.map(row=>row.id)}::text[])` : [];
    await lockStockIdentities(tx,[...requestedIdentities,...affectedLines.map(row=>({productId:row.product_id,variantId:row.variant_id}))]);

    // A customer retrying after a failed payment may still have the grace hold
    // from that order. A fresh checkout claims the same stock, so give the old
    // hold back first; otherwise a one-unit product would look sold out to the
    // very customer it is being held for. Only this customer's own failed or
    // cancelled holds are touched, and only under the row lock.
    if (params.userId && productIds.length > 0) {
      const superseded = await tx<Array<{ id: string }>>`
        select id from orders
        where user_id = ${params.userId}
          and reservation_state = 'ACTIVE'
          and reservation_expires_at > now()
          and status in ('FAILED', 'CANCELLED')
          and exists (
            select 1 from order_items oi
            where oi.order_id = orders.id
              and exists(select 1 from jsonb_to_recordset(${tx.json(requestedRecords)}::jsonb) as wanted(product_id text,variant_id text)
                where wanted.product_id=oi.product_id and wanted.variant_id is not distinct from oi.variant_id)
          )
        order by id
        for update
      `;
      for (const row of superseded) {
        await releaseClaimedStock(tx, String(row.id));
        await releaseCouponInTx(tx, String(row.id), 'superseded by a new checkout');
        await tx`
          update orders
          set reservation_state = 'RELEASED',
              reservation_released_at = now(),
              reservation_released_reason = 'superseded by a new checkout',
              next_reconcile_at = null,
              updated_at = now()
          where id = ${String(row.id)} and reservation_state = 'ACTIVE'
        `;
      }
    }

    if (web) {
      const configuration = await readCheckoutConfigurationUsing(tx);
      if (!configuration.ok) throw new Error('Checkout settings are temporarily unavailable.');
      if (configuration.settings.payu_enabled !== 'on') {
        throw new Error('Online payment is currently unavailable.');
      }
      if (params.coupon?.code && configuration.settings.coupons_enabled === 'off') {
        throw new CouponRejectedError('inactive', couponRejectionMessage('inactive'));
      }
      cart = await resolveCartItemsFromDbUsing(tx, web.cartItems);
      items = cart.items;
      itemLines = buildOrderItemLines(items);
      subtotalPaise = cart.totalPaise;
      shippingPolicy = configuration.policy;
      const quote = quoteShipping(subtotalPaise, shippingPolicy);
      shippingPaise = quote.shippingPaise;
      totalPaise = subtotalPaise + shippingPaise;
      pricingSnapshot = { shipping: { ...quote, ...shippingPolicy } };
      // Use the database's canonical ids for subsequent claim/release queries.
      productIds.splice(0, productIds.length, ...new Set(itemLines.map((line) => line.productId)));
    }

    // Expire matching holds before obtaining stock locks (never stock -> order).
    const expiredReservations = await releaseExpiredReservationsForProducts(tx, productIds, itemLines);
    const stockRows = await lockStockIdentities(tx, itemLines);
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

    // 2b. Coupon. The row is locked before its uses are counted, so two
    //     concurrent buyers cannot both take the last redemption. The code is
    //     the only client input; every amount below is computed here.
    let couponDefinition: CouponDefinition | null = null;
    let couponEvaluation: CouponEvaluation | null = null;
    let couponLineDiscounts: number[] = itemLines.map(() => 0);
    if (params.coupon?.code) {
      const code = normalizeCouponCode(params.coupon.code);
      const locked = await loadCouponDefinition(tx, code, { forUpdate: true });
      if (!locked) {
        throw new CouponRejectedError(
          'not_found',
          couponRejectionMessage('not_found'),
        );
      }

      const lines: CouponLine[] = itemLines.map((line, index) => ({
        productId: line.productId,
        categoryId: items[index]?.categoryId ?? null,
        brandId: items[index]?.brandId ?? null,
        quantity: line.quantity,
        unitPaise: line.unitPricePaise,
        linePaise: line.lineTotalPaise,
        onSale: items[index]?.onSale === true,
      }));

      const evaluation = await evaluateCouponFromDatabase(tx, locked, {
        lines,
        subtotalPaise,
        shippingPaise,
        customer: {
          userId: params.userId ?? null,
          email: params.customerEmail,
          group: params.coupon.customerGroup ?? null,
        },
      });

      if (!evaluation.ok) {
        throw new CouponRejectedError(evaluation.reason, evaluation.message);
      }

      couponDefinition = locked;
      couponEvaluation = evaluation;
      discountPaise = evaluation.discountPaise;
      shippingPaise = evaluation.shippingPaise;
      totalPaise = evaluation.totalPaise;
      couponLineDiscounts = evaluation.allocations;

    }

    if (shippingPolicy) {
      const finalQuote = quoteShipping(subtotalPaise, shippingPolicy, couponDefinition?.type === 'FREE_SHIPPING');
      shippingPaise = finalQuote.shippingPaise;
      totalPaise = subtotalPaise - discountPaise + shippingPaise;
      pricingSnapshot = { shipping: { ...finalQuote, ...shippingPolicy } };
    }
    const expected = web?.expectedTotalPaise ?? params.coupon?.expectedTotalPaise;
    if (
      (typeof expected === 'number' && Number.isSafeInteger(expected) && expected !== totalPaise)
      || (cart && cart.priceChanges.length > 0)
    ) {
      // Unit-price changes are represented by the same complete recovery payload;
      // totals are still checked independently for shipping/coupon changes.
      throw new TotalChangedError(
        { subtotalPaise, discountPaise, shippingPaise, totalPaise },
        cart?.items ?? [],
        shippingPolicy,
      );
    }

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
        coupon_id,
        coupon_code,
        coupon_snapshot,
        pricing_snapshot,
        customer_name,
        customer_email,
        customer_phone,
        reservation_state,
        reservation_expires_at,
        next_reconcile_at,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${txnid},
        ${orderNumber},
        ${params.userId ?? null},
        ${tx.json(items as any)},
        ${(totalPaise / 100).toFixed(2)},
        ${currency},
        'CREATED',
        'web',
        ${params.paymentMethod ?? 'payu'},
        'PENDING',
        ${subtotalPaise},
        ${discountPaise},
        ${shippingPaise},
        ${totalPaise},
        ${couponDefinition?.id ?? null},
        ${couponDefinition?.code ?? null},
        ${couponDefinition && couponEvaluation
          ? tx.json(couponSnapshot(couponDefinition, discountPaise) as any)
          : null},
        ${tx.json(pricingSnapshot as any)},
        ${params.customerName},
        ${params.customerEmail},
        ${params.customerPhone},
        ${reservationSeconds > 0 ? 'ACTIVE' : 'NONE'},
        now() + ${reservationSeconds > 0 ? `${reservationSeconds} seconds` : null}::interval,
        now() + ${reservationSeconds > 0 ? `${reservationSeconds} seconds` : null}::interval,
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
    for (const [index, line] of itemLines.entries()) {
      await tx`
        INSERT INTO order_items (
          order_id, line_number, product_id, product_name, quantity,
          unit_price_paise, line_total_paise, discount_paise, currency,variant_id,variant_sku,variant_label
        ) VALUES (
          ${rows[0].id}, ${line.lineNumber}, ${line.productId}, ${line.productName},
          ${line.quantity}, ${line.unitPricePaise}, ${line.lineTotalPaise},
          ${couponLineDiscounts[index] ?? 0}, ${line.currency},${line.variantId || null},${line.variantSku || null},${line.variantLabel || null}
        )
      `;
    }

    // The use is held from this moment. It counts against both limits until
    // the payment is verified (CONSUMED) or the hold is released.
    if (couponDefinition) {
      await insertReservedRedemption(tx, {
        couponId: couponDefinition.id,
        orderId: rows[0].id,
        customerUserId: params.userId ?? null,
        customerEmail: params.customerEmail,
        discountPaise,
      });
    }

    // 4. Claim the planned units. The guarded updates write `sale` movements
    //    under the same locked stock rows, so the ledger always equals the
    //    units the order holds.
    await claimPlannedStock(tx, rows[0].id, plan.claims);
    const stockClaimed = plan.claims.length > 0;

    return { order: mapRowToOrder(rows[0]), stockClaimed, expiredReservations };
  });
}

/**
 * Retrieves an order by unique txnid.
 *
 * `sqlOverride` is the connection of an integration test pinned to a throwaway
 * schema; production always uses the application pool.
 */
export async function getOrderByTxnid(
  txnid: string,
  sqlOverride?: postgres.Sql,
): Promise<Order | null> {
  const sql = sqlOverride ?? getSql();
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

/**
 * Find the order that already owns a gateway payment id, if any. Used to refuse
 * a replayed capture before any write instead of relying on the unique index.
 */
export async function findOrderByMihpayid(
  mihpayid: string,
  sqlOverride?: postgres.Sql,
): Promise<Order | null> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return null;
  const key = mihpayid.trim();
  if (!key) return null;

  const rows = await sql<RawOrderRow[]>`
    SELECT * FROM orders WHERE payu_mihpayid = ${key} LIMIT 1
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
  /** Reservation/grace policy. The coded defaults apply when omitted. */
  policy?: ReservationPolicy;
  /** An owner status check must not give an existing active hold more time. */
  preserveReservationWindow?: boolean;
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
  /** True when a late payment could not restore its coupon use. */
  couponReviewRequired: boolean;
  /** Created when the captured payment cannot be fulfilled. */
  refundObligationCreated: boolean;
  refundObligationAmountPaise: number;
  /** Fulfilment statuses applied because the order became PAID. */
  fulfilmentSteps: FulfilmentStatus[];
}

function noopTransition(
  previousStatus: OrderStatus,
  order: Order,
): TransitionResult {
  return {
    transitioned: false,
    previousStatus,
    order,
    firstTimePaid: false,
    stockReleased: false,
    stockReclaimed: false,
    paymentReviewRequired: false,
    couponReviewRequired: false,
    refundObligationCreated: false,
    refundObligationAmountPaise: 0,
    fulfilmentSteps: [],
  };
}

/**
 * Reason stored on an order whose payment was captured after its stock was
 * released and could not be taken back. Safe to show in Store Admin: no PII.
 */
export const LATE_PAYMENT_REVIEW_REASON =
  'Payment captured after the order was cancelled; the released stock could not be re-claimed. Review stock and any refund manually.';

/**
 * Reason stored when a verified late payment cannot restore its coupon use
 * because another customer has taken the last redemption since. The order
 * stays paid; a human reviews the discount.
 */
export const COUPON_LATE_REVIEW_REASON =
  'Payment captured after the coupon use was released and the limit no longer allows restoring it. The order is paid; review the discount manually.';

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
 * manual review and an audit row is written after the commit. Isolated tests
 * may disable these process-global audit writes with `sideEffects: false`;
 * transactional stock, coupon, refund and history writes always run.
 */
export async function transitionOrderStatus(
  params: TransitionStatusParams,
  sqlOverride?: postgres.Sql,
  options: { sideEffects?: boolean } = {},
): Promise<TransitionResult> {
  const sql = sqlOverride ?? getSql();
  if (!sql) throw new Error('Database is not configured.');

  let result: TransitionResult;
  try {
    result = await transitionOrderStatusUsing(sql, params);
  } catch (error: unknown) {
    // Two orders racing with the same capture: the database refuses the second
    // write. The caller answers as a duplicate instead of a 500, and the
    // payment is flagged so a human checks the gateway.
    if (params.mihpayid && isMihpayidConflict(error)) {
      console.warn(
        `[payu] gateway payment id already attached to another order; ${params.txnid} not marked paid`,
      );
      await flagPaymentForReview(
        {
          txnid: params.txnid,
          reason:
            'PayU reported a payment id that is already attached to another order. The order was not marked paid. Check the gateway before fulfilling or refunding.',
        },
        sqlOverride,
      ).catch(() => undefined);
      throw new DuplicateGatewayPaymentError(params.mihpayid);
    }
    throw error;
  }

  if (result.paymentReviewRequired && options.sideEffects !== false) {
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

  if (result.couponReviewRequired && options.sideEffects !== false) {
    await writeAudit({
      action: 'coupon.late_restore_review',
      entity: 'order',
      entityId: result.order.txnid,
      status: 'flagged',
      reason: 'coupon_limit_unavailable_for_restore',
      after: {
        previousStatus: result.previousStatus,
        status: result.order.status,
        couponCode: result.order.couponCode,
      },
      route: 'payment-verification',
    });
    console.warn(
      `[payu] late payment for ${result.order.txnid} could not restore its coupon use; flagged for review`,
    );
  }

  return result;
}

/** The transition on a caller-owned connection; used by integration tests. */
export async function transitionOrderStatusUsing(
  sql: postgres.Sql,
  params: TransitionStatusParams,
): Promise<TransitionResult> {
  const policy = params.policy ?? DEFAULT_RESERVATION_POLICY;

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
    if (params.mihpayid && current.payuMihpayid && params.mihpayid !== current.payuMihpayid) {
      throw new GatewayIdentityConflictError();
    }

    // If order is already PAID, do not overwrite or trigger duplicate fulfillment
    if (previousStatus === 'PAID') return noopTransition(previousStatus, current);

    // If already in target status, return idempotently. A repeated PROCESSING
    // decision must not extend the recovery window.
    if (previousStatus === params.targetStatus) {
      return noopTransition(previousStatus, current);
    }

    // A failed or cancelled order only ever moves back to PAID (a late capture)
    // or stays put. Nothing may turn it into PENDING/PROCESSING and revive a
    // reservation whose stock has already gone back to the shelf.
    if (
      (previousStatus === 'FAILED' || previousStatus === 'CANCELLED')
      && params.targetStatus !== 'PAID'
    ) {
      return noopTransition(previousStatus, current);
    }

    const [clock] = await tx<{ now: Date }[]>`select now() as now`;
    const now = new Date(clock.now);
    const isBecomingPaid = params.targetStatus === 'PAID';
    const isDefinitiveFailure =
      params.targetStatus === 'FAILED' || params.targetStatus === 'CANCELLED';
    const wasUnpaid =
      previousStatus === 'CREATED'
      || previousStatus === 'PENDING'
      || previousStatus === 'PROCESSING';
    const reservation = current.reservationState;

    let nextReservation: ReservationState = reservation;
    let nextExpires = current.reservationExpiresAt;
    let nextDeadline = current.processingDeadline;
    let releaseAt: Date | null = null;
    let releaseReason = current.reservationReleasedReason;
    let releaseNow = false;

    if (isBecomingPaid) {
      nextDeadline = null;
      // A payment verified while the window is still held consumes it in
      // place: no stock movement, the claim simply becomes a sale.
      if (reservation === 'ACTIVE') nextReservation = 'CONSUMED';
    } else if (isDefinitiveFailure && wasUnpaid) {
      nextDeadline = null;
      if (reservation === 'ACTIVE') {
        if (policy.failureGraceSeconds > 0) {
          // Keep the units for the grace window. A customer retrying the card
          // in a second tab then finds the same stock still held, and a late
          // verified capture consumes it instead of racing a release.
          nextExpires = addSeconds(now, policy.failureGraceSeconds);
          nextReservation = 'ACTIVE';
        } else {
          releaseNow = true;
          nextReservation = 'RELEASED';
          releaseAt = now;
          releaseReason = params.targetStatus === 'FAILED'
            ? 'payment failed'
            : 'payment cancelled';
        }
      } else if (reservation === 'NONE') {
        // Legacy/POS rows have no timed hold and keep the original behaviour:
        // an unpaid failure gives the claim back immediately.
        releaseNow = true;
      }
    } else if (params.targetStatus === 'PROCESSING') {
      if (!nextDeadline) nextDeadline = addMinutes(now, policy.unresolvedMinutes);
      // An unresolved payment keeps its claim for the safe recovery window;
      // releasing it earlier could sell a unit the bank is about to debit.
      if (reservation === 'ACTIVE') nextExpires = nextDeadline;
    }

    if (params.preserveReservationWindow && nextReservation === 'ACTIVE') {
      nextExpires = current.reservationExpiresAt;
      nextDeadline = params.targetStatus === 'PROCESSING'
        ? current.processingDeadline ?? current.reservationExpiresAt
        : nextDeadline;
    }

    let nextReconcile: Date | null = current.nextReconcileAt;
    if (isBecomingPaid || releaseNow) {
      nextReconcile = null;
    } else if (nextReservation === 'ACTIVE' && nextExpires) {
      nextReconcile = nextExpires;
    } else if (params.targetStatus === 'PROCESSING' || params.targetStatus === 'PENDING') {
      nextReconcile = nextReconcileAt(current.reconcileAttempts, now);
    }

    const paidAt = isBecomingPaid ? now : (current.paidAt || null);
    const cancelledAt = params.targetStatus === 'CANCELLED' ? now : null;

    await tx`
      UPDATE orders
      SET
        status = ${params.targetStatus},
        payu_mihpayid = COALESCE(${params.mihpayid ?? null}, payu_mihpayid),
        payu_mode = COALESCE(${params.mode ?? null}, payu_mode),
        payu_raw_response = COALESCE(${params.rawResponse ? tx.json(safePaymentSummary(params.rawResponse)) : null}, payu_raw_response),
        paid_at = ${paidAt},
        cancelled_at = COALESCE(${cancelledAt}, cancelled_at),
        cancel_reason = COALESCE(${params.cancelReason ?? null}, cancel_reason),
        reservation_state = ${nextReservation},
        reservation_expires_at = ${nextExpires},
        reservation_released_at = COALESCE(${releaseAt}, reservation_released_at),
        reservation_released_reason = ${releaseNow ? releaseReason : current.reservationReleasedReason},
        processing_deadline = ${nextDeadline},
        next_reconcile_at = ${nextReconcile},
        updated_at = now()
      WHERE id = ${current.id}
    `;

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
        ${current.id},
        'payment',
        'payu',
        ${previousStatus},
        ${params.targetStatus},
        ${params.mihpayid ?? null},
        ${params.mode ?? null}
      )
    `;

    // The coupon use follows the stock hold: a paid order consumes it in
    // place; a release decided above gives it back. A duplicate callback finds
    // no RESERVED row and changes nothing.
    let couponReviewRequired = false;
    if (isBecomingPaid) {
      const restore = await restoreCouponAfterLatePayment(tx, current.id);
      if (restore === 'limit-unavailable') {
        couponReviewRequired = true;
      } else {
        await consumeCouponInTx(tx, current.id);
      }
    }

    // Only a release decided above moves stock here. A timed failure keeps its
    // claim until the grace deadline, which the reconciler enforces.
    let stockReleased = false;
    if (releaseNow) {
      stockReleased = await releaseClaimedStock(tx, current.id);
      await releaseCouponInTx(tx, current.id, releaseReason);
    }

    if (couponReviewRequired) {
      await tx`
        UPDATE orders
        SET payment_review_required = true,
            payment_review_reason = ${COUPON_LATE_REVIEW_REASON},
            updated_at = now()
        WHERE id = ${current.id}
      `;
    }

    // A payment that arrives after its units were given back must not silently
    // sell stock that is already on the shelf. Re-take exactly what the release
    // ledger returned; if any unit is gone, claim nothing, mark the payment as
    // captured and record a refund obligation for a human to settle.
    // Any capture whose claim is no longer ACTIVE is late: the units may have
    // gone back to the shelf through expiry, a failure grace, a staff cancel or
    // the end of the unresolved window. Re-take exactly what the ledger
    // released, whatever the previous status was.
    const isLatePaid =
      isBecomingPaid && reservation !== 'ACTIVE' && reservation !== 'CONSUMED';
    let stockReclaimed = false;
    let paymentReviewRequired = false;
    let refundObligationCreated = false;
    let refundObligationAmountPaise = 0;

    if (isLatePaid) {
      const released = await releasedClaimLines(tx, current.id);
      if (released.length > 0) {
        const reclaim = await reclaimReleasedStock(tx, current.id, released);
        stockReclaimed = reclaim.ok;
        if (reclaim.ok) {
          await tx`
            UPDATE orders
            SET reservation_state = 'CONSUMED', updated_at = now()
            WHERE id = ${current.id}
          `;
        } else {
          paymentReviewRequired = true;
          const amountPaise = Math.max(
            0,
            Math.round(Number(current.amount) * 100),
          );
          const obligation = await createRefundObligationInTx(tx, {
            orderId: current.id,
            amountPaise,
          });
          refundObligationCreated = obligation.created;
          refundObligationAmountPaise = obligation.amountPaise;
          await tx`
            UPDATE orders
            SET payment_review_required = true,
                payment_review_reason = ${LATE_PAYMENT_REVIEW_REASON},
                updated_at = now()
            WHERE id = ${current.id}
          `;
        }
      } else if (reservation === 'EXPIRED' || reservation === 'RELEASED') {
        // The state says released but the ledger has no release movement, so
        // there is nothing on the shelf to take back (an untracked line, for
        // example). Fulfilment is safe.
        await tx`
          UPDATE orders
          SET reservation_state = 'CONSUMED', updated_at = now()
          WHERE id = ${current.id}
        `;
      }
    }

    // A flagged late payment stays where it is for a human to handle; the
    // payment is captured, but auto-confirm must not pretend the stock exists.
    let fulfilmentSteps: FulfilmentStatus[] = [];
    if (isBecomingPaid && !paymentReviewRequired) {
      fulfilmentSteps = await applyPaidOrderAutomation(tx, current.id, currentFulfilment);
    }

    const finalRows = await tx<RawOrderRow[]>`
      SELECT * FROM orders WHERE id = ${current.id} LIMIT 1
    `;

    return {
      transitioned: true,
      previousStatus,
      order: mapRowToOrder(finalRows[0]),
      firstTimePaid: isBecomingPaid,
      stockReleased,
      stockReclaimed,
      paymentReviewRequired,
      couponReviewRequired,
      refundObligationCreated,
      refundObligationAmountPaise,
      fulfilmentSteps,
    };
  });
}

/* --------------------------------------------- durable reconcile queue */

export interface DueOrderClaimOptions {
  limit?: number;
  /** How long the claiming worker owns a row before it becomes due again. */
  leaseSeconds?: number;
  /** Legacy rows without a reservation become due after this much time. */
  legacyStaleMinutes?: number;
}

/**
 * Claim a bounded batch of orders that are due for a payment check.
 *
 * `FOR UPDATE SKIP LOCKED` makes this safe with several instances: each row is
 * handed to exactly one worker. The claim moves `next_reconcile_at` forward by
 * the lease, so a worker that crashes mid-verification does not strand the row
 * — it simply becomes due again after the lease instead of being lost.
 *
 * New flash-sale orders are due at their reservation deadline. Legacy rows
 * (no reservation, e.g. POS or pre-0037 web orders) keep the previous
 * "stale after N minutes" behaviour.
 */
export async function claimDueOrders(
  options: DueOrderClaimOptions = {},
  sqlOverride?: postgres.Sql,
): Promise<Order[]> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return [];

  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 200);
  const leaseSeconds = Math.min(Math.max(Math.trunc(options.leaseSeconds ?? 120), 30), 3600);
  const legacyStaleMinutes = Math.max(Math.trunc(options.legacyStaleMinutes ?? 15), 1);

  const rows = await sql.begin(async (tx) => {
    return await tx<RawOrderRow[]>`
      with due as (
        select id
        from orders
        where (
            status in ('CREATED', 'PENDING', 'PROCESSING')
            -- A failed/cancelled order can still hold its grace stock.
            or (status in ('FAILED', 'CANCELLED') and reservation_state = 'ACTIVE')
          )
          and coalesce(
            next_reconcile_at,
            reservation_expires_at,
            created_at + ${`${legacyStaleMinutes} minutes`}::interval
          ) <= now()
        order by coalesce(next_reconcile_at, reservation_expires_at, created_at) asc
        limit ${limit}
        for update skip locked
      )
      update orders o
      set next_reconcile_at = now() + ${`${leaseSeconds} seconds`}::interval,
          reconcile_attempts = o.reconcile_attempts + 1,
          last_reconcile_at = now()
      from due
      where o.id = due.id
      returning o.*
    `;
  });

  return rows.map(mapRowToOrder);
}

/** Store the next due time and the bounded-failure bookkeeping. */
export async function recordReconcileResult(
  input: {
    txnid: string;
    nextAt: Date | null;
    consecutiveFailures: number;
    error?: string;
  },
  sqlOverride?: postgres.Sql,
): Promise<void> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return;
  try {
    await sql`
      update orders
      set next_reconcile_at = ${input.nextAt},
          consecutive_reconcile_failures = ${Math.max(0, Math.trunc(input.consecutiveFailures))},
          last_reconcile_error = ${input.error ? 'Gateway verification or reconciliation unavailable.' : ''},
          last_reconcile_at = now()
      where txnid = ${input.txnid}
    `;
  } catch {
    console.warn('[payu] could not record a reconcile result');
  }
}

/** An unresolved payment that must be looked at by a human. */
export async function flagPaymentForReview(
  input: {
    txnid: string;
    reason: string;
  },
  sqlOverride?: postgres.Sql,
): Promise<void> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return;
  await sql`
    update orders
    set payment_review_required = true,
        payment_review_reason = ${input.reason.slice(0, 300)},
        reconciliation_flagged_at = coalesce(reconciliation_flagged_at, now()),
        updated_at = now()
    where txnid = ${input.txnid}
      and status in ('CREATED', 'PENDING', 'PROCESSING', 'PAID')
  `;
}

export interface ReservationReleaseResult {
  outcome: 'released' | 'already-released' | 'not-due' | 'paid' | 'not-found';
  order: Order | null;
  stockReleased: boolean;
  statusChanged: boolean;
}

/**
 * Return a due claim to the shelf exactly once.
 *
 * Used for two transitions:
 * - an unpaid window that closed (`EXPIRED`, the order becomes CANCELLED);
 * - the end of the failure grace (`RELEASED`, the order stays FAILED).
 *
 * The row lock makes this and a concurrent verified payment mutually
 * exclusive. A PAID order can never be expired here, and a second call sees a
 * non-ACTIVE reservation and does nothing.
 */
export async function releaseOrderReservation(
  input: {
    txnid: string;
    state: 'EXPIRED' | 'RELEASED';
    reason: string;
    cancelOrder?: boolean;
  },
  sqlOverride?: postgres.Sql,
): Promise<ReservationReleaseResult> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return { outcome: 'not-found', order: null, stockReleased: false, statusChanged: false };

  return await sql.begin(async (tx) => {
    const rows = await tx<RawOrderRow[]>`
      select * from orders where txnid = ${input.txnid} for update
    `;
    const row = rows[0];
    if (!row) {
      return { outcome: 'not-found' as const, order: null, stockReleased: false, statusChanged: false };
    }
    const current = mapRowToOrder(row);
    if (current.status === 'PAID') {
      return { outcome: 'paid' as const, order: current, stockReleased: false, statusChanged: false };
    }
    if (current.reservationState !== 'ACTIVE') {
      return {
        outcome: 'already-released' as const,
        order: current,
        stockReleased: false,
        statusChanged: false,
      };
    }
    const [clock] = await tx<{ now: Date }[]>`select now() as now`;
    if (
      current.reservationExpiresAt
      && current.reservationExpiresAt.getTime() > new Date(clock.now).getTime()
    ) {
      return { outcome: 'not-due' as const, order: current, stockReleased: false, statusChanged: false };
    }

    const stockReleased = await releaseClaimedStock(tx, current.id);
    await releaseCouponInTx(tx, current.id, input.reason);
    const nextStatus = input.cancelOrder
      && (current.status === 'CREATED' || current.status === 'PENDING' || current.status === 'PROCESSING')
      ? 'CANCELLED'
      : current.status;

    await tx`
      update orders
      set reservation_state = ${input.state},
          reservation_released_at = now(),
          reservation_released_reason = ${input.reason.slice(0, 300)},
          processing_deadline = null,
          next_reconcile_at = null,
          status = ${nextStatus},
          cancelled_at = case when ${nextStatus} = 'CANCELLED' then coalesce(cancelled_at, now()) else cancelled_at end,
          cancel_reason = case when ${nextStatus} = 'CANCELLED' then ${input.reason.slice(0, 300)} else cancel_reason end,
          updated_at = now()
      where id = ${current.id}
    `;

    const statusChanged = nextStatus !== current.status;
    if (statusChanged) {
      await tx`
        insert into order_status_history (order_id, domain, actor, from_status, to_status)
        values (${current.id}, 'payment', 'system', ${current.status}, ${nextStatus})
      `;
    }

    const finalRows = await tx<RawOrderRow[]>`
      select * from orders where id = ${current.id} limit 1
    `;
    return {
      outcome: 'released' as const,
      order: mapRaw(finalRows[0]),
      stockReleased,
      statusChanged,
    };
  });
}

function mapRaw(row: RawOrderRow | undefined): Order | null {
  return row ? mapRowToOrder(row) : null;
}

/**
 * An unexpired flash-sale hold for this customer, if any. Used by the initiate
 * route to refuse a second concurrent payment: each new request creates a new
 * order, so without this a customer could hoard several units by re-submitting
 * checkout. The reservation itself is never extended.
 */
export async function findActiveReservationForUser(
  userId: string,
  sqlOverride?: postgres.Sql,
): Promise<{
  txnid: string;
  status: OrderStatus;
  expiresAt: Date | null;
} | null> {
  const sql = sqlOverride ?? getSql();
  if (!sql) return null;
  try {
    const rows = await sql<Array<{ txnid: string; status: OrderStatus; reservation_expires_at: string | Date | null }>>`
      select txnid, status, reservation_expires_at
      from orders
      where user_id = ${userId}
        and reservation_state = 'ACTIVE'
        and status in ('CREATED', 'PENDING', 'PROCESSING')
        and reservation_expires_at > now()
      order by created_at desc
      limit 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      txnid: String(row.txnid),
      status: row.status,
      expiresAt: dateOrNull(row.reservation_expires_at),
    };
  } catch {
    return null;
  }
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
