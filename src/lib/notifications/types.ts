/**
 * Shared notification vocabulary.
 *
 * The event names are the `topic` values in `notification_channel_settings`;
 * adding one here without adding its matrix row would make the toggle
 * unreachable, and adding a matrix row without code here would make the
 * toggle inert. Keep the two lists aligned.
 *
 * Pure module: no database, no Next.js, no environment access.
 */

export const NOTIFICATION_EVENTS = [
  'order_placed',
  'payment_received',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refund_requested',
  'refund_completed',
  'back_in_stock',
  'password_reset',
  'staff_invite',
  'low_stock',
  'payment_processing',
  'payment_failed',
  'reservation_expired',
  'refund_pending',
  'payment_review',
  'spin_win',
] as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

/** The outbox audience. The settings matrix calls staff "admin". */
export type NotificationAudience = 'customer' | 'staff';

export type NotificationChannel = 'email' | 'sms' | 'inapp';

export const NOTIFICATION_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export function isNotificationEvent(value: unknown): value is NotificationEvent {
  return typeof value === 'string'
    && (NOTIFICATION_EVENTS as readonly string[]).includes(value);
}

/**
 * What the business event knows. Only these fields can reach a template; the
 * renderer never walks the object, so an unexpected property cannot leak.
 */
export interface NotificationContext {
  /** Order transaction id, used as the default order number. */
  txnid?: string | null;
  /** Human order number, when the order already has one. */
  orderNumber?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerUserId?: string | null;
  /** A single staff recipient, for invitations and password resets. */
  staffEmail?: string | null;
  staffPhone?: string | null;
  orderTotalPaise?: number | null;
  shippingPaise?: number | null;
  refundPaise?: number | null;
  /** The coupon code shown to the customer, or null when none was used. */
  couponCode?: string | null;
  /** Spin and Win prize label, e.g. "10% off". */
  prizeName?: string | null;
  /** Formatted expiry date for a won coupon, e.g. "20 Nov 2026". */
  couponExpiry?: string | null;
  /** What that coupon took off the order, in paise. */
  discountPaise?: number | null;
  orderStatus?: string | null;
  trackingNumber?: string | null;
  /** Must already be an https URL; the renderer rejects anything else. */
  trackingLink?: string | null;
  itemCount?: number | null;
  productName?: string | null;
  stockAvailable?: number | null;
  /** Where a customer message should link, e.g. /order/status?txnid=GDZ1001. */
  customerLink?: string | null;
  /** Where a staff message should link, e.g. /store-admin/orders/GDZ1001. */
  staffLink?: string | null;
  /** Legacy single link; each audience prefers its own link above. */
  adminLink?: string | null;
  /**
   * Distinguishes legitimate repeats (a second return request on one order).
   * Events that must fire once, such as payment_received, leave this unset.
   */
  token?: string | null;
}

export interface NotificationEntity {
  /** order | order_request | return_request | product | staff | customer */
  type: string;
  /** txnid, request id, product id — stable enough for a dedupe key. */
  id: string;
}
