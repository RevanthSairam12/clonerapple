import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import Link from 'next/link';

import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { WHATSAPP_DISPLAY, WHATSAPP_ORDER_URL } from '@/lib/whatsapp';

const TITLE = 'Android Store - Coming Soon | Gadzio';
const DESCRIPTION =
  "Gadzio's Android store is on the way — cases, chargers, cables and audio built for Android phones. Order Android accessories now on WhatsApp.";

/**
 * Canonical origin for URL-based metadata.
 *
 * Reads the app's existing `APP_BASE_URL` config and ignores a localhost value,
 * so the canonical URL is always a real public origin; anything missing or
 * malformed falls back to the production origin the storefront already uses.
 */
function siteOrigin(): URL {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
        return url;
      }
    } catch {
      // Malformed value — fall through to the production origin.
    }
  }
  return new URL('https://gadzio.in');
}

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: TITLE,
  description: DESCRIPTION,
  // A placeholder store has nothing worth indexing, but its links stay followable.
  robots: { index: false, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/android',
    siteName: 'Gadzio',
    locale: 'en_US',
    type: 'website',
  },
  icons: { icon: '/gadzio_logo.png' },
};

/**
 * The site's primary pill (`.gz-button`) is 17px, which is wider than a 320px
 * viewport can lay out on one line. An inline clamp — the one thing a utility
 * class cannot do here, since `.gz-button` is unlayered — keeps the label on a
 * single line on small phones without touching the shared stylesheet.
 */
const buttonStyle: CSSProperties = { fontSize: 'clamp(15px, 4.4vw, 17px)' };

export default function AndroidStorePage() {
  return (
    <div className="gz-root flex min-h-dvh flex-col">
      {/* The switcher points back at the Gadzio store from here. */}
      <GlobalNav bannerVisible={false} currentBrand="android" />

      <main className="flex flex-1 items-center justify-center px-4 pt-8 pb-16 sm:px-6">
        <div className="w-full max-w-[640px] py-12 text-center sm:py-16">
          <p className="text-[12px] font-semibold tracking-[0.16em] text-[#6e6e73] uppercase">
            Android
          </p>

          <h1 className="mt-4 text-[34px] leading-[1.08] font-semibold tracking-[-0.02em] text-[#1d1d1f] sm:text-[48px]">
            Android store, coming soon
          </h1>

          <p className="mx-auto mt-5 max-w-[44ch] text-[17px] leading-[25px] text-[#333336]">
            Gadzio&apos;s Android accessories are on the way — cases, chargers, cables
            and everyday audio built for your phone.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
            <a
              href={WHATSAPP_ORDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={buttonStyle}
              className="gz-button focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0066cc]"
            >
              Click here to order on WhatsApp
            </a>

            <p className="text-[14px] leading-[20px] text-[#6e6e73]">
              Message us directly on{' '}
              <span className="whitespace-nowrap">{WHATSAPP_DISPLAY}</span>
            </p>

            <Link
              href="/"
              className="rounded-full px-1 text-[15px] font-medium text-[#0066cc] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#0066cc]"
            >
              ← Back to the Gadzio store
            </Link>
          </div>
        </div>
      </main>

      <GlobalFooter />
    </div>
  );
}
