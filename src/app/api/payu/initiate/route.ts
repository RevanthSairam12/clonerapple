import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getPayUConfig, assertPayUConfigured } from '@/lib/payu/config';
import { generateRequestHash } from '@/lib/payu/hash';
import { createOrder, findActiveReservationForUser, getOrderByTxnid } from '@/lib/payu/orders';
import { InsufficientStockError, ReservationUnavailableError } from '@/lib/payu/stock';
import { resolveCartItemsFromDb } from '@/lib/payu/db-catalog';
import { queueOrderEvent } from '@/lib/notifications/order-context';
import { getUserSession } from '@/lib/user-auth';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { getCustomerAddress } from '@/lib/account/addresses';
import { validateAddressInput } from '@/lib/account/rules';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { parseReservationPolicy } from '@/lib/checkout/reservation-rules';
import { quoteShipping } from '@/lib/checkout/shipping-rules';
import { isInvitationToken } from '@/lib/waitlist/rules';
import { hasUsableNumbering, readOrderNumberSettings } from '@/lib/orders/numbering';
import { isOn } from '@/lib/store-admin/customer-rules';
import { readCustomerSettings } from '@/lib/store-admin/customer-settings';
import { subscribeToNewsletter } from '@/lib/store-admin/subscribers';
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

    // A waiting-list claim token is exclusive stock. It must belong to a
    // signed-in customer; createOrder re-checks ownership and expiry under the
    // stock row lock, so a copied link cannot be used by someone else.
    const rawReservationToken = typeof body.reservationToken === 'string'
      ? body.reservationToken.trim()
      : '';
    if (rawReservationToken && !isInvitationToken(rawReservationToken)) {
      return NextResponse.json(
        { error: 'That reservation link is not valid. Please open the link from your email.' },
        { status: 400 },
      );
    }
    if (rawReservationToken && !userId) {
      return NextResponse.json(
        { error: 'Sign in to claim this reservation.' },
        { status: 401 },
      );
    }

    const reservationPolicy = parseReservationPolicy(settings);

    // One live checkout per account. Without this a customer could open several
    // tabs and hold several units; the reservation is never extended by a
    // repeat request, so the window stays the one shown when checkout started.
    // A waiting-list claim is still one checkout: the held unit stays reserved
    // until the claim window ends, so the customer can retry after the current
    // payment resolves.
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
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
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
    //    no charge, which is what checkout did before shipping was wired.
    const shippingQuote = quoteShipping(cart.totalPaise, checkoutConfiguration.policy);
    const subtotalPaise = cart.totalPaise;
    const totalPaise = subtotalPaise + shippingQuote.shippingPaise;

    // 4. Prepare PayU Config
    const config = getPayUConfig();
    assertPayUConfigured(config);

    // 5. Number the order from Order settings, or fall back to the previous
    //    random transaction id when the prefix is empty. The amount charged is
    //    the server total including the server-computed shipping.
    const numbering = readOrderNumberSettings({
      order_prefix: settings.order_prefix,
      order_start_number: settings.order_start_number,
    });
    const amountStr = (totalPaise / 100).toFixed(2);

    let created;
    try {
      created = await createOrder({
        txnid: hasUsableNumbering(numbering) ? undefined : generateTxnId(),
        numbering: hasUsableNumbering(numbering) ? numbering : null,
        userId,
        items: cart.items,
        subtotalPaise,
        shippingPaise: shippingQuote.shippingPaise,
        totalPaise,
        currency: 'INR',
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
        reservationToken: rawReservationToken || undefined,
      });
    } catch (error: unknown) {
      if (error instanceof ReservationUnavailableError) {
        return NextResponse.json(
          {
            error: 'That reservation is no longer available. The unit may have been offered to the next customer. Please start a new checkout.',
            code: 'reservation_unavailable',
          },
          { status: 409 },
        );
      }
      if (error instanceof InsufficientStockError) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    const txnid = created.order.txnid;

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
