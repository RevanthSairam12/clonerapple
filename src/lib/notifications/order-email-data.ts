/**
 * Server-only loader that enriches a customer notification email with order,
 * line-item (images + variant snapshot), shipping address, fulfilment/tracking,
 * payment, and refund metadata from PostgreSQL.
 *
 * Every query is isolated in try/catch so deployments or tests running against
 * a partial schema degrade smoothly instead of failing notification delivery.
 * Customer PII loaded here (such as shipping address) is strictly scoped to
 * `audience === 'customer'` email rendering and never shared with staff views
 * or notification context logs.
 */

import type postgres from 'postgres';

import type {
  EmailOrderAddress,
  EmailOrderDetail,
  EmailOrderItem,
  NotificationContext,
  NotificationEvent,
} from './types';

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nonNegInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed);
  }
  return null;
}

function rupeesToPaise(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

function positiveInt(value: unknown, fallback = 1): number {
  const n = nonNegInt(value);
  return n !== null && n > 0 ? n : fallback;
}

/** Format an ISO timestamp / Date string as e.g. `14 Nov 2026` in IST. */
export function formatEmailDate(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function addDaysIso(base: unknown, days: number): string | null {
  const date = base instanceof Date ? new Date(base.getTime()) : new Date(String(base ?? ''));
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Math.max(0, days));
  return formatEmailDate(date);
}

const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  upi: 'UPI',
  cc: 'Credit Card',
  dc: 'Debit Card',
  nb: 'Netbanking',
  card_machine: 'Card',
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  cod: 'Cash on Delivery',
  payu: 'PayU Online (UPI / Card / Netbanking)',
  wallet: 'Wallet',
  emi: 'EMI',
  bnpl: 'Pay Later',
  other: 'Online Payment',
};

export function formatPaymentMethodLabel(
  payuMode: string | null | undefined,
  paymentMethod: string | null | undefined,
): string {
  const mode = str(payuMode).toLowerCase();
  const method = str(paymentMethod).toLowerCase();
  if (mode && PAYMENT_METHOD_LABELS[mode]) {
    return method === 'payu' ? `PayU (${PAYMENT_METHOD_LABELS[mode]})` : PAYMENT_METHOD_LABELS[mode];
  }
  if (mode) {
    return method === 'payu' ? `PayU (${payuMode?.trim()})` : str(payuMode).toUpperCase();
  }
  if (method && PAYMENT_METHOD_LABELS[method]) return PAYMENT_METHOD_LABELS[method];
  if (method) return method.replace(/_/g, ' ');
  return 'Online Payment';
}

function formatPaymentStatusLabel(orderStatus: string, paymentMethod: string, paidPaise: number): string {
  const st = orderStatus.toUpperCase();
  const pm = paymentMethod.toLowerCase();
  if (st === 'PAID' || paidPaise > 0) return 'Paid';
  if (pm === 'cod') return 'Pay on Delivery';
  if (st === 'FAILED') return 'Payment Failed';
  if (st === 'CANCELLED') return 'Cancelled';
  if (st === 'PROCESSING') return 'Verification in Progress';
  return 'Pending Confirmation';
}

function humanizeProcessingStatus(fulfilmentStatus: string): string {
  switch (fulfilmentStatus.toUpperCase()) {
    case 'ACCEPTED':
      return 'Order Accepted — Preparing for Dispatch';
    case 'PROCESSING':
      return 'Processing — Packing in Progress';
    case 'ON_THE_WAY':
      return 'Dispatched — In Transit';
    case 'DELIVERED':
      return 'Delivered';
    case 'CANCELED':
    case 'CANCELLED':
      return 'Cancelled';
    default:
      return 'Order Confirmed — Queued for Processing';
  }
}

