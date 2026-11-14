'use client';

import React from 'react';
import Link from 'next/link';
import { SALE_BANNER_COPY } from '@/lib/website/section-defaults';

export interface GadzioSaleBannerProps {
  enabled?: boolean;
  kicker?: string;
  heading?: string;
  subtitle?: string;
  badgeText?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
  bgColor?: string;
  accentColor?: string;
}

export const DEFAULT_SALE_BANNER = SALE_BANNER_COPY;

function safeHexColor(value: string | undefined, fallback: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ? trimmed : fallback;
}

/**
 * Editable promotional banner displayed on `/sale` directly beneath the
 * header and accessory category navigation bar.
 */
export function GadzioSaleBanner({
  enabled = true,
  kicker = DEFAULT_SALE_BANNER.kicker,
  heading = DEFAULT_SALE_BANNER.heading,
  subtitle = DEFAULT_SALE_BANNER.subtitle,
  badgeText = DEFAULT_SALE_BANNER.badgeText,
  ctaLabel = DEFAULT_SALE_BANNER.ctaLabel,
  ctaHref = DEFAULT_SALE_BANNER.ctaHref,
  image = DEFAULT_SALE_BANNER.image,
  bgColor = DEFAULT_SALE_BANNER.bgColor,
  accentColor = DEFAULT_SALE_BANNER.accentColor,
}: GadzioSaleBannerProps) {
  if (enabled === false) return null;

  const surfaceColor = safeHexColor(bgColor, DEFAULT_SALE_BANNER.bgColor);
  const pillColor = safeHexColor(accentColor, DEFAULT_SALE_BANNER.accentColor);
  const hasImage = Boolean(image && image.trim());
  const cleanHref = ctaHref?.trim() || '#collection-grid-content';

  return (
    <section
      id="gadzio-sale-banner"
      aria-label={heading || 'Sale Promotion Banner'}
      className="relative w-full overflow-hidden border-b border-white/10 text-white select-none"
      style={{
        backgroundColor: surfaceColor,
        fontFamily: 'transducer, sans-serif',
      }}
    >
      {/* Subtle radial atmospheric depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 80% 25%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 38%, rgba(0,0,0,0.35) 100%)',
        }}
      />

      <div className="relative mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10 md:py-12">
        <div
          className={
            hasImage
              ? 'grid grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:gap-10'
              : 'mx-auto flex max-w-3xl flex-col items-center text-center'
          }
        >
          <div
            className={
              hasImage
                ? 'flex flex-col items-center text-center md:items-start md:text-left'
                : 'flex flex-col items-center text-center'
            }
          >
            {(kicker || badgeText) && (
              <div className="mb-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                {kicker ? (
                  <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/95 backdrop-blur-xs">
                    {kicker}
                  </span>
                ) : null}
                {badgeText ? (
                  <span
                    className="inline-flex items-center rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[#111111]"
                    style={{ backgroundColor: pillColor }}
                  >
                    {badgeText}
                  </span>
                ) : null}
              </div>
            )}

            {heading ? (
              <h2 className="text-3xl font-bold uppercase leading-[0.98] tracking-tight text-white sm:text-4xl lg:text-[46px]">
                {heading}
              </h2>
            ) : null}

            {subtitle ? (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-neutral-300 sm:text-base">
                {subtitle}
              </p>
            ) : null}

            {ctaLabel ? (
              <div className="mt-5">
                <Link
                  href={cleanHref}
                  className="inline-flex min-h-[42px] items-center justify-center rounded-full px-6 py-2 text-xs font-bold uppercase tracking-[0.1em] text-[#111111] transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98]"
                  style={{ backgroundColor: pillColor }}
                >
                  {ctaLabel}
                </Link>
              </div>
            ) : null}
          </div>

          {hasImage ? (
            <div className="relative mx-auto aspect-[16/9] w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/15 bg-black/40 shadow-2xl md:aspect-[16/10]">
              <img
                src={image}
                alt={heading || 'Featured sale offer'}
                className="h-full w-full object-cover object-center transition-transform duration-700 ease-out hover:scale-[1.03]"
                loading="eager"
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
