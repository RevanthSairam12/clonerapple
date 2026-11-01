import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { CouponRejectedError, TotalChangedError } from '@/lib/coupons/errors';
import {
  couponRejectionMessage,
  isValidCouponCode,
  normalizeCouponCode,
} from '@/lib/coupons/rules';
import { getPayUConfig, assertPayUConfigured } from '@/lib/payu/config';
import { generateRequestHash } from '@/lib/payu/hash';
import { createOrder, findActiveReservationForUser, getOrderByTxnid } from '@/lib/payu/orders';
import { InsufficientStockError } from '@/lib/payu/stock';
import { resolveCartItemsFromDb } from '@/lib/payu/db-catalog';
import { queueOrderEvent } from '@/lib/notifications/order-context';
import { getUserSession } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { getCustomerAddress } from '@/lib/account/addresses';
import { validateAddressInput } from '@/lib/account/rules';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { parseReservationPolicy } from '@/lib/checkout/reservation-rules';
import { quoteShipping } from '@/lib/checkout/shipping-rules';
import { hasUsableNumbering, readOrderNumberSettings } from '@/lib/orders/numbering';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import { subscribeToNewsletter } from '@/lib/store-admin/subscribers';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { revalidateCatalog } from '@/lib/storefront/revalidate';

