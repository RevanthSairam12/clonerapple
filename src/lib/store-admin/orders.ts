import { getSql } from '../admin/db';

import { maskCustomerEmail, maskCustomerPhone } from './masking';
import {
  buildTrackingUrl,
  type DeliveryInput,
  type DeliveryMethod,
  type DeliverySlot,
  validateDeliveryDetailsForOnTheWay,
} from './delivery';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Store-admin order repository must be server-only.');
}

export const ORDERS_PAGE_SIZE = 25;

export type SaleState =
  | 'REFUNDED'
  | 'PAYMENT_FAILED'
  | 'CANCELED'
  | 'DELIVERED'
  | 'ON_THE_WAY'
  | 'PROCESSING'
  | 'SCHEDULED'
  | 'ACCEPTED'
  | 'PENDING';

export type FulfilmentStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'ON_THE_WAY'
  | 'DELIVERED'
  | 'CANCELED';

export const SALE_STATES: readonly SaleState[] = [
  'REFUNDED',
  'PAYMENT_FAILED',
  'CANCELED',
  'DELIVERED',
  'ON_THE_WAY',
  'PROCESSING',
  'SCHEDULED',
  'ACCEPTED',
  'PENDING',
];

export type OrderSort = 'newest' | 'oldest' | 'amount-desc' | 'amount-asc';

export const ORDER_SORTS: readonly OrderSort[] = [
  'newest',
  'oldest',
  'amount-desc',
  'amount-asc',
];

export function isOrderSort(value: unknown): value is OrderSort {
  return typeof value === 'string' && (ORDER_SORTS as readonly string[]).includes(value);
}

export const FULFILMENT_TRANSITIONS: Readonly<
  Record<FulfilmentStatus, readonly FulfilmentStatus[]>
> = {
  PENDING: ['ACCEPTED', 'CANCELED'],
  ACCEPTED: ['PROCESSING', 'CANCELED'],
  PROCESSING: ['ON_THE_WAY', 'CANCELED'],
  ON_THE_WAY: ['DELIVERED', 'CANCELED'],
  DELIVERED: [],
  CANCELED: [],
};

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  const result = iso(value);
  return result || null;
}

function number(value: unknown): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(number(value)));
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseItems(value: unknown): OrderItem[] {
  let source: unknown = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source.map((item, index) => {
    const row = jsonObject(item);
    const quantity = integer(row.quantity) || 1;
    const unitPricePaise =
      row.unit_price_paise !== undefined
        ? integer(row.unit_price_paise)
        : Math.round(number(row.unitPrice) * 100);
    const lineTotalPaise =
      row.line_total_paise !== undefined
        ? integer(row.line_total_paise)
        : Math.round(number(row.totalPrice ?? row.lineTotal) * 100);
    return {
      lineNumber: integer(row.line_number) || index + 1,
      productId: text(row.product_id ?? row.id),
      productName: text(row.product_name ?? row.name),
      quantity,
      unitPricePaise,
      lineTotalPaise,
      currency: text(row.currency) || 'INR',
    };
  });
}

export function maskCustomerName(value: unknown): string {
  const parts = text(value).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '[redacted name]';
  return parts.map((part) => `${part.slice(0, 1)}***`).join(' ');
}

function maskAddressPart(value: unknown): string {
  return text(value).trim() ? '[redacted]' : '';
}

export function maskCustomerAddress(row: Row): OrderAddress {
  return {
    type: text(row.address_type) || 'shipping',
    fullName: maskCustomerName(row.full_name),
    phoneMasked: maskCustomerPhone(text(row.phone)),
    line1: maskAddressPart(row.line1),
    line2: text(row.line2).trim() ? '[redacted]' : null,
    city: maskAddressPart(row.city),
    state: maskAddressPart(row.state),
    postalCode: maskAddressPart(row.postal_code),
    country: text(row.country) || 'IN',
  };
}

