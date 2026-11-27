'use client';

import React from 'react';
import type { FreeShippingBannerState } from '@/lib/checkout/shipping-banner';

export function FreeShippingProgressBar({
  banner,
  className = '',
}: {
  banner: FreeShippingBannerState | null;
  className?: string;
}) {
  if (!banner) return null;

  const fillWidth =
    banner.progressPercent === 0 ? '0%' : `${Math.max(4, banner.progressPercent)}%`;

  return (
    <div
      data-testid="free-shipping-bar"
      role="status"
      aria-live="polite"
      className={`rounded-2xl border p-4 transition-colors ${
        banner.unlocked
          ? 'border-[#34c759]/30 bg-[#f2fbf5]'
          : 'border-[#e5e5ea] bg-[#fbfbfd]'
      } ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-2xs ${
            banner.unlocked
              ? 'bg-[#15803d] text-white'
              : 'bg-white text-[#0071e3] border border-black/5'
          }`}
        >
          {banner.unlocked ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
              />
            </svg>
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <p className="text-xs sm:text-sm font-semibold text-[#1d1d1f] leading-snug">
                {banner.headline}
              </p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  banner.unlocked
                    ? 'bg-[#15803d] text-white'
                    : 'bg-[#e8f5e9] text-[#1b5e20]'
                }`}
              >
                {banner.badgeText}
              </span>
            </div>
            {banner.progressLabel ? (
              <span className="shrink-0 text-[11px] font-medium text-[#6e6e73]">
                {banner.progressLabel}
              </span>
            ) : null}
          </div>

          <p
            className={`mt-1 text-[11px] sm:text-xs leading-snug ${
              banner.unlocked ? 'text-[#15803d]' : 'text-[#6e6e73]'
            }`}
          >
            {banner.subtext}
          </p>

          <div
            role="progressbar"
            aria-valuenow={banner.progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Free delivery progress"
            className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-[#e5e5ea]"
          >
            <div
              className="h-full rounded-full bg-[#34c759] transition-all duration-300"
              style={{ width: fillWidth }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
