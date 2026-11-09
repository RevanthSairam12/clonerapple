import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { CouponRejectedError, TotalChangedError } from '@/lib/coupons/errors';
import {
  couponRejectionMessage,
  isValidCouponCode,
  normalizeCouponCode,
} from '@/lib/coupons/rules';
import { getPayUConfig, checkPayUConfiguration, getPayUCallbackUrls } from '@/lib/payu/config';
import { generateRequestHash } from '@/lib/payu/hash';
import { createOrder, findActiveReservationForUser, getOrderByTxnid } from '@/lib/payu/orders';
import { InsufficientStockError } from '@/lib/payu/stock';
import { isValidCheckoutVariantId, MAX_CHECKOUT_LINES, SelectionUnavailableError } from '@/lib/payu/db-pricing';
import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { queueOrderEvent } from '@/lib/notifications/order-context';
import { queueStockAlerts } from '@/lib/notifications/stock-events';
import { getUserSession } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { getCustomerAddress } from '@/lib/account/addresses';
import { validateCheckoutContact, validateIndianAddress } from '@/lib/checkout/india-validation';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { parseReservationPolicy } from '@/lib/checkout/reservation-rules';
import { BUSY_MESSAGE, BUSY_RETRY_AFTER, isTransactionTimeout } from '@/lib/checkout/transaction-guards';
import { hasUsableNumbering, readOrderNumberSettings } from '@/lib/orders/numbering';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import { subscribeToNewsletter } from '@/lib/store-admin/subscribers';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const runtime = 'nodejs';


/**
 * Generates an alphanumeric, cryptographically random transaction ID (max 25 chars).
 * Format: "GDZ" + timestamp (base36, ~8 chars) + random hex (12 chars) = ~23 chars.
 */
function generateTxnId(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(6).toString('hex').toUpperCase();
  const txnid = `GDZ${time}${rand}`;
  return txnid.slice(0, 25);
}

