import { getSql } from '@/lib/platform/db';
import { formatPaise, getStorefrontProduct, getStorefrontProducts, type StorefrontProduct } from '@/lib/catalog/storefront';
import { getProductImage, getProductFromCatalog } from '@/lib/payu/catalog';
import { readSaleState } from '@/lib/storefront/sale-state';
import { hasShipmentStarted } from '@/lib/orders/fulfilment';
import { isBuyAgainVisible, selectBuyAgainProductIds } from './buy-again-rules';
import { isWithinReturnWindow } from './rules';
import { readReturnWindowDays } from './return-window';
import {
  toAccountOrderStatus,
  toDeliverySnapshot,
  toRefundSnapshots,
  toRequestSnapshots,
  type AccountOrderLiveStatus,
  type AccountOrderRefundSnapshot,
  type AccountOrderRequestSnapshot,
  type AccountOrderStatus,
} from './order-live';

export type { AccountOrderStatus } from './order-live';

export interface AccountOrderListItem {
  txnid: string;
  status: AccountOrderStatus;
  paymentStatus: string;
  amount: number;
  currency: string;
  /** Money breakdown in paise; total matches the amount PayU charged. */
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  couponCode: string | null;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
  refundCount: number;
}

export interface AccountOrderItem {
  id: string;
  name: string;
  variantId?: string | null;
  variantSku?: string | null;
  variantLabel?: string | null;
  /** The exact option and photo as they were when the order was placed. */
  deviceModelName?: string | null;
  colourName?: string | null;
  colourHex?: string | null;
  imageAlt?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  image: string | null;
}

export interface AccountOrderAddress {
  name: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

export interface AccountOrderDetail extends AccountOrderListItem {
  id: string;
  fulfilmentStatus: string;
  deliveryMethod: string | null;
  deliveryStatus: string | null;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  deliveredAt: Date | null;
  scheduledFor: string | null;
  deliverySlot: string | null;
  address: AccountOrderAddress | null;
  items: AccountOrderItem[];
  history: Array<{ domain: string; fromStatus: string | null; toStatus: string; createdAt: Date }>;
  requests: AccountOrderRequestSnapshot[];
  refunds: AccountOrderRefundSnapshot[];
  refundedPaise: number;
  canRequestCancellation: boolean;
  canRequestReturn: boolean;
  /** The same customer-safe snapshot the live endpoint returns. */
  live: AccountOrderLiveStatus;
}

type OrderRow = {
  id: string;
  txnid: string;
  user_id: string;
  items: unknown;
  amount: string | number;
  currency: string;
  status: string;
  fulfilment_status: string;
  sale_state: string;
  subtotal_paise: string | number | null;
  discount_paise: string | number | null;
  shipping_paise: string | number | null;
  total_paise: string | number | null;
  coupon_code: string | null;
  refund_count: string | number | null;
  created_at: string | Date;
  updated_at: string | Date;
};

function paise(value: unknown, fallbackRupees: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : Math.round(fallbackRupees * 100);
}

function moneyFields(row: OrderRow) {
  const amountRupees = Number(row.amount) || 0;
  const totalPaise = paise(row.total_paise, amountRupees);
  return {
    subtotalPaise: paise(row.subtotal_paise, totalPaise / 100),
    discountPaise: Math.max(0, paise(row.discount_paise, 0)),
    shippingPaise: Math.max(0, paise(row.shipping_paise, 0)),
    totalPaise,
    couponCode: row.coupon_code ? String(row.coupon_code) : null,
  };
}

type ItemRow = {
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_sku: string | null;
  variant_label: string | null;
  quantity: number;
  unit_price_paise: string | number;
  line_total_paise: string | number;
  /** 0061 snapshots; null on orders placed before the columns existed. */
  variant_device_model_name: string | null;
  variant_colour_name: string | null;
  variant_colour_hex: string | null;
  image_url: string | null;
  image_alt: string | null;
};

function parseItems(value: unknown): Array<Omit<AccountOrderItem, 'image'>> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const name = typeof row.name === 'string' ? row.name : '';
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    const totalPrice = Number(row.totalPrice);
    if (!id || !name || !Number.isFinite(quantity) || !Number.isFinite(unitPrice) || !Number.isFinite(totalPrice)) return [];
    return [{ id, name, quantity, unitPrice, totalPrice,
      variantId: typeof row.variantId === 'string' ? row.variantId : null,
      variantSku: typeof row.variantSku === 'string' ? row.variantSku : null,
      variantLabel: typeof row.variantLabel === 'string' ? row.variantLabel : null }];
  });
}

