'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface ExploreAccessoriesHeaderProps {
  heading?: string;
}

export function ExploreAccessoriesHeader({
  heading = 'Explore Accessories',
}: ExploreAccessoriesHeaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollShift, setScrollShift] = useState(0);

  useEffect(() => {
    let rafId: number;

    const onScroll = () => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      // Only compute when element is near or within the viewport
      if (rect.top < viewportHeight + 200 && rect.bottom > -200) {
        // Shift horizontally based on scroll depth
        const progress = (viewportHeight - rect.top) / (viewportHeight + rect.height);
        setScrollShift((progress - 0.5) * -180);
      }
    };

    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(onScroll);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    onScroll();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // Repeating array to ensure continuous looping across all ultrawide displays
  const repeatedItems = [0, 1, 2, 3, 4, 5];

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden select-none py-6 sm:py-8 al:py-12"
      aria-label={heading}
    >
      {/* Outer track with scroll parallax response */}
      <div
        className="w-full transition-transform duration-150 ease-out will-change-transform"
        style={{
          transform: `translate3d(${scrollShift}px, 0, 0)`,
        }}
      >
        {/* Continuous kinetic marquee loop */}
        <div className="flex w-max items-center animate-promo-marquee hover:[animation-play-state:paused]">
          {/* Track 1 */}
          <div className="flex shrink-0 items-center gap-6 sm:gap-10 pr-6 sm:pr-10">
            {repeatedItems.map((idx) => (
              <span key={`item-a-${idx}`} className="flex items-center gap-6 sm:gap-10">
                <h2
                  className={cn(
                    'text-[clamp(2.5rem,7vw,6.5rem)] font-[900] tracking-[-0.04em] uppercase leading-none',
                    'text-[#1d1d1f] hover:text-[#0071e3] transition-colors duration-300',
                  )}
                  style={{
                    fontFamily: "'Mona Sans', var(--ac-font-display), -apple-system, sans-serif",
                    fontStretch: '115%',
                  }}
                >
                  {heading}
                </h2>
                <span
                  className="text-[clamp(1.2rem,3vw,2.5rem)] text-[#0071e3]/70 font-light select-none"
                  aria-hidden="true"
                >
                  ✦
                </span>
              </span>
            ))}
          </div>

          {/* Track 2 (Clone for infinite seamless loop) */}
          <div className="flex shrink-0 items-center gap-6 sm:gap-10 pr-6 sm:pr-10" aria-hidden="true">
            {repeatedItems.map((idx) => (
              <span key={`item-b-${idx}`} className="flex items-center gap-6 sm:gap-10">
                <span
                  className={cn(
                    'text-[clamp(2.5rem,7vw,6.5rem)] font-[900] tracking-[-0.04em] uppercase leading-none',
                    'text-[#1d1d1f] hover:text-[#0071e3] transition-colors duration-300',
                  )}
                  style={{
                    fontFamily: "'Mona Sans', var(--ac-font-display), -apple-system, sans-serif",
                    fontStretch: '115%',
                  }}
                >
                  {heading}
                </span>
                <span
                  className="text-[clamp(1.2rem,3vw,2.5rem)] text-[#0071e3]/70 font-light select-none"
                >
                  ✦
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Subtle edge fade masks for smooth entrance/exit */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 sm:w-24 bg-gradient-to-r from-[#f5f5f7] to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 sm:w-24 bg-gradient-to-l from-[#f5f5f7] to-transparent z-10" />
    </div>
  );
}
