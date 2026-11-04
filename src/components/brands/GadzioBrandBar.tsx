'use client';

import React from 'react';
import Link from 'next/link';
import { BRAND_BAR_ITEMS, type BrandLogoItem } from '@/lib/website/section-defaults';

export type { BrandLogoItem };

export interface GadzioBrandBarProps {
  items?: BrandLogoItem[];
  enabled?: boolean;
}

export const DEFAULT_BRANDS = BRAND_BAR_ITEMS;

/**
 * Render brand logos with unique typographic marks matching the screenshot:
 * 1. GADZIO (playful bold lettering)
 * 2. BEAST GAMES (bold futuristic block lettering)
 * 3. BEAST by MrBeast (heavy wide sans)
 * 4. BEAST ATHLETICS (athletic collegiate lettering)
 * 5. MrBEAST LAB (dynamic comic-style lettering)
 * 6. GADZIO SIGNATURE (classic bold wordmark)
 */
function BrandWordmark({ index }: { index: number }) {
  const i = index % 6;

  if (i === 0) {
    // Playful bold wordmark
    return (
      <div className="flex flex-col items-center">
        <span
          className="text-xl sm:text-2xl font-black tracking-tight uppercase text-neutral-900 group-hover:text-blue-600 transition-colors"
          style={{
            fontFamily: '"Impact", "Arial Black", system-ui, sans-serif',
            textShadow: '1px 1px 0px rgba(0,0,0,0.15)',
          }}
        >
          GADZIO
        </span>
        <span className="text-[9px] font-black tracking-widest text-neutral-500 uppercase -mt-0.5">
          BY GADZIO
        </span>
      </div>
    );
  }

  if (i === 1) {
    // Beast Games style: heavy geometric block
    return (
      <div className="flex flex-col items-center text-center">
        <span
          className="text-lg sm:text-xl font-black uppercase text-neutral-900 leading-tight tracking-tighter group-hover:text-blue-600 transition-colors"
          style={{
            fontFamily: '"Impact", "Arial Black", system-ui, sans-serif',
            letterSpacing: '-0.5px',
          }}
        >
          GADZIO
          <br />
          <span className="tracking-widest text-[16px] sm:text-[18px]">GAMES</span>
        </span>
      </div>
    );
  }

  if (i === 2) {
    // BEAST by MrBeast: wide heavy modern sans with divider
    return (
      <div className="flex flex-col items-center text-center">
        <span
          className="text-xl sm:text-2xl font-black uppercase text-neutral-900 tracking-wider group-hover:text-blue-600 transition-colors"
          style={{ fontFamily: '"Impact", "Arial Black", system-ui, sans-serif' }}
        >
          GADZIO
        </span>
        <span className="w-10 h-[1.5px] bg-neutral-300 my-0.5" />
        <span className="text-[8px] font-extrabold uppercase tracking-widest text-neutral-500">
          BY GADZIO
        </span>
      </div>
    );
  }

  if (i === 3) {
    // Beast Athletics: Varsity serif / athletic style
    return (
      <div className="flex flex-col items-center text-center">
        <span
          className="text-lg sm:text-xl font-black uppercase tracking-widest text-neutral-900 group-hover:text-blue-600 transition-colors"
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          GADZIO
        </span>
        <span className="text-[10px] font-black uppercase tracking-[0.25em] text-neutral-600">
          ATHLETICS
        </span>
      </div>
    );
  }

  if (i === 4) {
    // MrBeast Lab: italic dynamic comic/tech lettering
    return (
      <div className="flex flex-col items-center text-center -rotate-2 group-hover:rotate-0 transition-transform">
        <span
          className="text-xl sm:text-2xl font-black italic uppercase text-neutral-900 tracking-tight group-hover:text-blue-600 transition-colors"
          style={{ fontFamily: '"Impact", "Arial Black", system-ui, sans-serif' }}
        >
          GADZIO <span className="text-amber-500">LAB</span>
        </span>
      </div>
    );
  }

  // Gadzio Signature wordmark
  return (
    <div className="flex flex-col items-center text-center">
      <span
        className="text-xl sm:text-2xl font-black tracking-tight uppercase text-neutral-900 group-hover:text-blue-600 transition-colors"
        style={{ fontFamily: '"Impact", "Arial Black", system-ui, sans-serif' }}
      >
        GADZIO SIGNATURE
      </span>
      <span className="text-[8px] font-bold tracking-widest text-neutral-400 uppercase">
        LIMITED EDITION
      </span>
    </div>
  );
}

export function GadzioBrandBar({ items, enabled = true }: GadzioBrandBarProps) {
  if (enabled === false) return null;

  const brands = items && items.length > 0 ? items : DEFAULT_BRANDS;

  return (
    <section
      id="gadzio-brand-bar"
      aria-label="Brand Ecosystem"
      className="w-full bg-white border-y border-neutral-200 py-6 px-4 sm:px-8 select-none overflow-hidden"
    >
      <div className="max-w-[1560px] mx-auto flex items-center justify-between gap-6 sm:gap-8 overflow-x-auto no-scrollbar py-1">
        {brands.map((brand, idx) => {
          const content = (
            <div className="group flex-shrink-0 flex items-center justify-center px-4 py-1 transition-transform duration-200 hover:scale-105">
              <BrandWordmark index={idx} />
            </div>
          );

          if (brand.href) {
            return (
              <Link key={idx} href={brand.href} className="no-underline text-inherit flex-shrink-0">
                {content}
              </Link>
            );
          }

          return <div key={idx} className="flex-shrink-0">{content}</div>;
        })}
      </div>
    </section>
  );
}
