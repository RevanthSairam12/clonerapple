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
 *   Apple homepage — data files under
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
  BTS_OFFERS,
  EDU_IN_ACTION,
  HERO as EDU_HERO,
  HOW_TO_BUY_STEPS,
  IPAD_PRODUCTS,
  MAC_PRODUCTS,
  SHOP_CATEGORIES,
} from '@/components/sites/edu-store/data/content';
import { PRODUCTS as CASES_PRODUCTS } from '@/components/sites/cases-protection/data/products';

/* ------------------------------------------------------------- helpers */

/** Apple tile → simplified editor shape (headline/subheadText/href/ctas + image size slots). */
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

/* ------------------------------------------------------ Apple homepage */

const APPLE_HERO_TILES_DEFAULTS = {
  heroTiles: HERO_TILES.map(tileOverride),
};

const APPLE_PROMO_DEFAULTS = {
  heading: 'Explore Accessories',
  promoTiles: PROMO_TILES.map(tileOverride),
};

const APPLE_RIBBON_DEFAULTS = {
  // Plain-text flattening of the hardcoded markup in Ribbon.tsx (the sup
  // footnote markers * and ‡ render as plain characters).
  text: 'Get up to 6 months of No Cost EMI* plus up to ₹15000 instant cashback‡ on selected products with eligible cards.',
  shopHref: 'https://www.apple.com/in/shop/goto/store',
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

const APPLE_SEO_DEFAULTS = {
  title: 'Apple',
  description:
    'Discover the innovative world of Apple and shop everything iPhone, iPad, Apple Watch, Mac, and Apple TV, plus explore accessories, entertainment, and expert device support.',
  ogTitle: 'Apple',
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

const EDU_HERO_DEFAULTS = {
  badge: EDU_HERO.badge,
  headline: EDU_HERO.headline,
  subhead: EDU_HERO.subhead,
  promoHeadline: EDU_HERO.promo.headline,
  promoOffer: EDU_HERO.promo.offer,
  promoDisclaimer: EDU_HERO.promo.disclaimer,
};

const EDU_BTS_OFFERS_DEFAULTS = {
  // Flat CTA paths, matching the field schema (ctaPrimaryLabel etc.).
  items: BTS_OFFERS.map((offer) => ({
    kicker: offer.kicker,
    headline: offer.headline,
    offer: offer.offer,
    upgradeNote: offer.upgradeNote,
    image: offer.image,
    ctaPrimaryLabel: offer.ctaPrimary.label,
    ctaPrimaryHref: offer.ctaPrimary.href,
    ctaSecondaryLabel: offer.ctaSecondary.label,
    ctaSecondaryHref: offer.ctaSecondary.href,
  })),
};

const EDU_MAC_PRODUCTS_DEFAULTS = {
  items: MAC_PRODUCTS.map((product) => ({
    name: product.name,
    descriptor: product.descriptor,
    chip: product.chip,
    price: product.price,
    priceNote: product.priceNote,
    image: product.image,
    buyHref: product.buyHref,
    learnHref: product.learnHref,
  })),
};

const EDU_IPAD_PRODUCTS_DEFAULTS = {
  items: IPAD_PRODUCTS.map((product) => ({
    name: product.name,
    descriptor: product.descriptor,
    chip: product.chip,
    price: product.price,
    priceNote: product.priceNote,
    image: product.image,
    buyHref: product.buyHref,
    learnHref: product.learnHref,
  })),
};

const EDU_SECTIONS_DEFAULTS = {
  mac: {
    eyebrow: 'Mac for Education',
    headline: 'Mac. Made for more.',
    subhead: 'The power of Apple silicon takes students further, faster.',
  },
  ipad: {
    eyebrow: 'iPad for Education',
    headline: 'iPad. The ultimate learning tool.',
    subhead: 'Versatile, powerful, and perfect with Apple Pencil.',
  },
  action: {
    eyebrow: 'Apple Education in Action',
    headline: 'Built for every kind of learner.',
    subhead: 'See how students across disciplines use Mac and iPad to go further.',
  },
  categories: {
    headline: 'Browse the Education Store.',
  },
};

const EDU_IN_ACTION_DEFAULTS = {
  items: EDU_IN_ACTION.map((item) => ({
    field: item.field,
    device: item.device,
    headline: item.headline,
    body: item.body,
    app: item.app,
  })),
};

const EDU_ELIGIBILITY_DEFAULTS = {
  headline: 'Who can shop the Education Store?',
  body: 'Apple Education Pricing is available to current and newly accepted college students, students’ parents, and teachers and staff at all grade levels.',
  // One tag per line (EligibilityBanner splits on newlines).
  tags: [
    'College Students',
    'Newly Accepted Students',
    'Parents of Students',
    'Teachers',
    'Faculty & Staff',
    'Homeschool Educators',
  ].join('\n'),
  ctaLabel: 'Verify my eligibility',
  ctaHref: 'https://www.apple.com/in-edu/store',
};

const EDU_HOW_TO_BUY_DEFAULTS = {
  eyebrow: 'Buying Guide',
  headline: 'How to buy with education savings.',
  // Flat link paths, matching the field schema (linkLabel / linkHref).
  steps: HOW_TO_BUY_STEPS.map((step) => ({
    step: step.step,
    headline: step.headline,
    body: step.body,
    linkLabel: step.link.label,
    linkHref: step.link.href,
  })),
};

const EDU_CATEGORIES_DEFAULTS = {
  items: SHOP_CATEGORIES.map((category) => ({
    label: category.label,
    icon: category.icon,
    href: category.href,
  })),
};

const EDU_SEO_DEFAULTS = {
  title: 'Apple Education Store India — Back to School 2026',
  description:
    'Shop Mac and iPad with Apple Education Pricing. Students, teachers, and educators get exclusive savings plus get AirPods with Mac and Apple Pencil Pro with iPad — for a limited time.',
};

/* -------------------------------------------------- Cases & Protection */

const CASES_CATEGORY_LINKS_DEFAULTS = {
  items: [
    { label: 'All Accessories', href: 'https://www.apple.com/in/shop/iphone/accessories' },
    { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection' },
    { label: 'MagSafe', href: 'https://www.apple.com/in/shop/iphone/accessories/magsafe' },
    { label: 'Power & Cables', href: 'https://www.apple.com/in/shop/iphone/accessories/power-cables' },
    { label: 'Audio', href: 'https://www.apple.com/in/shop/iphone/accessories/audio' },
    { label: 'AirTag', href: 'https://www.apple.com/in/shop/iphone/accessories/airtag' },
    { label: 'Stands & Mounts', href: 'https://www.apple.com/in/shop/iphone/accessories/stands-mounts' },
    { label: 'Health & Fitness', href: 'https://www.apple.com/in/shop/iphone/accessories/health-fitness' },
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

const CASES_SEO_DEFAULTS = {
  title: 'Cases & Protection - iPhone Accessories - Apple (IN)',
  description:
    'Shop iPhone cases and protection from Apple. Find MagSafe cases, silicone cases, clear cases, FineWoven cases and more for iPhone 17, iPhone 17 Pro, iPhone 16 and more.',
};

/* -------------------------------------------------------------- build */

const DEFAULTS: Record<string, Record<string, unknown>> = {
  /* Apple homepage */
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
  'edu.bts_offers': EDU_BTS_OFFERS_DEFAULTS,
  'edu.mac_products': EDU_MAC_PRODUCTS_DEFAULTS,
  'edu.ipad_products': EDU_IPAD_PRODUCTS_DEFAULTS,
  'edu.sections': EDU_SECTIONS_DEFAULTS,
  'edu.in_action': EDU_IN_ACTION_DEFAULTS,
  'edu.eligibility': EDU_ELIGIBILITY_DEFAULTS,
  'edu.how_to_buy': EDU_HOW_TO_BUY_DEFAULTS,
  'edu.categories': EDU_CATEGORIES_DEFAULTS,
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
