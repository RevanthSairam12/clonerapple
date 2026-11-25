'use client';

import React from 'react';
import Link from 'next/link';
import { TRUST_BADGES_ITEMS, type TrustBadgeItem } from '@/lib/website/section-defaults';
import { useStorefrontTrustBar } from './StorefrontTrustBarContext';

export type { TrustBadgeItem };

export interface GadzioTrustBarProps {
  items?: TrustBadgeItem[];
  enabled?: boolean;
}

export const DEFAULT_TRUST_BADGES = TRUST_BADGES_ITEMS;

/**
 * Clean 24x24 Lucide-style stroke icons for the Trust Badges Bar.
 */
function resolveTrustIconPaths(iconKey: string, index: number): React.ReactNode {
  // 1. Package / Shipping Box
  if (iconKey === 'shipping' || iconKey === 'box' || iconKey === 'package' || (!iconKey && index === 0)) {
    return (
      <>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
        <path d="m3.3 7 8.7 5 8.7-5" />
        <path d="M12 22V12" />
        <path d="m7.5 4.5 9 5.2" />
      </>
    );
  }

  // 2. 30-Day Returns / Sync Arrows
  if (iconKey === 'returns' || iconKey === 'replace' || iconKey === 'sync' || (!iconKey && index === 1)) {
    return (
      <>
        <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
        <path d="M3 21v-5h5" />
      </>
    );
  }

  // 3. Heart / Donated / Guarantee
  if (iconKey === 'heart' || iconKey === 'donated' || iconKey === 'genuine' || (!iconKey && index === 2)) {
    return (
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    );
  }

  // 4. Headset
  if (iconKey === 'headset' || iconKey === 'support') {
    return (
      <>
        <path d="M3 11h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5Zm0 0a9 9 0 1 1 18 0m0 0v5a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3Z" />
        <path d="M21 16v2a4 4 0 0 1-4 4h-5" />
      </>
    );
  }

  // 5. Headphones
  if (iconKey === 'headphones' || iconKey === 'audio') {
    return (
      <path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3" />
    );
  }

  // 6. Message
  if (iconKey === 'message' || iconKey === 'message-circle' || iconKey === 'message-square' || iconKey === 'chat') {
    return <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />;
  }

  // 7. Messages
  if (iconKey === 'messages' || iconKey === 'messages-square') {
    return (
      <>
        <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2Z" />
        <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
      </>
    );
  }

  // 8. Badge Check
  if (iconKey === 'badge-check' || iconKey === 'badgecheck' || iconKey === 'verified') {
    return (
      <>
        <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    );
  }

  // 9. Sparkles
  if (iconKey === 'sparkles' || iconKey === 'sparkle') {
    return (
      <>
        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        <path d="M5 3v4" />
        <path d="M19 17v4" />
        <path d="M3 5h4" />
        <path d="M17 19h4" />
      </>
    );
  }

  // 10. CPU
  if (iconKey === 'cpu' || iconKey === 'chip') {
    return (
      <>
        <rect width="16" height="16" x="4" y="4" rx="2" />
        <rect width="6" height="6" x="9" y="9" rx="1" />
        <path d="M15 2v2" />
        <path d="M15 20v2" />
        <path d="M2 15h2" />
        <path d="M2 9h2" />
        <path d="M20 15h2" />
        <path d="M20 9h2" />
        <path d="M9 2v2" />
        <path d="M9 20v2" />
      </>
    );
  }

  // 11. Gem
  if (iconKey === 'gem' || iconKey === 'diamond') {
    return (
      <>
        <path d="M6 3h12l4 6-10 13L2 9Z" />
        <path d="M11 3 8 9l4 13 4-13-3-6" />
        <path d="M2 9h20" />
      </>
    );
  }

  // 12. Stars
  if (iconKey === 'stars' || iconKey === 'star') {
    return (
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    );
  }

  // 13. Handshake
  if (iconKey === 'handshake' || iconKey === 'handshakes' || iconKey === 'deal' || iconKey === 'partner') {
    return (
      <>
        <path d="m11 17 2 2a1 1 0 1 0 3-3" />
        <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4" />
        <path d="m21 3 1 11h-2" />
        <path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3" />
        <path d="M3 4h8" />
      </>
    );
  }

  // Fallback: Quality Shield
  return (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  );
}

function TrustIcon({ name, index }: { name?: string; index: number }) {
  const iconKey = (name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');

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
      {resolveTrustIconPaths(iconKey, index)}
    </svg>
  );
}

export function GadzioTrustBar({ items, enabled }: GadzioTrustBarProps) {
  const inherited = useStorefrontTrustBar();
  const resolvedEnabled = enabled ?? inherited?.enabled ?? true;
  if (resolvedEnabled === false) return null;

  const badges =
    items && items.length > 0
      ? items
      : inherited?.items && inherited.items.length > 0
        ? inherited.items
        : DEFAULT_TRUST_BADGES;

  return (
    <section
      id="gadzio-trust-bar"
      aria-label="Store Guarantees and Shipping"
      className="w-full bg-white border-y border-neutral-200 py-6 px-4 sm:px-8 select-none rounded-none"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <div className="max-w-[1560px] mx-auto flex flex-col sm:flex-row sm:flex-wrap items-center justify-around gap-6 sm:gap-8">
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
