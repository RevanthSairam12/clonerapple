'use client';

import { useState, useEffect, useCallback } from 'react';

interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  image: string;
  bg: string;
  learnMoreHref: string;
  buyNowHref: string;
}

const SLIDES: HeroSlide[] = [
  {
    id: 'reno16',
    title: 'OPPO Reno16 5G - AI Remix Collage',
    subtitle: '10% Instant Bank Discount',
    image: '/sites/oppo-india/images/hero_banner_reno16.jpg',
    bg: 'linear-gradient(to right, #eae9f1 0%, #eae9f1 25%, #dcd7eb 100%)',
    learnMoreHref: '#',
    buyNowHref: '#',
  },
  {
    id: 'reno16c',
    title: 'OPPO Reno16c 5G - AI Remix Collage',
    subtitle: '10% Instant Bank Discount',
    image: '/sites/oppo-india/images/hero_banner_reno16c.jpg',
    bg: 'linear-gradient(to right, #f1eef7 0%, #f1eef7 25%, #dcd8eb 100%)',
    learnMoreHref: '#',
    buyNowHref: '#',
  },
  {
    id: 'bubble',
    title: 'OPPO Bubble - Ultra-Clear Rear Selfie View',
    subtitle: 'Custom Vibe E-Badge',
    image: '/sites/oppo-india/images/hero_banner_bubble.jpg',
    bg: 'linear-gradient(to right, #e7ddf2 0%, #e7ddf2 25%, #ded1ec 100%)',
    learnMoreHref: '#',
    buyNowHref: '#',
  },
];

export function OppoHeroBanner() {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const nextSlide = useCallback(() => {
    setCurrent((prev) => (prev + 1) % SLIDES.length);
  }, []);

  const prevSlide = useCallback(() => {
    setCurrent((prev) => (prev - 1 + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(nextSlide, 5000);
    return () => clearInterval(timer);
  }, [isPaused, nextSlide]);

  return (
    <section
      className="oppo-hero-wrapper"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-label="Hero Carousel"
    >
      <div className="oppo-hero-viewport">
        {SLIDES.map((slide, index) => {
          const isActive = index === current;
          return (
            <div
              key={slide.id}
              className={`oppo-hero-slide-item ${isActive ? 'active' : ''}`}
              style={{ background: slide.bg }}
              aria-hidden={!isActive}
            >
              <div className="oppo-hero-banner-frame">
                <img
                  src={slide.image}
                  alt={slide.title}
                  className="oppo-hero-banner-img"
                  loading={index === 0 ? 'eager' : 'lazy'}
                />

                {/* Hotspot buttons matching the Learn More / Buy Now pill locations */}
                <div className="oppo-hero-hotspots">
                  <a
                    href={slide.learnMoreHref}
                    className="oppo-hero-hotspot oppo-hotspot-learn"
                    aria-label={`Learn more about ${slide.title}`}
                    title="Learn more"
                  />
                  <a
                    href={slide.buyNowHref}
                    className="oppo-hero-hotspot oppo-hotspot-buy"
                    aria-label={`Buy ${slide.title} now`}
                    title="Buy now"
                  />
                </div>
              </div>
            </div>
          );
        })}

        {/* Prev / Next navigation arrows */}
        <button
          type="button"
          className="oppo-hero-nav-arrow prev"
          onClick={prevSlide}
          aria-label="Previous slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button
          type="button"
          className="oppo-hero-nav-arrow next"
          onClick={nextSlide}
          aria-label="Next slide"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Dot Indicators */}
      <div className="oppo-hero-pagination">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            className={`oppo-hero-dot ${i === current ? 'active' : ''}`}
            onClick={() => setCurrent(i)}
            aria-label={`Slide ${i + 1}: ${slide.title}`}
          />
        ))}
      </div>
    </section>
  );
}

