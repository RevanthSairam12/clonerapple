'use client';

import React from 'react';
import Link from 'next/link';
import { CATEGORY_GRID_ITEMS, type CategoryGridCard } from '@/lib/website/section-defaults';

export type { CategoryGridCard };

export interface GadzioCategoryGridProps {
  heading?: string;
  items?: CategoryGridCard[];
  enabled?: boolean;
}

export const DEFAULT_CATEGORY_CARDS = CATEGORY_GRID_ITEMS;

export function GadzioCategoryGrid({ heading, items, enabled = true }: GadzioCategoryGridProps) {
  if (enabled === false) return null;

  const cards = items && items.length > 0 ? items : DEFAULT_CATEGORY_CARDS;

  return (
    <section
      id="gadzio-category-grid"
      aria-label="Shop By Category"
      className="w-full bg-[#ebebe7] p-0 m-0 select-none overflow-hidden"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      {heading ? (
        <div className="py-6 px-4 text-center">
          <h2
            className="uppercase tracking-tight"
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
        </div>
      ) : null}

      {/* Full-bleed Edge-to-Edge Grid with Balanced Height (aspect-[4/5]), Very Small Gap (2px), and No Curved Corners (rounded-none) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[2px] w-full bg-[#ebebe7]">
        {cards.map((card, idx) => (
          <Link
            key={idx}
            href={card.href || '#'}
            className="group relative aspect-[4/5] min-h-[320px] sm:min-h-[380px] md:min-h-[440px] lg:min-h-[500px] w-full overflow-hidden bg-neutral-900 rounded-none flex items-center justify-center text-center cursor-pointer select-none transition-opacity duration-200 hover:opacity-95"
          >
            {/* Background Artwork filling the box with sharp corners */}
            <img
              src={card.image}
              alt={card.title}
              className="absolute inset-0 w-full h-full object-cover object-center rounded-none transition-transform duration-700 ease-out group-hover:scale-105"
              loading="lazy"
            />

            {/* Contrast Overlays to make bold white text pop on any background */}
            <div className="absolute inset-0 bg-black/25 group-hover:bg-black/15 transition-colors duration-300 pointer-events-none rounded-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25 pointer-events-none rounded-none" />

            {/* Optional Badge in top corner (sharp corners) */}
            {card.badge ? (
              <span className="absolute top-3.5 left-3.5 z-10 bg-[#ffe100] text-black font-black uppercase text-[10px] sm:text-xs px-2.5 py-1 rounded-none tracking-wider shadow">
                {card.badge}
              </span>
            ) : null}

            {/* Centered Category Heading - Bold All-Caps Typography scaled to fit 2-col / 4-col cards */}
            <div className="relative z-10 flex w-full min-w-0 flex-col items-center justify-center p-3 sm:p-5 text-center max-w-full">
              <h3
                className="max-w-full break-words text-[clamp(1rem,4.2vw,1.75rem)] md:text-[clamp(0.95rem,1.9vw,2.15rem)] font-bold uppercase text-white tracking-normal sm:tracking-wide leading-[1.05] drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)] transition-transform duration-300 group-hover:scale-[1.02]"
                style={{
                  fontFamily: 'transducer, sans-serif',
                  fontWeight: 700,
                }}
              >
                {card.title}
              </h3>
              {card.subtitle ? (
                <p
                  className="mt-2 w-full max-w-[240px] break-words text-[11px] sm:text-xs md:text-sm font-semibold text-white/90 drop-shadow leading-snug"
                  style={{ fontFamily: 'transducer, sans-serif' }}
                >
                  {card.subtitle}
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