/** The migration's precedence, kept pure for tests and non-SQL callers. */
export function mapSaleState(input: {
  paymentStatus?: unknown;
  fulfilmentStatus?: unknown;
  scheduledFor?: unknown;
  refundCount?: unknown;
  refunded?: boolean;
}): SaleState {
  const paymentStatus = text(input.paymentStatus).toUpperCase();
  const fulfilmentStatus = text(input.fulfilmentStatus).toUpperCase();
  if (input.refunded || number(input.refundCount) > 0) return 'REFUNDED';
  if (paymentStatus === 'FAILED') return 'PAYMENT_FAILED';
  if (paymentStatus === 'CANCELLED' || fulfilmentStatus === 'CANCELED') return 'CANCELED';
  if (fulfilmentStatus === 'DELIVERED') return 'DELIVERED';
  if (fulfilmentStatus === 'ON_THE_WAY') return 'ON_THE_WAY';
  if (fulfilmentStatus === 'PROCESSING') return 'PROCESSING';
  if (
    Boolean(input.scheduledFor) &&
    (fulfilmentStatus === 'PENDING' || fulfilmentStatus === 'ACCEPTED')
  ) {
    return 'SCHEDULED';
  }
  if (fulfilmentStatus === 'ACCEPTED') return 'ACCEPTED';
  return 'PENDING';
}

export function isSaleState(value: unknown): value is SaleState {
  return typeof value === 'string' && (SALE_STATES as readonly string[]).includes(value);
}

export function isFulfilmentStatus(value: unknown): value is FulfilmentStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FULFILMENT_TRANSITIONS, value)
  );
}

export type TransitionValidation =
  | { ok: true }
  | {
      ok: false;
      code: 'invalid-transition' | 'payment-required' | 'owner-required';
      error: string;
    };

export function validateFulfilmentTransition(input: {
  current: FulfilmentStatus;
  target: FulfilmentStatus;
  paymentStatus: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
}): TransitionValidation {
  if (!FULFILMENT_TRANSITIONS[input.current].includes(input.target)) {
    return {
      ok: false,
      code: 'invalid-transition',
      error: `Cannot move fulfilment from ${input.current} to ${input.target}.`,
    };
  }
  if (input.target === 'ACCEPTED' && input.paymentStatus !== 'PAID') {
    return {
      ok: false,
      code: 'payment-required',
      error: 'Only paid orders can be accepted for fulfilment.',
    };
  }
  if (input.current === 'ON_THE_WAY' && input.target === 'CANCELED' && input.role !== 'store_owner') {
    return {
      ok: false,
      code: 'owner-required',
      error: 'Only a store owner can cancel an order that is on the way.',
    };
  }
  return { ok: true };
}

export interface OrderItem {
  lineNumber: number;
  productId: string;
  productName: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  currency: string;
}

