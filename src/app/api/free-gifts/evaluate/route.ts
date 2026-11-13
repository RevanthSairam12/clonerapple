import { NextRequest, NextResponse } from 'next/server';

import { normalizeCartLineId } from '@/lib/cart/cart-id';
import { readCheckoutConfiguration } from '@/lib/checkout/settings';
import { quoteShipping } from '@/lib/checkout/shipping-rules';
import { isValidCouponCode, normalizeCouponCode } from '@/lib/coupons/rules';
import { lookupCouponForCart } from '@/lib/coupons/store';
import type { CartFreeGiftEvaluateResponse, CouponFreeGiftPreview } from '@/lib/free-gifts/rules';
import {
  evaluateCartFreeGiftsUsing,
  resolveCouponFreeGiftPreviewUsing,
} from '@/lib/free-gifts/store';
import { resolveCartItemsFromDb } from '@/lib/payu/db-catalog';
import { MAX_CHECKOUT_LINES, type CartPricingInput } from '@/lib/payu/db-pricing';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { assertSameOrigin } from '@/lib/platform/api-guard';
import { clientIpFromRequest } from '@/lib/platform/client-ip';
import { getSql } from '@/lib/platform/db';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { getUserSession } from '@/lib/user-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function emptyResponse(): CartFreeGiftEvaluateResponse {
  return {
    ok: true,
    eligibleSubtotalPaise: 0,
    paidSubtotalAfterCouponPaise: 0,
    unlockedGift: null,
    spinFreeGift: null,
    nextNudge: null,
    conflict: null,
    blockedByCouponMessage: null,
  };
}

