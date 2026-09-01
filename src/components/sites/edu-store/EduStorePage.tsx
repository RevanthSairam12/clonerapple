'use client';

import { useState } from 'react';

import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';

import {
  BTS_OFFERS,
  EDU_IN_ACTION,
  HERO,
  HOW_TO_BUY_STEPS,
  IPAD_PRODUCTS,
  MAC_PRODUCTS,
  SHOP_CATEGORIES,
} from './data/content';

/* ---------------------------------------------------------------- helpers */

const appleUrl = (href: string) =>
  href.startsWith('http') ? href : `https://www.apple.com${href}`;

function ImgWithFallback({
  src,
  alt,
  className,
  fallbackGradient,
}: {
  src: string;
  alt: string;
  className?: string;
  fallbackGradient?: string;
}) {
  const [errored, setErrored] = useState(false);

  if (errored && fallbackGradient) {
    return (
      <div
        className={className}
        style={{ background: fallbackGradient, width: '100%', height: '100%' }}
        aria-label={alt}
      />
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

/* ---------------------------------------------------------------- Hero */

function EduHero() {
  return (
    <section className="edu-hero" aria-label="Education Store hero">
      <div className="edu-container">
        <p className="edu-hero-badge">🎓 {HERO.badge}</p>
        <h1 className="edu-hero-headline">{HERO.headline}</h1>
        <p className="edu-hero-subhead">{HERO.subhead}</p>
        <div className="edu-hero-promo-box">
          <p className="edu-hero-promo-label">🍎 {HERO.promo.headline}</p>
          <p className="edu-hero-promo-text">{HERO.promo.offer}</p>
          <p className="edu-hero-promo-disclaimer">{HERO.promo.disclaimer}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Back to School tiles */

function BtsTiles() {
  return (
    <section className="edu-section edu-section-black" aria-label="Back to School offers">
      <div className="edu-container">
        <div className="edu-bts-grid">
          {BTS_OFFERS.map((offer) => {
            const isDark = offer.theme === 'dark';
            return (
              <div
                key={offer.id}
                className={`edu-bts-tile ${isDark ? 'edu-bts-tile-dark' : 'edu-bts-tile-light'}`}
              >
                <ImgWithFallback
                  src={offer.image}
                  alt={offer.headline}
                  className="edu-bts-tile-image"
                  fallbackGradient={offer.imageFallbackGradient}
                />
                <div className="edu-bts-tile-body">
                  <p className="edu-bts-kicker">{offer.kicker}</p>
                  <h2 className="edu-bts-headline">{offer.headline}</h2>
                  <p className="edu-bts-offer">{offer.offer}</p>
                  <p className="edu-bts-upgrade">{offer.upgradeNote}</p>
                  <div className="edu-bts-ctas">
                    <a
                      href={appleUrl(offer.ctaPrimary.href)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="edu-btn edu-btn-primary"
                    >
                      {offer.ctaPrimary.label}
                    </a>
                    <a
                      href={appleUrl(offer.ctaSecondary.href)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`edu-btn ${isDark ? 'edu-btn-secondary' : 'edu-btn-secondary-dark'}`}
                    >
                      {offer.ctaSecondary.label}
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Product Section */

function ProductSection({
  eyebrow,
  headline,
  subhead,
  products,
  cols,
  theme,
}: {
  eyebrow: string;
  headline: string;
  subhead: string;
  products: typeof MAC_PRODUCTS | typeof IPAD_PRODUCTS;
  cols: 3 | 4;
  theme: 'dark' | 'light';
}) {
  const isDark = theme === 'dark';
  return (
    <section
      className={`edu-section ${isDark ? 'edu-section-dark' : 'edu-section-light'}`}
      aria-label={headline}
    >
      <div className="edu-container">
        <div className="edu-section-title-group">
          <p className={`edu-section-eyebrow ${isDark ? '' : 'edu-section-eyebrow-dark'}`}>
            {eyebrow}
          </p>
          <h2 className="edu-section-headline">{headline}</h2>
          <p className={`edu-section-subhead ${isDark ? '' : 'edu-section-subhead-dark'}`}>
            {subhead}
          </p>
        </div>

        <div className={`edu-product-grid edu-product-grid-${cols}`}>
          {products.map((product) => (
            <div
              key={product.id}
              className={`edu-product-card ${isDark ? '' : 'edu-product-card-light'}`}
            >
              <div className="edu-product-img-wrap">
                <ImgWithFallback
                  src={product.image}
                  alt={product.name}
                  className="edu-product-img"
                  fallbackGradient={isDark ? '#2d2d2f' : '#f0f0f5'}
                />
              </div>
              <p className={`edu-product-name ${isDark ? '' : 'edu-product-name-dark'}`}>
                {product.name}
              </p>
              <p className={`edu-product-descriptor ${isDark ? '' : 'edu-product-descriptor-dark'}`}>
                {product.descriptor}
              </p>
              <p className={`edu-product-chip ${isDark ? '' : 'edu-product-chip-dark'}`}>
                {product.chip}
              </p>
              <p className="edu-product-price">{product.price}</p>
              <p className={`edu-product-price-note ${isDark ? '' : 'edu-product-price-note-dark'}`}>
                {product.priceNote}
              </p>
              <div className="edu-product-ctas">
                <a
                  href={appleUrl(product.buyHref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="edu-btn edu-btn-primary"
                >
                  Buy
                </a>
                <a
                  href={appleUrl(product.learnHref)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`edu-btn ${isDark ? 'edu-btn-secondary' : 'edu-btn-secondary-dark'}`}
                >
                  Learn more
                </a>
              </div>
            </div>
          ))}
        </div>

        <p className="edu-footnote" style={{ color: isDark ? '#6e6e73' : '#6e6e73', borderTopColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)' }}>
          * Education pricing available to students, teachers and staff of qualifying educational institutions.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Education in Action */

function EduInAction() {
  return (
    <section className="edu-section edu-section-black" aria-label="Apple Education in Action">
      <div className="edu-container">
        <div className="edu-section-title-group">
          <p className="edu-section-eyebrow">Apple Education in Action</p>
          <h2 className="edu-section-headline">Built for every kind of learner.</h2>
          <p className="edu-section-subhead">
            See how students across disciplines use Mac and iPad to go further.
          </p>
        </div>

        <div className="edu-action-grid">
          {EDU_IN_ACTION.map((item) => (
            <div
              key={item.id}
              className="edu-action-card"
              style={{ background: item.bgColor }}
            >
              <div
                className="edu-action-card-glow"
                style={{ background: item.accentColor }}
              />
              <p className="edu-action-field">{item.field} · {item.device}</p>
              <h3 className="edu-action-headline">{item.headline}</h3>
              <p className="edu-action-body">{item.body}</p>
              <span className="edu-action-app-pill" style={{ color: item.accentColor, borderColor: item.accentColor + '40' }}>
                {item.app}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Eligibility banner */

function EligibilityBanner() {
  return (
    <section className="edu-section edu-section-dark" aria-label="Eligibility">
      <div className="edu-container">
        <div className="edu-elig-banner">
          <h2 className="edu-elig-headline">Who can shop the Education Store?</h2>
          <p className="edu-elig-body">
            Apple Education Pricing is available to current and newly accepted college students,
            students&rsquo; parents, and teachers and staff at all grade levels.
          </p>
          <div className="edu-elig-tags">
            {['College Students', 'Newly Accepted Students', 'Parents of Students', 'Teachers', 'Faculty & Staff', 'Homeschool Educators'].map((tag) => (
              <span key={tag} className="edu-elig-tag">{tag}</span>
            ))}
          </div>
          <a
            href="https://www.apple.com/in-edu/store"
            target="_blank"
            rel="noopener noreferrer"
            className="edu-btn edu-btn-primary"
          >
            Verify my eligibility
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- How to Buy */

function HowToBuy() {
  return (
    <section className="edu-section edu-section-light" aria-label="How to buy">
      <div className="edu-container">
        <div className="edu-section-title-group">
          <p className="edu-section-eyebrow edu-section-eyebrow-dark">Buying Guide</p>
          <h2 className="edu-section-headline" style={{ color: '#1d1d1f' }}>
            How to buy with education savings.
          </h2>
        </div>

        <div className="edu-steps-grid">
          {HOW_TO_BUY_STEPS.map((step) => (
            <div key={step.step}>
              <p className="edu-step-number edu-step-number-dark">{step.step}</p>
              <h3 className="edu-step-headline" style={{ color: '#1d1d1f' }}>
                {step.headline}
              </h3>
              <p className="edu-step-body edu-step-body-dark">{step.body}</p>
              <a
                href={appleUrl(step.link.href)}
                target="_blank"
                rel="noopener noreferrer"
                className="edu-step-link edu-step-link-dark"
              >
                {step.link.label}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Shop Categories */

function ShopCategories() {
  return (
    <section className="edu-section edu-section-dark" aria-label="Shop categories">
      <div className="edu-container">
        <div className="edu-section-title-group">
          <h2 className="edu-section-headline">Browse the Education Store.</h2>
        </div>
        <div className="edu-categories-grid">
          {SHOP_CATEGORIES.map((cat) => (
            <a
              key={cat.label}
              href={appleUrl(cat.href)}
              target="_blank"
              rel="noopener noreferrer"
              className="edu-category-tile"
            >
              <span className="edu-category-icon" aria-hidden="true">{cat.icon}</span>
              <span className="edu-category-label">{cat.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Page */

export function EduStorePage() {
  return (
    <div className="edu-root ac-root">
      {/* Global Nav — reused, no changes */}
      <GlobalNav bannerVisible={false} />

      <div className="edu-page-wrap">
        <EduHero />
        <BtsTiles />

        <ProductSection
          eyebrow="Mac for Education"
          headline="Mac. Made for more."
          subhead="The power of Apple silicon takes students further, faster."
          products={MAC_PRODUCTS}
          cols={3}
          theme="dark"
        />

        <ProductSection
          eyebrow="iPad for Education"
          headline="iPad. The ultimate learning tool."
          subhead="Versatile, powerful, and perfect with Apple Pencil."
          products={IPAD_PRODUCTS}
          cols={4}
          theme="light"
        />

        <EduInAction />
        <EligibilityBanner />
        <HowToBuy />
        <ShopCategories />
      </div>

      {/* Global Footer — reused, no changes */}
      <GlobalFooter />
    </div>
  );
}
