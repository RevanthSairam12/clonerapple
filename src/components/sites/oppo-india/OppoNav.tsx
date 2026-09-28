'use client';

import { useState } from 'react';

import { FloatingBrandSwitcher } from '@/components/common/FloatingBrandSwitcher';
import type { OppoNavOverride } from './admin-overrides';

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

function mergeLinks(
  links: { label: string; href: string }[],
  overrides: { label?: string; href?: string }[] | undefined,
) {
  if (!overrides) return links;
  // Override array length wins — an added link defaults to a "#" placeholder.
  return overrides.map((o, i) => {
    const link = links[i] ?? { label: '', href: '#' };
    return { ...link, label: o.label ?? link.label, href: o.href ?? link.href };
  });
}

export function OppoNav({ content }: { content?: OppoNavOverride } = {}) {
  const logoText = content?.logoText ?? 'OPPO';
  const leftLinks = mergeLinks(NAV_LINKS_LEFT, content?.leftLinks);
  const rightLinks = mergeLinks(NAV_LINKS_RIGHT, content?.rightLinks);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="oppo-nav" aria-label="OPPO Navigation">
      <div className="oppo-nav-inner">
        {/* Logo */}
        <a href="/android" className="oppo-nav-logo">
          {logoText}
        </a>

        {/* Desktop left links */}
        <div className="oppo-nav-links">
          {leftLinks.map((link) => (
            <a key={link.label} href={link.href} className="oppo-nav-link">
              {link.label}
            </a>
          ))}

          <div className="oppo-nav-separator" />

          {rightLinks.map((link) => (
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

      {/* Mobile menu — follows the merged desktop lists */}
      <div className="oppo-mobile-menu" data-open={mobileOpen}>
        {[...leftLinks, ...rightLinks].map((link) => (
          <a key={link.label} href={link.href} onClick={() => setMobileOpen(false)}>
            {link.label}
          </a>
        ))}
      </div>

      {/* Floating Side Tab / Sticky Drawer for Gadzio Apple Store */}
      <FloatingBrandSwitcher currentBrand="oppo" />
    </nav>
  );
}
