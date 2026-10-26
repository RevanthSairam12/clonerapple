import { getSql } from '@/lib/admin/db';

import {
  getOrderDetail,
  type OrderAccessRole,
  type OrderDetail,
  type OrderLoad,
} from './orders';

if (typeof window !== 'undefined') {
  throw new Error('SECURITY ALERT: Order documents must be built on the server only.');
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

/**
 * Full address as printed on a document.
 *
 * This is deliberately separate from `OrderAddress`, which is always masked for
 * the screen. A printable invoice or packing slip is useless with a redacted
 * street, so these rows are only read for owner-only print routes, and every
 * render writes an audit row. Nothing here is ever copied into the audit log.
 */
export interface DocumentAddress {
  type: string;
  fullName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface OrderDocument extends OrderDetail {
  shipTo: DocumentAddress | null;
  billTo: DocumentAddress | null;
}

function addressFromRow(row: Row): DocumentAddress {
  return {
    type: text(row.address_type) || 'shipping',
    fullName: text(row.full_name).trim(),
    phone: text(row.phone).trim(),
    line1: text(row.line1).trim(),
    line2: nullableText(row.line2),
    city: text(row.city).trim(),
    state: text(row.state).trim(),
    postalCode: text(row.postal_code).trim(),
    country: text(row.country).trim() || 'IN',
  };
}

/** Add the unmasked shipping and billing addresses to an order detail. */
export async function getOrderDocument(
  txnid: string,
  role: OrderAccessRole = 'store_owner',
): Promise<OrderLoad<OrderDocument>> {
  const detail = await getOrderDetail(txnid, role);
  if (!detail.ok) return detail;

  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };

  try {
    const rows = (await sql`
      select address_type, full_name, phone, line1, line2, city, state,
             postal_code, country
      from order_addresses
      where order_id = ${detail.data.id}
      order by address_type asc, id asc
    `) as Row[];

    const addresses = rows.map(addressFromRow);
    return {
      ok: true,
      data: {
        ...detail.data,
        shipTo: addresses.find((address) => address.type === 'shipping') ?? null,
        billTo: addresses.find((address) => address.type === 'billing') ?? null,
      },
    };
  } catch {
    console.warn('[store-admin/order-documents] could not read the document address');
    return { ok: false, reason: 'unavailable' };
  }
}

export function formatRupees(paise: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${(paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface OrderTotals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  balancePaise: number;
  paid: boolean;
}

/**
 * Reconcile the money shown on a document.
 *
 * Web orders created before the totals columns were populated carry zeros, so
 * the line items and the legacy `amount` column are used as fallbacks. The
 * printed document must always add up, even for an old row.
 */
export function orderTotals(order: {
  items: readonly { lineTotalPaise: number }[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  amount: number;
  paymentStatus: string;
}): OrderTotals {
  const itemsSubtotal = order.items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const subtotalPaise = order.subtotalPaise || itemsSubtotal;
  const discountPaise = Math.min(order.discountPaise || 0, subtotalPaise);
  const shippingPaise = order.shippingPaise || 0;
  const totalPaise =
    order.totalPaise ||
    Math.round(order.amount * 100) ||
    Math.max(0, subtotalPaise - discountPaise + shippingPaise);
  const paid = order.paymentStatus === 'PAID';
  return {
    subtotalPaise,
    discountPaise,
    shippingPaise,
    totalPaise,
    balancePaise: paid ? 0 : totalPaise,
    paid,
  };
}
