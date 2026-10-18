'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { FooterOverride } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/admin-overrides';
import { FOOTER_BOTTOM } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer';
import { WHATSAPP_ORDER_URL } from '@/lib/whatsapp';

/* ------------------------------------------------------------- Brand mark */

/**
 * The Gadzio wordmark, with a text fallback if the asset cannot load.
 * Mirrors the header's implementation (src/components/header/GadzioHeader.tsx).
 */
function GadzioWordmark({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className={`font-bold tracking-[-0.03em] text-black ${className ?? ''}`}>
        Gadzio
      </span>
    );
  }

  return (
    <img
      src="/gadzio_logo.png"
      alt="Gadzio"
      width={184}
      height={61}
      className={`object-contain select-none ${className ?? ''}`}
      onError={() => setFailed(true)}
    />
  );
}

/* ------------------------------------------------------------------ Data */

/**
 * Payment methods actually accepted at checkout — matches the PayU/UPI
 * disclosure in data/footer.ts, showing text only (not other companies' logos).
 */
const PAYMENT_METHODS = ['UPI', 'PayU', 'Credit & Debit Cards', 'NetBanking'];

/** Shop / Support / Company directory columns. */
const FOOTER_COLUMNS = [
  {
    title: 'Shop',
    links: [
      { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
      { label: 'Mobile Cases', href: '/in/shop/iphone/accessories/mobile-cases' },
      { label: 'Power & Cables', href: '/in/shop/iphone/accessories/power-adapter-cable' },
      { label: 'Wired Earphones', href: '/in/shop/iphone/accessories/wired-earphones' },
      { label: 'Cable & Plug Cases', href: '/in/shop/iphone/accessories/cable-plug-case' },
      { label: 'AirPods Cases', href: '/in/shop/iphone/accessories/airpods-case' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Contact via WhatsApp', href: WHATSAPP_ORDER_URL },
      { label: 'Shipping & Delivery', href: '/support#shipping' },
      { label: 'Returns & Refunds', href: '/support#returns' },
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Use', href: '/terms' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'About Gadzio', href: '/' },
      { label: 'Customer Support', href: '/support' },
      { label: 'Search Catalog', href: '/search' },
      { label: 'Shopping Bag', href: '/bag' },
    ],
  },
];

/* -------------------------------------------------------------- Component */

/**
 * The site-wide storefront footer rendered by GlobalFooter on every page.
 *
 * All directory links come from data/footer.ts, which is constrained to routes
 * that exist in this app — do not inline a second link list here.
 *
 * The CMS fields the admin panel exposes for `apple.footer` map as:
 *   copyright   -> the bottom-row copyright line
 *   localeLabel -> the country/region link label
 *   localeHref  -> the country/region link target
 * footnotesHtml has no slot in this layout and is currently not rendered.
 */
export function GadzioFooter({ content }: { content?: FooterOverride } = {}) {
  const copyright = content?.copyright ?? FOOTER_BOTTOM.copyright;
  const localeLabel = content?.localeLabel ?? FOOTER_BOTTOM.localeLabel;
  const localeHref = content?.localeHref ?? FOOTER_BOTTOM.localeHref;

  return (
    <footer className="w-full bg-black text-white border-t border-white/10 font-sans antialiased overflow-hidden pt-16 sm:pt-24 md:pt-28">
      <div className="relative w-full">
        {/* =========================================================
            1. HERO HEADLINE
            Everything for
            your iPhone, from [GADZIO]
            ========================================================= */}
        <div className="max-w-[1440px] mx-auto px-6 sm:px-12 text-center">
          <h2 className="text-5xl sm:text-7xl md:text-8xl lg:text-[104px] font-medium tracking-tight text-white leading-[1.08]">
            <span className="block">Everything for</span>
            <span className="mt-2 sm:mt-4 flex flex-wrap items-center justify-center gap-x-3 sm:gap-x-5 gap-y-2">
              <span>your iPhone, from</span>
              <span className="inline-flex items-center justify-center px-4 sm:px-6 py-1.5 sm:py-2.5 bg-white rounded-full shadow-[0_0_24px_rgba(255,255,255,0.25)] transition-transform duration-300 hover:scale-105">
                <GadzioWordmark className="h-6 sm:h-9 w-auto max-w-[140px]" />
              </span>
            </span>
          </h2>
        </div>

        {/* =========================================================
            2. MIDDLE CONTENT GRID
            ========================================================= */}
        <div className="max-w-[1440px] mx-auto mt-16 sm:mt-24 md:mt-28 px-8 sm:px-14 lg:px-20 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-10 lg:gap-8 items-start relative z-10">
          {/* Columns 1-3: Shop / Support / Company */}
          {FOOTER_COLUMNS.map((column, columnIndex) => (
            <div key={columnIndex} className="lg:col-span-2 space-y-6">
              <div className="space-y-3.5">
                <h3 className="text-xs sm:text-[13px] font-semibold text-white/90 uppercase tracking-wider">
                  {column.title}
                </h3>
                <ul className="space-y-2.5 text-sm font-semibold text-white">
                  {column.links.map((link) => (
                    <li key={`${link.label}|${link.href}`}>
                      <Link href={link.href} className="hover:text-white/70 transition">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}

          {/* Column 4: Statement, Payments, More from Gadzio & Legal */}
          <div className="lg:col-span-6 flex flex-col justify-between space-y-6 lg:pl-10">
            {/* Statement */}
            <p className="text-xs sm:text-sm text-white leading-relaxed max-w-xl font-normal">
              Gadzio is an independent retailer of iPhone accessories in India. Cases, cables,
              chargers and earphones &mdash; delivered free across India, and backed by our 1-Year
              Limited Replacement Guarantee.
            </p>

            {/* Payments Row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2">
              <span className="text-xs text-white/80 font-normal">Payments</span>
              <div className="flex flex-wrap items-center gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <span
                    key={method}
                    className="text-[10px] sm:text-[11px] text-white/80 border border-white/30 bg-white/5 rounded-full px-2.5 py-0.5 font-normal"
                  >
                    {method}
                  </span>
                ))}
              </div>
            </div>


            {/* Legal row, locale & copyright */}
            <div className="space-y-4 pt-4">
              <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-[13px] text-white/80">
                {FOOTER_BOTTOM.legalLinks.map((link) => (
                  <li key={`${link.label}|${link.href}`}>
                    <Link href={link.href} className="hover:text-white transition">
                      {link.label}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href={localeHref}
                    title="Choose your country or region"
                    className="hover:text-white transition"
                  >
                    {localeLabel}
                  </Link>
                </li>
              </ul>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-[11px] sm:text-xs text-white/70 font-normal">{copyright}</p>
                <p className="text-[11px] sm:text-xs text-white/50 font-normal max-w-md">
                  Gadzio is an independent seller and is not affiliated with Apple Inc. Apple,
                  iPhone, AirPods and MagSafe are trademarks of Apple Inc.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* =========================================================
            3. MASSIVE "gadzio" WORDMARK
            ========================================================= */}
        <div className="relative mt-8 sm:mt-12 w-full overflow-hidden">
          <div className="w-full flex justify-center items-end leading-none select-none pointer-events-none -mb-3 sm:-mb-6 md:-mb-10 overflow-hidden">
            <span
              className="font-extrabold tracking-[-0.05em] text-white text-[28vw] sm:text-[26vw] md:text-[24vw] leading-[0.76] block text-center lowercase"
              style={{
                fontFamily:
                  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
              }}
              aria-hidden="true"
            >
              gadzio
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
