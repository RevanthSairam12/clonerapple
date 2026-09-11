'use client';

import { useState, useEffect } from 'react';

import { OppoNav } from './OppoNav';
import { OppoHeroBanner } from './OppoHeroBanner';
import { OppoHotSale } from './OppoHotSale';
import { OppoProductGrid } from './OppoProductGrid';
import { OppoOffersSection } from './OppoOffersSection';
import { OppoExploreCarousel } from './OppoExploreCarousel';
import { OppoSupportSection } from './OppoSupportSection';
import { OppoCommunitySection } from './OppoCommunitySection';
import { OppoFooter } from './OppoFooter';

export function OppoHomePage() {
  const [bannerVisible, setBannerVisible] = useState(true);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 600);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="oppo-root">
      {/* Announcement bar */}
      {bannerVisible && (
        <div className="oppo-announce-bar">
          <span>
            SHOP LIVE: Tap to unlock live discounts!{' '}
            <a href="#">Watch Now</a>
          </span>
          <button
            type="button"
            className="oppo-announce-bar-close"
            onClick={() => setBannerVisible(false)}
            aria-label="Close announcement"
          >
            ✕
          </button>
        </div>
      )}

      <OppoNav />

      <h1 style={{ position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}>
        OPPO India - Android Smartphones & Accessories
      </h1>

      <main>
        <OppoHeroBanner />
        <OppoHotSale />
        <OppoProductGrid />
        <OppoOffersSection />
        <OppoExploreCarousel />
        <OppoSupportSection />
        <OppoCommunitySection />
      </main>

      <OppoFooter />

      {/* Floating action dock */}
      <div className="oppo-floating-dock">
        <button
          type="button"
          className="oppo-float-btn oppo-scroll-top"
          data-visible={showScrollTop}
          onClick={scrollToTop}
          aria-label="Scroll to top"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </button>

        <button
          type="button"
          className="oppo-float-btn"
          aria-label="Customer Support"
          title="Customer Support"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>

        <a
          href="#"
          className="oppo-float-store"
          aria-label="OPPO Store"
          title="OPPO Store"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <path d="M16 10a4 4 0 0 1-8 0" />
          </svg>
          <span className="oppo-float-store-label">oppo</span>
        </a>
      </div>
    </div>
  );
}
