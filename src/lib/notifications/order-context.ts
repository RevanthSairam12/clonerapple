import { getOrderByTxnid, type Order } from '@/lib/payu/orders';
import type { FulfilmentStatus } from '@/lib/store-admin/order-rules';

import { queueNotification } from './queue';
import type {
  NotificationContext,
  NotificationEvent,
} from './types';

/**
 * Build the template context for an order event.
 *
 * Only the fields the renderer whitelists are copied. `order.total_paise` is
 * derived from the persisted rupee amount, and shipping is the remainder after
 * the item snapshot, so a message cannot show a number the order did not
 * charge. Customer and staff links are separate: a guest can open the public
 * status page, while staff links stay inside Store Admin.
 */
export interface OrderNotificationExtras {
  /** Customer-facing label, e.g. PAID, PROCESSING, CANCELLED. */
  orderStatus?: string | null;
  trackingNumber?: string | null;
  trackingLink?: string | null;
  refundPaise?: number | null;
  token?: string | null;
}

export function orderNotificationContext(
  order: Pick<
    Order,
    'txnid' | 'orderNumber' | 'items' | 'amount' | 'status'
    | 'customerName' | 'customerEmail' | 'customerPhone'
    | 'couponCode' | 'discountPaise'
  >,
  extras: OrderNotificationExtras = {},
): NotificationContext {
  const totalPaise = Math.round((Number(order.amount) || 0) * 100);
  const subtotalPaise = Array.isArray(order.items)
    ? order.items.reduce(
        (sum, item) => sum + Math.round((Number(item.totalPrice) || 0) * 100),
        0,
      )
    : 0;
  const itemCount = Array.isArray(order.items)
    ? order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
    : 0;
  const encodedTxnid = encodeURIComponent(order.txnid);

  return {
    txnid: order.txnid,
    orderNumber: order.orderNumber ? String(order.orderNumber) : order.txnid,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    customerPhone: order.customerPhone,
    customerUserId: ('userId' in order && order.userId ? String(order.userId) : null),
    orderTotalPaise: totalPaise,
    shippingPaise: Math.max(0, totalPaise - subtotalPaise),
    orderStatus: extras.orderStatus ?? order.status,
    trackingNumber: extras.trackingNumber ?? null,
    trackingLink: extras.trackingLink ?? null,
    refundPaise: extras.refundPaise ?? null,
    couponCode: order.couponCode ?? null,
    discountPaise: order.discountPaise ?? 0,
    itemCount,
    customerLink: `/order/status?txnid=${encodedTxnid}`,
    staffLink: `/store-admin/orders/${encodedTxnid}`,
    token: extras.token ?? null,
  };
}

/** Queue one order event, always after the business transaction committed. */
export function queueOrderEvent(
  event: NotificationEvent,
  order: Parameters<typeof orderNotificationContext>[0],
  extras: OrderNotificationExtras = {},
): void {
  queueNotification(
    event,
    { type: 'order', id: order.txnid },
    orderNotificationContext(order, extras),
  );
}

/**
 * Read the order after a committed staff action and queue its event. A read
 * failure is logged by event name only; it must not turn a successful
 * cancellation or refund into an error response.
 */
export async function queueOrderEventByTxnid(
  event: NotificationEvent,
  txnid: string,
  extras: OrderNotificationExtras = {},
): Promise<void> {
  try {
    const order = await getOrderByTxnid(txnid);
    if (order) queueOrderEvent(event, order, extras);
  } catch {
    console.warn(`[notifications] could not read the order for ${event}`);
  }
}

/**
 * Fulfilment moves that have a matching matrix topic. ACCEPTED is deliberately
 * absent: the matrix has no "accepted" topic, and pretending it is
 * "processing" would send the customer the wrong copy.
 */
const FULFILMENT_EVENTS: Partial<Record<FulfilmentStatus, NotificationEvent>> = {
  PROCESSING: 'processing',
  ON_THE_WAY: 'shipped',
  DELIVERED: 'delivered',
  CANCELED: 'cancelled',
};

export function fulfilmentNotificationEvent(
  status: FulfilmentStatus,
): NotificationEvent | null {
  return FULFILMENT_EVENTS[status] ?? null;
}

/**
 * Queue a message for each fulfilment step that moved the order. The steps
 * come from the order-automation planner, already in chain order.
 */
export function queueFulfilmentEvents(
  order: Parameters<typeof orderNotificationContext>[0],
  steps: readonly FulfilmentStatus[],
  extras: Omit<OrderNotificationExtras, 'orderStatus'> = {},
): void {
  for (const step of steps) {
    const event = fulfilmentNotificationEvent(step);
    if (!event) continue;
    queueOrderEvent(event, order, { ...extras, orderStatus: step });
  }
}