export interface OrderAddress {
  type: string;
  fullName: string;
  phoneMasked: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface DeliveryEvent {
  id: string;
  eventType: string;
  status: string | null;
  eventAt: string;
  details: Record<string, unknown>;
}

export interface OrderDelivery {
  id: string;
  status: FulfilmentStatus;
  method: DeliveryMethod | null;
  personName: string | null;
  personPhone: string | null;
  personPhoneMasked: string | null;
  courierName: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  scheduledFor: string | null;
  deliverySlot: DeliverySlot | null;
  deliveredAt: string | null;
  events: DeliveryEvent[];
}

export interface OrderHistoryEntry {
  id: string;
  domain: string;
  actor: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: string;
}

export interface OrderCustomer {
  nameMasked: string;
  emailMasked: string;
  phoneMasked: string;
}

export interface OrderSummary {
  id: string;
  txnid: string;
  customer: OrderCustomer;
  saleState: SaleState;
  paymentStatus: string;
  fulfilmentStatus: FulfilmentStatus;
  channel: string;
  amount: number;
  currency: string;
  totalPaise: number;
  scheduledFor: string | null;
  deliverySlot: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

export interface OrderListData {
  orders: OrderSummary[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
  state: SaleState | null;
  dateFrom: string | null;
  dateTo: string | null;
  counts: Record<SaleState, number>;
}

export interface OrderDetail extends OrderSummary {
  items: OrderItem[];
  addresses: OrderAddress[];
  history: OrderHistoryEntry[];
  delivery: OrderDelivery | null;
  /** Money breakdown. Zero for rows created before migration 0014 gained them. */
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  couponCode: string | null;
  paymentMethod: string | null;
}

export type OrderLoad<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'unavailable' | 'not-found' };

function emptyCounts(): Record<SaleState, number> {
  return Object.fromEntries(SALE_STATES.map((state) => [state, 0])) as Record<
    SaleState,
    number
  >;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function summaryFromRow(row: Row): OrderSummary {
  const fulfilmentStatus = isFulfilmentStatus(row.fulfilment_status)
    ? row.fulfilment_status
    : 'PENDING';
  const saleState = isSaleState(row.sale_state)
    ? row.sale_state
    : mapSaleState({
        paymentStatus: row.status,
        fulfilmentStatus,
        scheduledFor: row.scheduled_for,
        refundCount: row.refund_count,
      });
  return {
    id: text(row.id),
    txnid: text(row.txnid),
    customer: {
      nameMasked: maskCustomerName(row.customer_name),
      emailMasked: maskCustomerEmail(text(row.customer_email)),
      phoneMasked: maskCustomerPhone(text(row.customer_phone)),
    },
    saleState,
    paymentStatus: text(row.status),
    fulfilmentStatus,
    channel: text(row.channel) || 'web',
    amount: number(row.amount),
    currency: text(row.currency) || 'INR',
    totalPaise: integer(row.total_paise),
    scheduledFor: nullableIso(row.scheduled_for),
    deliverySlot: nullableText(row.delivery_slot),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    paidAt: nullableIso(row.paid_at),
  };
}

function queryParts(options: {
  query: string;
  state: SaleState | null;
  dateFrom: string | null;
  dateTo: string | null;
}) {
  const pattern = `%${escapeLike(options.query)}%`;
  return { pattern };
}

export async function listOrders(options: {
  query?: string;
  state?: SaleState | null;
  channel?: 'web' | 'pos' | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: OrderSort | null;
  page?: number;
}): Promise<OrderLoad<OrderListData>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const query = (options.query ?? '').trim().slice(0, 100);
  const state = options.state && isSaleState(options.state) ? options.state : null;
  const channel = options.channel === 'web' || options.channel === 'pos' ? options.channel : null;
  const dateFrom = options.dateFrom || null;
  const dateTo = options.dateTo || null;
  const sort = options.sort && isOrderSort(options.sort) ? options.sort : 'newest';
  const requestedPage = Math.max(1, Math.trunc(options.page ?? 1) || 1);
  const { pattern } = queryParts({ query, state, dateFrom, dateTo });

  try {
    const countRows = (await sql`
      select s.sale_state, count(*)::int as count
      from order_sale_state s
      join orders o on o.id = s.id
      where (${channel === null} or s.channel = ${channel})
        and (${query === ''}
          or o.txnid ilike ${pattern} escape '\\'
          or o.customer_name ilike ${pattern} escape '\\'
          or o.customer_email ilike ${pattern} escape '\\'
          or o.customer_phone ilike ${pattern} escape '\\')
        and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
        and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
      group by s.sale_state
    `) as Row[];

    const totalRows = (await sql`
      select count(*)::int as total
      from order_sale_state s
      join orders o on o.id = s.id
      where (${state === null} or s.sale_state = ${state})
        and (${channel === null} or s.channel = ${channel})
        and (${query === ''}
          or o.txnid ilike ${pattern} escape '\\'
          or o.customer_name ilike ${pattern} escape '\\'
          or o.customer_email ilike ${pattern} escape '\\'
          or o.customer_phone ilike ${pattern} escape '\\')
        and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
        and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
    `) as Row[];

    const counts = emptyCounts();
    for (const row of countRows) {
      if (isSaleState(row.sale_state)) counts[row.sale_state] = integer(row.count);
    }
    const total = integer(totalRows[0]?.total);
    const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const offset = (page - 1) * ORDERS_PAGE_SIZE;

    const rows = (await sql`
      select
        s.id, s.txnid, s.status, s.fulfilment_status, s.sale_state, s.channel,
        s.amount, s.currency, s.total_paise, s.scheduled_for, s.delivery_slot,
        s.created_at, s.updated_at, s.paid_at,
        o.customer_name, o.customer_email, o.customer_phone
      from order_sale_state s
      join orders o on o.id = s.id
      where (${state === null} or s.sale_state = ${state})
        and (${channel === null} or s.channel = ${channel})
        and (${query === ''}
          or o.txnid ilike ${pattern} escape '\\'
          or o.customer_name ilike ${pattern} escape '\\'
          or o.customer_email ilike ${pattern} escape '\\'
          or o.customer_phone ilike ${pattern} escape '\\')
        and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
        and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
      order by
        case when ${sort} = 'amount-desc'
          then coalesce(s.total_paise, round(s.amount * 100)::bigint) end desc nulls last,
        case when ${sort} = 'amount-asc'
          then coalesce(s.total_paise, round(s.amount * 100)::bigint) end asc nulls last,
        case when ${sort} = 'oldest' then s.created_at end asc,
        s.created_at desc,
        s.id desc
      limit ${ORDERS_PAGE_SIZE} offset ${offset}
    `) as Row[];

    return {
      ok: true,
      data: {
        orders: rows.map(summaryFromRow),
        total,
        page,
        pageCount,
        pageSize: ORDERS_PAGE_SIZE,
        query,
        state,
        dateFrom,
        dateTo,
        counts,
      },
    };
  } catch {
    console.warn('[store-admin/orders] could not read the order list');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface OrderExportRow {
  txnid: string;
  createdAt: string;
  saleState: SaleState;
  paymentStatus: string;
  fulfilmentStatus: FulfilmentStatus;
  channel: string;
  customerNameMasked: string;
  customerEmailMasked: string;
  customerPhoneMasked: string;
  amountPaise: number;
  currency: string;
  itemLines: number;
}

/**
 * Flat rows for the CSV export. The same filters as `listOrders` apply, the
 * result is capped, and customer values stay masked: a full email or phone is
 * only ever handed out by the audited reveal route.
 */
export async function listOrdersForExport(options: {
  query?: string;
  state?: SaleState | null;
  channel?: 'web' | 'pos' | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  sort?: OrderSort | null;
  limit?: number;
}): Promise<OrderLoad<OrderExportRow[]>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  const query = (options.query ?? '').trim().slice(0, 100);
  const state = options.state && isSaleState(options.state) ? options.state : null;
  const channel = options.channel === 'web' || options.channel === 'pos' ? options.channel : null;
  const dateFrom = options.dateFrom || null;
  const dateTo = options.dateTo || null;
  const sort = options.sort && isOrderSort(options.sort) ? options.sort : 'newest';
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 10_000), 1), 10_000);
  const pattern = `%${escapeLike(query)}%`;

