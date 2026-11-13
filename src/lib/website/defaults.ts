/**
 * Hardcoded defaults for every admin content collection, shaped exactly like
 * the simplified override object the admin panel stores in `content_blocks`
 * (see src/lib/website/collections.ts for the field-path contract).
 *
 * Purpose: pre-fill the admin editor so editors see the content the site
 * currently renders instead of blank fields. Saving the pre-filled value
 * unchanged must be a visual no-op — every value below is what the
 * corresponding page/component renders today.
 *
 * Sources of truth (do not invent values — copy from these):
 *   Gadzio homepage (`/`) — data files under
 *     src/components/sites/www-apple-com-736d3707/root-8a5edab2/data/
 *     plus inline defaults in Ribbon.tsx / PromoSection.tsx.
 *   Gadzio sections — shared plain data in ./section-defaults.ts.
 *   Edu store — src/components/sites/edu-store/data/content.ts plus inline
 *     defaults in EduStorePage.tsx.
 *   Cases — src/components/sites/cases-protection/data/products.ts plus inline
 *     CATEGORY_LINKS in CasesProtectionPage.tsx.
 *   SEO — the hardcoded `metadata` objects in each page.tsx.
 *
 * Art-directed image slots stay blank so original breakpoint art is retained;
 * getCollectionCurrentArt supplies their display-only previews. Single-image
 * sections prefill their image paths. Tile subheads flatten their {kind, value}
 * segments to the concatenated values.
 */

import { FOOTER_BOTTOM } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer';
import { TV_GALLERY_ITEMS } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/gallery';
import { LOCALE_BANNER } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/locale-banner';
import { NAV_ITEMS, SEARCH_PANEL } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav';
import { HERO_INLINE_MEDIA, HERO_TILES, NEW_UI_HERO_TILES, PROMO_TILES, type Tile } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles';
import {
  HERO as EDU_HERO,
  PRODUCT_NAV as EDU_PRODUCT_NAV,
  QUICK_LINKS as EDU_QUICK_LINKS,
  SHELVES as EDU_SHELVES,
  type EduCard,
} from '@/components/sites/edu-store/data/content';

import {
  TRUST_BADGES_ITEMS, CATEGORY_GRID_ITEMS, BRAND_BAR_ITEMS,
  DIWALI_ITEMS, DIWALI_COPY, CROWD_FAVORITES_ITEMS, CROWD_FAVORITES_COPY,
  REVIEWS_ITEMS, REVIEWS_COPY, IN_THE_WILD_ITEMS, IN_THE_WILD_COPY,
  EVENT_BANNER_COPY,
} from './section-defaults';

/* ------------------------------------------------------------- helpers */

/** Homepage tile → simplified editor shape (headline/subheadText/href/ctas + image size slots). */
function tileOverride(tile: Tile): Record<string, unknown> {
  return {
    headline: tile.headline ?? '',
    // Footnote glyphs/numbers render inline as markers, so a plain-text
    // subhead is the concatenation of every segment's value.
    subheadText: tile.subhead.map((segment) => segment.value).join(''),
    href: tile.href,
    // The field schema declares two CTA slots per tile; pad to two so every
    // declared path resolves. mergeTile only maps over the CTAs the tile
    // actually has, so a saved empty second CTA is a rendering no-op.
    ctas: [
      ...tile.ctas.map((cta) => ({ label: cta.label, href: cta.href })),
      ...Array.from({ length: Math.max(0, 2 - tile.ctas.length) }, () => ({
        label: '',
        href: '',
      })),
    ],
    infoTooltip: tile.infoTooltip ?? '',
    ...responsiveImageDefaults(tile.image),
  };
}

/**
 * Blank per-size slots for the editor: the defaults show empty upload boxes
 * (the original art keeps rendering until an editor uploads something). The
 * original image is NOT pre-filled — uploads replace, blanks keep originals.
 */
function responsiveImageDefaults(image: Tile['image']): Record<string, string> {
  return {
    imageSrc: '',
    imageSmallSrc: '',
    imageSmall2xSrc: '',
    imageMediumSrc: '',
    imageMedium2xSrc: '',
    imageLargeSrc: '',
    imageLarge2xSrc: '',
    ...(image ? {} : {}),
  };
}

/**
 * The original artwork per size slot (display-only "Currently" preview in the
 * editor). Each slot shows its bucket's 1x/2x source; the all-sizes shortcut
 * shows the plain <img> src. Buckets follow the site's breakpoints:
 * small ≤734px, medium ≤1068px (incl. mediumtall), large wider (incl. largetall).
 */
