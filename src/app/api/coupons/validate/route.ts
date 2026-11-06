import { NextRequest, NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { quoteShipping } from '@/lib/checkout/shipping-rules';
import {
  couponRejectionMessage,
  isValidCouponCode,
  normalizeCouponCode,
} from '@/lib/coupons/rules';
import {
  couponConnection,
  lookupCouponForCart,
} from '@/lib/coupons/store';
import { resolveCartItemsFromDb } from '@/lib/payu/db-catalog';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { getUserSession } from '@/lib/user-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function invalid(message: string, status = 200) {
  return NextResponse.json({ valid: false, message }, { status, headers: NO_STORE });
}

/**
 * Check a code against this cart without creating or consuming anything.
 *
 * The response carries only the new totals and a customer-safe message: no
 * coupon id, limit, scope, target list or other customer's use. The checkout
 * path re-evaluates the same rules under a row lock; this endpoint is a
 * preview, never the authority.
 */
export async function POST(req: NextRequest) {
  const originViolation = assertSameOrigin(req);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const ip = clientIpFromRequest(req);
  const ipLimit = ip ? checkRateLimit(`coupon-validate-ip:${ip}`, {
    limit: 10,
    windowMs: 60 * 1000,
  }) : null;
  if (ipLimit && !ipLimit.allowed) {
    return NextResponse.json(
      { valid: false, message: 'Too many attempts. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return invalid('Enter a coupon code.', 400);
  }

  const session = await getUserSession();
  const userId = session?.userId ?? null;
  if (userId) {
    const userLimit = checkRateLimit(`coupon-validate-user:${userId}`, {
      limit: 10,
      windowMs: 60 * 1000,
    });
    if (!userLimit.allowed) {
      return NextResponse.json(
        { valid: false, message: 'Too many attempts. Please wait a minute and try again.' },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': String(userLimit.retryAfterSec) } },
      );
    }
  }

  const code = normalizeCouponCode(body.code);
  if (!isValidCouponCode(code)) {
    return invalid(couponRejectionMessage('invalid_code'));
  }

  const configuration = await readCheckoutConfiguration();
  if (!configuration.ok) {
    return invalid('Coupons are temporarily unavailable. Please try again.');
  }
  if (configuration.settings.coupons_enabled === 'off') {
    return invalid(couponRejectionMessage('inactive'));
  }

  const sql = couponConnection();
  if (!sql) {
    return invalid('Coupons are temporarily unavailable. Please try again.');
  }

  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return invalid('Your bag is empty.', 400);
  }

  let cart;
  try {
    cart = await resolveCartItemsFromDb(rawItems);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return invalid(
      message || 'Some items in your bag are unavailable. Remove them and try again.',
    );
  }

  if (cart.priceChanges.length > 0) {
    return invalid('Prices have changed. Review your bag and try the code again.');
  }

  // Guests have no account yet; the email typed on the checkout form is the
  // only identity available. It is normalized by the coupon rules.
  const guestEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const email = session?.email || guestEmail;

  try {
    const shippingPaise = quoteShipping(cart.totalPaise, configuration.policy).shippingPaise;
    const result = await lookupCouponForCart(sql, code, {
      lines: cart.items.map((item) => ({
        productId: item.id,
        categoryId: item.categoryId ?? null,
        brandId: item.brandId ?? null,
        quantity: item.quantity,
        unitPaise: item.unitPaise,
        linePaise: item.unitPaise * item.quantity,
        onSale: item.onSale === true,
      })),
      subtotalPaise: cart.totalPaise,
      shippingPaise,
      customer: { userId, email, group: null },
    });

    if (!result.evaluation.ok) {
      return invalid(result.evaluation.message);
    }

    return NextResponse.json(
      {
        valid: true,
        code: normalizeCouponCode(code),
        subtotalPaise: cart.totalPaise,
        discountPaise: result.evaluation.discountPaise,
        shippingPaise: result.evaluation.shippingPaise,
        totalPaise: result.evaluation.totalPaise,
        currency: 'INR',
        message: result.evaluation.message,
      },
      { headers: NO_STORE },
    );
  } catch {
    // The coupon tables being unreadable never applies a discount. Checkout
    // can proceed without one; it can never proceed on an unverified code.
    console.warn('[coupons/validate] coupon lookup failed');
    return invalid('Coupons are temporarily unavailable. Please try again.');
  }
}
