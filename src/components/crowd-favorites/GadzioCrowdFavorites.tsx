'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

export interface CrowdFavoriteItem {
  title: string;
  price: string;
  image: string;
  href: string;
  badge?: string;
  badgeColor?: 'lavender' | 'yellow' | 'green' | 'default';
  secondaryBadge?: string;
  secondaryBadgeColor?: 'pink' | 'yellow' | 'green' | 'default';
  colorDots?: string;
}

export interface GadzioCrowdFavoritesProps {
  heading?: string;
  subtitle?: string;
  rightLinkLabel?: string;
  rightLinkHref?: string;
  items?: CrowdFavoriteItem[];
  enabled?: boolean;
}

export const DEFAULT_CROWD_FAVORITES: CrowdFavoriteItem[] = [
  {
    title: 'Gadzio CrystalArmor Clear Case with MagSafe',
    price: '₹3,499',
    image: '/sites/cases-protection/images/iphone17pro-clear-magsafe.jpg',
    href: '/shop/product/iphone18pro-max-clear-magsafe',
    badge: 'LIMITED RELEASE',
    badgeColor: 'lavender',
    secondaryBadge: '⚡ NEW',
    secondaryBadgeColor: 'yellow',
    colorDots: '#e8e8ed, #1d1d1f',
  },
  {
    title: 'Gadzio MagPulse Liquid Silicone Case',
    price: '₹3,499',
    image: '/sites/cases-protection/images/iphone17-silicone-black.jpg',
    href: '/shop/product/iphone17-silicone-black',
    badge: '⚡ NEW',
    badgeColor: 'yellow',
    secondaryBadge: 'TOP ITEM',
    secondaryBadgeColor: 'pink',
    colorDots: '#1d1d1f, #8e8e93',
  },
  {
    title: 'Gadzio 20W USB-C GaN Fast Power Adapter',
    price: '₹1,499',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/1_promo_adapter_large.jpg.jpg',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
    badge: 'TRENDING',
    badgeColor: 'green',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#f5f5f7, #1d1d1f',
  },
  {
    title: 'Gadzio Pulse USB-C Studio Hi-Res Earphones',
    price: '₹1,499',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/iearphones_large_2x.jpg',
    href: '/in/shop/iphone/accessories/wired-earphones',
    badge: 'TRENDING',
    badgeColor: 'green',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#ffffff, #1d1d1f',
  },
  {
    title: 'Gadzio Ultra-Durable Braided USB-C Cable',
    price: '₹999',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (1).jpg',
    href: '/in/shop/iphone/accessories/cable-plug-case',
    badge: 'BESTSELLER',
    badgeColor: 'yellow',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#1d1d1f',
  },
  {
    title: 'Gadzio Rugged Armor Case for AirPods Pro',
    price: '₹1,299',
    image: '/sites/cases-protection/images/iphone17pro-max-silicone.jpg',
    href: '/in/shop/iphone/accessories/airpods-case',
    badge: 'NEW',
    badgeColor: 'yellow',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#1d1d1f, #4f6f8f',
  },
];