function responsiveImageCurrentArt(image: Tile['image']): Record<string, string> {
  const byBucket: Record<'small' | 'medium' | 'large', { src: string; src2x: string }> = {
    small: { src: '', src2x: '' },
    medium: { src: '', src2x: '' },
    large: { src: '', src2x: '' },
  };
  if (image) {
    for (const source of image.sources) {
      const bucket = /\(max-width:\s*734px\)/.test(source.media)
        ? 'small'
        : /\(max-width:\s*1068px\)/.test(source.media)
          ? 'medium'
          : 'large';
      // First source in a bucket wins — the site lists the most specific
      // (tall-variant) art first, which is what the editor should preview.
      if (!byBucket[bucket].src) byBucket[bucket].src = source.src;
      if (!byBucket[bucket].src2x && source.src2x) byBucket[bucket].src2x = source.src2x;
    }
  }
  return {
    imageSrc: image?.img.src ?? '',
    imageSmallSrc: byBucket.small.src,
    imageSmall2xSrc: byBucket.small.src2x,
    imageMediumSrc: byBucket.medium.src,
    imageMedium2xSrc: byBucket.medium.src2x,
    imageLargeSrc: byBucket.large.src,
    imageLarge2xSrc: byBucket.large.src2x,
  };
}

/* ------------------------------------------------------ Gadzio homepage */

const APPLE_HERO_TILES_DEFAULTS = {
  heroTiles: HERO_TILES.map(tileOverride),
};

const APPLE_PROMO_DEFAULTS = {
  heading: 'Explore Accessories',
  promoTiles: PROMO_TILES.map(tileOverride),
};

const APPLE_RIBBON_DEFAULTS = {
  // The de-branded promo line the live `apple.ribbon` row already carries, and
  // the fallback Ribbon.tsx renders. Replaces Apple India's own offer
  // ("6 months of No Cost EMI … instant cashback … eligible cards"), which was
  // Apple's promotional claim rather than a Gadzio one.
  text: 'Unlock exclusive student pricing and massive savings this semester on all eligible device chargers, protective cases, and premium audio accessories.',
  shopHref: '/shop/iphone/accessories/cases-protection',
};

const APPLE_LOCALE_BANNER_DEFAULTS = {
  copy: LOCALE_BANNER.copy,
  selectedLabel: LOCALE_BANNER.selectedLabel,
  continueLabel: LOCALE_BANNER.continueLabel,
  continueHref: LOCALE_BANNER.continueHref,
};

const APPLE_NAV_DEFAULTS = {
  // All 11 items — a shorter list would drop nav entries when saved.
  items: NAV_ITEMS.map((item) => ({ label: item.label, href: item.href })),
  searchPlaceholder: SEARCH_PANEL.placeholder,
};

const APPLE_FOOTER_DEFAULTS = {
  copyright: FOOTER_BOTTOM.copyright,
  localeLabel: FOOTER_BOTTOM.localeLabel,
  localeHref: FOOTER_BOTTOM.localeHref,
};

const APPLE_GALLERY_DEFAULTS = {
  // No row is hidden by src/app/page.tsx; an untouched save must stay hidden.
  enabled: false,
  secondRowEnabled: true,
  // Card overrides: captions + per-size replacement artwork (blank = keep original).
  items: TV_GALLERY_ITEMS.map((item) => ({
    title: item.caption,
    imageSrc: '',
    imageSmallSrc: '',
    imageSmall2xSrc: '',
    imageMediumSrc: '',
    imageMedium2xSrc: '',
    imageLargeSrc: '',
    imageLarge2xSrc: '',
  })),
};

const APPLE_HERO_VIDEO_DEFAULTS = {
  // HeroSection opts in only when enabled === true; no row has no stage.
  enabled: false,
  // Poster per-size slots (blank = keep the original start-frame art).
  imageSrc: '',
  imageSmallSrc: '',
  imageSmall2xSrc: '',
  imageMediumSrc: '',
  imageMedium2xSrc: '',
  imageLargeSrc: '',
  imageLarge2xSrc: '',
  // The three autoplaying clips with their measured positions.
  clips: HERO_INLINE_MEDIA.clips.map((clip) => ({
    src: clip.src,
    left: String(clip.left),
    width: String(clip.width),
  })),
};

