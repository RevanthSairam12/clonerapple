'use client';

import { useCallback, useRef, useState } from 'react';

import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GadzioHeroSection } from '@/components/hero/GadzioHeroSection';

import { HERO, PRODUCT_NAV, QUICK_LINKS, SHELVES, type EduCard } from './data/content';

/* ---------------------------------------------------------------- types */

export interface EduCardOverride {
  headline?: string;
  tag?: string;
  desc?: string;
  price?: string;
  href?: string;
  image?: string;
  dark?: boolean;
  savingsBadge?: boolean;
}

export interface EduShelfOverride {
  headline?: string;
  subhead?: string;
  /** false hides the shelf entirely. */
  enabled?: boolean;
  cards?: EduCardOverride[];
}

export interface EduStoreOverrides {
  hero?: { headline?: string; subhead?: string };
  productNav?: EduCardOverride[];
  shelves?: Record<string, EduShelfOverride>;
  quickLinks?: { label?: string; href?: string }[];
}

/* -------------------------------------------------------------- helpers */

/**
 * Admin card overrides map positionally onto the hardcoded cards: an overridden
 * array keeps the default card at that index as its fallback, so a half-filled
 * editor row still renders complete content.
 */
function applyCardOverrides(base: EduCard[], overrides?: EduCardOverride[]): EduCard[] {
  if (!overrides) return base;
  return overrides.map((o, i) => {
    const fallback = base[i] ?? base[base.length - 1];
    return {
      ...fallback,
      id: `${fallback.id}-${i}`,
      headline: o.headline ?? fallback.headline,
      tag: o.tag ?? fallback.tag,
      desc: o.desc ?? fallback.desc,
      price: o.price ?? fallback.price,
      href: o.href ?? fallback.href,
      image: o.image ?? fallback.image,
      dark: o.dark ?? fallback.dark,
      savingsBadge: o.savingsBadge ?? fallback.savingsBadge,
    };
  });
}

/* ------------------------------------------------------------------ hero */

function EduHero({ content }: { content?: EduStoreOverrides['hero'] }) {
  const headline = content?.headline ?? HERO.headline;
  const subhead = content?.subhead ?? HERO.subhead;

  // The house style splits the sentence so the last word can carry the accent
  // colour. An edited subhead that no longer opens with "College," is rendered
  // whole rather than glued onto a stray literal.
  const opener = 'College,';
  const rest = subhead.startsWith(opener) ? subhead.slice(opener.length).trim() : null;

  return (
    <section className="edu-hero" aria-label="Education Store">
      <div className="edu-hero-halo" aria-hidden="true" />

      {HERO.sprites.map((sprite) => (
        <span
          key={sprite.src}
          className={`edu-sticker edu-sticker-${sprite.slot}`}
          aria-hidden="true"
          style={
            {
              backgroundImage: `url(${sprite.src})`,
              '--frames': sprite.frames,
              '--dur': `${sprite.duration}s`,
            } as React.CSSProperties
          }
        />
      ))}

      <div className="edu-hero-copy">
        <h1 className="edu-hero-title">
          <span className="edu-hero-highlight">{headline}</span>
        </h1>

        <p className="edu-hero-subhead">
          {rest ? (
            <>
              {opener} <span className="edu-hero-subhead-accent">{rest}</span>
            </>
          ) : (
            <span className="edu-hero-subhead-accent">{subhead}</span>
          )}
        </p>

        <div className="edu-hero-utility">
          <a className="edu-hero-utility-link" href={HERO.specialistHref}>
            {HERO.chatLabel}
          </a>
          <a className="edu-hero-utility-link" href={HERO.findStoreHref}>
            {HERO.findStoreLabel}
          </a>
        </div>
      </div>

      <img
        className="edu-hero-wave"
        src={HERO.backgroundImage}
        alt=""
        aria-hidden="true"
        width={3008}
        height={300}
      />
    </section>
  );
}

/* --------------------------------------------------------------- rail UX */

