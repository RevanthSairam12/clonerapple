'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import {
  HERO_OVERLAY_TARGET_ID,
  computeHeroOverlayGeometry,
  computeTapeImageStyle,
  isHeroOverlayActive,
  normalizeHeroOverlayConfig,
  type HeroCampaignOverlayConfig,
  type OverlayImageDimensions,
} from '@/lib/website/hero-overlay';

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

export function GadzioHeroSection({
  campaignOverlay,
}: {
  campaignOverlay?: HeroCampaignOverlayConfig | null;
} = {}) {
  const overlayConfig = normalizeHeroOverlayConfig(campaignOverlay);
  const overlayActive = isHeroOverlayActive(overlayConfig);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number } | null>(null);
  const [tape1Natural, setTape1Natural] = useState<{ src: string; size: OverlayImageDimensions } | null>(null);
  const [tape2Natural, setTape2Natural] = useState<{ src: string; size: OverlayImageDimensions } | null>(null);

  useEffect(() => {
    const grid = gridRef.current;
    if (grid) {
      grid.inert = overlayActive;
    }
  }, [overlayActive]);

  useEffect(() => {
    if (!overlayActive) return;
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [overlayActive]);

  const scrollToHeroTiles = useCallback(() => {
    const target = document.getElementById(HERO_OVERLAY_TARGET_ID);
    if (!target) return;
    const header = document.querySelector('header.gz-header');
    const headerHeight = header ? header.getBoundingClientRect().height : 0;
    const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerHeight - 8);
    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({
      top,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, []);

  const geometry = containerSize
    ? computeHeroOverlayGeometry(containerSize.width, containerSize.height)
    : null;
  const tape1Style = geometry
    ? computeTapeImageStyle(
        geometry,
        1,
        tape1Natural?.src === overlayConfig.tapeImage1 ? tape1Natural.size : null,
      )
    : undefined;
  const tape2Style = geometry
    ? computeTapeImageStyle(
        geometry,
        -1,
        tape2Natural?.src === overlayConfig.tapeImage2 ? tape2Natural.size : null,
      )
    : undefined;

  return (
    <section
      id="gadzio-hero"
      aria-label="Featured Collections"
      className="w-full bg-[#ebebe7] py-3.5 px-2 sm:px-3.5 select-none"
      style={{ fontFamily: 'transducer, sans-serif' }}
    >
      <div className="max-w-[1560px] mx-auto">
        <div
          ref={containerRef}
          className={overlayActive ? 'relative overflow-hidden rounded-2xl' : undefined}
        >
          {/* Asymmetric 2-column Grid: Left Big Tile, Right 2 Stacked Tiles */}
          <div
            ref={gridRef}
            aria-hidden={overlayActive || undefined}
            className={`grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-3.5 items-stretch${
              overlayActive ? ' pointer-events-none select-none' : ''
            }`}
          >

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
                  className={`w-full h-full object-cover object-center transition-transform duration-700 ease-out${
                    overlayActive ? '' : ' group-hover:scale-[1.02]'
                  }`}
                  loading="eager"
                />
              </picture>

              {/* Subtle overlay gradient to ensure text contrast */}
              <div className="absolute inset-0 bg-white/20 md:bg-white/10 pointer-events-none" />

              {/* Content Container */}
              <div className="relative z-10 flex flex-col items-center justify-center max-w-lg mx-auto space-y-3 sm:space-y-4">
                {/* Main Headline */}
                <h2
                  className="text-4xl sm:text-5xl md:text-5xl lg:text-[58px] font-bold uppercase text-black leading-[0.96] tracking-tight"
                  style={{
                    fontFamily: 'transducer, sans-serif',
                    fontWeight: 700,
                    color: '#000',
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
                  {overlayActive ? (
                    <span className="inline-block bg-[#ffe100] text-black font-black uppercase text-sm sm:text-base px-8 py-3.5 tracking-wider shadow-md rounded-xs">
                      SHOP ALL ACCESSORIES
                    </span>
                  ) : (
                    <Link
                      href="/in/shop/iphone/accessories/cases-protection"
                      className="inline-block bg-[#ffe100] text-black font-black uppercase text-sm sm:text-base px-8 py-3.5 tracking-wider hover:bg-[#ffea33] active:scale-95 transition-all duration-150 shadow-md hover:shadow-lg rounded-xs"
                    >
                      SHOP ALL ACCESSORIES
                    </Link>
                  )}
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
                    className={`w-full h-full object-cover object-right sm:object-center transition-transform duration-700 ease-out${
                      overlayActive ? '' : ' group-hover:scale-[1.02]'
                    }`}
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
                    className="text-2xl sm:text-3xl lg:text-4xl font-bold uppercase text-white leading-[1.02] tracking-tight"
                    style={{
                      fontFamily: 'transducer, sans-serif',
                      fontWeight: 700,
                    }}
                  >
                    SOUND ON.
                    <br />
                    PLUG IN.
                  </h3>

                  <div className="pt-2">
                    {overlayActive ? (
                      <span className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white">
                        SHOP EARPHONES
                      </span>
                    ) : (
                      <Link
                        href="/shop/product/we-gadzio-pulse-usbc"
                        className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white hover:text-white/80 hover:decoration-white/80 transition"
                      >
                        SHOP EARPHONES
                      </Link>
                    )}
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
                    className={`w-full h-full object-cover object-right sm:object-center transition-transform duration-700 ease-out${
                      overlayActive ? '' : ' group-hover:scale-[1.02]'
                    }`}
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
                    className="text-2xl sm:text-3xl lg:text-4xl font-bold uppercase text-white leading-[1.02] tracking-tight"
                    style={{
                      fontFamily: 'transducer, sans-serif',
                      fontWeight: 700,
                    }}
                  >
                    GEAR THAT
                    <br />
                    KEEPS UP
                  </h3>

                  <div className="pt-2">
                    {overlayActive ? (
                      <span className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white">
                        SHOP AIRPODS CASES
                      </span>
                    ) : (
                      <Link
                        href="/in/shop/iphone/accessories/airpods-case"
                        className="inline-block text-xs sm:text-sm font-extrabold uppercase text-white underline underline-offset-4 decoration-2 decoration-white hover:text-white/80 hover:decoration-white/80 transition"
                      >
                        SHOP AIRPODS CASES
                      </Link>
                    )}
                  </div>
                </div>
              </div>

            </div>
          </div>

          {overlayActive ? (
            <>
              <div
                aria-hidden="true"
                data-hero-campaign-overlay="true"
                className="pointer-events-none absolute inset-0 z-20 overflow-hidden select-none"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- Admin-uploaded vertical campaign tape image rendered directly without CSS generation */}
                <img
                  src={overlayConfig.tapeImage1}
                  alt=""
                  draggable={false}
                  data-hero-overlay-tape="1"
                  className={
                    tape1Style
                      ? 'pointer-events-none select-none'
                      : 'pointer-events-none absolute top-1/2 left-1/2 h-[118%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 rotate-[32deg] select-none md:h-[215%] md:rotate-[60deg]'
                  }
                  style={tape1Style}
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      setTape1Natural({
                        src: overlayConfig.tapeImage1,
                        size: { width: img.naturalWidth, height: img.naturalHeight },
                      });
                    }
                  }}
                />
                {/* eslint-disable-next-line @next/next/no-img-element -- Admin-uploaded vertical campaign tape image rendered directly without CSS generation */}
                <img
                  src={overlayConfig.tapeImage2}
                  alt=""
                  draggable={false}
                  data-hero-overlay-tape="2"
                  className={
                    tape2Style
                      ? 'pointer-events-none select-none'
                      : 'pointer-events-none absolute top-1/2 left-1/2 h-[118%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 -rotate-[32deg] select-none md:h-[215%] md:-rotate-[60deg]'
                  }
                  style={tape2Style}
                  onLoad={(event) => {
                    const img = event.currentTarget;
                    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                      setTape2Natural({
                        src: overlayConfig.tapeImage2,
                        size: { width: img.naturalWidth, height: img.naturalHeight },
                      });
                    }
                  }}
                />
              </div>
              <button
                type="button"
                data-hero-campaign-trigger="true"
                aria-label="Explore featured campaign showcase"
                onClick={scrollToHeroTiles}
                className="absolute inset-0 z-30 block h-full w-full cursor-pointer border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#ffe100] focus-visible:ring-inset"
              />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
