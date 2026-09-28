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
import type {
  EduCategoryOverride,
  EduEligibilityOverride,
  EduHeroOverride,
  EduInActionItemOverride,
  EduOfferItemOverride,
  EduProductOverride,
  EduSectionHeadingsOverride,
  EduStepOverride,
} from './admin-overrides';

/** Admin overrides; every field falls back to the hardcoded default. */
export interface EduStoreOverrides {
  hero?: EduHeroOverride;
  btsOffers?: EduOfferItemOverride[];
  /** false = section disabled in the admin panel. */
  btsEnabled?: boolean;
  macProducts?: EduProductOverride[];
  /** false = section disabled in the admin panel. */
  macEnabled?: boolean;
  ipadProducts?: EduProductOverride[];
  /** false = section disabled in the admin panel. */
  ipadEnabled?: boolean;
  sections?: EduSectionHeadingsOverride;
  inAction?: EduInActionItemOverride[];
  /** false = section disabled in the admin panel. */
  inActionEnabled?: boolean;
  eligibility?: EduEligibilityOverride;
  /** false = section disabled in the admin panel. */
  eligibilityEnabled?: boolean;
  howToBuy?: { eyebrow?: string; headline?: string; steps?: EduStepOverride[] };
  /** false = section disabled in the admin panel. */
  howToBuyEnabled?: boolean;
  categories?: EduCategoryOverride[];
  /** false = section disabled in the admin panel. */
  categoriesEnabled?: boolean;
}

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

