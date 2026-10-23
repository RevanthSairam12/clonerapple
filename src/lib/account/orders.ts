import { getSql } from '@/lib/admin/db';
import { getProductImage, getProductFromCatalog } from '@/lib/payu/catalog';
import { isWithinReturnWindow } from './rules';
import { RETURN_WINDOW_DAYS } from './config';

export type AccountOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELED'
  | 'PAYMENT_FAILED';

export interface AccountOrderListItem {
  txnid: string;
  status: AccountOrderStatus;
  paymentStatus: string;
  amount: number;
  currency: string;
  itemCount: number;
  createdAt: Date;
}

export interface AccountOrderItem {
  id: string;
  name: string;
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
  courier: string | null;
  trackingUrl: string | null;
  deliveredAt: Date | null;
  address: AccountOrderAddress | null;
  items: AccountOrderItem[];
  history: Array<{ domain: string; fromStatus: string | null; toStatus: string; createdAt: Date }>;
  canRequestCancellation: boolean;
  canRequestReturn: boolean;
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
  sale_state: AccountOrderStatus;
  created_at: string | Date;
};

type ItemRow = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price_paise: string | number;
  line_total_paise: string | number;
};

function parseItems(value: unknown): Array<{ id: string; name: string; quantity: number; unitPrice: number; totalPrice: number }> {
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
    return [{ id, name, quantity, unitPrice, totalPrice }];
  });
}

function mapItems(rows: ItemRow[], snapshot: unknown): AccountOrderItem[] {
  const parsed = rows.length > 0
    ? rows.map((row) => ({
        id: row.product_id,
        name: row.product_name,
        quantity: Number(row.quantity),
        unitPrice: Number(row.unit_price_paise) / 100,
        totalPrice: Number(row.line_total_paise) / 100,
      }))
    : parseItems(snapshot);
  return parsed.map((item) => ({
    ...item,
    image: getProductImage(item.id),
  }));
}

function countItems(snapshot: unknown): number {
  return parseItems(snapshot).reduce((sum, item) => sum + item.quantity, 0);
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
    select id, txnid, user_id, items, amount, currency, status, fulfilment_status, sale_state, created_at
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
    orders: rows.map((row) => ({
      txnid: row.txnid,
      status: row.sale_state,
      paymentStatus: row.status,
      amount: Number(row.amount),
      currency: row.currency,
      itemCount: countItems(row.items),
      createdAt: new Date(row.created_at),
    })),
    page,
    totalPages: Math.ceil(total / limit),
    total,
  };
}

export async function getLatestCustomerOrder(userId: string): Promise<AccountOrderListItem | null> {
  const result = await listCustomerOrders(userId, { page: 1 });
  return result.orders[0] || null;
}

export async function getCustomerOrderDetail(userId: string, txnid: string): Promise<AccountOrderDetail | null> {
  const sql = getSql();
  if (!sql) return null;
  const rows = await sql<OrderRow[]>`
    select id, txnid, user_id, items, amount, currency, status, fulfilment_status, sale_state, created_at
    from order_sale_state
    where txnid = ${txnid} and user_id = ${userId}
    limit 1
  `;
  const order = rows[0];
  if (!order) return null;

  const itemRows = await sql<ItemRow[]>`
    select product_id, product_name, quantity, unit_price_paise, line_total_paise
    from order_items where order_id = ${order.id} order by line_number asc
  `;
  const addressRows = await sql<Array<{
    full_name: string; phone: string; line1: string; line2: string | null; city: string; state: string; postal_code: string;
  }>>`
    select full_name, phone, line1, line2, city, state, postal_code
    from order_addresses where order_id = ${order.id} and address_type = 'shipping' limit 1
  `;
  const deliveryRows = await sql<Array<{
    delivery_method: string | null; courier_name: string | null; carrier: string | null; tracking_url: string | null; delivered_at: string | Date | null;
  }>>`
    select delivery_method, courier_name, carrier, tracking_url, delivered_at
    from order_deliveries where order_id = ${order.id} limit 1
  `;
  const historyRows = await sql<Array<{ domain: string; from_status: string | null; to_status: string; created_at: string | Date }>>`
    select domain, from_status, to_status, created_at
    from order_status_history where order_id = ${order.id}
    order by created_at asc, id asc
  `;
  const delivery = deliveryRows[0];
  const deliveredHistory = historyRows.find((row) => row.to_status === 'DELIVERED');
  const deliveredAt = delivery?.delivered_at
    ? new Date(delivery.delivered_at)
    : deliveredHistory
      ? new Date(deliveredHistory.created_at)
      : null;
  const fulfilmentStatus = order.fulfilment_status || 'PENDING';
  return {
    txnid: order.txnid,
    id: order.id,
    status: order.sale_state,
    paymentStatus: order.status,
    fulfilmentStatus,
    amount: Number(order.amount),
    currency: order.currency,
    itemCount: countItems(order.items),
    createdAt: new Date(order.created_at),
    deliveredAt,
    deliveryMethod: delivery?.delivery_method || null,
    courier: delivery?.courier_name || delivery?.carrier || null,
    trackingUrl: delivery?.tracking_url || null,
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
    canRequestCancellation: fulfilmentStatus === 'PENDING' || fulfilmentStatus === 'ACCEPTED',
    canRequestReturn: fulfilmentStatus === 'DELIVERED' && isWithinReturnWindow(deliveredAt, new Date(), RETURN_WINDOW_DAYS),
  };
}

export function getAccountItemFallbackImage(id: string): string | null {
  return getProductFromCatalog(id) ? getProductImage(id) : null;
}