function renderBadgePill(text?: string, color?: string) {
  if (!text) return null;

  let bgClass = 'bg-[#ffe100] text-black'; // default yellow
  if (color === 'lavender') {
    bgClass = 'bg-[#dce3fc] text-[#243372]';
  } else if (color === 'green') {
    bgClass = 'bg-[#c8f2cb] text-[#1b5e20]';
  } else if (color === 'pink') {
    bgClass = 'bg-[#fbcfe8] text-[#9d174d]';
  } else if (color === 'yellow') {
    bgClass = 'bg-[#ffe100] text-black';
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shadow-sm ${bgClass}`}
    >
      {text}
    </span>
  );
}

export function GadzioCrowdFavorites({
  heading = 'The Crowd Favorites',
  subtitle = 'See what everyone is adding to their cart right now.',
  rightLinkLabel = 'SHOP BEST SELLERS',
  rightLinkHref = '/in/shop/iphone/accessories/cases-protection',
  items,
  enabled = true,
}: GadzioCrowdFavoritesProps) {
  if (enabled === false) return null;

  const productList = items && items.length > 0 ? items : DEFAULT_CROWD_FAVORITES;

  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [thumbWidthRatio, setThumbWidthRatio] = useState(0.2);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollStart, setScrollStart] = useState(0);

  // Update scroll progress & thumb size
  const updateProgress = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) {
      setScrollProgress(0);
      setThumbWidthRatio(1);
    } else {
      setScrollProgress(el.scrollLeft / maxScroll);
      setThumbWidthRatio(Math.max(0.15, el.clientWidth / el.scrollWidth));
    }
  }, []);

  useEffect(() => {
    updateProgress();
    window.addEventListener('resize', updateProgress);
    return () => window.removeEventListener('resize', updateProgress);
  }, [updateProgress, productList]);

  // Arrow button handlers
  const handleScrollLeft = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const handleScrollRight = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  // Track click handler
  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current || !scrollRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;
    const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
    scrollRef.current.scrollTo({
      left: clickRatio * maxScroll,
      behavior: 'smooth',
    });
  };

  // Mouse drag-to-scroll on carousel
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    setIsDragging(true);
    setStartX(e.pageX - scrollRef.current.offsetLeft);
    setScrollStart(scrollRef.current.scrollLeft);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !scrollRef.current) return;
    e.preventDefault();
    const x = e.pageX - scrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    scrollRef.current.scrollLeft = scrollStart - walk;
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  return (
    <section
      id="gadzio-crowd-favorites"
      aria-label={heading || 'The Crowd Favorites'}
      className="w-full bg-[#e8eaee] py-10 sm:py-14 select-none overflow-hidden"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6 sm:mb-8">
          <div>
            <h2
              className="tracking-tight"
              style={{
                fontFamily: 'transducer, sans-serif',
                fontSize: '36px',
                fontWeight: 700,
                lineHeight: '36px',
                color: '#000',
              }}
            >
              {heading}
            </h2>
            {subtitle ? (
              <p
                className="text-xs sm:text-sm font-medium mt-1.5"
                style={{ fontFamily: 'transducer, sans-serif', color: '#333' }}
              >
                {subtitle}
              </p>
            ) : null}
          </div>

          {rightLinkLabel ? (
            <Link
              href={rightLinkHref || '#'}
              className="text-xs sm:text-sm tracking-wider uppercase underline underline-offset-4 hover:opacity-70 transition-opacity whitespace-nowrap self-start sm:self-auto"
              style={{
                fontFamily: 'transducer, sans-serif',
                fontWeight: 700,
                color: '#000',
              }}
            >
              {rightLinkLabel}
            </Link>
          ) : null}
        </div>

        {/* Carousel Container */}
        <div
          ref={scrollRef}
          onScroll={updateProgress}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          className={`flex gap-4 sm:gap-6 overflow-x-auto pb-4 no-scrollbar scroll-smooth ${
            isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
          }`}
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {productList.map((item, idx) => {
            const dots = item.colorDots
              ? item.colorDots
                  .split(',')
                  .map((d) => d.trim())
                  .filter(Boolean)
              : [];

            return (
              <Link
                key={idx}
                href={item.href || '#'}
                className="group flex-shrink-0 w-[220px] sm:w-[260px] md:w-[280px] flex flex-col cursor-pointer"
              >
                {/* Product Card Image Box */}
                <div className="relative aspect-square w-full rounded-2xl bg-white/70 border border-black/[0.04] p-4 flex items-center justify-center transition-all duration-300 group-hover:bg-white group-hover:shadow-md overflow-hidden">
                  {/* Badges on Top Left */}
                  <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 items-start pointer-events-none">
                    {renderBadgePill(item.badge, item.badgeColor)}
                    {item.secondaryBadge && !item.secondaryBadgeColor?.includes('pink')
                      ? renderBadgePill(item.secondaryBadge, item.secondaryBadgeColor)
                      : null}
                  </div>

                  {/* Product Artwork */}
                  <img
                    src={item.image}
                    alt={item.title}
                    className="max-h-[85%] max-w-[85%] object-contain drop-shadow transition-transform duration-300 ease-out group-hover:scale-105"
                    loading="lazy"
                  />
                </div>

                {/* Details under card */}
                <div className="flex flex-col mt-3 px-1">
                  {/* Title */}
                  <h3 className="text-xs sm:text-sm font-bold text-neutral-900 line-clamp-2 leading-snug group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h3>

                  {/* Middle Badge (like pink TOP ITEM pill) */}
                  {item.secondaryBadge &&
                  (item.secondaryBadgeColor === 'pink' ||
                    item.secondaryBadge.toUpperCase().includes('TOP ITEM')) ? (
                    <div className="mt-1.5">
                      <span className="inline-block bg-[#fbcfe8] text-[#9d174d] text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded shadow-xs">
                        {item.secondaryBadge}
                      </span>
                    </div>
                  ) : null}

                  {/* Price */}
                  <div className="text-xs sm:text-sm font-extrabold text-neutral-900 mt-1">
                    {item.price}
                  </div>

                  {/* Optional Color Dots */}
                  {dots.length > 0 ? (
                    <div className="flex items-center gap-1.5 mt-2">
                      {dots.map((dot, dIdx) => (
                        <span
                          key={dIdx}
                          style={{ backgroundColor: dot }}
                          className={`w-3 h-3 rounded-full border border-black/20 ${
                            dIdx === 0 ? 'ring-1 ring-black/40 ring-offset-1' : ''
                          }`}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>

        {/* Custom Interactive Scrollbar Track beneath products */}
        <div className="flex items-center gap-2 mt-4 sm:mt-6 w-full">
          {/* Left Arrow Button */}
          <button
            type="button"
            onClick={handleScrollLeft}
            aria-label="Scroll left"
            className="flex items-center justify-center w-6 h-6 rounded-full text-neutral-500 hover:text-neutral-900 hover:bg-black/5 transition-colors cursor-pointer text-xs"
          >
            ◀
          </button>

          {/* Scroll Track */}
          <div
            ref={trackRef}
            onClick={handleTrackClick}
            className="relative flex-1 h-1.5 bg-black/15 rounded-full cursor-pointer overflow-hidden"
          >
            {/* Draggable / Progress Thumb */}
            <div
              className="absolute top-0 bottom-0 bg-neutral-800 rounded-full transition-all duration-75"
              style={{
                width: `${thumbWidthRatio * 100}%`,
                left: `${scrollProgress * (1 - thumbWidthRatio) * 100}%`,
              }}
            />
          </div>

          {/* Right Arrow Button */}
          <button
            type="button"
            onClick={handleScrollRight}
            aria-label="Scroll right"
            className="flex items-center justify-center w-6 h-6 rounded-full text-neutral-500 hover:text-neutral-900 hover:bg-black/5 transition-colors cursor-pointer text-xs"
          >
            ▶
          </button>
        </div>
      </div>
    </section>
  );
}

