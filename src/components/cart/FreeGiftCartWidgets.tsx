'use client';

import React from 'react';
import Link from 'next/link';
import type { FreeGiftProgressNudge, ProductPageGiftPromo } from '@/lib/free-gifts/rules';
import { formatRupees } from '@/lib/store-admin/money';

export function FreeGiftProgressNudgeBanner({
  nudge,
  compact = false,
}: {
  nudge: FreeGiftProgressNudge | null | undefined;
  compact?: boolean;
}) {
  if (!nudge) return null;
  const pct = Math.max(4, Math.min(100, nudge.progressPercent));
  return (
    <div
      className={`rounded-2xl border border-[#e5e5ea] bg-[#fbfbfd] ${
        compact ? 'p-2.5' : 'p-3.5'
      }`}
      data-testid="free-gift-nudge"
    >
      <div className="flex items-center gap-2.5">
        {nudge.iconUrl ? (
          <img
            src={nudge.iconUrl}
            alt={nudge.giftName}
            className="h-8 w-8 shrink-0 rounded-lg border border-black/5 bg-white object-contain p-0.5"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fff9cc] text-[10px] font-bold text-[#1d1d1f]"
          >
            GIFT
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-semibold text-[#1d1d1f] leading-snug`}>
              {nudge.message}
            </p>
            <span className="shrink-0 rounded-full bg-[#e8f5e9] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#1b5e20]">
              {nudge.badgeText}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e5e5ea]">
            <div
              className="h-full rounded-full bg-[#34c759] transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function FreeGiftLineRow({
  productName,
  variantLabel = null,
  regularPricePaise = 0,
  imageUrl = null,
  badge = 'FREE',
  note,
  compact = false,
}: {
  productName: string;
  variantLabel?: string | null;
  regularPricePaise?: number;
  imageUrl?: string | null;
  badge?: string;
  note: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-2xl border border-[#34c759]/25 bg-[#f2fbf5] ${
        compact ? 'px-2.5 py-2' : 'px-4 py-3.5'
      }`}
      data-testid="free-gift-line-row"
    >
      <div className="flex min-w-0 items-center gap-3">
        {imageUrl ? (
          <div
            className={`${
              compact ? 'h-10 w-10' : 'h-14 w-14'
            } shrink-0 overflow-hidden rounded-xl border border-black/5 bg-white p-1 flex items-center justify-center`}
          >
            <img
              src={imageUrl}
              alt={productName}
              className="h-full w-full object-contain select-none"
            />
          </div>
        ) : (
          <div
            className={`${
              compact ? 'h-10 w-10 text-[10px]' : 'h-14 w-14 text-xs'
            } shrink-0 rounded-xl border border-[#34c759]/30 bg-white font-bold text-[#15803d] flex items-center justify-center`}
          >
            {badge}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-[#15803d] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              {badge}
            </span>
            <p className={`${compact ? 'text-[12px]' : 'text-sm'} font-semibold text-[#1d1d1f] truncate`}>
              {productName}
            </p>
          </div>
          {variantLabel ? (
            <p className="mt-0.5 text-[11px] text-[#6e6e73] truncate">{variantLabel}</p>
          ) : null}
          <p className="mt-0.5 text-[11px] text-[#15803d]">{note}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {regularPricePaise > 0 ? (
          <s className="block text-[11px] text-[#6e6e73] font-normal">
            {formatRupees(regularPricePaise)}
          </s>
        ) : null}
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-[#15803d]`}>
          FREE (₹0)
        </span>
      </div>
    </div>
  );
}

export function FreeGiftConflictNotice({
  message,
  tone = 'warning',
}: {
  message: string | null | undefined;
  tone?: 'warning' | 'info';
}) {
  if (!message) return null;
  const styles =
    tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-[#d2d2d7] bg-[#f5f5f7] text-[#424245]';
  return (
    <div
      role="status"
      className={`rounded-xl border px-3 py-2 text-xs leading-snug ${styles}`}
    >
      {message}
    </div>
  );
}

export function FreeGiftUnavailablePrompt({
  giftName,
  message,
  onContinueWithoutGift,
  busy = false,
}: {
  giftName: string;
  message: string;
  onContinueWithoutGift: () => void;
  busy?: boolean;
}) {
  return (
    <section
      role="alert"
      data-testid="gift-unavailable-prompt"
      className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <p className="font-semibold">
        Free gift unavailable: {giftName}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-amber-900">{message}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onContinueWithoutGift}
          disabled={busy}
          className="rounded-full bg-[#1d1d1f] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Opening payment…' : 'Continue without free gift'}
        </button>
        <Link
          href="/cart"
          className="text-xs font-semibold text-[#0071e3] hover:underline"
        >
          Review bag
        </Link>
      </div>
    </section>
  );
}

export function ProductPageFreeGiftStrip({
  promos,
}: {
  promos: readonly ProductPageGiftPromo[] | undefined;
}) {
  if (!promos || promos.length === 0) return null;
  const top = promos[0];
  return (
    <div
      className="mb-4 rounded-xl border border-[#34c759]/25 bg-[#f2fbf5] p-3"
      data-testid="pdp-free-gift-strip"
    >
      <div className="flex items-center gap-2.5">
        {top.iconUrl ? (
          <img
            src={top.iconUrl}
            alt={top.giftName}
            className="h-9 w-9 shrink-0 rounded-lg border border-black/5 bg-white object-contain p-0.5"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#15803d] text-[10px] font-bold text-white">
            {top.badgeText}
          </span>
        )}
        <div className="min-w-0 text-xs">
          <p className="font-semibold text-[#1d1d1f]">
            <span className="mr-1.5 inline-block rounded-full bg-[#15803d] px-2 py-0.5 text-[10px] font-bold uppercase text-white">
              {top.badgeText}
            </span>
            Free {top.giftName} on orders above {formatRupees(top.targetPaise)}
          </p>
          <p className="mt-0.5 text-[11px] text-[#424245]">
            {top.unlockMessage}
            {promos.length > 1 ? ` · +${promos.length - 1} more gift tier available` : ''}
          </p>
        </div>
      </div>
    </div>
  );
}