  try {
    const rows = (await sql`
      select
        s.txnid, s.sale_state, s.status, s.fulfilment_status, s.channel,
        s.amount, s.currency, s.total_paise, s.created_at,
        o.customer_name, o.customer_email, o.customer_phone,
        (
          select count(*)::int from order_items oi where oi.order_id = s.id
        ) as item_lines
      from order_sale_state s
      join orders o on o.id = s.id
      where (${state === null} or s.sale_state = ${state})
        and (${channel === null} or s.channel = ${channel})
        and (${query === ''}
          or o.txnid ilike ${pattern} escape '\\'
          or o.customer_name ilike ${pattern} escape '\\'
          or o.customer_email ilike ${pattern} escape '\\'
          or o.customer_phone ilike ${pattern} escape '\\')
        and (${dateFrom === null} or o.created_at >= ${dateFrom}::date)
        and (${dateTo === null} or o.created_at < (${dateTo}::date + interval '1 day'))
      order by
        case when ${sort} = 'amount-desc'
          then coalesce(s.total_paise, round(s.amount * 100)::bigint) end desc nulls last,
        case when ${sort} = 'amount-asc'
          then coalesce(s.total_paise, round(s.amount * 100)::bigint) end asc nulls last,
        case when ${sort} = 'oldest' then s.created_at end asc,
        s.created_at desc,
        s.id desc
      limit ${limit}
    `) as Row[];

    return {
      ok: true,
      data: rows.map((row) => ({
        txnid: text(row.txnid),
        createdAt: iso(row.created_at),
        saleState: isSaleState(row.sale_state) ? row.sale_state : 'PENDING',
        paymentStatus: text(row.status),
        fulfilmentStatus: isFulfilmentStatus(row.fulfilment_status)
          ? row.fulfilment_status
          : 'PENDING',
        channel: text(row.channel) || 'web',
        customerNameMasked: maskCustomerName(row.customer_name),
        customerEmailMasked: maskCustomerEmail(text(row.customer_email)),
        customerPhoneMasked: maskCustomerPhone(text(row.customer_phone)),
        amountPaise:
          integer(row.total_paise) || Math.round(number(row.amount) * 100),
        currency: text(row.currency) || 'INR',
        itemLines: integer(row.item_lines),
      })),
    };
  } catch {
    console.warn('[store-admin/orders] could not build the export rows');
    return { ok: false, reason: 'unavailable' };
  }
}

