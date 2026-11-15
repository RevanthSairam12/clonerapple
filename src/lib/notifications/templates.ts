/**
 * Rendering for notification templates.
 *
 * Two sources feed a message: a stored template (`email_templates` or
 * `automated_messages`) and, when that is missing or blank, a built-in default
 * for the event. A customer never receives an empty email because an admin
 * cleared a row.
 *
 * Substitution is deliberately narrow. Only the names in `TEMPLATE_VARIABLES`
 * are read, always from a plain object built field by field, never from the
 * event or a database row. Unknown names render empty. Values are control-
 * character stripped for every channel, escaped for HTML email, and flattened
 * to one line for subjects and SMS so a newline cannot inject a mail header.
 *
 * Custom body text is treated as plain text: the whole rendered body is
 * HTML-escaped and newlines become <br>. Structured order data (items,
 * addresses, totals, tracking, payment, and refund metadata) is escaped field
 * by field inside the email card layout.
 *
 * Pure module: no database, no Next.js, no environment access.
 */

import type {
  EmailOrderAddress,
  EmailOrderDetail,
  EmailOrderItem,
  NotificationAudience,
  NotificationChannel,
  NotificationEvent,
} from './types';

export const TEMPLATE_VARIABLES = [
  'order_number',
  'order_id',
  'txnid',
  'customer_name',
  'order_total',
  'total',
  'shipping_amount',
  'order_status',
  'tracking_number',
  'tracking_url',
  'tracking_link',
  'store_name',
  'support_phone',
  'support_email',
  'return_window_days',
  'refund_amount',
  // The coupon code and what it took off. No other coupon detail (scope,
  // limits, targets or other customers) is ever available to a template.
  'coupon_code',
  'prize_name',
  'coupon_expiry',
  'discount_amount',
  'item_count',
  'product_name',
  'stock_available',
  'admin_link',
] as const;

