import { getSql } from '@/lib/admin/db';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { randomBytes } from 'node:crypto';

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

  return {
    id: row.id,
    txnid: row.txnid,
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
  txnid: string;
  userId?: string | null;
  items: OrderItemSnapshot[];
  amount: number;
  currency?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
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

/**
 * Creates a new Order in 'CREATED' status.
 */
export async function createOrder(params: CreateOrderParams): Promise<Order> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');

  const id = `ord_${randomBytes(12).toString('hex')}`;
  const currency = params.currency || 'INR';

  return await sql.begin(async (tx) => {
    const rows = await tx<RawOrderRow[]>`
      INSERT INTO orders (
        id,
        txnid,
        user_id,
        items,
        amount,
        currency,
        status,
        customer_name,
        customer_email,
        customer_phone,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${params.txnid},
        ${params.userId ?? null},
        ${tx.json(params.items as any)},
        ${params.amount},
        ${currency},
        'CREATED',
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
    const itemLines = buildOrderItemLines(params.items);
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

    return mapRowToOrder(rows[0]);
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
}

export interface TransitionResult {
  transitioned: boolean;
  previousStatus: OrderStatus;
  order: Order;
  firstTimePaid: boolean;
}

/**
 * Transitions order status idempotently and atomically with row locking.
 * Returns firstTimePaid=true only if this call moved the order from non-PAID to PAID.
 */
export async function transitionOrderStatus(params: TransitionStatusParams): Promise<TransitionResult> {
  const sql = getSql();
  if (!sql) throw new Error('Database is not configured.');

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

    // If order is already PAID, do not overwrite or trigger duplicate fulfillment
    if (previousStatus === 'PAID') {
      return {
        transitioned: false,
        previousStatus,
        order: current,
        firstTimePaid: false,
      };
    }

    // If already in target status, return idempotently
    if (previousStatus === params.targetStatus) {
      return {
        transitioned: false,
        previousStatus,
        order: current,
        firstTimePaid: false,
      };
    }

    const isBecomingPaid = params.targetStatus === 'PAID';
    const paidAt = isBecomingPaid ? new Date() : (current.paidAt || null);

    const updatedRows = await tx<RawOrderRow[]>`
      UPDATE orders
      SET
        status = ${params.targetStatus},
        payu_mihpayid = COALESCE(${params.mihpayid ?? null}, payu_mihpayid),
        payu_mode = COALESCE(${params.mode ?? null}, payu_mode),
        payu_raw_response = COALESCE(${params.rawResponse ? tx.json(params.rawResponse as any) : null}, payu_raw_response),
        paid_at = ${paidAt},
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

    return {
      transitioned: true,
      previousStatus,
      order: updated,
      firstTimePaid: isBecomingPaid,
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
