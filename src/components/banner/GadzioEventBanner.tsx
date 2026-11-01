'use client';

import React from 'react';
import Link from 'next/link';

export interface GadzioEventBannerProps {
  heading?: string;
  subtitle?: string;
  ctaLabel?: string;
  ctaHref?: string;
  image?: string;
  enabled?: boolean;
}

export const DEFAULT_EVENT_BANNER = {
  heading: 'The Flagship Drop Of The Year',
  subtitle:
    'Order now to get the limited deluxe titanium edition—engineered with aerospace-grade defense and high-gauss MagSafe.',
  ctaLabel: 'SHOP THE DROP',
  ctaHref: '/in/shop/iphone/accessories/cases-protection',
  image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/icase_large_2x.jpg',
};

export function GadzioEventBanner({
  heading = DEFAULT_EVENT_BANNER.heading,
  subtitle = DEFAULT_EVENT_BANNER.subtitle,
  ctaLabel = DEFAULT_EVENT_BANNER.ctaLabel,
  ctaHref = DEFAULT_EVENT_BANNER.ctaHref,
  image = DEFAULT_EVENT_BANNER.image,
  enabled = true,
}: GadzioEventBannerProps) {
  if (enabled === false) return null;

  return (
    <section
      id="gadzio-event-banner"
      aria-label={heading || 'The Flagship Drop Of The Year'}
      className="w-full bg-[#010609] text-white py-12 sm:py-16 md:py-20 select-none overflow-hidden border-t border-white/10"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">
          {/* Left Column: Dramatic Product Showcase Artwork */}
          <div className="relative aspect-[4/3] sm:aspect-[16/10] md:aspect-[4/3] w-full max-w-[620px] mx-auto rounded-xl overflow-hidden bg-neutral-950 flex items-center justify-center p-4 group">
            {/* Ambient Backlight Glow */}
            <div className="absolute inset-0 bg-gradient-to-tr from-cyan-900/30 via-transparent to-white/10 pointer-events-none" />

            <img
              src={image}
              alt={heading}
              className="w-full h-full object-cover object-center rounded-lg shadow-2xl transition-transform duration-700 ease-out group-hover:scale-105"
              loading="lazy"
            />
          </div>

          {/* Right Column: High-Impact Typography & CTA */}
          <div className="flex flex-col items-center md:items-start text-center md:text-left max-w-xl mx-auto md:mx-0">
            <h2
              className="text-3xl sm:text-4xl md:text-5xl lg:text-[56px] font-bold uppercase text-white tracking-tight leading-[0.95]"
              style={{
                fontFamily: 'transducer, sans-serif',
                fontWeight: 700,
              }}
            >
              {heading}
            </h2>

            {subtitle ? (
              <p
                className="mt-4 sm:mt-6 text-sm sm:text-base md:text-lg text-neutral-300 font-medium leading-relaxed max-w-lg"
                style={{ fontFamily: 'transducer, sans-serif' }}
              >
                {subtitle}
              </p>
            ) : null}

            {ctaLabel ? (
              <div className="mt-6 sm:mt-8">
                <Link
                  href={ctaHref || '#'}
                  className="inline-block text-sm sm:text-base font-bold tracking-widest text-white uppercase underline underline-offset-8 decoration-2 hover:opacity-80 transition-opacity"
                  style={{
                    fontFamily: 'transducer, sans-serif',
                    fontWeight: 700,
                  }}
                >
                  {ctaLabel}
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