const VARIABLE_SET = new Set<string>(TEMPLATE_VARIABLES);

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const TEMPLATE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** HTML-escape a value that is about to become email markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remove characters that can break a header or a terminal line. */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** Format paise the same way the storefront and receipts do. */
export function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return `${sign}₹${(Math.abs(paise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function money(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatPaise(value) : '';
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  CREATED: 'created',
  PAID: 'paid',
  FAILED: 'payment failed',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  ON_THE_WAY: 'on the way',
  DELIVERED: 'delivered',
  REFUNDED: 'refunded',
  SCHEDULED: 'scheduled',
};

/** "ON_THE_WAY" → "on the way"; an unknown value is still readable. */
export function statusLabel(value: string | null | undefined): string {
  const key = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!key) return '';
  return STATUS_LABELS[key] ?? key.toLowerCase().replace(/_/g, ' ');
}

/** Only an https URL without embedded credentials can reach a message. */
export function safeHttpsUrl(value: string | null | undefined): string {
  const candidate = stripControlChars(text(value));
  if (!candidate || candidate.length > 2048) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

/**
 * Links in email: https only, plus a same-site path resolved against the app
 * base. `javascript:` and protocol-relative URLs are rejected.
 */
export function safeEmailLink(value: string | null | undefined, baseUrl: string): string {
  const candidate = stripControlChars(text(value));
  if (!candidate || candidate.length > 2048) return '';

  if (candidate.startsWith('/') && !candidate.startsWith('//')) {
    const base = text(baseUrl).replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) return '';
    return `${base}${candidate}`;
  }

  return safeHttpsUrl(candidate);
}

/**
 * Every value a template may see, built explicitly from the event context.
 * Customer messages carry the customer's name; staff messages do not.
 */
export function templateValues(input: {
  audience: NotificationAudience;
  txnid?: string | null;
  orderNumber?: string | null;
  customerName?: string | null;
  orderTotalPaise?: number | null;
  shippingPaise?: number | null;
  refundPaise?: number | null;
  discountPaise?: number | null;
  couponCode?: string | null;
  prizeName?: string | null;
  couponExpiry?: string | null;
  orderStatus?: string | null;
  trackingNumber?: string | null;
  trackingLink?: string | null;
  itemCount?: number | null;
  productName?: string | null;
  stockAvailable?: number | null;
  storeName?: string | null;
  supportPhone?: string | null;
  supportEmail?: string | null;
  returnWindowDays?: string | number | null;
  adminLink?: string | null;
}): Record<string, string> {
  const orderNumber = text(input.orderNumber) || text(input.txnid);
  const customerName = input.audience === 'customer'
    ? text(input.customerName) || 'there'
    : '';
  const adminLink = stripControlChars(text(input.adminLink));
  const returnWindow = text(input.returnWindowDays) || '7';

  return {
    order_number: orderNumber,
    order_id: orderNumber,
    txnid: orderNumber,
    customer_name: customerName,
    order_total: money(input.orderTotalPaise),
    total: money(input.orderTotalPaise),
    shipping_amount: input.shippingPaise === 0 ? 'Free' : money(input.shippingPaise),
    order_status: statusLabel(input.orderStatus),
    tracking_number: text(input.trackingNumber),
    tracking_url: safeHttpsUrl(input.trackingLink),
    tracking_link: safeHttpsUrl(input.trackingLink),
    store_name: text(input.storeName) || 'Gadzio',
    support_phone: text(input.supportPhone),
    support_email: text(input.supportEmail),
    return_window_days: returnWindow,
    refund_amount: money(input.refundPaise),
    coupon_code: text(input.couponCode),
    prize_name: text(input.prizeName),
    coupon_expiry: text(input.couponExpiry),
    discount_amount: money(input.discountPaise),
    item_count: numberText(input.itemCount),
    product_name: text(input.productName),
    stock_available: numberText(input.stockAvailable),
    admin_link: adminLink,
  };
}

/** Replace whitelisted tokens; everything else becomes an empty string. */
export function substitute(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return String(template ?? '').replace(TEMPLATE_TOKEN, (_match, name: string) => {
    const key = name.toLowerCase();
    return VARIABLE_SET.has(key) ? values[key] ?? '' : '';
  });
}

/**
 * Render as text. `singleLine` is used for subjects and SMS, where a newline
 * from a value must not survive.
 */
export function renderText(
  template: string,
  values: Readonly<Record<string, string>>,
  singleLine = false,
): string {
  const rendered = stripControlChars(substitute(template, values)).replace(/\r\n?/g, '\n');
  return singleLine ? rendered.replace(/\s+/g, ' ').trim() : rendered.trim();
}

function supportLine(values: Readonly<Record<string, string>>): string {
  const parts = [values.support_email, values.support_phone].filter(Boolean);
  return parts.join(' · ');
}

function defaultFooter(values: Readonly<Record<string, string>>): string {
  const store = values.store_name || 'Gadzio';
  const support = supportLine(values);
  return `This is an automated message from ${store}.${support ? ` Questions? ${support}.` : ''}`;
}

export interface EmailParts {
  subject: string;
  heading: string;
  body: string;
  buttonLabel: string;
  buttonUrl: string;
  footer: string;
  /** True when `body` came from an admin-edited database row rather than EVENT_COPY. */
  isCustom?: boolean;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

interface DetailRow {
  label: string;
  value: string;
  linkUrl?: string;
}

interface DetailButton {
  label: string;
  url: string;
  primary: boolean;
}

interface DetailView {
  heading: string;
  badgeDate: string;
  highlightLabel: string;
  highlightValue: string;
  showItems: boolean;
  summaryRows: Array<{ label: string; value: string }>;
  totalLabel: string;
  totalValue: string;
  rows: DetailRow[];
  note: string;
  closingAccent: string;
  buttons: DetailButton[];
}

const ITEM_CIRCLE_PALETTE = ['#fadadd', '#fde4c8', '#e6e9fa', '#dff3e8'] as const;

function currentDateLabel(): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatShippingAddress(addr: EmailOrderAddress | null | undefined): string {
  if (!addr) return '';
  const parts = [
    addr.fullName,
    addr.line1,
    addr.line2,
    addr.city,
    addr.state,
    addr.postalCode,
    addr.phone ? `Phone: ${addr.phone}` : '',
  ]
    .map((p) => stripControlChars(text(p)))
    .filter(Boolean);
  return parts.join(', ');
}

function displayOrderReference(detail: EmailOrderDetail): string {
  const num = text(detail.orderNumber);
  const txn = text(detail.txnid);
  if (num && txn && num !== txn) return `${num} (${txn})`;
  return num || txn;
}

function safeDetailLink(pathOrUrl: string | null | undefined, baseUrl: string): string {
  return safeEmailLink(pathOrUrl, baseUrl);
}

function buildItemOptionsLine(item: EmailOrderItem): string {
  const bits: string[] = [];
  if (text(item.deviceModelName)) bits.push(`Model: ${text(item.deviceModelName)}`);
  if (text(item.colourName)) bits.push(`Color: ${text(item.colourName)}`);
  if (text(item.variantLabel) && !text(item.deviceModelName) && !text(item.colourName)) {
    bits.push(text(item.variantLabel));
  }
  bits.push(`Qty: ${Math.max(1, item.quantity)}`);
  return bits.map((bit) => escapeHtml(bit)).join('&nbsp;&nbsp;&nbsp;&nbsp;');
}

function buildPricingSummaryRows(detail: EmailOrderDetail): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Subtotal', value: formatPaise(detail.subtotalPaise) },
  ];
  if (detail.discountPaise > 0) {
    const label = detail.couponCode ? `Discount (${detail.couponCode})` : 'Discount';
    rows.push({ label, value: `-${formatPaise(detail.discountPaise)}` });
  }
  rows.push({
    label: 'Shipping',
    value: detail.shippingPaise === 0 ? 'Free' : formatPaise(detail.shippingPaise),
  });
  return rows;
}

function buildDetailView(
  detail: EmailOrderDetail,
  headingOverride: string,
  baseUrl: string,
): DetailView {
  const encodedTxnid = encodeURIComponent(detail.txnid);
  const orderStatusUrl = safeDetailLink(`/order/status?txnid=${encodedTxnid}`, baseUrl);
  const receiptUrl = safeDetailLink(`/account/orders/${encodedTxnid}/receipt`, baseUrl);
  const supportUrl = safeDetailLink('/support', baseUrl);
  const retryUrl = safeDetailLink(`/order/failed?txnid=${encodedTxnid}`, baseUrl);
  const issueUrl = safeDetailLink(
    detail.hasCustomerAccount ? `/account/orders/${encodedTxnid}` : '/support',
    baseUrl,
  );
  const firstProductItem = detail.items.find((item) => text(item.productId));
  const reviewUrl = safeDetailLink(
    firstProductItem?.productId
      ? `/shop/product/${encodeURIComponent(text(firstProductItem.productId))}`
      : '/shop',
    baseUrl,
  );
  const externalTrackingUrl = safeHttpsUrl(detail.trackingUrl);
  const orderRef = displayOrderReference(detail);
  const fallbackDate = detail.orderDate || currentDateLabel();
  const formattedAddress = formatShippingAddress(detail.shippingAddress);
  const pricingSummary = buildPricingSummaryRows(detail);

  switch (detail.event) {
    case 'order_placed':
      return {
        heading: headingOverride || 'Order Accepted!',
        badgeDate: fallbackDate,
        highlightLabel: formattedAddress ? 'Shipping Address:' : 'Order Status:',
        highlightValue: formattedAddress || 'Order Accepted — Preparing for Dispatch',
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows: [
          { label: 'Order ID', value: orderRef },
          { label: 'Order Date', value: detail.orderDate || fallbackDate },
          { label: 'Payment Method', value: detail.paymentMethod || 'Online Payment' },
          { label: 'Payment Status', value: detail.paymentStatus || 'Pending Confirmation' },
          { label: 'Estimated Delivery', value: detail.estimatedDelivery || '3–5 business days' },
        ],
        note: detail.expectedDispatch
          ? `Your order has been accepted and will be packed shortly (${detail.expectedDispatch}).`
          : 'Your order has been accepted and will be dispatched within 1–2 business days.',
        closingAccent: 'Thanks for shopping with us!',
        buttons: orderStatusUrl ? [{ label: 'View Order', url: orderStatusUrl, primary: true }] : [],
      };

    case 'payment_received': {
      const paidPaise =
        detail.paidAmountPaise !== null && detail.paidAmountPaise !== undefined && detail.paidAmountPaise > 0
          ? detail.paidAmountPaise
          : detail.totalPaise;
      const buttons: DetailButton[] = [];
      if (receiptUrl) buttons.push({ label: 'Payment Receipt', url: receiptUrl, primary: true });
      if (orderStatusUrl) buttons.push({ label: 'View Order', url: orderStatusUrl, primary: buttons.length === 0 });
      return {
        heading: headingOverride || 'Payment Successful!',
        badgeDate: detail.paymentDate || fallbackDate,
        highlightLabel: 'Transaction ID:',
        highlightValue: detail.transactionId || detail.txnid,
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Amount Paid:',
        totalValue: formatPaise(paidPaise),
        rows: [
          { label: 'Transaction ID', value: detail.transactionId || detail.txnid },
          { label: 'Payment Amount', value: formatPaise(paidPaise) },
          { label: 'Payment Method', value: detail.paymentMethod || 'Online Payment' },
          { label: 'Payment Date', value: detail.paymentDate || fallbackDate },
          { label: 'Order ID', value: orderRef },
        ],
        note: 'Your payment is confirmed and your receipt is ready. We will update you as soon as dispatch begins.',
        closingAccent: 'Thanks for shopping with us!',
        buttons,
      };
    }

    case 'processing': {
      const buttons: DetailButton[] = [];
      if (supportUrl) buttons.push({ label: 'Customer Support', url: supportUrl, primary: true });
      if (orderStatusUrl) buttons.push({ label: 'View Order', url: orderStatusUrl, primary: buttons.length === 0 });
      return {
        heading: headingOverride || 'Order is Processing!',
        badgeDate: fallbackDate,
        highlightLabel: 'Processing Status:',
        highlightValue: detail.processingStatus || 'Processing — Preparing for Dispatch',
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows: [
          { label: 'Order ID', value: orderRef },
          { label: 'Order Date', value: detail.orderDate || fallbackDate },
          { label: 'Processing Status', value: detail.processingStatus || 'Processing — Preparing for Dispatch' },
          { label: 'Expected Dispatch Date', value: detail.expectedDispatch || 'Dispatched in 1–2 business days.' },
        ],
        note: 'Our team is carefully packing your order. Need any assistance before dispatch? Use Customer Support below.',
        closingAccent: 'Thanks for shopping with us!',
        buttons,
      };
    }

    case 'shipped': {
      const buttons: DetailButton[] = [];
      const trackHref = externalTrackingUrl || orderStatusUrl;
      if (trackHref) buttons.push({ label: 'Track Shipment', url: trackHref, primary: true });
      if (orderStatusUrl && externalTrackingUrl) {
        buttons.push({ label: 'View Order', url: orderStatusUrl, primary: false });
      }
      return {
        heading: headingOverride || 'Your Order Has Shipped!',
        badgeDate: detail.dispatchDate || fallbackDate,
        highlightLabel: `Courier Partner — ${detail.courierPartner || 'Courier Partner'}:`,
        highlightValue: detail.trackingId ? `Tracking ID: ${detail.trackingId}` : 'Shipment Handed Over to Courier',
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows: [
          { label: 'Courier Partner', value: detail.courierPartner || 'Courier Partner' },
          { label: 'Tracking ID', value: detail.trackingId || 'Updating shortly' },
          {
            label: 'Tracking URL',
            value: externalTrackingUrl || 'Available via View Order once courier activates tracking',
            ...(externalTrackingUrl ? { linkUrl: externalTrackingUrl } : {}),
          },
          { label: 'Dispatch Date', value: detail.dispatchDate || fallbackDate },
          { label: 'Estimated Delivery', value: detail.estimatedDelivery || '3–5 business days' },
        ],
        note: 'Your parcel has been handed over to our courier partner and is now on its way.',
        closingAccent: 'Thanks for shopping with us!',
        buttons,
      };
    }

    case 'delivered': {
      const buttons: DetailButton[] = [];
      if (reviewUrl) buttons.push({ label: 'Review Products', url: reviewUrl, primary: true });
      if (issueUrl) buttons.push({ label: 'Report an Issue', url: issueUrl, primary: buttons.length === 0 });
      const deliveredDate = detail.deliveredDate || fallbackDate;
      return {
        heading: headingOverride || 'Order Delivered!',
        badgeDate: deliveredDate,
        highlightLabel: formattedAddress ? 'Delivered To:' : 'Delivered Date:',
        highlightValue: formattedAddress || deliveredDate,
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Order Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows: [
          { label: 'Delivered Date', value: deliveredDate },
          { label: 'Order ID', value: orderRef },
          {
            label: 'Order Summary',
            value: `${detail.items.length} item${detail.items.length === 1 ? '' : 's'} · Total ${formatPaise(detail.totalPaise)}`,
          },
        ],
        note: 'Your order has been delivered! Enjoy your purchase — you can review your products or report an issue anytime.',
        closingAccent: 'Thanks for shopping with us!',
        buttons,
      };
    }

    case 'cancelled': {
      const refundPaise = detail.refundAmountPaise ?? 0;
      const refundSummary = refundPaise > 0
        ? `${formatPaise(refundPaise)} — ${detail.refundStatus || 'Eligible for refund'}`
        : `₹0.00 — ${detail.refundStatus || 'No payment captured'}`;
      const rows: DetailRow[] = [
        { label: 'Cancellation Confirmation', value: `Confirmed — Order ${orderRef} cancelled` },
        { label: 'Order ID', value: orderRef },
      ];
      if (text(detail.cancellationReason)) {
        rows.push({ label: 'Cancellation Reason', value: text(detail.cancellationReason) });
      }
      rows.push({
        label: 'Refund Eligibility',
        value: detail.refundEligibility || 'No payment captured — no refund required',
      });
      rows.push({ label: 'Refund Amount & Status', value: refundSummary });

      return {
        heading: headingOverride || 'Order Cancelled',
        badgeDate: currentDateLabel(),
        highlightLabel: 'Cancellation Confirmation:',
        highlightValue: `Order ${orderRef} has been cancelled`,
        showItems: true,
        summaryRows: pricingSummary,
        totalLabel: 'Order Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows,
        note: 'This order has been cancelled and will not be dispatched. Any eligible refund follows the status shown above.',
        closingAccent: 'Thanks for shopping with us!',
        buttons: orderStatusUrl ? [{ label: 'View Order', url: orderStatusUrl, primary: true }] : [],
      };
    }

    case 'refund_pending': {
      const amount = detail.refundAmountPaise ?? detail.totalPaise;
      const refundId = text(detail.refundId) || `REF-${detail.orderNumber || detail.txnid}`;
      const initDate = detail.refundInitiationDate || currentDateLabel();
      return {
        heading: headingOverride || 'Refund Initiated!',
        badgeDate: initDate,
        highlightLabel: 'Refund ID:',
        highlightValue: `${refundId} · Submitted to Payment Provider`,
        showItems: false,
        summaryRows: [
          { label: 'Original Transaction ID', value: detail.transactionId || detail.txnid },
          { label: 'Refund Method', value: detail.refundMethod || detail.paymentMethod || 'Original Payment Method' },
        ],
        totalLabel: 'Refund Amount:',
        totalValue: formatPaise(amount),
        rows: [
          { label: 'Refund ID', value: refundId },
          { label: 'Original Transaction ID', value: detail.transactionId || detail.txnid },
          { label: 'Refund Amount', value: formatPaise(amount) },
          { label: 'Refund Method', value: detail.refundMethod || detail.paymentMethod || 'Original Payment Method' },
          { label: 'Initiation Date', value: initDate },
          { label: 'Expected Processing Time', value: detail.refundExpectedTime || '5–7 business days' },
        ],
        note: 'Your refund request has been successfully submitted to the payment provider. We will send another confirmation once settlement completes.',
        closingAccent: 'Thanks for shopping with us!',
        buttons: orderStatusUrl ? [{ label: 'View Order', url: orderStatusUrl, primary: true }] : [],
      };
    }

    case 'refund_completed': {
      const amount = detail.refundAmountPaise ?? detail.totalPaise;
      const procDate = detail.refundProcessingDate || currentDateLabel();
      const refNo = text(detail.refundReference) || text(detail.refundId) || detail.txnid;
      return {
        heading: headingOverride || 'Refund Successful!',
        badgeDate: procDate,
        highlightLabel: 'Refund Confirmation:',
        highlightValue: `Confirmed — ${formatPaise(amount)} refunded`,
        showItems: false,
        summaryRows: [
          { label: 'Refund Reference Number', value: refNo },
          { label: 'Original Payment Method', value: detail.paymentMethod || detail.refundMethod || 'Original Payment Method' },
        ],
        totalLabel: 'Refunded Amount:',
        totalValue: formatPaise(amount),
        rows: [
          { label: 'Refund Confirmation', value: 'Refund Successful — Completed' },
          { label: 'Refunded Amount', value: formatPaise(amount) },
          { label: 'Refund Reference Number', value: refNo },
          { label: 'Original Payment Method', value: detail.paymentMethod || detail.refundMethod || 'Original Payment Method' },
          { label: 'Processing Date', value: procDate },
        ],
        note: 'Bank processing disclaimer: Depending on your bank, UPI app, or card issuer, please allow 3–7 business days for the refunded amount to reflect on your statement.',
        closingAccent: 'Thanks for shopping with us!',
        buttons: orderStatusUrl ? [{ label: 'View Order', url: orderStatusUrl, primary: true }] : [],
      };
    }

    case 'payment_failed': {
      const charged = detail.paidAmountPaise ?? 0;
      const chargedDisplay = charged > 0
        ? `${formatPaise(charged)} (Captured — contact support for verification)`
        : '₹0.00 (No amount charged)';
      const rows: DetailRow[] = [
        { label: 'Payment Failure Status', value: 'Failed / Expired — Order not confirmed' },
        { label: 'Order / Payment Reference', value: orderRef },
      ];
      if (text(detail.paymentFailureReason)) {
        rows.push({ label: 'Failure Reason', value: text(detail.paymentFailureReason) });
      }
      rows.push({ label: 'Amount Charged, if any', value: chargedDisplay });

      const buttons: DetailButton[] = [];
      if (retryUrl) buttons.push({ label: 'Retry Payment', url: retryUrl, primary: true });
      if (supportUrl) buttons.push({ label: 'Customer Support', url: supportUrl, primary: buttons.length === 0 });

      return {
        heading: headingOverride || 'Payment Failed',
        badgeDate: fallbackDate,
        highlightLabel: 'Payment Failure Status:',
        highlightValue: 'Payment Failed / Expired',
        showItems: false,
        summaryRows: [{ label: 'Order / Payment Reference', value: orderRef }],
        totalLabel: 'Amount Charged:',
        totalValue: charged > 0 ? formatPaise(charged) : '₹0.00',
        rows,
        note: 'Duplicate payment support instructions: If your bank or UPI app shows a debit, please do not initiate another payment immediately. Unsettled charges usually auto-reverse within 3–5 business days, or contact Support with your Order Reference and bank UTR.',
        closingAccent: 'Need help completing your order?',
        buttons,
      };
    }

    default:
      return {
        heading: headingOverride || 'Order Update',
        badgeDate: fallbackDate,
        highlightLabel: formattedAddress ? 'Shipping Address:' : 'Order Status:',
        highlightValue: formattedAddress || statusLabel(detail.orderStatus) || 'Updated',
        showItems: detail.items.length > 0,
        summaryRows: pricingSummary,
        totalLabel: 'Total:',
        totalValue: formatPaise(detail.totalPaise),
        rows: [{ label: 'Order ID', value: orderRef }],
        note: 'You can view the latest status of your order anytime using the button below.',
        closingAccent: 'Thanks for shopping with us!',
        buttons: orderStatusUrl ? [{ label: 'View Order', url: orderStatusUrl, primary: true }] : [],
      };
  }
}

/**
 * Gmail strips inline <svg> elements, so draw the top-left shopping bag mark
 * using crisp border geometry inside a role="presentation" table.
 */
function renderShoppingBagMarkHtml(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:0;line-height:0;font-size:0;">
        <div style="width:10px;height:6px;margin:0 auto;border:2px solid #111111;border-bottom:0;border-radius:6px 6px 0 0;"></div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0;line-height:0;font-size:0;">
        <div style="width:20px;height:16px;border:2px solid #111111;border-radius:4px 4px 6px 6px;background-color:#ffffff;"></div>
      </td>
    </tr>
  </table>`;
}