// Mirrors the hardcoded `metadata` in src/app/page.tsx — the values the
// homepage actually renders when no `apple.seo` row exists. These are editor
// prefills only; they are never rendered directly.
const APPLE_SEO_DEFAULTS = {
  title: 'Gadzio',
  description:
    'Shop Gadzio mobile accessories, cases, chargers, cables, audio accessories and everyday tech essentials.',
  ogTitle: 'Gadzio',
};

/* -------------------------------------------------------- Edu store */

/** Store card → editor shape. Optional fields pre-fill as empty strings. */
function eduCardOverride(card: EduCard): Record<string, unknown> {
  return {
    headline: card.headline,
    tag: card.tag ?? '',
    desc: card.desc ?? '',
    price: card.price ?? '',
    image: card.image,
    href: card.href,
    dark: card.dark ?? false,
    savingsBadge: card.savingsBadge ?? false,
  };
}

const EDU_HERO_DEFAULTS = {
  headline: EDU_HERO.headline,
  subhead: EDU_HERO.subhead,
};

const EDU_PRODUCT_NAV_DEFAULTS = {
  // Every category — a shorter list would drop nav entries when saved.
  items: EDU_PRODUCT_NAV.map(eduCardOverride),
};

const EDU_QUICK_LINKS_DEFAULTS = {
  items: EDU_QUICK_LINKS.map((link) => ({ label: link.label, href: link.href })),
};

/** One DEFAULTS entry per shelf, keyed `edu.shelf_<id with underscores>`. */
const EDU_SHELF_DEFAULTS: Record<string, Record<string, unknown>> = Object.fromEntries(
  EDU_SHELVES.map((shelf) => [
    `edu.shelf_${shelf.id.replace(/-/g, '_')}`,
    {
      headline: shelf.headline,
      subhead: shelf.subhead,
      enabled: true,
      cards: shelf.cards.map(eduCardOverride),
    },
  ]),
);

const EDU_SEO_DEFAULTS = {
  title: 'Education Pricing and Student Discounts — Gadzio Education Store (IN)',
  description:
    'College, sorted. Buy Gadzio Book, Pad and more with education pricing. Students, parents and educators save on computers, tablets, watches and accessories.',
};

/* -------------------------------------------------- Cases & Protection */

const CASES_CATEGORY_LINKS_DEFAULTS = {
  // Mirrors CATEGORY_LINKS in CasesProtectionPage.tsx. Every destination is an
  // in-app Gadzio route — the previous apple.com category URLs would each have
  // sent an editor-saved rail straight to Apple's store.
  items: [
    { label: 'All Accessories', href: '/shop/iphone/accessories/cases-protection' },
    { label: 'Cases & Protection', href: '/shop/iphone/accessories/cases-protection' },
    { label: 'MagSafe Mounts', href: '/shop/iphone/accessories/cases-protection?filter=magsafe' },
    { label: 'Power & Cables', href: '/checkout' },
    { label: 'Audio & AirPods', href: '/' },
    { label: 'Stands & Docks', href: '/' },
    { label: 'Screen Protectors', href: '/shop/iphone/accessories/cases-protection' },
  ],
};

const CASES_PAGE_HEADER_DEFAULTS = {
  title: 'Cases & Protection',
};

// Mirrors the hardcoded `metadata` in the cases-protection page. Apple product
// terminology (iPhone, MagSafe) stays — Gadzio sells those cases — but the copy
// no longer implies the store is Apple's or that the cases are Apple's.
const CASES_SEO_DEFAULTS = {
  title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  description:
    'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
};

// Share the storefront fallback values, never a client-component export.
export const GADZIO_TRUST_BADGES_DEFAULTS = { enabled: true, items: TRUST_BADGES_ITEMS };
export const GADZIO_CATEGORY_GRID_DEFAULTS = { enabled: true, heading: '', items: CATEGORY_GRID_ITEMS };
export const GADZIO_CROWD_FAVORITES_DEFAULTS = {
  enabled: true, ...CROWD_FAVORITES_COPY, items: CROWD_FAVORITES_ITEMS,
};
export const GADZIO_EVENT_BANNER_DEFAULTS = { enabled: true, ...EVENT_BANNER_COPY };
export const GADZIO_BRAND_BAR_DEFAULTS = { enabled: true, items: BRAND_BAR_ITEMS };
export const GADZIO_DIWALI_CAMPAIGN_DEFAULTS = {
  enabled: true, ...DIWALI_COPY, bannerImage: '', items: DIWALI_ITEMS,
};
export const GADZIO_REVIEWS_DEFAULTS = { enabled: true, ...REVIEWS_COPY, items: REVIEWS_ITEMS };
export const GADZIO_IN_THE_WILD_DEFAULTS = {
  enabled: true, ...IN_THE_WILD_COPY, items: IN_THE_WILD_ITEMS,
};
export const GADZIO_HERO_TILES_DEFAULTS = {
  enabled: true,
  heroTiles: NEW_UI_HERO_TILES.map(tileOverride),
};

