import type { CouponRejectReason } from './rules';
import type { ShippingPolicy } from '@/lib/checkout/shipping-rules';
import type { PricedCartItem } from '@/lib/payu/db-pricing';

/**
 * Thrown inside the order transaction when the coupon cannot be honoured.
 * The transaction rolls back; the route maps this to 409 `coupon_invalid`
 * with the safe message only.
 */
export class CouponRejectedError extends Error {
  readonly reason: CouponRejectReason;

  constructor(reason: CouponRejectReason, safeMessage: string) {
    super(safeMessage);
    this.name = 'CouponRejectedError';
    this.reason = reason;
  }
}

export interface ChangedTotals {
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
}

/**
 * The client's expected total no longer matches what the server would charge
 * (a sale boundary, a coupon reaching its limit, or an edited cart). No order
 * is created; the customer reviews the new total.
 */
export class TotalChangedError extends Error {
  readonly totals: ChangedTotals;

  constructor(
    totals: ChangedTotals,
    readonly items: readonly PricedCartItem[] = [],
    readonly shippingPolicy?: ShippingPolicy,
  ) {
    super('Prices have changed, please review your cart.');
    this.name = 'TotalChangedError';
    this.totals = totals;
  }
}