function renderItemRowHtml(
  item: EmailOrderItem,
  index: number,
  event: NotificationEvent,
  baseUrl: string,
): string {
  const circleBg = ITEM_CIRCLE_PALETTE[index % ITEM_CIRCLE_PALETTE.length];
  const imgUrl = safeEmailLink(item.imageUrl, baseUrl);
  const alt = escapeHtml(item.imageAlt || item.productName);
  const initial = escapeHtml((text(item.productName).charAt(0) || 'G').toUpperCase());

  const thumbHtml = imgUrl
    ? `<img src="${escapeHtml(imgUrl)}" alt="${alt}" width="42" height="42" style="display:block;width:42px;height:42px;object-fit:contain;margin:0 auto;border:0;border-radius:50%;" />`
    : `<span style="font-size:17px;font-weight:700;color:#3a2f35;line-height:42px;display:block;text-align:center;">${initial}</span>`;

  const badgeHtml = item.isFreeGift
    ? ` <span style="display:inline-block;padding:2px 8px;margin-left:6px;background:#fce4ec;color:#c82362;border-radius:999px;font-size:10px;font-weight:700;vertical-align:middle;">${escapeHtml(item.freeGiftBadge || 'FREE GIFT')}</span>`
    : '';

  const productHref = event === 'delivered' && text(item.productId)
    ? safeEmailLink(`/shop/product/${encodeURIComponent(text(item.productId))}`, baseUrl)
    : '';
  const reviewLinkHtml = productHref
    ? `<div style="margin-top:4px;"><a href="${escapeHtml(productHref)}" style="font-size:11px;font-weight:600;color:#c82362;text-decoration:none;">Review this product &rarr;</a></div>`
    : '';

  const priceDisplay = item.isFreeGift && item.lineTotalPaise === 0
    ? 'Free'
    : formatPaise(item.lineTotalPaise || item.unitPricePaise * Math.max(1, item.quantity));

  return `<tr>
    <td style="padding:10px 0;vertical-align:middle;width:62px;">
      <table role="presentation" width="56" cellpadding="0" cellspacing="0" border="0" style="width:56px;height:56px;border-radius:50%;background-color:${circleBg};">
        <tr>
          <td align="center" valign="middle" style="padding:0;width:56px;height:56px;text-align:center;">
            ${thumbHtml}
          </td>
        </tr>
      </table>
    </td>
    <td style="padding:10px 14px;vertical-align:middle;">
      <div style="font-size:14px;line-height:1.35;font-weight:700;color:#111111;">${escapeHtml(item.productName)}${badgeHtml}</div>
      <div style="margin-top:4px;font-size:12px;line-height:1.4;color:#86868b;">${buildItemOptionsLine(item)}</div>
      ${reviewLinkHtml}
    </td>
    <td align="right" style="padding:10px 0;vertical-align:middle;white-space:nowrap;font-size:14px;font-weight:700;color:#111111;">
      ${escapeHtml(priceDisplay)}
    </td>
  </tr>`;
}

