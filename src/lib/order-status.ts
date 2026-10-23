import { getSql } from '@/lib/admin/db';
import { validateHttpsTrackingUrl } from '@/lib/store-admin/delivery';
import { isSaleState, type SaleState } from '@/lib/store-admin/orders';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return text(value);
}

function nullableIso(value: unknown): string | null {
  const valueText = iso(value);
  return valueText || null;
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText || null;
}

export interface CustomerStatusDelivery {
  method: 'self' | 'courier' | null;
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  scheduledFor: string | null;
  deliverySlot: string | null;
}

export interface CustomerStatusData {
  id: string;
  txnid: string;
  userId: string | null;
  saleState: SaleState;
  paymentStatus: string;
  fulfilmentStatus: string;
  channel: string;
  deliverySlot: string | null;
  createdAt: string;
  updatedAt: string;
  delivery: CustomerStatusDelivery | null;
  history: Array<{ domain: string; toStatus: string; createdAt: string }>;
}

export type CustomerStatusLoad =
  | { ok: true; data: CustomerStatusData }
  | { ok: false; reason: 'unavailable' | 'not-found' };

/** Customer-safe fields only; ownership is checked by the page after loading user_id. */
export async function getCustomerOrderStatus(
  txnid: string,
): Promise<CustomerStatusLoad> {
  const sql = getSql();
  if (!sql) return { ok: false, reason: 'unavailable' };
  const key = txnid.trim().slice(0, 200);
  if (!key) return { ok: false, reason: 'not-found' };

  try {
    const orderRows = (await sql`
      select s.id, s.txnid, o.user_id, s.sale_state, s.status,
             s.fulfilment_status, s.channel, s.delivery_slot,
             s.created_at, s.updated_at
      from order_sale_state s
      join orders o on o.id = s.id
      where s.txnid = ${key}
      limit 1
    `) as Row[];
    const order = orderRows[0];
    if (!order) return { ok: false, reason: 'not-found' };

    const [deliveryRows, historyRows] = await Promise.all([
      sql`
        select d.status, d.delivery_method, d.courier_name, d.carrier,
               d.tracking_number, d.tracking_url,
               d.scheduled_for, latest.details as latest_details
        from order_deliveries d
        left join lateral (
          select details
          from order_delivery_events
          where delivery_id = d.id
          order by event_at desc, id desc
          limit 1
        ) latest on true
        where d.order_id = ${text(order.id)}
        limit 1
      `,
      sql`
        select domain, to_status, created_at
        from order_status_history
        where order_id = ${text(order.id)}
        order by created_at asc, id asc
      `,
    ]);

    const deliveryRow = (deliveryRows as Row[])[0];
    let details: Record<string, unknown> = {};
    if (deliveryRow?.latest_details && typeof deliveryRow.latest_details === 'object') {
      details = deliveryRow.latest_details as Record<string, unknown>;
    } else if (typeof deliveryRow?.latest_details === 'string') {
      try {
        const parsed = JSON.parse(deliveryRow.latest_details);
        if (parsed && typeof parsed === 'object') details = parsed;
      } catch {
        details = {};
      }
    }

    const method = deliveryRow?.delivery_method === 'self' || deliveryRow?.delivery_method === 'courier'
      ? deliveryRow.delivery_method
      : details.method === 'self' || details.method === 'courier' ? details.method : null;
    const trackingUrl = validateHttpsTrackingUrl(deliveryRow?.tracking_url ?? details.trackingUrl);

    return {
      ok: true,
      data: {
        id: text(order.id),
        txnid: text(order.txnid),
        userId: nullableText(order.user_id),
        saleState: isSaleState(order.sale_state) ? order.sale_state : 'PENDING',
        paymentStatus: text(order.status),
        fulfilmentStatus: text(order.fulfilment_status) || 'PENDING',
        channel: text(order.channel) || 'web',
        deliverySlot: nullableText(order.delivery_slot),
        createdAt: iso(order.created_at),
        updatedAt: iso(order.updated_at),
        delivery: deliveryRow
          ? {
              method,
              status: text(deliveryRow.status) || 'PENDING',
               carrier: nullableText(deliveryRow.courier_name) ?? nullableText(deliveryRow.carrier),
              trackingNumber: nullableText(deliveryRow.tracking_number),
               trackingUrl,
              scheduledFor: nullableIso(deliveryRow.scheduled_for),
              deliverySlot: nullableText(details.deliverySlot) || nullableText(order.delivery_slot),
            }
          : null,
        history: (historyRows as Row[]).map((row) => ({
          domain: text(row.domain),
          toStatus: text(row.to_status),
          createdAt: iso(row.created_at),
        })),
      },
    };
  } catch {
    console.warn('[order/status] could not read the order status');
    return { ok: false, reason: 'unavailable' };
  }
}
