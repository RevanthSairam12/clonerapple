/**
 * Hardcoded defaults for every admin content collection, shaped exactly like
 * the simplified override object the admin panel stores in `content_blocks`
 * (see src/lib/admin/collections.ts for the field-path contract).
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
 *   OPPO — inline DEFAULT_* constants in src/components/sites/oppo-india/*.tsx.
 *   Edu store — src/components/sites/edu-store/data/content.ts plus inline
 *     defaults in EduStorePage.tsx.
 *   Cases — src/components/sites/cases-protection/data/products.ts plus inline
 *     CATEGORY_LINKS in CasesProtectionPage.tsx.
 *   SEO — the hardcoded `metadata` objects in each page.tsx.
 *
 * Image fields collapse art-directed multi-breakpoint PictureData to a single
 * `imageSrc` string: the primary `img.src` (largest rendered asset). Tile
 * subheads flatten their {kind, value} segments to the concatenated values.
 */

import { FOOTER_BOTTOM, FOOTER_FOOTNOTES_HTML } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/footer';
import { TV_GALLERY_ITEMS } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/gallery';
import { LOCALE_BANNER } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/locale-banner';
import { NAV_ITEMS, SEARCH_PANEL } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/nav';
import { HERO_INLINE_MEDIA, HERO_TILES, PROMO_TILES, type Tile } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/data/tiles';
import {
  HERO as EDU_HERO,
  PRODUCT_NAV as EDU_PRODUCT_NAV,
  QUICK_LINKS as EDU_QUICK_LINKS,
  SHELVES as EDU_SHELVES,
  type EduCard,
} from '@/components/sites/edu-store/data/content';
import { PRODUCTS as CASES_PRODUCTS } from '@/components/sites/cases-protection/data/products';

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
  footnotesHtml: FOOTER_FOOTNOTES_HTML,
  copyright: FOOTER_BOTTOM.copyright,
  localeLabel: FOOTER_BOTTOM.localeLabel,
  localeHref: FOOTER_BOTTOM.localeHref,
};