function renderButtonsHtml(buttons: DetailButton[]): string {
  if (buttons.length === 0) return '';
  const links = buttons
    .map((btn, idx) => {
      const style = btn.primary
        ? 'display:inline-block;background-color:#111111;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:980px;font-size:13px;font-weight:600;letter-spacing:-0.01em;'
        : 'display:inline-block;background-color:#ffffff;color:#111111;border:1px solid #d2d2d7;text-decoration:none;padding:10px 20px;border-radius:980px;font-size:13px;font-weight:600;letter-spacing:-0.01em;';
      const spacing = idx > 0 ? 'margin-left:10px;' : '';
      return `<a href="${escapeHtml(btn.url)}" style="${style}${spacing}">${escapeHtml(btn.label)}</a>`;
    })
    .join('');
  return `<div style="padding:18px 32px 0 32px;">${links}</div>`;
}

function renderDetailRowsHtml(rows: DetailRow[]): string {
  if (rows.length === 0) return '';
  const trs = rows
    .map((row, idx) => {
      const border = idx < rows.length - 1 ? 'border-bottom:1px solid #f2eff0;' : '';
      const valHtml = row.linkUrl
        ? `<a href="${escapeHtml(row.linkUrl)}" style="color:#0066cc;font-weight:600;text-decoration:none;word-break:break-all;">${escapeHtml(row.value)}</a>`
        : escapeHtml(row.value);
      return `<tr>
        <td style="padding:9px 10px 9px 0;${border}font-size:12px;color:#76767c;vertical-align:top;width:44%;">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:9px 0 9px 10px;${border}font-size:12px;font-weight:700;color:#111111;vertical-align:top;word-break:break-word;">${valHtml}</td>
      </tr>`;
    })
    .join('');

  return `<div style="padding:16px 32px 0 32px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${trs}</table>
  </div>`;
}