function EduHero({ content }: { content?: EduHeroOverride }) {
  const badge = content?.badge ?? HERO.badge;
  const headline = content?.headline ?? HERO.headline;
  const subhead = content?.subhead ?? HERO.subhead;
  const promoHeadline = content?.promoHeadline ?? HERO.promo.headline;
  const promoOffer = content?.promoOffer ?? HERO.promo.offer;
  const promoDisclaimer = content?.promoDisclaimer ?? HERO.promo.disclaimer;

  return (
    <section className="edu-hero" aria-label="Education Store hero">
      <div className="edu-container">
        <p className="edu-hero-badge">🎓 {badge}</p>
        <h1 className="edu-hero-headline">{headline}</h1>
        <p className="edu-hero-subhead">{subhead}</p>
        <div className="edu-hero-promo-box">
          <p className="edu-hero-promo-label">🍎 {promoHeadline}</p>
          <p className="edu-hero-promo-text">{promoOffer}</p>
          <p className="edu-hero-promo-disclaimer">{promoDisclaimer}</p>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- Back to School tiles */

function BtsTiles({ items: overrides }: { items?: EduOfferItemOverride[] }) {
  // Override array length wins — an added tile clones the last one.
  const offers = overrides
    ? overrides.map((o, i) => {
        const offer = BTS_OFFERS[i] ?? BTS_OFFERS[BTS_OFFERS.length - 1];
        return {
          ...offer,
          kicker: o.kicker ?? offer.kicker,
          headline: o.headline ?? offer.headline,
          offer: o.offer ?? offer.offer,
          upgradeNote: o.upgradeNote ?? offer.upgradeNote,
          image: o.image ?? offer.image,
          ctaPrimary: {
            label: o.ctaPrimaryLabel ?? offer.ctaPrimary.label,
            href: o.ctaPrimaryHref ?? offer.ctaPrimary.href,
          },
          ctaSecondary: {
            label: o.ctaSecondaryLabel ?? offer.ctaSecondary.label,
            href: o.ctaSecondaryHref ?? offer.ctaSecondary.href,
          },
        };
      })
    : BTS_OFFERS;

  return (
    <section className="edu-section edu-section-black" aria-label="Back to School offers">
      <div className="edu-container">
        <div className="edu-bts-grid">
          {offers.map((offer) => {
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
  overrides,
  cols,
  theme,
}: {
  eyebrow: string;
  headline: string;
  subhead: string;
  products: typeof MAC_PRODUCTS | typeof IPAD_PRODUCTS;
  overrides?: EduProductOverride[];
  cols: 3 | 4;
  theme: 'dark' | 'light';
}) {
  const isDark = theme === 'dark';
  // Override array length wins — an added card clones the last one.
  const items = overrides
    ? overrides.map((o, i) => {
        const product = products[i] ?? products[products.length - 1];
        return {
          ...product,
          name: o.name ?? product.name,
          descriptor: o.descriptor ?? product.descriptor,
          chip: o.chip ?? product.chip,
          price: o.price ?? product.price,
          priceNote: o.priceNote ?? product.priceNote,
          image: o.image ?? product.image,
          buyHref: o.buyHref ?? product.buyHref,
          learnHref: o.learnHref ?? product.learnHref,
        };
      })
    : products;

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
          {items.map((product) => (
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

function EduInAction({ items: overrides }: { items?: EduInActionItemOverride[] }) {
  // Override array length wins — an added card clones the last one (its
  // colors carry over; the editor sets field/device/headline/body).
  const items = overrides
    ? overrides.map((o, i) => {
        const item = EDU_IN_ACTION[i] ?? EDU_IN_ACTION[EDU_IN_ACTION.length - 1];
        return {
          ...item,
          field: o.field ?? item.field,
          device: o.device ?? item.device,
          headline: o.headline ?? item.headline,
          body: o.body ?? item.body,
          app: o.app ?? item.app,
        };
      })
    : EDU_IN_ACTION;

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
          {items.map((item) => (
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

const DEFAULT_TAGS = [
  'College Students',
  'Newly Accepted Students',
  'Parents of Students',
  'Teachers',
  'Faculty & Staff',
  'Homeschool Educators',
];

function EligibilityBanner({ content }: { content?: EduEligibilityOverride }) {
  const headline = content?.headline ?? 'Who can shop the Education Store?';
  const body =
    content?.body ??
    'Apple Education Pricing is available to current and newly accepted college students, students’ parents, and teachers and staff at all grade levels.';
  const tags = content?.tags ? content.tags.split('\n').map((t) => t.trim()).filter(Boolean) : DEFAULT_TAGS;
  const ctaLabel = content?.ctaLabel ?? 'Verify my eligibility';
  const ctaHref = content?.ctaHref ?? 'https://www.apple.com/in-edu/store';

  return (
    <section className="edu-section edu-section-dark" aria-label="Eligibility">
      <div className="edu-container">
        <div className="edu-elig-banner">
          <h2 className="edu-elig-headline">{headline}</h2>
          <p className="edu-elig-body">{body}</p>
          <div className="edu-elig-tags">
            {tags.map((tag) => (
              <span key={tag} className="edu-elig-tag">{tag}</span>
            ))}
          </div>
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className="edu-btn edu-btn-primary"
          >
            {ctaLabel}
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- How to Buy */

function HowToBuy({
  eyebrow = 'Buying Guide',
  headline = 'How to buy with education savings.',
  steps: overrides,
}: {
  eyebrow?: string;
  headline?: string;
  steps?: EduStepOverride[];
} = {}) {
  // Override array length wins — an added step clones the last one.
  const steps = overrides
    ? overrides.map((o, i) => {
        const step = HOW_TO_BUY_STEPS[i] ?? HOW_TO_BUY_STEPS[HOW_TO_BUY_STEPS.length - 1];
        return {
          ...step,
          step: o.step ?? step.step,
          headline: o.headline ?? step.headline,
          body: o.body ?? step.body,
          link: { label: o.linkLabel ?? step.link.label, href: o.linkHref ?? step.link.href },
        };
      })
    : HOW_TO_BUY_STEPS;

  return (
    <section className="edu-section edu-section-light" aria-label="How to buy">
      <div className="edu-container">
        <div className="edu-section-title-group">
          <p className="edu-section-eyebrow edu-section-eyebrow-dark">{eyebrow}</p>
          <h2 className="edu-section-headline" style={{ color: '#1d1d1f' }}>
            {headline}
          </h2>
        </div>

        <div className="edu-steps-grid">
          {steps.map((step) => (
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

function ShopCategories({
  headline = 'Browse the Education Store.',
  items: overrides,
}: {
  headline?: string;
  items?: EduCategoryOverride[];
} = {}) {
  // Override array length wins — an added tile clones the last one.
  const categories = overrides
    ? overrides.map((o, i) => {
        const cat = SHOP_CATEGORIES[i] ?? SHOP_CATEGORIES[SHOP_CATEGORIES.length - 1];
        return { ...cat, label: o.label ?? cat.label, icon: o.icon ?? cat.icon, href: o.href ?? cat.href };
      })
    : SHOP_CATEGORIES;

  return (
    <section className="edu-section edu-section-dark" aria-label="Shop categories">
      <div className="edu-container">
        <div className="edu-section-title-group">
          <h2 className="edu-section-headline">{headline}</h2>
        </div>
        <div className="edu-categories-grid">
          {categories.map((cat) => (
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

export function EduStorePage({ overrides }: { overrides?: EduStoreOverrides } = {}) {
  const s = overrides?.sections;

  return (
    <div className="edu-root ac-root">
      {/* Global Nav — reused, no changes */}
      <GlobalNav bannerVisible={false} />

      <div className="edu-page-wrap">
        <EduHero content={overrides?.hero} />
        {overrides?.btsEnabled !== false ? <BtsTiles items={overrides?.btsOffers} /> : null}

        {overrides?.macEnabled !== false ? (
          <ProductSection
            eyebrow={s?.mac?.eyebrow ?? 'Mac for Education'}
            headline={s?.mac?.headline ?? 'Mac. Made for more.'}
            subhead={s?.mac?.subhead ?? 'The power of Apple silicon takes students further, faster.'}
            products={MAC_PRODUCTS}
            overrides={overrides?.macProducts}
            cols={3}
            theme="dark"
          />
        ) : null}

        {overrides?.ipadEnabled !== false ? (
          <ProductSection
            eyebrow={s?.ipad?.eyebrow ?? 'iPad for Education'}
            headline={s?.ipad?.headline ?? 'iPad. The ultimate learning tool.'}
            subhead={s?.ipad?.subhead ?? 'Versatile, powerful, and perfect with Apple Pencil.'}
            products={IPAD_PRODUCTS}
            overrides={overrides?.ipadProducts}
            cols={4}
            theme="light"
          />
        ) : null}

        {overrides?.inActionEnabled !== false ? <EduInAction items={overrides?.inAction} /> : null}
        {overrides?.eligibilityEnabled !== false ? (
          <EligibilityBanner content={overrides?.eligibility} />
        ) : null}
        {overrides?.howToBuyEnabled !== false ? (
          <HowToBuy
            eyebrow={overrides?.howToBuy?.eyebrow}
            headline={overrides?.howToBuy?.headline}
            steps={overrides?.howToBuy?.steps}
          />
        ) : null}
        {overrides?.categoriesEnabled !== false ? (
          <ShopCategories
            headline={s?.categories?.headline}
            items={overrides?.categories}
          />
        ) : null}
      </div>

      {/* Global Footer — reused, no changes */}
      <GlobalFooter />
    </div>
  );
}
