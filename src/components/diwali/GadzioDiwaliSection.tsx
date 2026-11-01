'use client';

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';

export interface FestiveProductCard {
  title: string;
  tagPrimary?: string;
  tagSecondary?: string;
  amountText: string;
  originalAmountText?: string;
  savingsText?: string;
  image: string;
  href?: string;
}

export interface GadzioDiwaliSectionProps {
  enabled?: boolean;
  bannerKicker?: string;
  bannerTitle?: string;
  bannerButtonLabel?: string;
  bannerButtonHref?: string;
  bannerImage?: string;
  items?: FestiveProductCard[];
}

export const DEFAULT_FESTIVE_PRODUCTS: FestiveProductCard[] = [
  {
    title: 'Gadzio Diwali Festive Tech Hamper 2026 (Limited Box)',
    tagPrimary: 'LIMITED RELEASE',
    tagSecondary: '⚡ NEW',
    amountText: '₹2,999',
    originalAmountText: '₹4,499',
    savingsText: 'SAVE 33%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (3).jpg',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
  {
    title: 'Diwali Gold Edition 3-in-1 Fast Wireless Charging Station',
    tagSecondary: '⚡ NEW',
    amountText: '₹1,899',
    originalAmountText: '₹2,699',
    savingsText: 'SAVE 30%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/1_promo_adapter_large.jpg.jpg',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
  },
  {
    title: 'Gadzio Pulse ANC Wireless Earphones - Festive Edition',
    tagPrimary: 'SAVE',
    tagSecondary: '⚡ NEW',
    amountText: '₹1,499',
    originalAmountText: '₹2,199',
    savingsText: 'SAVE 32%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/iearphones_large_2x.jpg',
    href: '/in/shop/iphone/accessories/wired-earphones',
  },
  {
    title: 'Diwali Elite MagSafe Protection Combo (Case + Screen Glass)',
    tagPrimary: 'BESTSELLER',
    tagSecondary: '⚡ FESTIVE',
    amountText: '₹1,299',
    originalAmountText: '₹1,899',
    savingsText: 'SAVE 31%',
    image: '/sites/cases-protection/images/iphone16pro-clear-magsafe.jpg',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
];

export function GadzioDiwaliSection({
  enabled = true,
  bannerKicker = 'DIWALI 2026',
  bannerTitle = 'ARE YOU READY?',
  bannerButtonLabel = 'SHOP DIWALI',
  bannerButtonHref = '/in/shop/iphone/accessories/cases-protection',
  bannerImage,
  items,
}: GadzioDiwaliSectionProps) {
  if (enabled === false) return null;

  const products = items && items.length > 0 ? items : DEFAULT_FESTIVE_PRODUCTS;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  const updateScrollProgress = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    const maxScroll = scrollWidth - clientWidth;
    if (maxScroll <= 0) {
      setScrollProgress(100);
      return;
    }
    const pct = Math.min(100, Math.max(0, (scrollLeft / maxScroll) * 100));
    setScrollProgress(pct);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollProgress, { passive: true });
    updateScrollProgress();
    return () => el.removeEventListener('scroll', updateScrollProgress);
  }, []);

  const scrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  return (
    <section
      id="gadzio-diwali-section"
      aria-label="Diwali Festive Campaign"
      className="w-full bg-[#ebebe7] py-6 sm:py-8 px-2 sm:px-3.5 select-none font-sans"
    >
      <div className="max-w-[1560px] mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 items-stretch">

          {/* =========================================================
              1. LEFT PROMO BANNER: DIWALI 2026 - ARE YOU READY?
              ========================================================= */}
          <div className="lg:col-span-5 relative min-h-[420px] sm:min-h-[480px] lg:min-h-[520px] rounded-2xl overflow-hidden shadow-sm flex flex-col justify-center items-center text-center p-6 sm:p-10 group">
            {/* Rich festive Diwali background with deep amber tones & glowing diya bokeh */}
            {bannerImage ? (
              <img
                src={bannerImage}
                alt="Diwali 2026 Celebration"
                className="absolute inset-0 w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
              />
            ) : (
              <div
                className="absolute inset-0 w-full h-full"
                style={{
                  background:
                    'radial-gradient(ellipse at 50% 35%, #ff9500 0%, #b84300 40%, #521600 70%, #1c0500 100%)',
                }}
              >
                {/* Decorative festive light bokeh & diya sparkle effects */}
                <div
                  className="absolute inset-0 opacity-40 mix-blend-screen pointer-events-none"
                  style={{
                    backgroundImage: `radial-gradient(circle at 20% 20%, #ffe066 0, transparent 35%),
                                      radial-gradient(circle at 80% 30%, #ffd166 0, transparent 40%),
                                      radial-gradient(circle at 50% 80%, #ff9e00 0, transparent 45%),
                                      radial-gradient(circle at 75% 75%, #ffb703 0, transparent 30%)`,
                  }}
                />
                {/* Soft festive diya glow at bottom */}
                <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
              </div>
            )}

            {/* Dark vignette overlay for crisp contrast */}
            <div className="absolute inset-0 bg-black/25 pointer-events-none" />

            {/* Banner Content Container */}
            <div className="relative z-10 flex flex-col items-center justify-center max-w-md mx-auto space-y-3 sm:space-y-4">
              {/* Kicker */}
              <span className="text-xs sm:text-sm font-black uppercase tracking-[0.2em] text-white/95 drop-shadow">
                {bannerKicker}
              </span>

              {/* Main Headline */}
              <h2
                className="text-4xl sm:text-5xl md:text-5xl lg:text-[56px] font-black uppercase text-white leading-[0.96] tracking-tight drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]"
                style={{
                  fontFamily:
                    '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                }}
              >
                {bannerTitle}
              </h2>

              {/* Yellow Action Button */}
              <div className="pt-2 sm:pt-4">
                <Link
                  href={bannerButtonHref}
                  className="inline-block bg-[#ffe100] text-black font-black uppercase text-sm sm:text-base px-8 py-3.5 tracking-wider hover:bg-[#ffea33] active:scale-95 transition-all duration-150 shadow-md hover:shadow-lg rounded-xs"
                >
                  {bannerButtonLabel}
                </Link>
              </div>
            </div>
          </div>

          {/* =========================================================
              2. RIGHT HORIZONTAL PRODUCT CAROUSEL (FESTIVE SPECIALS)
              ========================================================= */}
          <div className="lg:col-span-7 flex flex-col justify-between relative min-h-[420px] bg-transparent">

            {/* Navigation Chevron Buttons */}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-xs sm:text-sm font-bold tracking-wider uppercase text-neutral-600">
                FESTIVE RELEASES &amp; EXCLUSIVES
              </span>
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={scrollLeft}
                  aria-label="Previous products"
                  className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-black shadow-sm flex items-center justify-center border border-neutral-300 transition-all hover:scale-105 active:scale-95"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={scrollRight}
                  aria-label="Next products"
                  className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-black shadow-sm flex items-center justify-center border border-neutral-300 transition-all hover:scale-105 active:scale-95"
                >
                  ›
                </button>
              </div>
            </div>

            {/* Product Scroll Track */}
            <div
              ref={scrollRef}
              className="flex gap-3 overflow-x-auto scroll-smooth py-1 no-scrollbar items-stretch"
              style={{
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
            >
              {products.map((item, idx) => (
                <Link
                  key={idx}
                  href={item.href || '#'}
                  className="w-[230px] sm:w-[260px] md:w-[280px] shrink-0 bg-white rounded-2xl p-3.5 sm:p-4 flex flex-col justify-between shadow-sm hover:shadow-md transition-all duration-200 group border border-neutral-200/70"
                >
                  {/* Top Badges Row */}
                  <div className="flex items-start justify-between gap-1 min-h-[26px] mb-2 z-10">
                    <div className="flex flex-col items-start gap-1">
                      {item.tagPrimary ? (
                        <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-[#dce9ff] text-[#2250be] border border-blue-200/50 tracking-wider shadow-2xs">
                          {item.tagPrimary}
                        </span>
                      ) : null}
                      {item.tagSecondary ? (
                        <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-[#ffe600] text-black tracking-wider flex items-center gap-1 shadow-2xs">
                          {item.tagSecondary}
                        </span>
                      ) : null}
                    </div>

                    {item.savingsText ? (
                      <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-[#fedce8] text-[#c2185b] tracking-wider self-start shadow-2xs">
                        {item.savingsText}
                      </span>
                    ) : null}
                  </div>

                  {/* Product Image Stage */}
                  <div className="relative aspect-square w-full flex items-center justify-center overflow-hidden my-auto p-2">
                    <img
                      src={item.image}
                      alt={item.title}
                      className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>

                  {/* Product Info */}
                  <div className="pt-3 border-t border-neutral-100 flex flex-col gap-1 mt-auto">
                    <h3 className="text-xs sm:text-sm font-bold text-neutral-900 line-clamp-2 group-hover:text-blue-600 transition-colors leading-snug">
                      {item.title}
                    </h3>

                    {/* Price and Savings Row */}
                    <div className="flex items-baseline gap-2 pt-1 flex-wrap">
                      <span
                        className={`text-base sm:text-lg font-black ${
                          item.savingsText ? 'text-[#d6186e]' : 'text-neutral-900'
                        }`}
                      >
                        {item.amountText}
                      </span>
                      {item.originalAmountText ? (
                        <span className="text-xs sm:text-sm text-neutral-400 line-through font-medium">
                          {item.originalAmountText}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {/* Bottom Scrollbar Progress Track (matches screenshot) */}
            <div className="w-full h-1.5 bg-neutral-300/80 rounded-full mt-4 relative overflow-hidden">
              <div
                className="h-full bg-neutral-600 rounded-full transition-all duration-150"
                style={{
                  width: '35%',
                  transform: `translateX(${scrollProgress * 1.85}%)`,
                }}
              />
            </div>

          </div>

        </div>
      </div>
    </section>
  );
}