export type OrderAccessRole = 'store_owner' | 'store_admin' | 'store_viewer';

function deliveryFromRows(
  row: Row,
  events: DeliveryEvent[],
  role: OrderAccessRole,
): OrderDelivery {
  const details = jsonObject(row.latest_details);
  const method = row.delivery_method === 'self' || row.delivery_method === 'courier'
    ? row.delivery_method
    : details.method === 'self' || details.method === 'courier'
    ? details.method
    : null;
  const slot = row.order_delivery_slot === '10:00-13:00' || row.order_delivery_slot === '13:00-17:00' || row.order_delivery_slot === '17:00-20:00'
    ? row.order_delivery_slot
    : null;
  const personPhone = nullableText(row.person_phone) ?? nullableText(details.personPhone);
  const personName = nullableText(row.person_name) ?? nullableText(details.personName);
  const courierName = nullableText(row.courier_name) ?? nullableText(row.carrier) ?? nullableText(details.courierName);
  return {
    id: text(row.delivery_id),
    status: isFulfilmentStatus(row.delivery_status) ? row.delivery_status : 'PENDING',
    method,
    personName,
    personPhone: role === 'store_owner' ? personPhone : null,
    personPhoneMasked: personPhone ? maskCustomerPhone(personPhone) : null,
    courierName,
    carrier: courierName,
    trackingNumber: nullableText(row.tracking_number),
    trackingUrl: nullableText(row.tracking_url) ?? nullableText(details.trackingUrl),
    scheduledFor: nullableIso(row.delivery_scheduled_for),
    deliverySlot: slot,
    deliveredAt: nullableIso(row.delivered_at),
    events,
  };
}