/* -------------------------------------------------------------- build */

const DEFAULTS: Record<string, Record<string, unknown>> = {
  /* Gadzio homepage */
  'gadzio.hero_tiles': GADZIO_HERO_TILES_DEFAULTS,
  'gadzio.reviews': GADZIO_REVIEWS_DEFAULTS,
  'gadzio.in_the_wild': GADZIO_IN_THE_WILD_DEFAULTS,
  'gadzio.brand_bar': GADZIO_BRAND_BAR_DEFAULTS,
  'gadzio.diwali_campaign': GADZIO_DIWALI_CAMPAIGN_DEFAULTS,
  'gadzio.trust_badges': GADZIO_TRUST_BADGES_DEFAULTS,
  'gadzio.category_grid': GADZIO_CATEGORY_GRID_DEFAULTS,
  'gadzio.crowd_favorites': GADZIO_CROWD_FAVORITES_DEFAULTS,
  'gadzio.event_banner': GADZIO_EVENT_BANNER_DEFAULTS,
  'apple.hero_tiles': APPLE_HERO_TILES_DEFAULTS,
  'apple.hero_video': APPLE_HERO_VIDEO_DEFAULTS,
  'apple.promo_section': APPLE_PROMO_DEFAULTS,
  'apple.ribbon': APPLE_RIBBON_DEFAULTS,
  'apple.locale_banner': APPLE_LOCALE_BANNER_DEFAULTS,
  'apple.nav': APPLE_NAV_DEFAULTS,
  'apple.footer': APPLE_FOOTER_DEFAULTS,
  'apple.gallery': APPLE_GALLERY_DEFAULTS,
  'apple.seo': APPLE_SEO_DEFAULTS,

  /* Education store */
  'edu.hero': EDU_HERO_DEFAULTS,
  'edu.product_nav': EDU_PRODUCT_NAV_DEFAULTS,
  // One entry per shelf — ids must match SHELVES in data/content.ts.
  ...EDU_SHELF_DEFAULTS,
  'edu.quick_links': EDU_QUICK_LINKS_DEFAULTS,
  'edu.seo': EDU_SEO_DEFAULTS,

  /* Cases & Protection */
  'cases.category_links': CASES_CATEGORY_LINKS_DEFAULTS,
  'cases.page_header': CASES_PAGE_HEADER_DEFAULTS,
  'cases.seo': CASES_SEO_DEFAULTS,
};

/**
 * The current hardcoded values for a collection, in the simplified override
 * shape the admin editor stores — or null for unknown keys.
 */
export function getCollectionDefaults(key: string): Record<string, unknown> | null {
  const defaults = DEFAULTS[key];
  return defaults ? structuredClone(defaults) : null;
}

/**
 * Original artwork per image slot for the editor's "Currently on site"
 * previews — or null for collections without art-directed image slots (those
 * pre-fill their image paths in DEFAULTS, so no preview map is needed).
 */
const CURRENT_ART: Record<string, Record<string, unknown>> = {
  'gadzio.hero_tiles': {
    heroTiles: NEW_UI_HERO_TILES.map((tile) => responsiveImageCurrentArt(tile.image)),
  },
  'apple.hero_tiles': {
    heroTiles: HERO_TILES.map((tile) => responsiveImageCurrentArt(tile.image)),
  },
  'apple.hero_video': {
    ...responsiveImageCurrentArt(HERO_TILES[0]?.startFrame ?? null),
  },
  'apple.promo_section': {
    promoTiles: PROMO_TILES.map((tile) => responsiveImageCurrentArt(tile.image)),
  },
  'apple.gallery': {
    items: TV_GALLERY_ITEMS.map((item) => responsiveImageCurrentArt(item.background)),
  },
};

export function getCollectionCurrentArt(key: string): Record<string, unknown> | null {
  const art = CURRENT_ART[key];
  return art ? structuredClone(art) : null;
}
