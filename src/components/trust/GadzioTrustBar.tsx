'use client';

import React from 'react';
import Link from 'next/link';

export interface TrustBadgeItem {
  title: string;
  subtitle?: string;
  icon?: string;
  href?: string;
}

export interface GadzioTrustBarProps {
  items?: TrustBadgeItem[];
  enabled?: boolean;
}

/** Default 3 trust badges matching the screenshot with Gadzio detailing. */
export const DEFAULT_TRUST_BADGES: TrustBadgeItem[] = [
  {
    title: 'FREE SHIP $75+',
    subtitle: 'Free delivery on orders over ₹999',
    icon: 'shipping',
    href: '',
  },
  {
    title: '30-DAY RETURNS',
    subtitle: 'Hassle-free replacement guarantee',
    icon: 'returns',
    href: '',
  },
  {
    title: '1% DONATED',
    subtitle: 'Giving back with every single order',
    icon: 'heart',
    href: '',
  },
];

/**
 * Clean SVG icons matching the screenshot.
 */
function TrustIcon({ name, index }: { name?: string; index: number }) {
  const iconKey = (name || '').toLowerCase();

  // 1. Package / Shipping Box (📦)
  if (iconKey === 'shipping' || iconKey === 'box' || iconKey === 'package' || (!iconKey && index === 0)) {
    return (
      <svg
        className="w-7 h-7 sm:w-8 sm:h-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
        <path d="m7.5 4.5 9 5.2" />
      </svg>
    );
  }

  // 2. 30-Day Returns / Sync Arrows (🔄)
  if (iconKey === 'returns' || iconKey === 'replace' || iconKey === 'sync' || (!iconKey && index === 1)) {
    return (
      <svg
        className="w-7 h-7 sm:w-8 sm:h-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    );
  }

  // 3. Heart / Donated / Guarantee (🤍)
  if (iconKey === 'heart' || iconKey === 'donated' || iconKey === 'genuine' || (!iconKey && index === 2)) {
    return (
      <svg
        className="w-7 h-7 sm:w-8 sm:h-8"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
      </svg>
    );
  }

  // Fallback: Quality Shield
  return (
    <svg
      className="w-7 h-7 sm:w-8 sm:h-8"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export function GadzioTrustBar({ items, enabled = true }: GadzioTrustBarProps) {
  if (enabled === false) return null;

  const badges = items && items.length > 0 ? items : DEFAULT_TRUST_BADGES;

  return (
    <section
      id="gadzio-trust-bar"
      aria-label="Store Guarantees and Shipping"
      className="w-full bg-white border-y border-neutral-200 py-6 px-4 sm:px-8 select-none rounded-none"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <div className="max-w-[1560px] mx-auto flex flex-col sm:flex-row items-center justify-around gap-6 sm:gap-8">
        {badges.map((badge, idx) => {
          const content = (
            <div className="flex flex-col items-center justify-center text-center gap-2 group cursor-pointer sm:cursor-default transition-transform duration-200 hover:-translate-y-0.5">
              <div className="text-black transition-transform duration-300 group-hover:scale-110 flex items-center justify-center">
                <TrustIcon name={badge.icon} index={idx} />
              </div>
              <span
                className="text-xs sm:text-sm font-bold tracking-widest uppercase text-black"
                style={{
                  fontFamily: 'transducer, sans-serif',
                  fontWeight: 700,
                  color: '#000',
                }}
              >
                {badge.title}
              </span>
              {badge.subtitle ? (
                <span
                  className="text-[11px] text-neutral-500 font-medium tracking-tight -mt-1"
                  style={{ fontFamily: 'transducer, sans-serif' }}
                >
                  {badge.subtitle}
                </span>
              ) : null}
            </div>
          );

          if (badge.href) {
            return (
              <Link key={idx} href={badge.href} className="no-underline text-inherit">
                {content}
              </Link>
            );
          }

          return <div key={idx}>{content}</div>;
        })}
      </div>
    </section>
  );
}