function Rail({ children, label }: { children: React.ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(240, el.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <div className="edu-rail" aria-label={label}>
      <button
        type="button"
        className="edu-rail-arrow edu-rail-arrow-prev"
        onClick={() => scrollBy(-1)}
        disabled={atStart}
        aria-label="Previous"
      >
        <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
          <circle cx="18" cy="18" r="17" />
          <path d="M20.5 12 15 18l5.5 6" fill="none" strokeWidth="1.6" />
        </svg>
      </button>

      <div className="edu-rail-viewport" ref={ref} onScroll={sync}>
        {children}
      </div>

      <button
        type="button"
        className="edu-rail-arrow edu-rail-arrow-next"
        onClick={() => scrollBy(1)}
        disabled={atEnd}
        aria-label="Next"
      >
        <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
          <circle cx="18" cy="18" r="17" />
          <path d="M15.5 12 21 18l-5.5 6" fill="none" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------- product nav */

function ProductNav({ items }: { items: EduCard[] }) {
  return (
    <section className="edu-productnav" aria-label="Product">
      <Rail label="Product categories">
        <ul className="edu-productnav-track">
          {items.map((card) => (
            <li key={card.id} className="edu-productnav-item">
              <a className="edu-productnav-card" href={card.href}>
                <span className="edu-productnav-media">
                  <img src={card.image} alt="" loading="lazy" />
                </span>
                <span className="edu-productnav-title">{card.headline}</span>
              </a>
            </li>
          ))}
        </ul>
      </Rail>
    </section>
  );
}

/* ------------------------------------------------------------ store card */

function StoreCard({ card }: { card: EduCard }) {
  return (
    <li className="edu-card-item">
      <a className={`edu-card${card.dark ? ' edu-card-dark' : ''}`} href={card.href}>
        {card.tag ? <span className="edu-card-tag">{card.tag}</span> : null}

        {card.savingsBadge ? (
          <span className="edu-card-savings" aria-hidden="true">
            <svg viewBox="0 0 35 35" width="35" height="35">
              <path
                d="M17.5 3 21 6.2l4.6-.5 1.2 4.5 4.2 2-1.6 4.4 1.6 4.4-4.2 2-1.2 4.5-4.6-.5L17.5 31 14 27.8l-4.6.5-1.2-4.5-4.2-2 1.6-4.4-1.6-4.4 4.2-2 1.2-4.5 4.6.5z"
                fill="currentColor"
              />
              <path d="M15 18.5v3.2c-1.8-.9-2.9-2.4-2.9-4.2v-2l2.9 1.3zm5 0 6-2.7v2c0 1.8-1.1 3.3-2.9 4.2v-3.2zm0-3.6-2.5 1.1-2.5-1.1V13l2.5-1.1L20 13z" fill="#fff" />
            </svg>
            <span className="edu-card-savings-text">Education Savings</span>
          </span>
        ) : null}

        <span className="edu-card-media">
          <img src={card.image} alt="" loading="lazy" />
        </span>

        <span className="edu-card-copy">
          <h3 className="edu-card-headline">{card.headline}</h3>
          {card.desc ? <span className="edu-card-desc">{card.desc}</span> : null}
          {card.price ? <span className="edu-card-price">{card.price}</span> : null}
        </span>
      </a>
    </li>
  );
}

/* ---------------------------------------------------------------- shelf */

function CardShelf({
  headline,
  subhead,
  cards,
}: {
  headline: string;
  subhead: string;
  cards: EduCard[];
}) {
  return (
    <section className="edu-shelf" aria-label={headline}>
      <div className="edu-shelf-header">
        <h2 className="edu-shelf-title">{headline}</h2>
        <p className="edu-shelf-subhead">{subhead}</p>
      </div>
      <Rail label={headline}>
        <ul className="edu-card-track">
          {cards.map((card) => (
            <StoreCard key={card.id} card={card} />
          ))}
        </ul>
      </Rail>
    </section>
  );
}

/* ---------------------------------------------------------- quick links */

function QuickLinks({ items }: { items: { label?: string; href?: string }[] }) {
  return (
    <section className="edu-quicklinks" aria-label="Quick Links">
      <h2 className="edu-quicklinks-title">Quick Links</h2>
      <ul className="edu-quicklinks-list">
        {items.map((link, i) => (
          <li key={`${link.label}-${i}`}>
            <a className="edu-quicklinks-button" href={link.href}>
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ----------------------------------------------------------------- page */

export function EduStorePage({ overrides }: { overrides?: EduStoreOverrides } = {}) {
  const productNav = applyCardOverrides(PRODUCT_NAV, overrides?.productNav);

  const shelves = SHELVES.filter((shelf) => overrides?.shelves?.[shelf.id]?.enabled !== false).map(
    (shelf) => {
      const o = overrides?.shelves?.[shelf.id];
      return {
        ...shelf,
        headline: o?.headline ?? shelf.headline,
        subhead: o?.subhead ?? shelf.subhead,
        cards: applyCardOverrides(shelf.cards, o?.cards),
      };
    },
  );

  const quickLinks = overrides?.quickLinks?.length ? overrides.quickLinks : QUICK_LINKS;

  return (
    <div className="edu-root">
      {/* Old Header (kept commented as requested, do not remove): */}
      {/* <GlobalNav bannerVisible={false} /> */}
      {/* Sticky Gadzio header (the older GlobalNav is kept commented below). */}
      <GadzioHeader bannerVisible={true} />

      <main className="edu-storehome" role="main">
        {/* =========================================================================
            PREVIOUS HERO SECTION (KEPT COMMENTED AS REQUESTED - DO NOT REMOVE)
            ========================================================================= */}
        {/* <EduHero content={overrides?.hero} /> */}

        {/* ACTIVE GADZIO HERO SECTION */}
        <GadzioHeroSection />
        <ProductNav items={productNav} />
        {shelves.map((shelf) => (
          <CardShelf
            key={shelf.id}
            headline={shelf.headline}
            subhead={shelf.subhead}
            cards={shelf.cards}
          />
        ))}
        <QuickLinks items={quickLinks} />
      </main>

      <GlobalFooter />
    </div>
  );
}