function renderTotalBandHtml(
  summaryRows: Array<{ label: string; value: string }>,
  totalLabel: string,
  totalValue: string,
): string {
  const breakdownHtml = summaryRows.length > 0
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:10px;">
        ${summaryRows
      .map(
        (r) => `<tr>
              <td style="padding:3px 0;font-size:12px;color:#6e6e73;">${escapeHtml(r.label)}</td>
              <td align="right" style="padding:3px 0;font-size:12px;font-weight:600;color:#2c2c2e;">${escapeHtml(r.value)}</td>
            </tr>`,
      )
      .join('')}
      </table>`
    : '';

  const infoBadge = `<span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:50%;background-color:#111111;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:700;font-size:12px;vertical-align:middle;margin-left:8px;">i</span>`;

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8f4f5;">
    <tr>
      <td style="padding:16px 32px 18px 32px;">
        ${breakdownHtml}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td align="right" style="padding-top:${summaryRows.length > 0 ? '8px' : '0'};${summaryRows.length > 0 ? 'border-top:1px solid #ece4e7;' : ''}">
              <span style="font-size:14px;font-weight:500;color:#3a3a3c;vertical-align:middle;">${escapeHtml(totalLabel)}</span>
              <span style="font-size:21px;font-weight:800;color:#111111;vertical-align:middle;margin-left:6px;letter-spacing:-0.02em;">${escapeHtml(totalValue)}</span>${infoBadge}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function renderCardShellHtml(options: {
  orderRef: string;
  badgeDate: string;
  heading: string;
  highlightLabel: string;
  highlightValue: string;
  itemsHtml: string;
  totalBandHtml: string;
  detailRowsHtml: string;
  noteHtml: string;
  buttonsHtml: string;
  closingAccent: string;
  supportUrl: string;
  storeName: string;
  year: number;
  customFooter: string;
}): string {
  const orderHeaderHtml = options.orderRef
    ? `<div style="font-size:13px;line-height:1.3;color:#111111;"><strong style="font-weight:700;">Order#:</strong>&nbsp;&nbsp;<span style="font-weight:600;">${escapeHtml(options.orderRef)}</span></div>`
    : `<div style="font-size:13px;line-height:1.3;font-weight:700;color:#111111;">${escapeHtml(options.storeName)}</div>`;

  const dateHeaderHtml = options.badgeDate
    ? `<div style="margin-top:4px;font-size:12px;color:#76767c;">${escapeHtml(options.badgeDate)}</div>`
    : '';

  const headingHtml = options.heading
    ? `<div style="padding:0 32px 18px 32px;">
        <h1 style="margin:0;font-size:24px;line-height:1.22;letter-spacing:-0.02em;font-weight:800;color:#111111;">${escapeHtml(options.heading)}</h1>
      </div>`
    : '';

  const highlightHtml = options.highlightLabel && options.highlightValue
    ? `<div style="padding:0 32px 18px 32px;">
        <div style="font-size:12px;color:#8e8e93;margin-bottom:5px;">${escapeHtml(options.highlightLabel)}</div>
        <div style="font-size:13px;line-height:1.5;font-weight:700;color:#111111;">${escapeHtml(options.highlightValue)}</div>
      </div>`
    : '';

  const supportHtml = options.supportUrl
    ? `<a href="${escapeHtml(options.supportUrl)}" style="color:#0066cc;font-size:12px;font-weight:500;text-decoration:none;">Need Help?</a>`
    : `<span style="color:#8e8e93;font-size:12px;">Need Help?</span>`;

  const customFooterHtml = options.customFooter
    ? `<div style="padding:0 32px 20px 32px;font-size:11px;line-height:1.5;color:#8e8e93;">${escapeHtml(options.customFooter)}</div>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:36px 16px;background-color:#fef2f4;background-image:radial-gradient(circle at 14% 26%,rgba(255,66,94,0.14) 0,rgba(255,66,94,0) 240px),radial-gradient(circle at 86% 78%,rgba(245,30,90,0.16) 0,rgba(245,30,90,0) 260px);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:580px;background-color:#ffffff;border-radius:16px;border:1px solid #f4e5e9;box-shadow:0 20px 50px rgba(200,35,98,0.09);overflow:hidden;">
        <tr>
          <td style="padding:30px 32px 18px 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="top" style="padding:0;">${renderShoppingBagMarkHtml()}</td>
                <td align="right" valign="top" style="padding:0;">${orderHeaderHtml}${dateHeaderHtml}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0;">
            ${headingHtml}${highlightHtml}${options.itemsHtml}${options.totalBandHtml}${options.detailRowsHtml}${options.noteHtml}${options.buttonsHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:22px 32px 14px 32px;">
            <div style="font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:#c82362;">${escapeHtml(options.closingAccent)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:10px 32px ${options.customFooter ? '12px' : '28px'} 32px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td style="padding:0;">${supportHtml}</td>
                <td align="right" style="padding:0;font-size:12px;color:#8e8e93;">&copy; ${escapeHtml(options.storeName.toUpperCase())} ${options.year}</td>
              </tr>
            </table>
          </td>
        </tr>
        ${customFooterHtml ? `<tr><td style="padding:0;">${customFooterHtml}</td></tr>` : ''}
      </table>
    </td>
  </tr>
</table>
</body></html>`;
}

/**
 * Compose the HTML and plain-text versions of an email. The stored/default
 * template parts are merged by the caller; when structured `detail` is
 * provided for an order/payment/refund event, the card renders every field
 * matching the transactional UI specification.
 */
export function renderEmail(
  parts: EmailParts,
  values: Readonly<Record<string, string>>,
  baseUrl: string,
  detail?: EmailOrderDetail | null,
): RenderedEmail {
  const subject = renderText(parts.subject, values, true) || 'Notification from Gadzio';
  const heading = renderText(parts.heading, values, true);
  const body = renderText(parts.body, values);
  const buttonLabel = renderText(parts.buttonLabel, values, true);
  const buttonUrl = safeEmailLink(renderText(parts.buttonUrl, values, true), baseUrl);
  const footer = parts.footer ? renderText(parts.footer, values) : defaultFooter(values);
  const storeName = values.store_name || 'Gadzio';
  const supportUrl = safeEmailLink('/support', baseUrl);
  const year = new Date().getUTCFullYear();

  if (detail) {
    const view = buildDetailView(detail, heading, baseUrl);
    const itemsHtml = view.showItems && detail.items.length > 0
      ? `<div style="padding:4px 32px 16px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${detail.items.map((item, i) => renderItemRowHtml(item, i, detail.event, baseUrl)).join('')}
          </table>
        </div>`
      : '';

    const totalBandHtml = renderTotalBandHtml(view.summaryRows, view.totalLabel, view.totalValue);
    const detailRowsHtml = renderDetailRowsHtml(view.rows);

    const customBodyHtml = parts.isCustom && body
      ? `<p style="font-size:13px;line-height:1.6;margin:0 0 10px 0;color:#2c2c2e;">${escapeHtml(body).replace(/\n/g, '<br>')}</p>`
      : '';
    const noteTextHtml = view.note
      ? `<p style="font-size:13px;line-height:1.6;margin:0;color:#55555a;">${escapeHtml(view.note)}</p>`
      : '';
    const noteHtml = customBodyHtml || noteTextHtml
      ? `<div style="padding:16px 32px 0 32px;">${customBodyHtml}${noteTextHtml}</div>`
      : '';

    // Preserve any admin-configured custom CTA button if the admin edited buttonLabel/buttonUrl
    const buttons = parts.isCustom && buttonLabel && buttonUrl
      ? [{ label: buttonLabel, url: buttonUrl, primary: true }, ...view.buttons.filter((b) => b.url !== buttonUrl)]
      : view.buttons;

    const html = renderCardShellHtml({
      orderRef: detail.orderNumber || detail.txnid,
      badgeDate: view.badgeDate,
      heading: view.heading,
      highlightLabel: view.highlightLabel,
      highlightValue: view.highlightValue,
      itemsHtml,
      totalBandHtml,
      detailRowsHtml,
      noteHtml,
      buttonsHtml: renderButtonsHtml(buttons),
      closingAccent: view.closingAccent,
      supportUrl,
      storeName,
      year,
      customFooter: parts.footer ? footer : '',
    });

    const itemLines = view.showItems && detail.items.length > 0
      ? detail.items.map((it) => `- ${it.productName} x ${it.quantity}: ${it.isFreeGift && it.lineTotalPaise === 0 ? 'Free' : formatPaise(it.lineTotalPaise || it.unitPricePaise * it.quantity)}`).join('\n')
      : '';
    const detailLines = view.rows.map((r) => `${r.label}: ${r.value}`).join('\n');
    const summaryLines = view.summaryRows.map((s) => `${s.label}: ${s.value}`).join('\n');
    const buttonLines = buttons.map((b) => `${b.label}: ${b.url}`).join('\n');

    const textParts = [
      view.heading,
      view.highlightLabel && view.highlightValue ? `${view.highlightLabel} ${view.highlightValue}` : '',
      itemLines,
      summaryLines,
      `${view.totalLabel} ${view.totalValue}`,
      detailLines,
      parts.isCustom && body ? body : '',
      view.note,
      buttonLines,
      view.closingAccent,
      footer,
    ].filter(Boolean);

    return { subject, text: textParts.join('\n\n'), html };
  }

  // Fallback / staff / direct 3-argument render path: uses exact same blush-card visual shell
  const summaryRows: DetailRow[] = [];
  if (values.order_number) summaryRows.push({ label: 'Order', value: values.order_number });
  if (values.tracking_number) summaryRows.push({ label: 'Tracking', value: values.tracking_number });

  const totalValue = values.refund_amount || values.order_total || '';
  const totalLabel = values.refund_amount ? 'Refund:' : 'Total:';
  const totalBandHtml = totalValue ? renderTotalBandHtml([], totalLabel, totalValue) : '';

  const noteHtml = body
    ? `<div style="padding:0 32px 16px 32px;"><p style="font-size:14px;line-height:1.65;margin:0;color:#2c2c2e;">${escapeHtml(body).replace(/\n/g, '<br>')}</p></div>`
    : '';

  const fallbackButtons: DetailButton[] = buttonUrl && buttonLabel
    ? [{ label: buttonLabel, url: buttonUrl, primary: true }]
    : [];

  const html = renderCardShellHtml({
    orderRef: values.order_number || '',
    badgeDate: '',
    heading: heading || 'Notification',
    highlightLabel: '',
    highlightValue: '',
    itemsHtml: '',
    totalBandHtml,
    detailRowsHtml: renderDetailRowsHtml(summaryRows),
    noteHtml,
    buttonsHtml: renderButtonsHtml(fallbackButtons),
    closingAccent: 'Thanks for shopping with us!',
    supportUrl,
    storeName,
    year,
    customFooter: parts.footer ? footer : '',
  });

  const textParts = [heading, body, buttonUrl, footer].filter(Boolean);
  return { subject, text: textParts.join('\n\n'), html };
}

interface Copy {
  subject: string;
  heading: string;
  body: string;
  sms: string;
  buttonLabel?: string;
  buttonUrl?: string;
}

const CUSTOMER = 'customer' as const;
const STAFF = 'staff' as const;

/**
 * Built-in copy for every event and audience. A missing stored template never
 * means a silent or blank message.
 */
const EVENT_COPY: Readonly<Record<NotificationEvent, Readonly<Record<NotificationAudience, Copy>>>> = {
  order_placed: {
    [CUSTOMER]: {
      subject: 'Order Accepted — #{{order_number}}',
      heading: 'Order Accepted!',
      body: 'Hi {{customer_name}},\n\nYour order {{order_number}} for {{order_total}} has been accepted.\n\nWe will email you again when it is on the way.',
      sms: '{{store_name}}: order {{order_number}} accepted. Total {{order_total}}.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Order accepted: {{order_number}}',
      heading: 'Order accepted',
      body: 'Order {{order_number}} for {{order_total}} ({{item_count}} item(s)) was accepted.',
      sms: '{{store_name}}: order {{order_number}} accepted ({{order_total}}).',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  payment_received: {
    [CUSTOMER]: {
      subject: 'Payment Successful — Order #{{order_number}}',
      heading: 'Payment Successful!',
      body: 'Hi {{customer_name}},\n\nWe have received {{order_total}} for order {{order_number}}. Your payment is confirmed.',
      sms: '{{store_name}}: payment of {{order_total}} received for {{order_number}}.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Payment received: {{order_number}}',
      heading: 'Payment received',
      body: 'Order {{order_number}} was paid. Total {{order_total}}.',
      sms: '{{store_name}}: {{order_number}} paid {{order_total}}.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  processing: {
    [CUSTOMER]: {
      subject: 'Order #{{order_number}} is Being Processed',
      heading: 'Order is Processing!',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} is being prepared for dispatch.',
      sms: '{{store_name}}: order {{order_number}} is being prepared.',
      buttonLabel: 'Customer Support',
      buttonUrl: '/support',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} in processing',
      heading: 'Order moved to processing',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} is now {{order_status}}.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  shipped: {
    [CUSTOMER]: {
      subject: 'Order #{{order_number}} Has Shipped',
      heading: 'Your Order Has Shipped!',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} has shipped.\n\nTracking number: {{tracking_number}}',
      sms: '{{store_name}}: order {{order_number}} shipped. Tracking {{tracking_number}}.',
      buttonLabel: 'Track Shipment',
      buttonUrl: '{{tracking_link}}',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} shipped',
      heading: 'Order shipped',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} shipped.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  delivered: {
    [CUSTOMER]: {
      subject: 'Order #{{order_number}} Delivered',
      heading: 'Order Delivered!',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} was delivered. If something is wrong, contact us within {{return_window_days}} days.',
      sms: '{{store_name}}: order {{order_number}} delivered.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} delivered',
      heading: 'Order delivered',
      body: 'Order {{order_number}} is now {{order_status}}.',
      sms: '{{order_number}} delivered.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  cancelled: {
    [CUSTOMER]: {
      subject: 'Order #{{order_number}} Cancelled',
      heading: 'Order Cancelled',
      body: 'Hi {{customer_name}},\n\nOrder {{order_number}} has been cancelled. If a payment was taken, any eligible refund follows the store refund policy.',
      sms: '{{store_name}}: order {{order_number}} cancelled.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Order {{order_number}} cancelled',
      heading: 'Order cancelled',
      body: 'Order {{order_number}} was cancelled. Total {{order_total}}.',
      sms: '{{order_number}} cancelled.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  refund_requested: {
    [CUSTOMER]: {
      subject: 'We received your request for {{order_number}}',
      heading: 'Request received',
      body: 'Hi {{customer_name}},\n\nWe have received your request for order {{order_number}}. Our team will review it and reply soon.',
      sms: '{{store_name}}: request received for order {{order_number}}.',
    },
    [STAFF]: {
      subject: 'New request for {{order_number}}',
      heading: 'New customer request',
      body: 'A request was opened for order {{order_number}}.',
      sms: '{{order_number}}: new customer request.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  refund_completed: {
    [CUSTOMER]: {
      subject: 'Refund Successful — Order #{{order_number}}',
      heading: 'Refund Successful!',
      body: 'Hi {{customer_name}},\n\nA refund of {{refund_amount}} for order {{order_number}} has been completed. Please allow 3–7 business days for your bank to reflect it.',
      sms: '{{store_name}}: refund of {{refund_amount}} completed for {{order_number}}.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Refund completed: {{order_number}}',
      heading: 'Refund completed',
      body: 'A refund of {{refund_amount}} was recorded for order {{order_number}}.',
      sms: '{{order_number}}: refund {{refund_amount}} completed.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  back_in_stock: {
    [CUSTOMER]: {
      subject: '{{product_name}} is back in stock',
      heading: 'Back in stock',
      body: '{{product_name}} is available again. Order soon while stock lasts.',
      sms: '{{store_name}}: {{product_name}} is back in stock.',
    },
    [STAFF]: {
      subject: 'Back in stock: {{product_name}}',
      heading: 'Back in stock',
      body: '{{product_name}} is back in stock ({{stock_available}} available to buy).',
      sms: '{{product_name}} back in stock.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  password_reset: {
    [CUSTOMER]: {
      subject: 'Your password was reset',
      heading: 'Password updated',
      body: 'Hi {{customer_name}},\n\nThe password for your account was changed. If this was not you, contact us at {{support_email}}.',
      sms: '{{store_name}}: your password was changed. If this was not you, contact support.',
    },
    [STAFF]: {
      subject: 'Staff password reset',
      heading: 'Password updated',
      body: 'The password for this staff account was changed. If this was not expected, contact the store owner.',
      sms: '{{store_name}}: staff password was changed.',
    },
  },
  staff_invite: {
    [CUSTOMER]: {
      subject: 'Your account is ready',
      heading: 'Account created',
      body: 'An account was created for you at {{store_name}}.',
      sms: '{{store_name}}: your account is ready.',
    },
    [STAFF]: {
      subject: 'Your staff account is ready',
      heading: 'Welcome to the team',
      body: 'A staff account has been created for you at {{store_name}}. Sign in with the password the owner shared with you; you will be asked to change it.',
      sms: '{{store_name}}: your staff account is ready. Sign in with the password the owner shared with you.',
      buttonLabel: 'Sign in to Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  low_stock: {
    [CUSTOMER]: {
      subject: '{{product_name}} is low in stock',
      heading: 'Low stock',
      body: 'Hurry, {{product_name}} is low in stock.',
      sms: '{{store_name}}: {{product_name}} is low in stock.',
    },
    [STAFF]: {
      subject: 'Low stock: {{product_name}}',
      heading: 'Low stock alert',
      body: '{{product_name}} is low on stock ({{stock_available}} available to buy).',
      sms: '{{store_name}}: low stock for {{product_name}} ({{stock_available}} left).',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  payment_processing: {
    [CUSTOMER]: {
      subject: 'We are verifying your payment for {{order_number}}',
      heading: 'Payment being verified',
      body: 'Hi {{customer_name}},\n\nYour payment is being verified. If your bank has debited the amount, please do not pay again while this transaction is being checked. We will update your order status when confirmation is received.\n\nOrder: {{order_number}}\nAmount: {{order_total}}',
      sms: '{{store_name}}: payment for {{order_number}} is being verified. Please do not pay again while we check.',
      buttonLabel: 'Check order status',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Payment verification needed: {{order_number}}',
      heading: 'Payment awaiting verification',
      body: 'Order {{order_number}} ({{order_total}}) has an unresolved payment outcome. The stock claim is held while PayU is re-checked.',
      sms: '{{store_name}}: {{order_number}} payment outcome unresolved.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  payment_failed: {
    [CUSTOMER]: {
      subject: 'Payment Failed — Order #{{order_number}}',
      heading: 'Payment Failed',
      body: 'Hi {{customer_name}},\n\nWe could not confirm a successful payment for order {{order_number}}. No order will be dispatched.\n\nIf your bank shows a debit, contact us at {{support_email}} before trying again. Otherwise you can retry checkout.',
      sms: '{{store_name}}: payment for {{order_number}} did not complete. If your bank shows a debit, contact support before retrying.',
      buttonLabel: 'Retry Payment',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Payment failed: {{order_number}}',
      heading: 'Payment failed',
      body: 'Order {{order_number}} for {{order_total}} has a definitive failed payment. The stock claim is released after the grace window.',
      sms: '{{order_number}}: payment failed.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  reservation_expired: {
    [CUSTOMER]: {
      subject: 'Your reservation for {{order_number}} expired',
      heading: 'Reservation expired',
      body: 'Hi {{customer_name}},\n\nThe reservation for order {{order_number}} expired before a payment was confirmed, so the unit has been returned to the store. No order will be dispatched from this checkout.\n\nIf your bank shows a debit, contact us at {{support_email}} before paying again. Otherwise you can start a new checkout.',
      sms: '{{store_name}}: reservation for {{order_number}} expired. If your bank shows a debit, contact support before retrying.',
      buttonLabel: 'View order status',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Reservation expired: {{order_number}}',
      heading: 'Reservation expired',
      body: 'The reservation for order {{order_number}} expired without a verified payment. The stock claim was released.',
      sms: '{{order_number}}: reservation expired.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  refund_pending: {
    [CUSTOMER]: {
      subject: 'Refund Initiated — Order #{{order_number}}',
      heading: 'Refund Initiated!',
      body: 'Hi {{customer_name}},\n\nA refund of {{refund_amount}} has been initiated for order {{order_number}} and submitted to the payment provider. It typically completes in 5–7 business days.',
      sms: '{{store_name}}: refund of {{refund_amount}} initiated for {{order_number}}.',
      buttonLabel: 'View Order',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Refund owed: {{order_number}}',
      heading: 'Refund obligation',
      body: 'Order {{order_number}} was paid {{refund_amount}} after its stock was released and could not be reclaimed. Record the refund in Store Admin once it is settled.',
      sms: '{{order_number}}: refund {{refund_amount}} owed.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  payment_review: {
    [CUSTOMER]: {
      subject: 'We are checking a payment for {{order_number}}',
      heading: 'Payment under review',
      body: 'Hi {{customer_name}},\n\nYour payment is being verified. If your bank has debited the amount, please do not pay again while this transaction is being checked. We will update your order status when confirmation is received.',
      sms: '{{store_name}}: payment for {{order_number}} is under review. Please do not pay again while we check.',
      buttonLabel: 'Check order status',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Payment needs review: {{order_number}}',
      heading: 'Payment flagged for review',
      body: 'Order {{order_number}} needs a manual payment check. Verify the transaction in the PayU dashboard before fulfilling, cancelling or refunding.',
      sms: '{{order_number}}: payment needs manual review.',
      buttonLabel: 'Open in Store Admin',
      buttonUrl: '{{admin_link}}',
    },
  },
  spin_win: {
    [CUSTOMER]: {
      subject: 'You won {{prize_name}} on Spin and Win!',
      heading: 'Congratulations, you won {{prize_name}}',
      body: 'Hi {{customer_name}},\n\nYou won {{prize_name}} on Spin and Win at {{store_name}}! Your personal coupon code is {{coupon_code}}, valid until {{coupon_expiry}}.\n\nIt has been added to Your Coupons and is ready to use at checkout.',
      sms: '{{store_name}}: You won {{prize_name}}! Code {{coupon_code}} valid until {{coupon_expiry}}.',
      buttonLabel: 'View my coupons',
      buttonUrl: '{{admin_link}}',
    },
    [STAFF]: {
      subject: 'Spin and Win prize awarded: {{prize_name}}',
      heading: 'Spin and Win prize awarded',
      body: 'A customer won {{prize_name}} on Spin and Win. Coupon {{coupon_code}} (valid until {{coupon_expiry}}) was created.',
      sms: 'Spin win: {{prize_name}} ({{coupon_code}}).',
      buttonLabel: 'Open Spin wheel report',
      buttonUrl: '{{admin_link}}',
    },
  },
};

export function defaultTemplate(
  event: NotificationEvent,
  channel: NotificationChannel,
  audience: NotificationAudience,
): EmailParts {
  const copy = EVENT_COPY[event][audience];
  if (channel === 'sms') {
    return {
      subject: copy.subject,
      heading: '',
      body: copy.sms,
      buttonLabel: '',
      buttonUrl: '',
      footer: '',
    };
  }
  if (channel === 'inapp') {
    return {
      subject: copy.subject,
      heading: copy.heading,
      body: copy.sms,
      buttonLabel: '',
      buttonUrl: '',
      footer: '',
    };
  }
  return {
    subject: copy.subject,
    heading: copy.heading,
    body: copy.body,
    buttonLabel: copy.buttonLabel ?? '',
    buttonUrl: copy.buttonUrl ?? '',
    footer: '',
  };
}