export const runtime = 'nodejs';

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z\s]/g, '').trim();
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  // If 12 digits starting with 91, strip 91
  if (digits.length === 12 && digits.startsWith('91')) {
    const raw = digits.slice(2);
    return /^[6-9]\d{9}$/.test(raw) ? raw : null;
  }
  // If 11 digits starting with 0, strip 0
  if (digits.length === 11 && digits.startsWith('0')) {
    const raw = digits.slice(1);
    return /^[6-9]\d{9}$/.test(raw) ? raw : null;
  }
  // Standard 10 digits starting with 6-9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }
  return null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

    const ip = getClientIp(req);

    // Rate limit per IP: max 20 initiate requests per 5 minutes
    const ipLimit = checkRateLimit(`payu-init-ip:${ip}`, { limit: 20, windowMs: 5 * 60 * 1000 });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many payment requests from this IP. Please wait a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSec) } }
      );
    }

    // Guest checkout is controlled by Customers → Customer settings. When it
    // is off (the default), an account is required.
    const customerSettings = await readCustomerSettings();
    const userSession = await getUserSession();
    if (!userSession && !isOn(customerSettings.guest_checkout)) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in or create an account to proceed with purchase.' },
        { status: 401 }
      );
    }

    // Store Admin settings decide whether PayU can be used and what shipping
    // costs. Once a database is configured a failed read fails closed here:
    // no order is created and the customer sees one clear error.
    const checkoutConfiguration = await readCheckoutConfiguration();
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
    const userId = userSession?.userId ?? null;

    if (userId) {
      const userLimit = checkRateLimit(`payu-init-user:${userId}`, { limit: 10, windowMs: 5 * 60 * 1000 });
      if (!userLimit.allowed) {
        return NextResponse.json(
          { error: 'Too many payment attempts for this account. Please wait.' },
          { status: 429, headers: { 'Retry-After': String(userLimit.retryAfterSec) } }
        );
      }
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON request body.' }, { status: 400 });
    }

    const reservationPolicy = parseReservationPolicy(settings);

    // One live checkout per account. Without this a customer could open several
    // tabs and hold several units; the reservation is never extended by a
    // repeat request, so the window stays the one shown when checkout started.
    if (userId) {
      const activeReservation = await findActiveReservationForUser(userId);
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
    }

    // 1. Resolve cart items and compute price strictly server-side
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return NextResponse.json({ error: 'Cart must contain at least one item.' }, { status: 400 });
    }

    let cart;
    try {
      cart = await resolveCartItemsFromDb(rawItems);
    } catch (err: unknown) {
      // Normal mode's storefront availability is enforced here too, so a
      // crafted request cannot buy what the shop has marked unavailable.
      if (err instanceof InsufficientStockError) {
        return NextResponse.json(
          { success: false, error: err.message, code: 'out_of_stock' },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }

    // The client's displayed unit prices are advisory: they are never charged.
    // If any of them no longer matches the database price (a sale started or
    // ended between the bag and this request), stop before reserving stock or
    // creating an order and make the customer review the new prices.
    if (cart.priceChanges.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Prices have changed, please review your cart.',
          code: 'price_changed',
          items: cart.items.map((item) => ({
            id: item.id,
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

    // 2. Validate and sanitize customer details
    const customer = body.customer || {};
    const rawFirstName = customer.firstname || userSession?.firstName || '';
    const firstname = sanitizeName(rawFirstName);
    if (!firstname || firstname.length < 2 || firstname.length > 50) {
      return NextResponse.json(
        { error: 'A valid first name (2-50 alphabetic characters) is required.' },
        { status: 400 }
      );
    }

    const rawEmail = (customer.email || userSession?.email || '').trim().toLowerCase();
    if (!isValidEmail(rawEmail)) {
      return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
    }

    const rawPhone = String(customer.phone || '').trim();
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      return NextResponse.json(
        { error: 'A valid 10-digit Indian mobile number is required.' },
        { status: 400 }
      );
    }

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
      shippingAddress = savedAddress;
    } else {
      const addressValidation = validateAddressInput(body.shippingAddress);
      if (!addressValidation.ok) {
        return NextResponse.json({ error: addressValidation.error }, { status: 400 });
      }
      shippingAddress = addressValidation.value;
    }

    // 3. Server-computed shipping. Shipping disabled or no active method means
    //    no charge, which is what checkout did before shipping was wired. A
    //    free-shipping coupon is applied inside the order transaction.
    const shippingQuote = quoteShipping(cart.totalPaise, checkoutConfiguration.policy);
    const subtotalPaise = cart.totalPaise;

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
    const expectedTotalPaise =
      typeof expectedTotal === 'number' && Number.isSafeInteger(expectedTotal)
        ? expectedTotal
        : null;

    // 4. Prepare PayU Config
    const config = getPayUConfig();
    assertPayUConfigured(config);

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
        items: cart.items,
        subtotalPaise,
        shippingPaise: shippingQuote.shippingPaise,
        totalPaise: subtotalPaise + shippingQuote.shippingPaise,
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
        pricingSnapshot: {
          shipping: {
            methodId: shippingQuote.methodId,
            methodName: shippingQuote.methodName,
            reason: shippingQuote.reason,
            shippingPaise: shippingQuote.shippingPaise,
          },
        },
        shippingAddress,
        reservationSeconds: reservationPolicy.reservationSeconds,
      });
    } catch (error: unknown) {
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
          },
          { status: 409 },
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
    const amountStr = created.order.amount.toFixed(2);

    // Availability changed when tracked stock was claimed.
    if (created.stockClaimed) revalidateCatalog();

    // The order transaction has committed. The matrix decides whether a
    // message exists; queueNotification never waits for the provider.
    queueOrderEvent('order_placed', created.order, { orderStatus: 'CREATED' });

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
      productinfo: cart.productSummary,
      firstname,
      email: rawEmail,
      salt: config.salt,
    });

    // 7. Form parameters (public URLs over HTTPS)
    const surl = `${config.appBaseUrl}/api/payu/success`;
    const furl = `${config.appBaseUrl}/api/payu/failure`;
    const curl = `${config.appBaseUrl}/api/payu/cancel`;

    return NextResponse.json({
      success: true,
      actionUrl: config.paymentUrl,
      reservationSeconds: reservationPolicy.reservationSeconds,
      reservationExpiresAt: created.order.reservationExpiresAt?.toISOString() ?? null,
      fields: {
        key: config.key,
        txnid,
        amount: amountStr,
        productinfo: cart.productSummary,
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
    console.error('[PayU Initiate Error]:', (error as Error).message);
    return NextResponse.json(
      { error: 'Failed to initiate payment. Please try again later.' },
      { status: 500 }
    );
  }
}
