'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CustomerCouponView } from '@/lib/account/coupons';

export function CouponsList({ coupons }: { coupons: CustomerCouponView[] }) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(null), 2500);
    } catch {
      // Fallback or ignore
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Your Coupons</h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Public offers and coupons selected for your account.
        </p>
      </div>

      <div className="rounded-2xl bg-[#f5f5f7] p-4 text-xs sm:text-sm text-[#6e6e73]">
        <p>
          <strong>How to use:</strong> Copy a coupon code below and paste it in the promo code box in your bag or during checkout. Cart conditions still apply, including minimum spend, eligible items and shipping savings.
        </p>
      </div>

      {coupons.length === 0 ? (
        <div className="rounded-3xl border border-[#e5e5ea] bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-[#6e6e73]">You have no available coupons right now.</p>
          <Link
            href="/shop/iphone/accessories/cases-protection"
            className="mt-4 inline-flex rounded-full bg-[#ffe100] px-5 py-2.5 text-sm font-bold text-[#1d1d1f] hover:bg-[#ffea33] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            Start shopping
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coupons.map((coupon) => {
            const isCopied = copiedCode === coupon.code;
            return (
              <article
                key={coupon.id}
                className="flex flex-col justify-between rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-[#e8f3ff] px-3 py-1 text-xs font-semibold text-[#0066cc]">
                      {coupon.scopeDisplay}
                    </span>
                    <span className="text-xs text-[#6e6e73]">
                      {coupon.remainingDisplay}
                    </span>
                  </div>

                  <p className="mt-4 text-2xl font-bold tracking-tight text-[#1d1d1f]">
                    {coupon.valueDisplay}
                  </p>
                  <p className="mt-1 text-xs text-[#6e6e73]">
                    {coupon.minOrderDisplay}
                  </p>

                  <div className="mt-5 flex items-center justify-between rounded-2xl bg-[#f5f5f7] p-3">
                    <span className="font-mono text-sm font-bold tracking-wider text-[#1d1d1f]">
                      {coupon.code}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyCode(coupon.code)}
                      className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#1d1d1f] shadow-sm hover:bg-[#e8e8ed] focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
                    >
                      {isCopied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 border-t border-[#f5f5f7] pt-3 text-xs text-[#6e6e73]">
                  {coupon.expiryDisplay}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