export async function POST(req: NextRequest) {
  try {
    const originViolation = assertSameOrigin(req);
    if (originViolation) return originViolation;

    // Maintenance closes checkout: no order row is created, no stock is held.
    const closed = await requireStorefrontOpen();
    if (closed) return closed;

    const ip = clientIpFromRequest(req);

    // Rate limit per IP when a trusted proxy supplies one: max 20 initiate
    // requests per 5 minutes. Without a trusted address the account limit below
    // is the control.
    const ipLimit = ip
      ? checkRateLimit(`payu-init-ip:${ip}`, { limit: 20, windowMs: 5 * 60 * 1000 })
      : null;
    if (ipLimit && !ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many payment requests from this IP. Please wait a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      );
    }

    // Guest checkout is controlled by Customers → Customer settings. When it
    // is off (the default), an account is required. Read customer settings and
    // user session in parallel to save a database round-trip on every initiate call.
    const [customerSettings, userSession] = await Promise.all([
      readCustomerSettings(),
      getUserSession(),
    ]);
    if (!userSession && !isOn(customerSettings.guest_checkout)) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in or create an account to proceed with purchase.' },
        { status: 401 }
      );
    }

    const userId = userSession?.userId ?? null;

    // Store Admin settings decide whether PayU can be used and what shipping
    // costs. Once a database is configured a failed read fails closed here:
    // no order is created and the customer sees one clear error.
    // Read checkout configuration, active user reservation, and request body
    // concurrently to avoid sequential round-trips before order creation.
    const [checkoutConfiguration, activeReservation, body] = await Promise.all([
      readCheckoutConfiguration(),
      userId ? findActiveReservationForUser(userId) : Promise.resolve(null),
      req.json().catch(() => null),
    ]);
    if (!checkoutConfiguration.ok) {
      return NextResponse.json(
        { error: 'Checkout is temporarily unavailable. Please try again.' },
        { status: 503 }
      );
    }
    const settings = checkoutConfiguration.settings;
    if (settings.payu_enabled !== 'on') {
      return NextResponse.json(
        { error: 'Online payment is currently unavailable. Please try again later.' },
        { status: 400 }
      );
    }

    if (userId) {
      const userLimit = checkRateLimit(`payu-init-user:${userId}`, { limit: 10, windowMs: 5 * 60 * 1000 });
      if (!userLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many payment attempts for this account. Please wait.' },
          { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
        );
      }
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const reservationPolicy = parseReservationPolicy(settings);

    // One live checkout per account. Without this a customer could open several
    // tabs and hold several units; the reservation is never extended by a
    // repeat request, so the window stays the one shown when checkout started.
    if (activeReservation) {
      return NextResponse.json(
        {
          error: 'A checkout is already in progress for this account. Finish that payment or wait for its reservation to expire before starting another.',
          code: 'reservation_active',
          statusUrl: `/order/status?txnid=${encodeURIComponent(activeReservation.txnid)}`,
          reservationExpiresAt: activeReservation.expiresAt?.toISOString() ?? null,
        },
        { status: 409 },
      );
    }

    // 1. Resolve cart items and compute price strictly server-side
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return NextResponse.json({ error: 'Cart must contain at least one item.' }, { status: 400 });
    }

    if (rawItems.length > MAX_CHECKOUT_LINES) {
      return NextResponse.json({ error: 'Cart must contain at most 50 items.' }, { status: 400 });
    }
    if (rawItems.some((item) => !normalizeCartLineId(item?.id).baseId
      || !isValidCheckoutVariantId(item?.variantId)
      || !Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 50)) {
      return NextResponse.json({ error: 'Invalid cart item or quantity.' }, { status: 400 });
    }
    // Resolve prices only inside the order transaction after stock is locked.
    // Display expectations are compared there, never used as charge amounts.

    // Identical unknown-safe rules/messages on browser and server. No order or
    // reservation may be created before these customer fields are accepted.
    const contact = validateCheckoutContact(body.customer);
    if (!contact.ok) {
      return NextResponse.json({ error: contact.error, fieldErrors: contact.errors }, { status: 400 });
    }
    const { firstname, email: rawEmail, phone } = contact.value;

    const addressId = typeof body.shippingAddressId === 'string' ? body.shippingAddressId.trim() : '';
    let shippingAddress;
    if (addressId && !userId) {
      return NextResponse.json(
        { error: 'Sign in to use a saved address, or enter a shipping address.' },
        { status: 400 }
      );
    } else if (addressId && userId) {
      const savedAddress = await getCustomerAddress(userId, addressId);
      if (!savedAddress) {
        return NextResponse.json({ error: 'The selected shipping address is unavailable.' }, { status: 400 });
      }
      const validation = validateIndianAddress(savedAddress);
      if (!validation.ok) {
        return NextResponse.json({ error: validation.error, fieldErrors: validation.errors, code: 'address_needs_correction' }, { status: 400 });
      }
      shippingAddress = validation.value;
    } else {
      const addressValidation = validateIndianAddress(body.shippingAddress);
      if (!addressValidation.ok) {
        return NextResponse.json({ error: addressValidation.error, fieldErrors: addressValidation.errors }, { status: 400 });
      }
      shippingAddress = addressValidation.value;
    }

    // The coupon code is the only coupon input accepted from the browser.
    // The discount and the total are computed under the coupon row lock.
    const rawCouponCode = body.couponCode;
    let couponCode: string | null = null;
    if (rawCouponCode !== undefined && rawCouponCode !== null && rawCouponCode !== '') {
      if (typeof rawCouponCode !== 'string' || !isValidCouponCode(rawCouponCode)) {
        return NextResponse.json(
          {
            success: false,
            code: 'coupon_invalid',
            error: couponRejectionMessage('invalid_code'),
          },
          { status: 409 },
        );
      }
      if (settings.coupons_enabled === 'off') {
        return NextResponse.json(
          {
            success: false,
            code: 'coupon_invalid',
            error: couponRejectionMessage('inactive'),
          },
          { status: 409 },
        );
      }
      couponCode = normalizeCouponCode(rawCouponCode);
    }

    const expectedTotal = body.expectedTotalPaise;
    if (expectedTotal !== undefined && expectedTotal !== null
      && (typeof expectedTotal !== 'number' || !Number.isSafeInteger(expectedTotal) || expectedTotal < 0)) {
      return NextResponse.json({ error: 'Invalid displayed total. Review your cart.' }, { status: 400 });
    }
    const expectedTotalPaise = expectedTotal ?? null;

    // 4. Check the payment configuration before anything is written. A missing
    //    key, salt or public site address must fail here, closed: no order row,
    //    no stock claim, no reservation — and one message an operator can act
    //    on instead of a PayU page that cannot return the customer.
    const payuCheck = checkPayUConfiguration();
    if (!payuCheck.ok) {
      console.error(
        `[payu/initiate] payment is not configured (${payuCheck.problem.code}); no order was created`,
      );
      return NextResponse.json(
        {
          success: false,
          code: 'payment_not_configured',
          error: payuCheck.problem.message,
          adminAction: payuCheck.problem.adminAction,
        },
        { status: 503 },
      );
    }
    const config = getPayUConfig();
    const callbackUrls = getPayUCallbackUrls(payuCheck.appBaseUrl);

    // 5. Number the order from Order settings, or fall back to the previous
    //    random transaction id when the prefix is empty. The amount charged is
    //    the server total including the server-computed shipping and coupon.
    const numbering = readOrderNumberSettings({
      order_prefix: settings.order_prefix,
      order_start_number: settings.order_start_number,
    });

    let created;
    try {
      created = await createOrder({
        txnid: hasUsableNumbering(numbering) ? undefined : generateTxnId(),
        numbering: hasUsableNumbering(numbering) ? numbering : null,
        userId,
        cartItems: rawItems.map((item) => ({
          id: item.id,
          variantId: item.variantId ?? null,
          quantity: item.quantity,
          expectedUnitPaise: item.expectedUnitPaise,
        })),
        expectedTotalPaise,
        currency: 'INR',
        coupon: couponCode
          ? {
              code: couponCode,
              customerGroup: null,
              expectedTotalPaise,
            }
          : null,
        customerName: firstname,
        customerEmail: rawEmail,
        customerPhone: phone,
        paymentMethod: 'payu',
        shippingAddress,
        reservationSeconds: reservationPolicy.reservationSeconds,
        checkoutConfiguration,
      });
    } catch (error: unknown) {
      if (error instanceof SelectionUnavailableError) {
        return NextResponse.json(
          { success: false, code: 'selection_unavailable', error: error.message, selection: error.selection },
          { status: 409 },
        );
      }
      if (error instanceof InsufficientStockError) {
        return NextResponse.json(
          { success: false, error: error.message, code: 'out_of_stock' },
          { status: 409 },
        );
      }
      if (error instanceof CouponRejectedError) {
        return NextResponse.json(
          { success: false, error: error.message, code: 'coupon_invalid' },
          { status: 409 },
        );
      }
      if (error instanceof TotalChangedError) {
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            code: 'price_changed',
            totals: error.totals,
            shippingPolicy: error.shippingPolicy,
            items: error.items.map((item) => ({
              id: item.id,
              variantId: item.variantId || null,
              variantSku: item.variantSku || null,
              variantLabel: item.variantLabel || null,
              name: item.name,
              quantity: item.quantity,
              unitPaise: item.unitPaise,
              totalPaise: item.unitPaise * item.quantity,
              regularPricePaise: item.regularPricePaise ?? null,
            })),
          },
          { status: 409 },
        );
      }
      if (isTransactionTimeout(error)) {
        return NextResponse.json(
          { success: false, error: BUSY_MESSAGE, code: 'busy' },
          { status: 503, headers: { 'Retry-After': BUSY_RETRY_AFTER } },
        );
      }
      // A coupon that cannot be checked must never be charged blind: the
      // order is not created and the customer is told to remove the code.
      // Without a coupon the normal error path below applies.
      if (couponCode) {
        console.warn('[payu/initiate] coupon lookup failed; no order was created');
        return NextResponse.json(
          {
            success: false,
            code: 'coupon_unavailable',
            error: 'The coupon could not be checked. Remove it and pay without the code.',
          },
          { status: 409 },
        );
      }
      throw error;
    }

    const txnid = created.order.txnid;
    // The order transaction is the authority: this is the amount PayU is
    // asked for, matching the total the customer was shown.
    const amountStr = (created.order.totalPaise / 100).toFixed(2);
    const names = created.order.items.map((item) => `${item.name} (x${item.quantity})`).join(', ');
    const productSummary = (names.length > 90 ? `${names.slice(0, 87)}...` : names)
      .replace(/[^a-zA-Z0-9\s,.-]/g, ' ').trim();

    // Availability changed when tracked stock was claimed.
    if (created.stockClaimed) revalidateCatalog();

    // The order transaction has committed. The matrix decides whether a
    // message exists; queueNotification never waits for the provider.
    queueOrderEvent('order_placed', created.order, { orderStatus: 'CREATED' });
    if (created.stockAlerts?.length) {
      queueStockAlerts(created.stockAlerts);
    }

    // This checkout returned stock from checkout(s) whose window had already
    // closed. Tell those customers the worker would have told them, so a
    // scheduler outage does not also silence the expiry notice. Best effort:
    // a notification failure never affects the order that just started.
    for (const stale of created.expiredReservations) {
      if (stale.status !== 'CANCELLED') continue;
      const staleOrder = await getOrderByTxnid(stale.txnid).catch(() => null);
      if (staleOrder) {
        queueOrderEvent('reservation_expired', staleOrder, { orderStatus: 'CANCELLED' });
      }
    }

    // Opt-in is only honoured while the checkbox is enabled in settings.
    // Failure to record it never blocks the payment.
    if (body.marketingOptIn === true && isOn(customerSettings.checkout_marketing_optin)) {
      await subscribeToNewsletter(rawEmail, 'checkout');
    }

    // 6. Generate request hash. Never log the hash string or any customer
    //    detail from this route.
    const { hash } = generateRequestHash({
      key: config.key,
      txnid,
      amount: amountStr,
      productinfo: productSummary,
      firstname,
      email: rawEmail,
      salt: config.salt,
    });

    // 7. Form parameters. Every URL comes from the one validated site address;
    //    none is derived from the request's Host header.
    const surl = callbackUrls.surl;
    const furl = callbackUrls.furl;
    const curl = callbackUrls.curl;

    return NextResponse.json({
      success: true,
      actionUrl: config.paymentUrl,
      reservationSeconds: reservationPolicy.reservationSeconds,
      reservationExpiresAt: created.order.reservationExpiresAt?.toISOString() ?? null,
      fields: {
        key: config.key,
        txnid,
        amount: amountStr,
        productinfo: productSummary,
        firstname,
        email: rawEmail,
        phone,
        surl,
        furl,
        curl,
        hash,
      },
    });
  } catch (error: unknown) {
    if (isTransactionTimeout(error)) {
      return NextResponse.json(
        { success: false, error: BUSY_MESSAGE, code: 'busy' },
        { status: 503, headers: { 'Retry-After': BUSY_RETRY_AFTER } },
      );
    }
    console.error('[PayU Initiate Error]:', (error as Error).message);
    return NextResponse.json(
      { error: 'Failed to initiate payment. Please try again later.' },
      { status: 500 }
    );
  }
}