export async function getOrderDetail(
  txnid: string,
  role: OrderAccessRole = 'store_admin',
): Promise<OrderLoad<OrderDetail>> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  const key = txnid.trim();
  if (!key) return { ok: false, reason: 'not-found' };

  try {
    const orderRows = (await sql`
      select
        s.id, s.txnid, s.status, s.fulfilment_status, s.sale_state, s.channel,
        s.amount, s.currency, s.total_paise, s.scheduled_for, s.delivery_slot,
        s.subtotal_paise, s.discount_paise, s.shipping_paise, s.coupon_code,
        s.payment_method,
        s.created_at, s.updated_at, s.paid_at,
        o.customer_name, o.customer_email, o.customer_phone, o.items
      from order_sale_state s
      join orders o on o.id = s.id
      where s.txnid = ${key}
      limit 1
    `) as Row[];
    const order = orderRows[0];
    if (!order) return { ok: false, reason: 'not-found' };

    const orderId = text(order.id);
    const [itemRows, historyRows, addressRows, deliveryRows, eventRows] = await Promise.all([
      sql`
        select line_number, product_id, product_name, quantity,
               unit_price_paise, line_total_paise, currency
        from order_items
        where order_id = ${orderId}
        order by line_number asc
      `,
      sql`
        select id, domain, actor, from_status, to_status, created_at
        from order_status_history
        where order_id = ${orderId}
        order by created_at asc, id asc
      `,
      sql`
        select address_type, full_name, phone, line1, line2, city, state,
               postal_code, country
        from order_addresses
        where order_id = ${orderId}
        order by address_type asc, id asc
      `,
      sql`
         select d.id as delivery_id, d.status as delivery_status,
                d.delivery_method, d.person_name, d.person_phone, d.courier_name,
                d.carrier, d.tracking_number, d.tracking_url,
                d.scheduled_for as delivery_scheduled_for,
               d.delivered_at, e.details as latest_details,
               o.delivery_slot as order_delivery_slot
        from order_deliveries d
        join orders o on o.id = d.order_id
        left join lateral (
          select details from order_delivery_events
          where delivery_id = d.id
          order by event_at desc, id desc
          limit 1
        ) e on true
        where d.order_id = ${orderId}
        limit 1
      `,
      sql`
        select e.id, e.event_type, e.status, e.event_at, e.details
        from order_delivery_events e
        join order_deliveries d on d.id = e.delivery_id
        where d.order_id = ${orderId}
        order by e.event_at asc, e.id asc
      `,
    ]);

    const items = (itemRows as Row[]).length
      ? (itemRows as Row[]).map((row) => ({
          lineNumber: integer(row.line_number),
          productId: text(row.product_id),
          productName: text(row.product_name),
          quantity: integer(row.quantity) || 1,
          unitPricePaise: integer(row.unit_price_paise),
          lineTotalPaise: integer(row.line_total_paise),
          currency: text(row.currency) || 'INR',
        }))
      : parseItems(order.items);
    const history: OrderHistoryEntry[] = (historyRows as Row[]).map((row) => ({
      id: text(row.id),
      domain: text(row.domain),
      actor: text(row.actor),
      fromStatus: nullableText(row.from_status),
      toStatus: text(row.to_status),
      createdAt: iso(row.created_at),
    }));
    const events: DeliveryEvent[] = (eventRows as Row[]).map((row) => ({
      id: text(row.id),
      eventType: text(row.event_type),
      status: nullableText(row.status),
      eventAt: iso(row.event_at),
      details: jsonObject(row.details),
    }));
    const delivery = (deliveryRows as Row[])[0]
       ? deliveryFromRows((deliveryRows as Row[])[0], events, role)
      : null;

    return {
      ok: true,
      data: {
        ...summaryFromRow(order),
        items,
        addresses: (addressRows as Row[]).map(maskCustomerAddress),
        history,
        delivery,
        subtotalPaise: integer(order.subtotal_paise),
        discountPaise: integer(order.discount_paise),
        shippingPaise: integer(order.shipping_paise),
        couponCode: nullableText(order.coupon_code),
        paymentMethod: nullableText(order.payment_method),
      },
    };
  } catch {
    console.warn('[store-admin/orders] could not read the order detail');
    return { ok: false, reason: 'unavailable' };
  }
}

export interface DashboardOrderCounts {
  total: number;
  counts: Record<SaleState, number>;
}

export async function getOrderDashboardCounts(): Promise<OrderLoad<DashboardOrderCounts>> {
  const result = await listOrders({ page: 1 });
  if (!result.ok) return result;
  return { ok: true, data: { total: result.data.total, counts: result.data.counts } };
}

/** Compatibility name used by the protected dashboard's count cards. */
export async function listStoreOrders(): Promise<OrderLoad<OrderListData>> {
  return listOrders({ page: 1 });
}

export type MutationFailure =
  | { ok: false; reason: 'unavailable' | 'not-found' | 'invalid-transition' | 'payment-required' | 'owner-required' | 'delivery-required' | 'invalid-input'; error: string };

export type FulfilmentMutation =
  | { ok: true; previousStatus: FulfilmentStatus; currentStatus: FulfilmentStatus; orderId: string; txnid: string }
  | MutationFailure;

function mutationFailure(
  reason: MutationFailure['reason'],
  error: string,
): MutationFailure {
  return { ok: false, reason, error };
}