function mapItems(rows: ItemRow[], snapshot: unknown): AccountOrderItem[] {
  const parsed = rows.length > 0
    ? rows.map((row) => ({
        id: row.product_id,
        name: row.product_name,
        variantId: row.variant_id,
        variantSku: row.variant_sku,
        variantLabel: row.variant_label,
        deviceModelName: row.variant_device_model_name,
        colourName: row.variant_colour_name,
        colourHex: row.variant_colour_hex,
        imageAlt: row.image_alt,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price_paise) / 100,
        totalPrice: Number(row.line_total_paise) / 100,
        imageUrl: row.image_url,
      }))
    : parseItems(snapshot);
  return parsed.map((item): AccountOrderItem => {
    const snapshotImage = 'imageUrl' in item && typeof item.imageUrl === 'string' ? item.imageUrl : null;
    return {
      ...item,
      // The ordered photo is the snapshot; old orders fall back to the catalogue.
      image: snapshotImage || getProductImage(item.id),
    };
  });
}

function countItems(snapshot: unknown): number {
  return parseItems(snapshot).reduce((sum, item) => sum + item.quantity, 0);
}

function toDate(value: unknown): Date {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  return new Date(Number.isFinite(parsed) ? parsed : 0);
}

function mapListItem(row: OrderRow): AccountOrderListItem {
  return {
    txnid: row.txnid,
    status: toAccountOrderStatus(row.sale_state),
    paymentStatus: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    ...moneyFields(row),
    itemCount: countItems(row.items),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    refundCount: Math.max(0, Math.floor(Number(row.refund_count) || 0)),
  };
}

export interface ListOrdersOptions {
  page?: number;
  status?: string;
  search?: string;
}

