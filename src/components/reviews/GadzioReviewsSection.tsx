'use client';

import React from 'react';
import { REVIEWS_ITEMS, REVIEWS_COPY, type CustomerReviewItem } from '@/lib/website/section-defaults';

export type { CustomerReviewItem };

export interface GadzioReviewsSectionProps {
  enabled?: boolean;
  kicker?: string;
  heading?: string;
  subheading?: string;
  items?: CustomerReviewItem[];
}

export const DEFAULT_CUSTOMER_REVIEWS = REVIEWS_ITEMS;

export function GadzioReviewsSection({
  enabled = true,
  kicker = REVIEWS_COPY.kicker,
  heading = REVIEWS_COPY.heading,
  subheading = REVIEWS_COPY.subheading,
  items,
}: GadzioReviewsSectionProps) {
  if (enabled === false) return null;

  const reviews = items && items.length > 0 ? items : DEFAULT_CUSTOMER_REVIEWS;

  return (
    <section
      id="gadzio-reviews-section"
      aria-label="Customer Reviews and Star Rating"
      className="w-full bg-[#ebebe7] py-14 sm:py-20 px-4 sm:px-6 select-none font-sans"
    >
      <div className="max-w-[1240px] mx-auto text-center">
        {/* Top Kicker */}
        {kicker ? (
          <span className="block text-xs sm:text-sm font-extrabold uppercase tracking-[0.2em] text-neutral-800 mb-2">
            {kicker}
          </span>
        ) : null}

        {/* Main Headline */}
        {heading ? (
          <h2
            className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-black tracking-tight mb-3"
            style={{
              fontFamily:
                '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
              letterSpacing: '-0.5px',
            }}
          >
            {heading}
          </h2>
        ) : null}

        {/* Subtitle */}
        {subheading ? (
          <p className="text-sm sm:text-base text-neutral-700 max-w-2xl mx-auto mb-10 sm:mb-12 leading-relaxed font-medium">
            {subheading}
          </p>
        ) : null}

        {/* 3 Reviews Horizontal Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 items-stretch">
          {reviews.map((review, idx) => (
            <div
              key={idx}
              className="bg-white rounded-2xl p-6 sm:p-7 shadow-sm border border-neutral-200/60 flex flex-col justify-between text-center transition-all duration-200 hover:shadow-md hover:-translate-y-0.5"
            >
              <div>
                {/* Review Headline */}
                <h3 className="text-base sm:text-lg font-extrabold text-black mb-2 tracking-tight">
                  {review.headline}
                </h3>

                {/* Star Rating (5 cyan/sky-blue stars matching screenshot) */}
                <div className="flex items-center justify-center gap-1 mb-3 text-[#29b6f6]">
                  {[...Array(5)].map((_, starIdx) => (
                    <svg
                      key={starIdx}
                      className="w-4 h-4 fill-current drop-shadow-2xs"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>

                {/* Review Quote Body */}
                <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed mb-6 font-normal">
                  {review.content}
                </p>
              </div>

              {/* Author & Verified Buyer Badge */}
              <div className="pt-2 border-t border-neutral-100 flex items-center justify-center gap-1.5 text-xs text-neutral-600 font-medium">
                <span>{review.author}</span>
                {review.badgeText ? (
                  <>
                    <span>, {review.badgeText}</span>
                    <span
                      aria-label="Verified"
                      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[#10b981] text-white text-[9px] font-black leading-none"
                    >
                      ✓
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