export async function transitionFulfilment(input: {
  txnid: string;
  target: FulfilmentStatus;
  staffId: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
  reason?: string | null;
}): Promise<FulfilmentMutation> {
  const sql = getSql();
  if (!sql) return mutationFailure('unavailable', 'Order records are not available.');
  if (input.target === 'CANCELED' && !input.reason?.trim()) {
    return mutationFailure('invalid-input', 'A cancellation reason is required.');
  }

  try {
    return await sql.begin(async (tx) => {
      const rows = (await tx`
        select id, txnid, status, fulfilment_status, scheduled_for, delivery_slot
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = rows[0];
      if (!order) return mutationFailure('not-found', 'Order not found.');

      const current = isFulfilmentStatus(order.fulfilment_status)
        ? order.fulfilment_status
        : 'PENDING';
      const validation = validateFulfilmentTransition({
        current,
        target: input.target,
        paymentStatus: text(order.status),
        role: input.role,
      });
      if (!validation.ok) return mutationFailure(validation.code, validation.error);

      if (input.target === 'ON_THE_WAY') {
        const deliveryRows = (await tx`
          select d.delivery_method, d.person_name, d.person_phone,
                 d.courier_name, d.carrier, d.tracking_number, d.tracking_url,
                 d.scheduled_for as delivery_scheduled_for,
                 o.delivery_slot,
                 e.details as latest_details
          from order_deliveries d
          join orders o on o.id = d.order_id
          left join lateral (
            select details from order_delivery_events
            where delivery_id = d.id
            order by event_at desc, id desc
            limit 1
          ) e on true
          where d.order_id = ${text(order.id)}
          limit 1
        `) as Row[];
        const delivery = deliveryRows[0];
          const details = jsonObject(delivery?.latest_details);
          const ready = validateDeliveryDetailsForOnTheWay(
            delivery
              ? {
                 method: delivery.delivery_method === 'self' || delivery.delivery_method === 'courier'
                   ? delivery.delivery_method
                   : details.method === 'self' || details.method === 'courier' ? details.method : null,
                 personName: nullableText(delivery.person_name) ?? nullableText(details.personName),
                 personPhone: nullableText(delivery.person_phone) ?? nullableText(details.personPhone),
                 courierName: nullableText(delivery.courier_name) ?? nullableText(delivery.carrier) ?? nullableText(details.courierName),
                 carrier: nullableText(delivery.courier_name) ?? nullableText(delivery.carrier),
                 trackingNumber: nullableText(delivery.tracking_number),
                 trackingUrl: nullableText(delivery.tracking_url) ?? nullableText(details.trackingUrl),
                scheduledFor: nullableIso(delivery.delivery_scheduled_for)?.slice(0, 10) ?? null,
                 deliverySlot: nullableText(delivery.delivery_slot),
              }
            : null,
        );
        if (!ready.ok) return mutationFailure('delivery-required', ready.error);
      }

      await tx`
        update orders
        set fulfilment_status = ${input.target},
            staff_id = ${input.staffId},
            cancelled_at = case when ${input.target} = 'CANCELED' then now() else cancelled_at end,
            cancel_reason = case when ${input.target} = 'CANCELED' then ${input.reason?.trim() ?? null} else cancel_reason end,
            updated_at = now()
        where id = ${text(order.id)}
      `;

      await tx`
        update order_deliveries
        set status = ${input.target},
            delivered_at = case when ${input.target} = 'DELIVERED' then now() else delivered_at end,
            updated_at = now()
        where order_id = ${text(order.id)}
      `;

      await tx`
        insert into order_status_history (
          order_id, domain, actor, from_status, to_status
        ) values (
          ${text(order.id)}, 'fulfilment', 'system', ${current}, ${input.target}
        )
      `;

      return {
        ok: true,
        previousStatus: current,
        currentStatus: input.target,
        orderId: text(order.id),
        txnid: text(order.txnid),
      };
    });
  } catch {
    console.warn('[store-admin/orders] fulfilment transition failed');
    return mutationFailure('unavailable', 'Order records are not available.');
  }
}

export type DeliveryMutation =
  | { ok: true; orderId: string; txnid: string; deliveryId: string; value: DeliveryInput }
  | MutationFailure;

export async function updateDelivery(input: {
  txnid: string;
  value: DeliveryInput;
  staffId: string;
}): Promise<DeliveryMutation> {
  const sql = getSql();
  if (!sql) return mutationFailure('unavailable', 'Order records are not available.');

  try {
    return await sql.begin(async (tx) => {
      const orderRows = (await tx`
        select id, txnid, fulfilment_status
        from orders
        where txnid = ${input.txnid.trim()}
        for update
      `) as Row[];
      const order = orderRows[0];
      if (!order) return mutationFailure('not-found', 'Order not found.');
      if (order.fulfilment_status === 'DELIVERED' || order.fulfilment_status === 'CANCELED') {
        return mutationFailure('invalid-transition', 'Delivery details cannot be changed for a closed order.');
      }

      // A courier whose tracking template is configured fills the tracking URL
      // in when staff leave it blank. An explicit URL always wins.
      let trackingUrl = input.value.trackingUrl;
      if (
        input.value.method === 'courier' &&
        !trackingUrl &&
        input.value.courierName &&
        input.value.trackingNumber
      ) {
        const providers = (await tx`
          select tracking_template
          from fulfilment_providers
          where is_active
            and tracking_template <> ''
            and lower(name) = lower(${input.value.courierName})
          limit 1
        `) as Row[];
        trackingUrl = buildTrackingUrl(
          providers[0]?.tracking_template,
          input.value.trackingNumber,
        );
      }
      const deliveryValue: DeliveryInput = { ...input.value, trackingUrl };

      const deliveryRows = (await tx`
         insert into order_deliveries (
           order_id, status, delivery_method, person_name, person_phone,
           courier_name, carrier, tracking_number, tracking_url, scheduled_for, updated_at
         ) values (
           ${text(order.id)}, ${text(order.fulfilment_status)}, ${input.value.method},
           ${input.value.personName}, ${input.value.personPhone}, ${input.value.courierName},
           ${input.value.carrier}, ${input.value.trackingNumber}, ${trackingUrl},
           ${input.value.scheduledFor}::date, now()
         )
         on conflict (order_id) do update set
           status = excluded.status,
           delivery_method = excluded.delivery_method,
           person_name = excluded.person_name,
           person_phone = excluded.person_phone,
           courier_name = excluded.courier_name,
           carrier = excluded.carrier,
           tracking_number = excluded.tracking_number,
           tracking_url = excluded.tracking_url,
          scheduled_for = excluded.scheduled_for,
          updated_at = now()
        returning id
      `) as Row[];
      const deliveryId = text(deliveryRows[0]?.id);
      await tx`
        update orders
        set scheduled_for = ${input.value.scheduledFor}::date,
            delivery_slot = ${input.value.deliverySlot},
            updated_at = now()
        where id = ${text(order.id)}
      `;
      await tx`
        insert into order_delivery_events (delivery_id, event_type, status, details)
        values (
          ${deliveryId}, 'details_updated', ${text(order.fulfilment_status)},
          ${JSON.stringify({
             method: input.value.method,
             personName: input.value.personName,
             hasPersonPhone: Boolean(input.value.personPhone),
             courierName: input.value.courierName,
             trackingUrl,
            hasTrackingNumber: Boolean(input.value.trackingNumber),
            scheduledFor: input.value.scheduledFor,
            deliverySlot: input.value.deliverySlot,
          })}::jsonb
        )
      `;

      return {
        ok: true,
        orderId: text(order.id),
        txnid: text(order.txnid),
        deliveryId,
        value: deliveryValue,
      };
    });
  } catch {
    console.warn('[store-admin/orders] delivery update failed');
    return mutationFailure('unavailable', 'Order records are not available.');
  }
}

/** Cheap transaction-id lookup used by routes that never render the order. */
export async function findOrderId(txnid: string): Promise<string | null> {
  const sql = getSql();
  if (!sql) return null;
  try {
    const rows = (await sql`
      select id from orders where txnid = ${txnid.trim()} limit 1
    `) as Row[];
    return rows[0] ? text(rows[0].id) || null : null;
  } catch {
    console.warn('[store-admin/orders] could not look up an order id');
    return null;
  }
}

export type OrderRevealField = 'email' | 'phone';

export function isOrderRevealField(value: unknown): value is OrderRevealField {
  return value === 'email' || value === 'phone';
}

export async function revealOrderField(
  txnid: string,
  field: OrderRevealField,
): Promise<{ ok: true; value: string } | { ok: false; reason: 'unavailable' | 'not-found' | 'no-value' }> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  try {
    const rows = field === 'email'
      ? await sql`select customer_email as value from orders where txnid = ${txnid.trim()} limit 1`
      : await sql`select customer_phone as value from orders where txnid = ${txnid.trim()} limit 1`;
    if (!rows[0]) return { ok: false, reason: 'not-found' };
    const value = text(rows[0].value).trim();
    return value ? { ok: true, value } : { ok: false, reason: 'no-value' };
  } catch {
    console.warn('[store-admin/orders] could not reveal an order field');
    return { ok: false, reason: 'unavailable' };
  }
}
