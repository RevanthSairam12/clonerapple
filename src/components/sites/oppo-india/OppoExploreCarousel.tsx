'use client';

import { useRef } from 'react';

import type { OppoExploreOverride } from './admin-overrides';

interface ExploreCard {
  title: string;
  description: string;
  image: string;
  href?: string;
}

const EXPLORE_CARDS: ExploreCard[] = [
  {
    title: 'OPPO Apex Guard',
    description: 'Next Level Quality',
    image: '/sites/oppo-india/images/explore_guard.png',
    href: '#',
  },
  {
    title: 'About OPPO',
    description: 'Make Your Moment',
    image: '/sites/oppo-india/images/explore_about.png',
    href: '#',
  },
  {
    title: 'OPPO AI',
    description: 'Leading AI Experiences',
    image: '/sites/oppo-india/images/explore_ai.png',
    href: '#',
  },
  {
    title: 'ColorOS',
    description: 'New Generation Experience',
    image: '/sites/oppo-india/images/explore_coloros.jpg',
    href: '#',
  },
];

export function OppoExploreCarousel({
  heading = 'Explore OPPO',
  items: overrides,
}: {
  heading?: string;
  items?: OppoExploreOverride[];
} = {}) {
  // Override array length wins — an added card clones the last one.
  const cards = overrides
    ? overrides.map((o, i) => {
        const card = EXPLORE_CARDS[i] ?? EXPLORE_CARDS[EXPLORE_CARDS.length - 1];
        return {
          ...card,
          title: o.title ?? card.title,
          description: o.description ?? card.description,
          image: o.image ?? card.image,
          href: o.href ?? card.href,
        };
      })
    : EXPLORE_CARDS;

  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const amount = 400;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <section className="oppo-explore-section">
      <div className="oppo-explore-container">
        <div className="oppo-explore-header">
          <h2 className="oppo-explore-title">{heading}</h2>
          <div className="oppo-explore-controls">
            <button
              type="button"
              className="oppo-explore-arrow-btn"
              onClick={() => scroll('left')}
              aria-label="Scroll left"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              className="oppo-explore-arrow-btn"
              onClick={() => scroll('right')}
              aria-label="Scroll right"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        <div className="oppo-explore-track" ref={scrollRef}>
          {cards.map((card) => (
            <a key={card.title} href={card.href || '#'} className="oppo-explore-card">
              <div className="oppo-explore-card-image">
                <img
                  src={card.image}
                  alt={card.title}
                  loading="lazy"
                />
              </div>
              <div className="oppo-explore-card-body">
                <h3 className="oppo-explore-card-title">{card.title}</h3>
                <div className="oppo-explore-card-footer">
                  <p className="oppo-explore-card-desc">{card.description}</p>
                  <span className="oppo-explore-card-arrow" aria-hidden="true">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="4" y1="12" x2="20" y2="12" />
                      <polyline points="14 6 20 12 14 18" />
                    </svg>
                  </span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

