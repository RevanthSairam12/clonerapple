'use client';

import React, { useRef, useState, useEffect } from 'react';
import Link from 'next/link';
import { IN_THE_WILD_ITEMS, IN_THE_WILD_COPY, type WildPhotoItem } from '@/lib/website/section-defaults';

export type { WildPhotoItem };

export interface GadzioInTheWildProps {
  enabled?: boolean;
  heading?: string;
  subheading?: string;
  items?: WildPhotoItem[];
}

export const DEFAULT_WILD_PHOTOS = IN_THE_WILD_ITEMS;

export function GadzioInTheWild({
  enabled = true,
  heading = IN_THE_WILD_COPY.heading,
  subheading = IN_THE_WILD_COPY.subheading,
  items,
}: GadzioInTheWildProps) {
  if (enabled === false) return null;

  const photos = items && items.length > 0 ? items : DEFAULT_WILD_PHOTOS;
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

  const scrollPrev = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: -320, behavior: 'smooth' });
    }
  };

  const scrollNext = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollBy({ left: 320, behavior: 'smooth' });
    }
  };

  return (
    <section
      id="gadzio-in-the-wild"
      aria-label="Community Photo Gallery"
      className="w-full bg-white py-14 sm:py-20 px-2 sm:px-4 select-none font-sans overflow-hidden"
    >
      <div className="max-w-[1560px] mx-auto">
        {/* Header Title & Subtitle */}
        <div className="text-center max-w-2xl mx-auto mb-8 sm:mb-10 px-4">
          {heading ? (
            <h2
              className="text-3xl sm:text-4xl md:text-5xl font-black text-black tracking-tight mb-2.5"
              style={{
                fontFamily:
                  '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                letterSpacing: '-0.5px',
              }}
            >
              {heading}
            </h2>
          ) : null}

          {subheading ? (
            <p className="text-xs sm:text-sm md:text-base text-neutral-600 font-medium leading-relaxed">
              {subheading}
            </p>
          ) : null}
        </div>

        {/* Carousel Container */}
        <div className="relative group/track">
          {/* Subtle Navigation Buttons (shown on desktop hover) */}
          <button
            type="button"
            onClick={scrollPrev}
            aria-label="Scroll left"
            className="hidden md:flex absolute -left-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/95 text-black shadow-lg border border-neutral-200 items-center justify-center opacity-0 group-hover/track:opacity-100 transition-all hover:scale-105 active:scale-95"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={scrollNext}
            aria-label="Scroll right"
            className="hidden md:flex absolute -right-2 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-white/95 text-black shadow-lg border border-neutral-200 items-center justify-center opacity-0 group-hover/track:opacity-100 transition-all hover:scale-105 active:scale-95"
          >
            ›
          </button>

          {/* Photo Track */}
          <div
            ref={scrollRef}
            className="flex gap-2 sm:gap-3 overflow-x-auto scroll-smooth py-1 no-scrollbar items-stretch"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {photos.map((item, idx) => {
              const cardContent = (
                <div className="relative aspect-[3/4] sm:aspect-[4/5] min-h-[300px] sm:min-h-[340px] md:min-h-[380px] w-[210px] sm:w-[240px] md:w-[270px] shrink-0 bg-neutral-100 overflow-hidden shadow-xs hover:shadow-md transition-all duration-300 group">
                  <img
                    src={item.image}
                    alt={item.alt || `Community photo ${idx + 1}`}
                    className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-105"
                    loading="lazy"
                  />
                  {/* Subtle dark vignette at bottom for optional caption */}
                  {item.caption ? (
                    <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end">
                      <span className="text-[11px] font-semibold text-white drop-shadow-sm line-clamp-2">
                        {item.caption}
                      </span>
                    </div>
                  ) : null}
                </div>
              );

              if (item.href) {
                return (
                  <Link
                    key={idx}
                    href={item.href}
                    className="no-underline shrink-0 block"
                    aria-label={item.alt || `View photo ${idx + 1}`}
                  >
                    {cardContent}
                  </Link>
                );
              }

              return (
                <div key={idx} className="shrink-0">
                  {cardContent}
                </div>
              );
            })}
          </div>

          {/* Bottom Scrollbar Progress Track (matches screenshot exactly) */}
          <div className="w-full h-1.5 bg-neutral-200 rounded-full mt-6 relative overflow-hidden">
            <div
              className="h-full bg-neutral-600 rounded-full transition-all duration-150"
              style={{
                width: '30%',
                transform: `translateX(${scrollProgress * 2.33}%)`,
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

