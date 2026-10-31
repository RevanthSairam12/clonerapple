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
  customerUserId?: string | null;
}

export function orderNotificationContext(
  order: Pick<
    Order,
    'txnid' | 'orderNumber' | 'items' | 'amount' | 'status'
    | 'customerName' | 'customerEmail' | 'customerPhone'
    | 'couponCode' | 'discountPaise'
  > & { userId?: string | null },
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
    customerUserId: extras.customerUserId ?? order.userId ?? null,
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
export async function queueOrderNotification(
  event: NotificationEvent,
  txnid: string,
  extras: OrderNotificationExtras = {},
): Promise<boolean> {
  const order = await getOrderByTxnid(txnid);
  if (!order) return false;
  return queueNotification(
    event,
    { type: 'order', id: order.txnid },
    orderNotificationContext(order, extras),
  );
}

/** Convenience wrapper for status transitions that notify customers/staff. */
export async function notifyOrderStatusChange(
  txnid: string,
  toStatus: string,
): Promise<void> {
  const norm = toStatus.trim().toUpperCase();
  if (norm === 'PAID') {
    await queueOrderNotification('payment_received', txnid, { orderStatus: 'PAID' });
  } else if (norm === 'CANCELLED' || norm === 'CANCELED') {
    await queueOrderNotification('cancelled', txnid, { orderStatus: 'CANCELLED' });
  }
}

/** Convenience wrapper for fulfilment transitions that notify customers/staff. */
export async function notifyFulfilmentStatusChange(
  txnid: string,
  toStatus: FulfilmentStatus,
  tracking?: { number?: string | null; link?: string | null },
): Promise<void> {
  if (toStatus === 'PROCESSING') {
    await queueOrderNotification('processing', txnid, { orderStatus: 'PROCESSING' });
  } else if (toStatus === 'OUT_FOR_DELIVERY') {
    await queueOrderNotification('shipped', txnid, {
      orderStatus: 'ON_THE_WAY',
      trackingNumber: tracking?.number,
      trackingLink: tracking?.link,
    });
  } else if (toStatus === 'DELIVERED') {
    await queueOrderNotification('delivered', txnid, { orderStatus: 'DELIVERED' });
  }
}