export async function listCustomerOrders(userId: string, options: ListOrdersOptions = {}) {
  const sql = getSql();
  if (!sql) return { orders: [] as AccountOrderListItem[], page: 1, totalPages: 0, total: 0 };
  const page = Math.max(1, Math.floor(Number(options.page || 1)));
  const limit = 10;
  const offset = (page - 1) * limit;
  const status = String(options.status || 'ALL').toUpperCase();
  const search = String(options.search || '').trim().slice(0, 64);
  const rows = await sql<OrderRow[]>`
    select id, txnid, user_id, items, amount, currency, status, fulfilment_status, sale_state,
           subtotal_paise, discount_paise, shipping_paise, total_paise, coupon_code,
           refund_count, created_at, updated_at
    from order_sale_state
    where user_id = ${userId}
      and (${status === 'ALL'} or sale_state = ${status})
      and (${search === ''} or txnid ilike ${`%${search}%`})
    order by created_at desc
    limit ${limit} offset ${offset}
  `;
  const countRows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from order_sale_state
    where user_id = ${userId}
      and (${status === 'ALL'} or sale_state = ${status})
      and (${search === ''} or txnid ilike ${`%${search}%`})
  `;
  const total = Number(countRows[0]?.count || 0);
  return {
    orders: rows.map(mapListItem),
    page,
    totalPages: Math.ceil(total / limit),
    total,
  };
}

export async function getLatestCustomerOrder(userId: string): Promise<AccountOrderListItem | null> {
  const result = await listCustomerOrders(userId, { page: 1 });
  return result.orders[0] || null;
}

type RequestRow = {
  id: string;
  type: string;
  status: string;
  created_at: string | Date;
  updated_at: string | Date;
};

type RefundRow = {
  id: string;
  amount_paise: string | number;
  currency: string;
  method: string;
  status: string;
  created_at: string | Date;
};

type DeliveryRow = {
  status: string;
  delivery_method: string | null;
  courier_name: string | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  delivered_at: string | Date | null;
  scheduled_for: string | Date | null;
  delivery_slot: string | null;
};

/**
 * The live snapshot in ONE query: the order, its delivery row, its requests
 * and its refunds are aggregated in SQL so a 30-second poll never fans out
 * into four connections on the 15-client session pooler.
 *
 * The payload is deliberately narrow — no address, no items, no money beyond
 * refunds. Only what a chip, a tracking link and request/refund state need.
 */
export async function getCustomerOrderLiveStatus(
  userId: string,
  txnid: string,
): Promise<AccountOrderLiveStatus | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<Array<{
    txnid: string;
    status: string;
    fulfilment_status: string;
    sale_state: string;
    updated_at: string | Date;
    delivery: unknown;
    shipment_history_status: string | null;
    requests: unknown;
    refunds: unknown;
  }>>`
    select s.txnid, s.status, s.fulfilment_status, s.sale_state, s.updated_at,
           (
             select h.to_status from order_status_history h
             where h.order_id = s.id and h.domain = 'fulfilment'
               and h.to_status in ('ON_THE_WAY', 'DELIVERED')
             limit 1
           ) as shipment_history_status,
           (
             select to_jsonb(d)
             from (
               select status, delivery_method, courier_name, carrier,
                      tracking_number, tracking_url, scheduled_for, delivered_at,
                      s.delivery_slot
               from order_deliveries
               where order_id = s.id
               limit 1
             ) d
           ) as delivery,
           coalesce((
             select jsonb_agg(to_jsonb(r) order by r.created_at desc)
             from (
               select id, type, status, created_at, updated_at
               from order_requests
               where order_id = s.id
               order by created_at desc
               limit 20
             ) r
           ), '[]'::jsonb) as requests,
           coalesce((
             select jsonb_agg(to_jsonb(f) order by f.created_at desc)
             from (
               select id, amount_paise, currency, method, status, created_at
               from refunds
               where order_id = s.id
               order by created_at desc
               limit 20
             ) f
           ), '[]'::jsonb) as refunds
    from order_sale_state s
    where s.txnid = ${txnid} and s.user_id = ${userId}
    limit 1
  `;
  const order = rows[0];
  if (!order) return null;

  return {
    txnid: order.txnid,
    status: toAccountOrderStatus(order.sale_state),
    paymentStatus: order.status,
    fulfilmentStatus: order.fulfilment_status || 'PENDING',
    updatedAt: toDate(order.updated_at).toISOString(),
    delivery: toDeliverySnapshot(order.delivery, hasShipmentStarted(order.fulfilment_status, [
      { domain: 'fulfilment', toStatus: order.shipment_history_status },
    ])),
    requests: toRequestSnapshots(order.requests),
    refunds: toRefundSnapshots(order.refunds),
  };
}

export async function getCustomerOrderDetail(userId: string, txnid: string): Promise<AccountOrderDetail | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<OrderRow[]>`
    select id, txnid, user_id, items, amount, currency, status, fulfilment_status, sale_state,
           subtotal_paise, discount_paise, shipping_paise, total_paise, coupon_code,
           refund_count, created_at, updated_at
    from order_sale_state
    where txnid = ${txnid} and user_id = ${userId}
    limit 1
  `;
  const order = rows[0];
  if (!order) return null;

  const itemRows = await sql<ItemRow[]>`
    select product_id, product_name, variant_id, variant_sku, variant_label, quantity, unit_price_paise, line_total_paise,
           to_jsonb(order_items)->>'variant_device_model_name' as variant_device_model_name,
           to_jsonb(order_items)->>'variant_colour_name' as variant_colour_name,
           to_jsonb(order_items)->>'variant_colour_hex' as variant_colour_hex,
           to_jsonb(order_items)->>'image_url' as image_url,
           to_jsonb(order_items)->>'image_alt' as image_alt
    from order_items where order_id = ${order.id} order by line_number asc
  `;
  const addressRows = await sql<Array<{
    full_name: string; phone: string; line1: string; line2: string | null; city: string; state: string; postal_code: string;
  }>>`
    select full_name, phone, line1, line2, city, state, postal_code
    from order_addresses where order_id = ${order.id} and address_type = 'shipping' limit 1
  `;
  const deliveryRows = await sql<DeliveryRow[]>`
    select d.status, d.delivery_method, d.courier_name, d.carrier,
           d.tracking_number, d.tracking_url, d.delivered_at, d.scheduled_for, o.delivery_slot
    from order_deliveries d join orders o on o.id = d.order_id
    where d.order_id = ${order.id} limit 1
  `;
  const historyRows = await sql<Array<{ domain: string; from_status: string | null; to_status: string; created_at: string | Date }>>`
    select domain, from_status, to_status, created_at
    from order_status_history where order_id = ${order.id}
    order by created_at asc, id asc
  `;
  const requestRows = await sql<RequestRow[]>`
    select id, type, status, created_at, updated_at
    from order_requests where order_id = ${order.id}
    order by created_at desc
    limit 20
  `;
  const refundRows = await sql<RefundRow[]>`
    select id, amount_paise, currency, method, status, created_at
    from refunds where order_id = ${order.id}
    order by created_at desc
    limit 20
  `;
  const refundTotalRows = await sql`select coalesce(sum(amount_paise),0)::text as total from refunds where order_id=${order.id}`;
  const fulfilmentStatus = order.fulfilment_status || 'PENDING';
  const shipmentStarted = hasShipmentStarted(fulfilmentStatus, historyRows);
  const delivery = toDeliverySnapshot(deliveryRows[0], shipmentStarted);
  const deliveredHistory = historyRows.find((row) => row.domain === 'fulfilment' && row.to_status === 'DELIVERED');
  const deliveredAt = shipmentStarted
    ? delivery?.deliveredAt
      ? new Date(delivery.deliveredAt)
      : deliveredHistory ? new Date(deliveredHistory.created_at) : null
    : null;
  const returnWindowDays = await readReturnWindowDays();
  const requests = toRequestSnapshots(requestRows);
  const refunds = toRefundSnapshots(refundRows);
  const base = mapListItem(order);
  return {
    ...base,
    id: order.id,
    fulfilmentStatus,
    deliveredAt,
    deliveryMethod: delivery?.method ?? null,
    deliveryStatus: delivery?.status ?? null,
    courier: delivery?.carrier ?? null,
    trackingNumber: delivery?.trackingNumber ?? null,
    trackingUrl: delivery?.trackingUrl ?? null,
    scheduledFor: delivery?.scheduledFor ?? null,
    deliverySlot: delivery?.deliverySlot ?? null,
    address: addressRows[0]
      ? {
          name: addressRows[0].full_name,
          phone: addressRows[0].phone,
          line1: addressRows[0].line1,
          line2: addressRows[0].line2 || '',
          city: addressRows[0].city,
          state: addressRows[0].state,
          pincode: addressRows[0].postal_code,
        }
      : null,
    items: mapItems(itemRows, order.items),
    history: historyRows.map((row) => ({
      domain: row.domain,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      createdAt: new Date(row.created_at),
    })),
    requests,
    refunds,
    refundedPaise: Number(refundTotalRows[0]?.total) || 0,
    canRequestCancellation: fulfilmentStatus === 'PENDING' || fulfilmentStatus === 'ACCEPTED',
    canRequestReturn: fulfilmentStatus === 'DELIVERED' && isWithinReturnWindow(deliveredAt, new Date(), returnWindowDays),
    live: {
      txnid: order.txnid,
      status: base.status,
      paymentStatus: order.status,
      fulfilmentStatus,
      updatedAt: base.updatedAt.toISOString(),
      delivery,
      requests,
      refunds,
    },
  };
}

/* ------------------------------------------------------------ buy again */

export interface BuyAgainItem {
  id: string;
  name: string;
  subtitle: string;
  image: string;
  href: string;
  pricePaise: number;
  priceDisplay: string;
  regularPricePaise: number;
  wasPriceDisplay: string | null;
  onSale: boolean;
  inStock: boolean;
  inventoryMode: NonNullable<StorefrontProduct['inventoryMode']>;
  lastOrderedAt: Date;
}

function toBuyAgainItem(
  product: StorefrontProduct,
  lastOrderedAt: Date,
): BuyAgainItem {
  return {
    id: product.id,
    name: product.name,
    subtitle: product.subtitle,
    image: product.image,
    href: product.href,
    pricePaise: product.pricePaise,
    priceDisplay: product.priceDisplay,
    regularPricePaise: product.regularPricePaise,
    wasPriceDisplay: product.onSale ? formatPaise(product.regularPricePaise) : null,
    onSale: product.onSale,
    inStock: product.inStock,
    inventoryMode: product.inventoryMode ?? 'product',
    lastOrderedAt,
  };
}

/**
 * The products this customer bought before that are still sellable.
 *
 * One grouped query for the ids, then the ordinary storefront read (which
 * already resolves the live sale price and drops archived/deleted/inactive
 * rows). Normal mode hides sold-out items; sale mode shows everything.
 */
export async function listBuyAgainProducts(userId: string): Promise<BuyAgainItem[]> {
  const sql = getSql();
  if (!sql) return [];
  const rows = await sql<Array<{ product_id: string; last_ordered_at: string | Date }>>`
    select oi.product_id, max(o.created_at) as last_ordered_at
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.user_id = ${userId}
      and o.status = 'PAID'
      and oi.product_id <> ''
    group by oi.product_id
    order by max(o.created_at) desc
    limit 40
  `;
  const ids = selectBuyAgainProductIds(rows, 40);
  if (ids.length === 0) return [];

  const [products, sale] = await Promise.all([getStorefrontProducts(ids), readSaleState()]);
  const orderedAt = new Map(rows.map((row) => [row.product_id, toDate(row.last_ordered_at)]));
  return products
    .filter((product) => isBuyAgainVisible(product, sale.live))
    .slice(0, 8)
    .map((product) => toBuyAgainItem(product, orderedAt.get(product.id) ?? new Date(0)));
}

/**
 * Click-time re-check for a Buy again card. The product must appear in this
 * customer's own paid order history, so the endpoint cannot be used as a
 * general product-price probe against another customer's data.
 */
export async function getBuyAgainProduct(
  userId: string,
  productId: string,
): Promise<BuyAgainItem | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<Array<{ last_ordered_at: string | Date }>>`
    select max(o.created_at) as last_ordered_at
    from order_items oi
    join orders o on o.id = oi.order_id
    where o.user_id = ${userId}
      and o.status = 'PAID'
      and oi.product_id = ${productId}
    limit 1
  `;
  if (!rows[0]) return null;
  const product = await getStorefrontProduct(productId);
  if (!product) return null;
  return toBuyAgainItem(product, toDate(rows[0].last_ordered_at));
}

export function getAccountItemFallbackImage(id: string): string | null {
  return getProductFromCatalog(id) ? getProductImage(id) : null;
}