'use client';

import { useState } from 'react';

const NAV_LINKS_LEFT = [
  { label: 'Smartphones', href: '#' },
  { label: 'Tablets', href: '#' },
  { label: 'Audio', href: '#' },
  { label: 'Accessories', href: '#' },
  { label: 'About OPPO', href: '#' },
];

const NAV_LINKS_RIGHT = [
  { label: 'Store', href: '#' },
  { label: 'ColorOS', href: '#' },
  { label: 'Support', href: '#' },
  { label: 'Student Offer', href: '#' },
  { label: 'My OPPO', href: '#' },
];

export function OppoNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="oppo-nav" aria-label="OPPO Navigation">
      <div className="oppo-nav-inner">
        {/* Logo */}
        <a href="/android" className="oppo-nav-logo">
          OPPO
        </a>

        {/* Brand switcher — Apple */}
        <a
          href="/"
          aria-label="Switch to Apple"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: '16px',
            padding: '4px 8px',
            borderRadius: '4px',
            background: '#1d1d1f',
            color: '#fff',
            transition: 'opacity 0.2s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
        >
          <svg width="14" height="14" viewBox="0 0 814 1000" fill="currentColor">
            <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57.8-155.5-127.4c-58.4-81.5-105.9-207.1-105.9-326.5C0 406.2 61 283.7 157.8 220c48.4-32.2 106.8-53.4 169.8-53.4 65.4 0 119.3 42.1 167.9 42.1 46.7 0 95.6-44.7 170.6-44.7 27.5 0 126.4 2.2 191.7 83.9l-69.7 93z" />
          </svg>
        </a>

        {/* Desktop left links */}
        <div className="oppo-nav-links">
          {NAV_LINKS_LEFT.map((link) => (
            <a key={link.label} href={link.href} className="oppo-nav-link">
              {link.label}
            </a>
          ))}

          <div className="oppo-nav-separator" />

          {NAV_LINKS_RIGHT.map((link) => (
            <a key={link.label} href={link.href} className="oppo-nav-link">
              {link.label}
            </a>
          ))}
        </div>

        {/* Icons */}
        <div className="oppo-nav-icons">
          <button type="button" className="oppo-nav-icon-btn" aria-label="Search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button type="button" className="oppo-nav-icon-btn" aria-label="Account">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </button>
          <button type="button" className="oppo-nav-icon-btn" aria-label="Cart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </button>
        </div>

        {/* Mobile toggle */}
        <button
          type="button"
          className="oppo-mobile-toggle"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile menu */}
      <div className="oppo-mobile-menu" data-open={mobileOpen}>
        {[...NAV_LINKS_LEFT, ...NAV_LINKS_RIGHT].map((link) => (
          <a key={link.label} href={link.href} onClick={() => setMobileOpen(false)}>
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