export async function POST(req: NextRequest) {
  const originViolation = assertSameOrigin(req);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const ip = clientIpFromRequest(req);
  const ipLimit = ip
    ? checkRateLimit(`free-gift-eval-ip:${ip}`, { limit: 40, windowMs: 60 * 1000 })
    : null;
  if (ipLimit && !ipLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: 'Too many requests. Please try again shortly.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSec) } },
    );
  }

  const body = await req.json().catch(() => null);
  const sql = getSql();
  if (!sql) {
    return NextResponse.json(emptyResponse(), { headers: NO_STORE });
  }

  const session = await getUserSession();
  const userId = session?.userId ?? null;
  const guestEmail =
    body && typeof body === 'object' && typeof body.email === 'string'
      ? body.email.trim().toLowerCase()
      : '';
  const email = session?.email || guestEmail;

  const rawItemsInput =
    body && typeof body === 'object' && Array.isArray(body.items) ? body.items : [];
  if (rawItemsInput.length > MAX_CHECKOUT_LINES) {
    return NextResponse.json(
      { ok: false, message: 'Too many cart lines.' },
      { status: 400, headers: NO_STORE },
    );
  }

  const cartInputs: CartPricingInput[] = [];
  for (const entry of rawItemsInput) {
    if (!entry || typeof entry !== 'object') continue;
    const rawId = typeof entry.id === 'string' ? entry.id.trim() : '';
    const rawProductId = typeof entry.productId === 'string' ? entry.productId.trim() : '';
    const parsed = normalizeCartLineId(rawProductId || rawId);
    if (!parsed.baseId) continue;
    const rawVariant =
      typeof entry.variantId === 'string' && entry.variantId.trim()
        ? entry.variantId.trim()
        : null;
    const quantity = Number(entry.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) continue;
    cartInputs.push({
      id: parsed.baseId,
      variantId: rawVariant ?? null,
      quantity,
    });
  }

  let resolvedItems: Awaited<ReturnType<typeof resolveCartItemsFromDb>>['items'] = [];
  let cartTotalPaise = 0;

  if (cartInputs.length > 0) {
    try {
      const cart = await resolveCartItemsFromDb(cartInputs);
      resolvedItems = cart.items;
      cartTotalPaise = cart.totalPaise;
    } catch {
      // Bag preview stays non-blocking even if an item in storage is temporarily stale.
      resolvedItems = [];
      cartTotalPaise = 0;
    }
  }

  let discountPaise = 0;
  let couponApplied = false;
  let spinFreeGift: CouponFreeGiftPreview | null = null;

  const rawCoupon =
    body && typeof body === 'object' && typeof body.couponCode === 'string'
      ? body.couponCode
      : '';
  const normalizedCode = normalizeCouponCode(rawCoupon);

  if (normalizedCode && isValidCouponCode(normalizedCode) && resolvedItems.length > 0) {
    try {
      const configuration = await readCheckoutConfiguration();
      if (configuration.ok && configuration.settings.coupons_enabled !== 'off') {
        const shippingPaise = quoteShipping(cartTotalPaise, configuration.policy).shippingPaise;
        const couponResult = await lookupCouponForCart(sql, normalizedCode, {
          lines: resolvedItems.map((item) => ({
            productId: item.id,
            categoryId: item.categoryId ?? null,
            brandId: item.brandId ?? null,
            quantity: item.quantity,
            unitPaise: item.unitPaise,
            linePaise: item.unitPaise * item.quantity,
            onSale: item.onSale === true,
          })),
          subtotalPaise: cartTotalPaise,
          shippingPaise,
          customer: { userId, email, group: null },
        });

        if (couponResult.evaluation.ok) {
          if (couponResult.evaluation.freeGift) {
            const giftCheck = await resolveCouponFreeGiftPreviewUsing(sql, {
              productId: couponResult.evaluation.freeGift.productId,
              variantId: couponResult.evaluation.freeGift.variantId,
              cartItems: resolvedItems.map((item) => ({
                id: item.id,
                variantId: item.variantId ?? null,
                quantity: item.quantity,
              })),
            });
            if (giftCheck.ok) {
              spinFreeGift = giftCheck.gift;
              couponApplied = true;
            }
          } else {
            discountPaise = couponResult.evaluation.discountPaise;
            couponApplied = true;
          }
        }
      }
    } catch {
      // Coupon lookup is advisory here; ignore transient failures for free-gift evaluation.
    }
  }

  try {
    const evaluation = await evaluateCartFreeGiftsUsing(sql, {
      lines: resolvedItems.map((item) => ({
        linePaise: item.unitPaise * item.quantity,
        isFreeGift: false,
      })),
      discountPaise,
      couponApplied,
      userId,
      email,
    });

    const payload: CartFreeGiftEvaluateResponse = {
      ok: true,
      eligibleSubtotalPaise: evaluation.eligibleSubtotalPaise,
      paidSubtotalAfterCouponPaise: evaluation.paidSubtotalAfterCouponPaise,
      unlockedGift: evaluation.unlockedGift
        ? {
            ruleId: evaluation.unlockedGift.ruleId,
            ruleName: evaluation.unlockedGift.ruleName,
            targetPaise: evaluation.unlockedGift.targetPaise,
            badgeText: evaluation.unlockedGift.badgeText,
            unlockMessage: evaluation.unlockedGift.unlockMessage,
            iconUrl: evaluation.unlockedGift.iconUrl,
            productId: evaluation.unlockedGift.gift.productId,
            variantId: evaluation.unlockedGift.gift.variantId,
            productName: evaluation.unlockedGift.gift.productName,
            variantLabel: evaluation.unlockedGift.gift.variantLabel,
            regularPricePaise: evaluation.unlockedGift.gift.regularPricePaise,
            imageUrl: evaluation.unlockedGift.gift.imageUrl,
          }
        : null,
      spinFreeGift,
      nextNudge: evaluation.nextNudge,
      conflict: evaluation.conflict,
      blockedByCouponMessage: evaluation.blockedByCouponMessage,
    };

    return NextResponse.json(payload, { headers: NO_STORE });
  } catch {
    return NextResponse.json(emptyResponse(), { headers: NO_STORE });
  }
}
