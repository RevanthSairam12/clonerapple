'use client';

import React from 'react';
import Link from 'next/link';

/**
 * Gadzio's homepage hero — three feature tiles under the header.
 *
 * Ported from a third-party storefront layout and since de-branded: every
 * headline, eyebrow, CTA and image is Gadzio's own. The three CTA targets are
 * real routes registered in this app (the accessories hub, an accessory
 * product detail page, and an accessory category); the copy they replaced
 * pointed at /collections/* and /products/*, none of which exist here.
 *
 * Artwork is reused from the local tile set under
 * `public/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/`. The
 * left tile's shots are the pair the (currently commented-out) `HeroSection`
 * would have used, so they appear nowhere else on the rendered page; the two
 * right-hand tiles reuse the wired-earphones and AirPods-case shots, which are
 * dark enough to sit under white text without touching the tiles' gradients.
 */

/** Local tile artwork — kept in one place so the paths stay readable. */
const TILES = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';

export function GadzioHeroSection() {
  return (
    <section
      id="gadzio-hero"
      aria-label="Featured Collections"
      className="w-full bg-[#ebebe7] py-3.5 px-2 sm:px-3.5 select-none font-sans"
    >
      <div className="max-w-[1560px] mx-auto">
        {/* Asymmetric 2-column Grid: Left Big Tile, Right 2 Stacked Tiles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-3.5 items-stretch">

          {/* =========================================================
              1. LEFT MAIN TILE: "EVERYDAY TECH. BETTER CHOICES."
              ========================================================= */}
          <div className="relative min-h-[460px] sm:min-h-[520px] md:min-h-[620px] lg:min-h-[680px] rounded-2xl overflow-hidden bg-white shadow-sm flex flex-col justify-center items-center text-center p-6 sm:p-10 group">
            {/* Background Photography */}
            <picture className="absolute inset-0 w-full h-full">
              <source
                media="(max-width: 767px)"
                srcSet={`${TILES}/12_Untitled (2136 x 1140 px) (3).jpg`}
              />
              <img
                src={`${TILES}/12_Untitled (2136 x 1140 px) (4).jpg`}
                alt="Phone, wireless earbuds and a smartwatch arranged with everyday accessories"
                className="w-full h-full object-cover object-center transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                loading="eager"
              />
            </picture>

            {/* Subtle overlay gradient to ensure text contrast */}
            <div className="absolute inset-0 bg-white/20 md:bg-white/10 pointer-events-none" />

            {/* Content Container */}
            <div className="relative z-10 flex flex-col items-center justify-center max-w-lg mx-auto space-y-3 sm:space-y-4">
              {/* Main Headline */}
              <h2
                className="text-4xl sm:text-5xl md:text-5xl lg:text-[58px] font-black uppercase text-black leading-[0.96] tracking-tight"
                style={{
                  fontFamily:
                    '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                }}
              >
                Everyday Tech.
                <br />
                Better Choices.
              </h2>

              {/* Subhead */}
              <p className="text-sm sm:text-base font-semibold text-black/85 max-w-sm leading-snug pt-1">
                Handpicked tech and accessories, ready to ship.
              </p>

              {/* CTA Button */}
              <div className="pt-2 sm:pt-4">
                <Link
                  href="/in/shop/iphone/accessories/cases-protection"
                  className="inline-block bg-[#ffe100] text-black font-black uppercase text-sm sm:text-base px-8 py-3.5 tracking-wider hover:bg-[#ffea33] active:scale-95 transition-all duration-150 shadow-md hover:shadow-lg rounded-xs"
                >
                  SHOP ALL ACCESSORIES
                </Link>
              </div>
            </div>
          </div>

          {/* =========================================================
              2. RIGHT STACKED TILES: AUDIO + NEW ARRIVALS
              ========================================================= */}
          <div className="grid grid-rows-1 sm:grid-rows-2 gap-3 sm:gap-3.5 h-full">

            {/* Top Tile: GADZIO AUDIO */}
            <div className="relative min-h-[220px] sm:min-h-[250px] md:min-h-[300px] lg:min-h-[330px] rounded-2xl overflow-hidden bg-black shadow-sm flex flex-col justify-center items-start p-6 sm:p-10 group">
              {/* Background Photography */}
              <picture className="absolute inset-0 w-full h-full">
                <source
                  media="(max-width: 767px)"
                  srcSet={`${TILES}/iearphones_large.jpg`}
                />
                <img
                  src={`${TILES}/iearphones_large_2x.jpg`}
                  alt="Wired earphones"
                  className="w-full h-full object-cover object-right sm:object-center transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                  loading="eager"
                />
              </picture>

              {/* Subtle dark gradient on left side for text clarity */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent sm:w-3/4 pointer-events-none" />

              {/* Content */}
              <div className="relative z-10 flex flex-col items-start space-y-1.5 sm:space-y-2 max-w-xs sm:max-w-sm text-left">
                <span className="text-xs sm:text-[13px] font-bold tracking-widest uppercase text-white/90">
                  GADZIO AUDIO
                </span>

                <h3
                  className="text-2xl sm:text-3xl lg:text-4xl font-black uppercase text-white leading-[1.02] tracking-tight"
                  style={{
                    fontFamily:
                      '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                  }}
                >
                  SOUND ON.
                  <br />
                  PLUG IN.
                </h3>

                <div className="pt-2">
                  <Link
                    href="/shop/product/we-gadzio-pulse-usbc"
                    className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white hover:text-white/80 hover:decoration-white/80 transition"
                  >
                    SHOP EARPHONES
                  </Link>
                </div>
              </div>
            </div>

            {/* Bottom Tile: GADZIO × NEW ARRIVALS */}
            <div className="relative min-h-[220px] sm:min-h-[250px] md:min-h-[300px] lg:min-h-[330px] rounded-2xl overflow-hidden bg-green-900 shadow-sm flex flex-col justify-center items-start p-6 sm:p-10 group">
              {/* Background Photography */}
              <picture className="absolute inset-0 w-full h-full">
                <source
                  media="(max-width: 767px)"
                  srcSet={`${TILES}/icase_large.jpg`}
                />
                <img
                  src={`${TILES}/icase_large_2x.jpg`}
                  alt="AirPods case"
                  className="w-full h-full object-cover object-right sm:object-center transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </picture>

              {/* Gradient for text clarity */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent sm:w-3/4 pointer-events-none" />

              {/* Content */}
              <div className="relative z-10 flex flex-col items-start space-y-1.5 sm:space-y-2 max-w-xs sm:max-w-sm text-left">
                <span className="text-xs sm:text-[13px] font-bold tracking-widest uppercase text-white/90">
                  GADZIO × NEW ARRIVALS
                </span>

                <h3
                  className="text-2xl sm:text-3xl lg:text-4xl font-black uppercase text-white leading-[1.02] tracking-tight"
                  style={{
                    fontFamily:
                      '"Impact", "Arial Black", system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                  }}
                >
                  GEAR THAT
                  <br />
                  KEEPS UP
                </h3>

                <div className="pt-2">
                  <Link
                    href="/in/shop/iphone/accessories/airpods-case"
                    className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white hover:text-white/80 hover:decoration-white/80 transition"
                  >
                    SHOP AIRPODS CASES
                  </Link>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