function sanitizeCustomerReason(raw: string | null | undefined): string | null {
  const value = str(raw).replace(/[\r\n\t]+/g, ' ').trim();
  if (!value) return null;
  if (value === 'verification_claim_lease') return null;

  const known: Readonly<Record<string, string>> = {
    grace_expired: 'The payment session expired before confirmation was received.',
    reservation_expired: 'The checkout reservation expired before payment completed.',
    payu_failed: 'The payment was declined by your bank or payment provider.',
    amount_mismatch: 'The payment amount could not be verified.',
    user_cancelled: 'Cancelled during checkout before completion.',
    admin_cancelled: 'Cancelled by the store team.',
    customer_request: 'Cancelled at customer request.',
  };
  const key = value.toLowerCase();
  if (known[key]) return known[key];

  // Drop internal codes or anything containing email/long payload fragments
  if (value.includes('@') || value.length > 180 || /^[\[{]/.test(value)) {
    return null;
  }
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function mapJsonFallbackItems(rawItems: unknown): EmailOrderItem[] {
  if (!Array.isArray(rawItems)) return [];
  const out: EmailOrderItem[] = [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = str(item.name || item.productName || item.product_name);
    if (!name) continue;
    const quantity = positiveInt(item.quantity, 1);
    const unitPricePaise = nonNegInt(item.unitPricePaise)
      ?? rupeesToPaise(item.unitPrice ?? item.price)
      ?? 0;
    const lineTotalPaise = nonNegInt(item.lineTotalPaise)
      ?? rupeesToPaise(item.totalPrice ?? item.lineTotal)
      ?? unitPricePaise * quantity;
    out.push({
      productId: str(item.id || item.productId || item.product_id) || null,
      productName: name,
      quantity,
      unitPricePaise,
      lineTotalPaise,
      imageUrl: str(item.imageUrl || item.image_url || item.image) || null,
      imageAlt: str(item.imageAlt || item.image_alt) || name,
      deviceModelName: str(item.deviceModelName || item.device_model_name) || null,
      colourName: str(item.colourName || item.colour_name || item.color) || null,
      variantLabel: str(item.variantLabel || item.variant_label) || null,
      isFreeGift: item.isFreeGift === true || item.is_free_gift === true,
      freeGiftBadge: str(item.freeGiftBadge || item.free_gift_badge) || null,
    });
  }
  return out;
}

async function safeQuery<T>(fn: () => Promise<Iterable<T>>, fallback: T[] = []): Promise<T[]> {
  try {
    return Array.from(await fn());
  } catch {
    return fallback;
  }
}

export interface LoadEmailOrderDetailOptions {
  sql: postgres.Sql;
  txnid: string;
  event: NotificationEvent;
  context?: NotificationContext;
  supportEmail?: string | null;
  supportPhone?: string | null;
}

export async function loadEmailOrderDetail(
  opts: LoadEmailOrderDetailOptions,
): Promise<EmailOrderDetail | null> {
  const txnid = str(opts.txnid);
  if (!txnid) return null;

  const orderRows = await safeQuery(
    () =>
      opts.sql<Array<{ row_data: Record<string, unknown> }>>`
        select to_jsonb(o) as row_data
        from orders o
        where o.txnid = ${txnid}
        limit 1
      `,
    [],
  );

  const o = orderRows[0]?.row_data;
  if (!o) return null;

  const orderId = str(o.id);
  const orderNumber = positiveInt(o.order_number, 0) > 0
    ? String(positiveInt(o.order_number, 0))
    : (str(opts.context?.orderNumber) || txnid);
  const currency = str(o.currency) || 'INR';
  const orderStatus = str(o.status) || str(opts.context?.orderStatus) || 'CREATED';
  const fulfilmentStatus = str(o.fulfilment_status) || 'PENDING';
  const totalPaise = nonNegInt(o.total_paise)
    ?? rupeesToPaise(o.amount)
    ?? opts.context?.orderTotalPaise
    ?? 0;
  const discountPaise = nonNegInt(o.discount_paise) ?? opts.context?.discountPaise ?? 0;
  const shippingPaise = nonNegInt(o.shipping_paise) ?? opts.context?.shippingPaise ?? 0;
  const subtotalPaise = nonNegInt(o.subtotal_paise)
    ?? Math.max(0, totalPaise + discountPaise - shippingPaise);
  const couponCode = str(o.coupon_code) || str(opts.context?.couponCode) || null;
  const rawPaymentMethod = str(o.payment_method);
  const rawPayuMode = str(o.payu_mode);
  const payuMihpayid = str(o.payu_mihpayid);
  const jsonFallbackItems = mapJsonFallbackItems(o.items);

  // Run independent enrichment queries safely in parallel
  const [
    itemRows,
    addressRows,
    deliveryRows,
    dispatchHistoryRows,
    paymentRows,
    paymentEventRows,
    refundRows,
    refundRequestRows,
    refundObligationRows,
    cancelReasonRows,
    settingRows,
    shippingMethodRows,
  ] = await Promise.all([
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<{ row_data: Record<string, unknown> }>>`
              select to_jsonb(oi) as row_data
              from order_items oi
              where oi.order_id = ${orderId}
              order by oi.line_number asc, oi.id asc
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select full_name, phone, line1, line2, city, state, postal_code
              from order_addresses
              where order_id = ${orderId} and address_type = 'shipping'
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<{ row_data: Record<string, unknown> }>>`
              select to_jsonb(d) as row_data
              from order_deliveries d
              where d.order_id = ${orderId}
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<{ created_at: unknown }>>`
              select created_at
              from order_status_history
              where order_id = ${orderId}
                and domain = 'fulfilment'
                and to_status = 'ON_THE_WAY'
              order by created_at desc, id desc
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select status, method, amount_paise, provider_ref, paid_at, created_at
              from order_payments
              where order_id = ${orderId}
              order by paid_at desc nulls last, created_at desc, id desc
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select payu_status, outcome, reason, created_at
              from payment_events
              where order_id = ${orderId}
                and outcome in ('failed', 'rejected', 'cancelled')
              order by created_at desc, id desc
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select id, amount_paise, method, provider_ref, reason, created_at
              from refunds
              where order_id = ${orderId}
              order by created_at desc
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select id, amount_paise, method, reason, created_at
              from refund_requests
              where order_id = ${orderId}
              order by created_at desc
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    orderId
      ? safeQuery(
          () =>
            opts.sql<Array<Record<string, unknown>>>`
              select id, amount_paise, reason, status, refund_id, created_at
              from refund_obligations
              where order_id = ${orderId}
              order by created_at desc
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    str(o.cancellation_reason_id)
      ? safeQuery(
          () =>
            opts.sql<Array<{ label: string }>>`
              select label from cancellation_reasons
              where id = ${str(o.cancellation_reason_id)}
              limit 1
            `,
          [],
        )
      : Promise.resolve([]),
    safeQuery(
      () =>
        opts.sql<Array<{ key: string; value: string }>>`
          select key, value from store_settings
          where key in ('processing_time_text', 'return_window_days', 'email', 'phone')
        `,
      [],
    ),
    safeQuery(
      () =>
        opts.sql<Array<Record<string, unknown>>>`
          select name, rate_paise, eta_min_days, eta_max_days
          from shipping_methods
          where is_active = true
          order by sort_order asc
          limit 5
        `,
      [],
    ),
  ]);

  // Build line items (order_items preferred, merged with JSON snapshot fallback)
  let items: EmailOrderItem[] = itemRows.map((entry, idx) => {
    const r = entry.row_data;
    const snap = jsonFallbackItems[idx];
    const quantity = positiveInt(r.quantity, snap?.quantity ?? 1);
    const unitPricePaise = nonNegInt(r.unit_price_paise) ?? snap?.unitPricePaise ?? 0;
    const lineTotalPaise = nonNegInt(r.line_total_paise) ?? snap?.lineTotalPaise ?? unitPricePaise * quantity;
    return {
      productId: str(r.product_id) || snap?.productId || null,
      productName: str(r.product_name) || snap?.productName || 'Item',
      quantity,
      unitPricePaise,
      lineTotalPaise,
      imageUrl: str(r.image_url) || snap?.imageUrl || null,
      imageAlt: str(r.image_alt) || snap?.imageAlt || str(r.product_name) || 'Item',
      deviceModelName: str(r.variant_device_model_name) || snap?.deviceModelName || null,
      colourName: str(r.variant_colour_name) || snap?.colourName || null,
      variantLabel: str(r.variant_label) || snap?.variantLabel || null,
      isFreeGift: r.is_free_gift === true || snap?.isFreeGift === true,
      freeGiftBadge: str(r.free_gift_badge) || snap?.freeGiftBadge || null,
    };
  });
  if (items.length === 0) items = jsonFallbackItems;

  // Backfill product images for older orders where order_items lacks image_url
  const missingImageIds = Array.from(
    new Set(
      items
        .filter((item) => !item.imageUrl && item.productId)
        .map((item) => item.productId as string),
    ),
  );
  if (missingImageIds.length > 0) {
    const imageRows = await safeQuery(
      () =>
        opts.sql<Array<{ product_id: string; url: string }>>`
          select product_id, url
          from product_images
          where product_id = any(${missingImageIds})
            and is_active
            and deleted_at is null
          order by
            case role when 'primary' then 0 when 'hover' then 1 else 2 end,
            sort_order,
            id
        `,
      [],
    );
    const imageByProduct = new Map<string, string>();
    for (const row of imageRows) {
      if (row.product_id && row.url && !imageByProduct.has(row.product_id)) {
        imageByProduct.set(row.product_id, row.url);
      }
    }
    items = items.map((item) => ({
      ...item,
      imageUrl: item.imageUrl || (item.productId ? imageByProduct.get(item.productId) ?? null : null),
    }));
  }

  // Shipping address
  const addrRow = addressRows[0];
  let shippingAddress: EmailOrderAddress | null = null;
  if (addrRow) {
    const addr: EmailOrderAddress = {
      fullName: str(addrRow.full_name) || null,
      phone: str(addrRow.phone) || null,
      line1: str(addrRow.line1) || null,
      line2: str(addrRow.line2) || null,
      city: str(addrRow.city) || null,
      state: str(addrRow.state) || null,
      postalCode: str(addrRow.postal_code) || null,
    };
    if (addr.line1 || addr.city || addr.postalCode) {
      shippingAddress = addr;
    }
  }

  // Store settings map
  const settingsMap = new Map<string, string>();
  for (const row of settingRows) settingsMap.set(row.key, str(row.value));
  const processingTimeText = settingsMap.get('processing_time_text') || 'Dispatched in 1–2 business days.';
  const supportEmail = opts.supportEmail || settingsMap.get('email') || null;
  const supportPhone = opts.supportPhone || settingsMap.get('phone') || null;

  // Delivery details
  const delivery = deliveryRows[0]?.row_data ?? {};
  const courierPartner = str(delivery.courier_name) || str(delivery.carrier) || null;
  const trackingId = str(delivery.tracking_number) || str(opts.context?.trackingNumber) || null;
  const trackingUrl = str(delivery.tracking_url) || str(opts.context?.trackingLink) || null;
  const scheduledForRaw = delivery.scheduled_for || o.scheduled_for;
  const scheduledFormatted = formatEmailDate(scheduledForRaw);
  const slot = str(o.delivery_slot);

  // Estimate delivery window from shipping_methods when no exact scheduled_for date exists
  let estimatedDelivery: string | null = scheduledFormatted
    ? (slot ? `${scheduledFormatted} (${slot})` : scheduledFormatted)
    : null;
  if (!estimatedDelivery && shippingMethodRows.length > 0) {
    const matchedMethod = shippingMethodRows.find(
      (m) => nonNegInt(m.rate_paise) === shippingPaise,
    ) ?? shippingMethodRows[0];
    const minDays = nonNegInt(matchedMethod?.eta_min_days) ?? 0;
    const maxDays = nonNegInt(matchedMethod?.eta_max_days) ?? 0;
    if (maxDays > 0) {
      const start = addDaysIso(o.created_at ?? new Date(), minDays);
      const end = addDaysIso(o.created_at ?? new Date(), maxDays);
      if (start && end && start !== end) {
        estimatedDelivery = `${start} – ${end}`;
      } else if (end) {
        estimatedDelivery = end;
      }
    }
  }
  if (!estimatedDelivery) {
    estimatedDelivery = '3–5 business days';
  }

  const dispatchDate = formatEmailDate(dispatchHistoryRows[0]?.created_at ?? delivery.updated_at ?? o.updated_at);
  const deliveredDate = formatEmailDate(delivery.delivered_at ?? o.updated_at ?? new Date());
  const expectedDispatch = scheduledFormatted || processingTimeText;

  // Payments
  const paidRows = paymentRows.filter((p) => str(p.status).toUpperCase() === 'PAID');
  const recordedPaidPaise = paidRows.reduce((sum, p) => sum + (nonNegInt(p.amount_paise) ?? 0), 0);
  const latestPayment = paidRows[0] ?? paymentRows[0];
  const paidAmountPaise = recordedPaidPaise > 0
    ? recordedPaidPaise
    : (orderStatus.toUpperCase() === 'PAID' ? totalPaise : 0);

  const paymentMethod = formatPaymentMethodLabel(
    rawPayuMode,
    rawPaymentMethod || str(latestPayment?.method),
  );
  const paymentStatus = formatPaymentStatusLabel(orderStatus, rawPaymentMethod, paidAmountPaise);
  const transactionId = payuMihpayid || str(latestPayment?.provider_ref) || txnid;
  const paymentDate = formatEmailDate(o.paid_at ?? latestPayment?.paid_at ?? o.updated_at ?? o.created_at);

  const failedEvent = paymentEventRows[0];
  const paymentFailureReason =
    sanitizeCustomerReason(failedEvent?.reason ? String(failedEvent.reason) : null)
    ?? sanitizeCustomerReason(str(o.reservation_released_reason))
    ?? null;

  // Refunds
  const latestRefund = refundRows[0];
  const latestRefundRequest = refundRequestRows[0];
  const latestObligation = refundObligationRows[0];
  const refundAmountPaise =
    opts.context?.refundPaise
    ?? nonNegInt(latestRefund?.amount_paise)
    ?? nonNegInt(latestRefundRequest?.amount_paise)
    ?? nonNegInt(latestObligation?.amount_paise)
    ?? (paidAmountPaise > 0 ? paidAmountPaise : null);

  const refundId =
    str(latestRefundRequest?.id)
    || str(latestObligation?.id)
    || str(latestRefund?.id)
    || `REF-${orderNumber}`;
  const refundReference = str(latestRefund?.provider_ref) || str(latestRefund?.id) || null;
  const refundMethodRaw = str(latestRefund?.method) || str(latestRefundRequest?.method);
  const refundMethod = refundMethodRaw
    ? formatPaymentMethodLabel(null, refundMethodRaw)
    : paymentMethod;
  const refundInitiationDate = formatEmailDate(
    latestRefundRequest?.created_at ?? latestObligation?.created_at ?? o.updated_at ?? new Date(),
  );
  const refundProcessingDate = formatEmailDate(latestRefund?.created_at ?? o.updated_at ?? new Date());

  // Cancellation reason + refund eligibility
  const cancellationReason =
    str(o.cancel_reason)
    || str(cancelReasonRows[0]?.label)
    || sanitizeCustomerReason(str(o.reservation_released_reason))
    || null;

  let refundEligibility = 'No payment captured — no refund required';
  let refundStatus = 'Not applicable (No payment captured)';
  if (latestRefund) {
    refundEligibility = 'Refund processed';
    refundStatus = 'Refund Completed';
  } else if (latestRefundRequest || (latestObligation && str(latestObligation.status) === 'PENDING')) {
    refundEligibility = 'Eligible for full refund';
    refundStatus = 'Refund Initiated (5–7 business days)';
  } else if (paidAmountPaise > 0) {
    refundEligibility = 'Eligible for full refund to original payment method';
    refundStatus = 'Eligible — Pending Refund Initiation';
  }

  return {
    event: opts.event,
    txnid,
    orderNumber,
    hasCustomerAccount: Boolean(str(o.user_id)),
    orderDate: formatEmailDate(o.created_at),
    currency,
    orderStatus,
    fulfilmentStatus,
    subtotalPaise,
    discountPaise,
    shippingPaise,
    totalPaise,
    couponCode,
    paymentMethod,
    paymentStatus,
    transactionId,
    paymentDate,
    paidAmountPaise,
    paymentFailureReason,
    items,
    shippingAddress,
    estimatedDelivery,
    processingStatus: humanizeProcessingStatus(fulfilmentStatus),
    expectedDispatch,
    courierPartner: courierPartner || 'Courier Partner',
    trackingId,
    trackingUrl,
    dispatchDate,
    deliveredDate,
    cancellationReason,
    refundEligibility,
    refundAmountPaise,
    refundStatus,
    refundId,
    refundReference,
    refundMethod,
    refundInitiationDate,
    refundProcessingDate,
    refundExpectedTime: '5–7 business days',
    supportEmail,
    supportPhone,
  };
}