const APPLE_GALLERY_DEFAULTS = {
  // GALLERY_META.headline is null — the gallery renders no section heading.
  heading: '',
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
    label: clip.id,
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

/* ---------------------------------------------------------- OPPO India */

const OPPO_ANNOUNCE_DEFAULTS = {
  text: 'SHOP LIVE: Tap to unlock live discounts! ',
  linkLabel: 'Watch Now',
  linkHref: '#',
};

const OPPO_NAV_DEFAULTS = {
  logoText: 'OPPO',
  leftLinks: [
    { label: 'Smartphones', href: '#' },
    { label: 'Tablets', href: '#' },
    { label: 'Audio', href: '#' },
    { label: 'Accessories', href: '#' },
    { label: 'About OPPO', href: '#' },
  ],
  rightLinks: [
    { label: 'Store', href: '#' },
    { label: 'ColorOS', href: '#' },
    { label: 'Support', href: '#' },
    { label: 'Student Offer', href: '#' },
    { label: 'My OPPO', href: '#' },
  ],
};

const OPPO_HERO_SLIDES_DEFAULTS = {
  slides: [
    {
      title: 'OPPO Reno16 5G - AI Remix Collage',
      subtitle: '10% Instant Bank Discount',
      image: '/sites/oppo-india/images/hero_banner_reno16.jpg',
      learnMoreHref: '#',
      buyNowHref: '#',
    },
    {
      title: 'OPPO Reno16c 5G - AI Remix Collage',
      subtitle: '10% Instant Bank Discount',
      image: '/sites/oppo-india/images/hero_banner_reno16c.jpg',
      learnMoreHref: '#',
      buyNowHref: '#',
    },
    {
      title: 'OPPO Bubble - Ultra-Clear Rear Selfie View',
      subtitle: 'Custom Vibe E-Badge',
      image: '/sites/oppo-india/images/hero_banner_bubble.jpg',
      learnMoreHref: '#',
      buyNowHref: '#',
    },
  ],
};

const OPPO_HOT_SALE_DEFAULTS = {
  badge: 'OPPO AI Phone',
  title: 'OPPO Find X9s',
  tagline: 'Your Story Matters.\nCreate with Find.',
  image: '/sites/oppo-india/images/find_x9s.jpg',
  learnLabel: 'Learn more',
  buyLabel: 'Buy now',
};

const OPPO_PRODUCTS_DEFAULTS = {
  items: [
    {
      title: 'Charging Adapters',
      titleSup: '',
      image: '/sites/oppo-india/images/chargingadpters.png',
      descriptions: 'Browse our full collection of adapters',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO F33',
      titleSup: '5G',
      image: '/sites/oppo-india/images/f33.jpg',
      descriptions: 'Wide for Big Moments',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Bubble',
      titleSup: '',
      image: '/sites/oppo-india/images/oppo_bubble.jpg',
      descriptions: 'Ultra-Clear Rear Selfie View\nCustom Vibe E-Badge',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Enco Air5',
      titleSup: '',
      image: '',
      descriptions: 'True Wireless\nNoise Cancelling Earbuds',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Enco Air5 Pro',
      titleSup: '',
      image: '',
      descriptions: 'True Wireless Noise Cancelling Earbuds',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Enco Buds3 Pro+',
      titleSup: '',
      image: '',
      descriptions: 'True Wireless Noise Cancelling Earbuds\nNon-Stop Grooves\nUnmatched Battery Life',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Magnetic Charger 2 AIRVOOC 50W',
      titleSup: '',
      image: '',
      descriptions: 'Fast Wireless Charging',
      learnHref: '#',
      buyHref: '#',
    },
    {
      title: 'OPPO Magnetic Cooling Card',
      titleSup: '',
      image: '',
      descriptions: 'Keep Your Phone Cool',
      learnHref: '#',
      buyHref: '#',
    },
  ],
};

const OPPO_OFFERS_DEFAULTS = {
  heading: 'Offers made for you',
  items: [
    {
      title: 'Exchange Program',
      description: 'Upgrade Now and Save Up to ₹43,900',
      image: '/sites/oppo-india/images/offer_exchange.png',
      href: '#',
    },
    {
      title: 'Welcome Gift',
      description: 'Limited-time offer for all new members.',
      image: '/sites/oppo-india/images/offer_gift.png',
      href: '#',
    },
    {
      title: 'Student Offer',
      description: 'Students Get up to 44% OFF on\nSmartphone',
      image: '/sites/oppo-india/images/offer_student.png',
      href: '#',
    },
  ],
};

const OPPO_EXPLORE_DEFAULTS = {
  heading: 'Explore OPPO',
  items: [
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
  ],
};

const OPPO_SUPPORT_DEFAULTS = {
  heading: 'OPPO Support',
  items: [
    'Authenticity and Warranty Status Check',
    'Service Centers & Reservation',
    'Contact Us',
    'Find More Service',
    'Retail Store Locator',
  ],
};

const OPPO_COMMUNITY_DEFAULTS = {
  heading: 'OPPO Community',
  viewAllLabel: 'View all',
  tagline: 'A home for all OPPO fans to experience content, inspiration, and our beautiful technology.',
  cards: [
    { title: 'Quick reply speech to text', subtitle: '#OPPOFindN2Flip', image: '' },
    { title: 'CAPTURE THE SM:)ING EARTH', subtitle: 'Winners of the #ShotonOPPO #SmilingEarth day contest', image: '' },
  ],
};

const OPPO_FOOTER_DEFAULTS = {
  disclaimer1: '*The product pictures are for reference only, please refer to the actual product.',
  disclaimer2: '*The UI is only for demonstration purposes, please refer to the UI design of actual product.',
  disclaimer3: '*The prices displayed are the official suggested retail Prices, the actual price may vary depending on the purchasing channel.',
  tagline: 'Make Your Moment',
};

const OPPO_SEO_DEFAULTS = {
  title: 'OPPO Official Site - OPPO India',
  description:
    'Discover OPPO smartphones, tablets, audio accessories, and IoT products. Explore the latest Reno, Find, and F series phones with cutting-edge AI features powered by ColorOS.',
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
  sortLabel: 'Sort by',
};

const CASES_PRODUCTS_DEFAULTS = {
  // All products — a shorter list would drop grid entries when saved.
  items: CASES_PRODUCTS.map((product) => ({
    name: product.name,
    subtitle: product.subtitle,
    price: product.price,
    priceDisplay: product.priceDisplay,
    image: product.image,
    badge: product.badge ?? '',
    href: product.href,
  })),
};

// Mirrors the hardcoded `metadata` in the cases-protection page. Apple product
// terminology (iPhone, MagSafe) stays — Gadzio sells those cases — but the copy
// no longer implies the store is Apple's or that the cases are Apple's.
const CASES_SEO_DEFAULTS = {
  title: 'Cases & Protection - iPhone Accessories | Gadzio Store',
  description:
    'Shop Gadzio protective cases for iPhone. Find MagSafe liquid silicone cases, crystal clear cases, and AeroWeave technical textile cases with military-grade drop defense.',
};

/* -------------------------------------------------------------- build */

const DEFAULTS: Record<string, Record<string, unknown>> = {
  /* Gadzio homepage */
  'apple.hero_tiles': APPLE_HERO_TILES_DEFAULTS,
  'apple.hero_video': APPLE_HERO_VIDEO_DEFAULTS,
  'apple.promo_section': APPLE_PROMO_DEFAULTS,
  'apple.ribbon': APPLE_RIBBON_DEFAULTS,
  'apple.locale_banner': APPLE_LOCALE_BANNER_DEFAULTS,
  'apple.nav': APPLE_NAV_DEFAULTS,
  'apple.footer': APPLE_FOOTER_DEFAULTS,
  'apple.gallery': APPLE_GALLERY_DEFAULTS,
  'apple.seo': APPLE_SEO_DEFAULTS,

  /* OPPO India */
  'oppo.announce': OPPO_ANNOUNCE_DEFAULTS,
  'oppo.nav': OPPO_NAV_DEFAULTS,
  'oppo.hero_slides': OPPO_HERO_SLIDES_DEFAULTS,
  'oppo.hot_sale': OPPO_HOT_SALE_DEFAULTS,
  'oppo.products': OPPO_PRODUCTS_DEFAULTS,
  'oppo.offers': OPPO_OFFERS_DEFAULTS,
  'oppo.explore': OPPO_EXPLORE_DEFAULTS,
  'oppo.support': OPPO_SUPPORT_DEFAULTS,
  'oppo.community': OPPO_COMMUNITY_DEFAULTS,
  'oppo.footer': OPPO_FOOTER_DEFAULTS,
  'oppo.seo': OPPO_SEO_DEFAULTS,

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
  'cases.products': CASES_PRODUCTS_DEFAULTS,
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
  'apple.hero_tiles': {
    heroTiles: HERO_TILES.map((tile) => responsiveImageCurrentArt(tile.image)),
  },
  'apple.hero_video': {
    ...responsiveImageCurrentArt(HERO_TILES[0].startFrame ?? null),
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
