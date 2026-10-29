'use client';

import { useEffect, useState } from 'react';

import type { UseCouponResult } from '@/lib/cart/useCoupon';

/**
 * The "Have a coupon code?" box used in the bag and at checkout.
 *
 * It renders only what the server returned: a valid code becomes a chip with
 * a Remove control and the discount row appears next to it. An invalid code
 * never looks applied — the box stays open with the server's safe message.
 */

interface Props {
  coupon: UseCouponResult;
  /** Smaller type and spacing for the checkout summary. */
  compact?: boolean;
}

export function CouponBox({ coupon, compact = false }: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!coupon.applied && coupon.input && !expanded) setExpanded(true);
    // Only react to a code being restored or typed; collapsing stays collapsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupon.input]);

  const applied = coupon.applied;

  return (
    <div className={compact ? 'text-xs' : 'text-sm'}>
      {applied ? (
        <div className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
            <span aria-hidden>✓</span>
            {applied.code}
          </span>
          <button
            type="button"
            onClick={coupon.remove}
            className="text-xs font-medium text-[#0071e3] hover:underline"
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          {!expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="py-1 text-xs font-medium text-[#0071e3] hover:underline"
            >
              Have a coupon code?
            </button>
          ) : (
            <div className="space-y-2">
              <label
                className="block text-[10px] font-semibold uppercase tracking-wider text-[#86868b]"
                htmlFor="coupon-code-input"
              >
                Coupon code
              </label>
              <div className="flex gap-2">
                <input
                  id="coupon-code-input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={coupon.input}
                  onChange={(event) => coupon.setInput(event.target.value.toUpperCase())}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void coupon.apply();
                    }
                  }}
                  placeholder="Enter code"
                  maxLength={32}
                  className="min-w-0 flex-1 rounded-xl border border-[#d2d2d7] px-3 py-2 text-sm uppercase tracking-wide focus:outline-none focus:ring-2 focus:ring-[#0071e3]"
                />
                <button
                  type="button"
                  onClick={() => void coupon.apply()}
                  disabled={coupon.busy || coupon.input.trim().length === 0}
                  className="rounded-xl bg-[#1d1d1f] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#86868b]"
                >
                  {coupon.busy ? 'Checking…' : 'Apply'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {coupon.message ? (
        <p
          role={coupon.isError ? 'alert' : 'status'}
          className={`mt-2 text-xs ${coupon.isError ? 'text-[#e30000]' : 'text-emerald-700'}`}
        >
          {coupon.message}
        </p>
      ) : null}
    </div>
  );
}
