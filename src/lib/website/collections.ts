/**
 * Registry of every editable collection — the contract between the public
 * site (which reads via getContent) and the admin panel (which edits).
 *
 * Each entry declares:
 *   key        — the content_blocks key the site reads
 *   label      — shown in the admin UI
 *   site       — which public route(s) the content renders on ("view on site")
 *   fields     — a flat JSON-path field schema the generic editor renders
 *   lists      — item lists the editor can add to / remove from
 *   disablable — the whole section can be hidden from the page (enabled:false)
 *
 * Field paths are dot/bracket paths into the stored JSON value
 * (e.g. "items[0].title"). List itemFields paths are RELATIVE to one item
 * (e.g. "title" or "ctaPrimary.label"); the editor prefixes the list path
 * and index. The site consumes the stored value whole.
 */

import { SITE_FONT_NAMES } from '@/lib/fonts';

export type FieldType = 'text' | 'textarea' | 'image' | 'video' | 'url' | 'color' | 'boolean' | 'select';

export interface FieldSchema {
  /** JSON path into the collection value, e.g. "items[0].title" (or relative to a list item when part of ListSchema). */
  path: string;
  label: string;
  type: FieldType;
  /** Optional helper text under the input. */
  hint?: string;
  /**
   * Allowed values for `type: 'select'`. The editor renders these as a
   * dropdown, so a stored value can only ever be one of them — which is what
   * keeps settings that drive build-time behaviour (e.g. the site font, whose
   * faces are compiled in by `next/font`) from accepting free text.
   */
  options?: readonly string[];
}

/** A repeatable item list (tiles, products, slides…) the editor can grow/shrink. */
export interface ListSchema {
  /** JSON path of the array in the stored value, e.g. "promoTiles" or "steps". */
  path: string;
  /** Singular label shown on item cards, e.g. "Tile". */
  itemLabel: string;
  minItems: number;
  maxItems: number;
  /** Fields relative to one item, e.g. "headline" or "ctaPrimary.label". */
  itemFields: FieldSchema[];
}

export interface CollectionSchema {
  key: string;
  label: string;
  /** Public route(s) for the "view on site" link. */
  sitePaths: string[];
  description?: string;
  fields: FieldSchema[];
  /** Item lists the editor can add to / remove from. */
  lists?: ListSchema[];
  /** True when the whole section can be hidden from the page. */
  disablable?: boolean;
}

/* Helpers to build repetitive field sets concisely. */

const text = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'text',
  hint: hint ?? `Enter ${label.toLowerCase()}. Leave blank to keep the built-in default.`,
});
const area = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'textarea',
  hint: hint ?? `Enter ${label.toLowerCase()}. Leave blank to keep the built-in default.`,
});
const image = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'image',
  hint: hint ?? `Choose or upload an image for ${label.toLowerCase()} from the Media library.`,
});
const video = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'video',
  hint: hint ?? `Choose or upload a WebM or MP4 video for ${label.toLowerCase()}.`,
});
const url = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'url',
  hint: hint ?? `Enter a relative path (such as /shop/...) or a full https:// URL for ${label.toLowerCase()}.`,
});
const booleanField = (path: string, label: string, hint?: string): FieldSchema => ({
  path,
  label,
  type: 'boolean',
  hint: hint ?? `Turn on or off for ${label.toLowerCase()}.`,
});

/**
 * The art-directed image size slots, matching the site's <picture> breakpoints:
 * small (≤734px), medium (≤1068px), large (wider) — each with an optional @2x
 * retina variant. Plus imageSrc, the "one image at every size" shortcut.
 */
const RESPONSIVE_IMAGE_FIELDS = (prefix = ''): FieldSchema[] => [
  image(`${prefix}imageSrc`, 'Image (all sizes)', 'Upload one image and it is used at every breakpoint. Use the size fields below for crisper per-breakpoint art.'),
  image(`${prefix}imageSmallSrc`, 'Small (≤734px)'),
  image(`${prefix}imageSmall2xSrc`, 'Small @2x (retina)'),
  image(`${prefix}imageMediumSrc`, 'Medium (≤1068px)'),
  image(`${prefix}imageMedium2xSrc`, 'Medium @2x (retina)'),
  image(`${prefix}imageLargeSrc`, 'Large (>1068px)'),
  image(`${prefix}imageLarge2xSrc`, 'Large @2x (retina)'),
];

/* --------------------------------------------------------- Gadzio storefront */

/** One hero/promo tile (relative paths — prefixed by the editor). */
const TILE_ITEM_FIELDS: FieldSchema[] = [
  text('headline', 'Headline'),
  area('subheadText', 'Subhead', 'Plain text; footnote markers like * are rendered as text.'),
  text('href', 'Tile link'),
  ...([0, 1] as const).flatMap((c): FieldSchema[] => [
    text(`ctas[${c}].label`, `CTA ${c + 1} label`),
    url(`ctas[${c}].href`, `CTA ${c + 1} link`),
  ]),
  text('infoTooltip', 'Info note (optional)', 'Small (i) tooltip text shown below the CTAs.'),
  ...RESPONSIVE_IMAGE_FIELDS(),
];

const LINK_ITEM_FIELDS: FieldSchema[] = [
  text('label', 'Label'),
  url('href', 'Link'),
];

/** Retired keys are reserved for compatibility, not editable collections. */
export const LEGACY_COLLECTION_KEYS = [
  'oppo.announce', 'oppo.nav', 'oppo.hero_slides', 'oppo.hot_sale',
  'oppo.products', 'oppo.offers', 'oppo.explore', 'oppo.support',
  'oppo.community', 'oppo.footer', 'oppo.seo',
] as const;

/* ------------------------------------------------------------- Edu store */

/**
 * One store card, shared by the product nav and every shelf rail.
 * Cards override the hardcoded ones positionally, so leaving a field blank
 * keeps the value the site renders today.
 */
const EDU_CARD_ITEM_FIELDS: FieldSchema[] = [
  text('headline', 'Headline'),
  text('tag', 'Messaging tag', 'The small pill in the card corner, e.g. "New".'),
  area('desc', 'Description'),
  text('price', 'Price line', 'Shown small under the description, e.g. "From ₹137900.00".'),
  image('image', 'Image'),
  url('href', 'Link'),
  booleanField('dark', 'Dark card', 'Render the card on the dark background.'),
  booleanField('savingsBadge', 'Education savings badge', 'Show the savings icon in the top-right corner.'),
];

/** One shelf section: its headings plus the rail of cards inside it. */
function eduShelfSchema(
  key: string,
  label: string,
  description: string,
  itemLabel: string,
  maxItems: number,
): CollectionSchema {
  return {
    key,
    label,
    sitePaths: ['/in-edu/store'],
    description,
    fields: [
      text('headline', 'Section headline'),
      text('subhead', 'Section subhead'),
      booleanField('enabled', 'Show this section', 'Untick to hide the whole shelf from the page.'),
    ],
    lists: [
      { path: 'cards', itemLabel, minItems: 1, maxItems, itemFields: EDU_CARD_ITEM_FIELDS },
    ],
    disablable: true,
  };
}

/* ------------------------------------------------------------------ build */

const CROWD_FAVORITES_ITEM_FIELDS: FieldSchema[] = [
  text('productId', 'Catalog product'),
  text('badge', 'Primary Badge (e.g. LIMITED RELEASE, ⚡ NEW, TRENDING)'),
  text('badgeColor', 'Badge Style', 'lavender, yellow, green, or default'),
  text('secondaryBadge', 'Secondary Badge (optional)', 'e.g. TOP ITEM, BESTSELLER'),
  text('secondaryBadgeColor', 'Secondary Badge Style', 'pink, yellow, green, or default'),
];

export const COLLECTIONS: CollectionSchema[] = [
  /* — Gadzio homepage (route: /) — */
  {
    key: 'gadzio.reviews',
    label: 'Homepage — Customer Reviews & Star Rating',
    sitePaths: ['/'],
    description: 'The 4.9 average star rating block with verified customer testimonial cards.',
    fields: [
      booleanField('enabled', 'Show reviews section', 'Untick to hide the reviews section from the homepage.'),
      text('kicker', 'Top Kicker', 'e.g. LOVED BY CREATORS & CUSTOMERS'),
      text('heading', 'Headline', 'e.g. 4.9 Average Star Rating'),
      area('subheading', 'Subheading', 'Short intro statement under the headline.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Review Card',
        minItems: 1,
        maxItems: 9,
        itemFields: [
          text('headline', 'Review Title', 'e.g. CrystalArmor Case is unbelievable!'),
          area('content', 'Review Content', 'Customer quote or testimonial feedback.'),
          text('author', 'Author Name', 'e.g. Aarav M.'),
          text('badgeText', 'Badge Text', 'e.g. Verified Buyer'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.in_the_wild',
    label: 'Homepage — Gadzio in the Wild (Community Gallery)',
    sitePaths: ['/'],
    description: 'The community photo carousel showcasing creators and customers using Gadzio gear.',
    fields: [
      booleanField('enabled', 'Show community gallery', 'Untick to hide this section from the homepage.'),
      text('heading', 'Headline', 'e.g. Gadzio in the Wild'),
      text('subheading', 'Subheading', 'Call to action for tagging photos on social media.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Community Photo',
        minItems: 1,
        maxItems: 18,
        itemFields: [
          image('image', 'Photo'),
          text('alt', 'Accessibility Label', 'Describe what is shown in the photo.'),
          text('caption', 'Hover Caption (optional)', 'Short description or user handle.'),
          url('href', 'Link (optional)'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.brand_bar',
    label: 'Homepage — Brand Logos Bar',
    sitePaths: ['/'],
    description: 'The horizontal Gadzio brand wordmarks/logos strip. Wordmarks are fixed in code; brand links are editable.',
    fields: [
      booleanField('enabled', 'Show brand bar', 'Untick to hide the brand logos strip.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Brand Logo',
        minItems: 1,
        maxItems: 12,
        itemFields: [
          url('href', 'Brand link (optional)'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.diwali_campaign',
    label: 'Homepage — Diwali Festive Campaign',
    sitePaths: ['/'],
    description: 'The festive Diwali feature banner and limited release product carousel.',
    fields: [
      booleanField('enabled', 'Show Diwali campaign', 'Untick to hide this section.'),
      text('bannerKicker', 'Banner Kicker', 'e.g. DIWALI 2026'),
      text('bannerTitle', 'Banner Headline', 'e.g. ARE YOU READY?'),
      text('bannerButtonLabel', 'Button Label', 'e.g. SHOP DIWALI'),
      url('bannerButtonHref', 'Button Link'),
      image('bannerImage', 'Banner Background Image (optional)', 'Leave blank for the built-in Diwali glowing lights backdrop.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Festive Product',
        minItems: 4,
        maxItems: 4,
        itemFields: [
          text('productId', 'Catalog product'),
          text('tagPrimary', 'Primary Tag (optional)', 'e.g. LIMITED RELEASE'),
          text('tagSecondary', 'Secondary Tag (optional)', 'e.g. ⚡ NEW'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.trust_badges',
    label: 'Homepage — Trust Badges Bar',
    sitePaths: ['/'],
    description: 'The 3 value proposition / trust badges directly below the hero section.',
    fields: [
      booleanField('enabled', 'Show trust badges bar', 'Untick to hide this strip from the homepage.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Badge',
        minItems: 1,
        maxItems: 6,
        itemFields: [
          text('title', 'Badge Title', 'e.g. FREE SHIPPING OVER ₹999 or 30-DAY RETURNS'),
          text('subtitle', 'Badge Subtitle (optional)', 'Small helper text under the badge title'),
          text('icon', 'Icon Type', 'One of: shipping, returns, heart, genuine, shield'),
          url('href', 'Badge link (optional)'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.category_grid',
    label: 'Homepage — 4-Column Category Grid',
    sitePaths: ['/'],
    description: 'The prominent 4-column category photo cards.',
    fields: [
      text('heading', 'Section heading (optional)', 'Shown above the category cards if provided.'),
      booleanField('enabled', 'Show category grid', 'Untick to hide this section from the homepage.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Category Card',
        minItems: 1,
        maxItems: 8,
        itemFields: [
          text('title', 'Category Title', 'e.g. CASES, CHARGERS, AUDIO, ACCESSORIES'),
          text('subtitle', 'Subtitle (optional)'),
          image('image', 'Card Photo', 'High-res image filling the card'),
          url('href', 'Card Link'),
          text('badge', 'Badge (optional)', 'Small pill on top-left of card (e.g. NEW, POPULAR)'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.crowd_favorites',
    label: 'Homepage — The Crowd Favorites',
    sitePaths: ['/'],
    description: 'The horizontal product slider showcasing bestsellers and customer favorites with badges and swatches.',
    fields: [
      text('heading', 'Section heading', 'Defaults to "The Crowd Favorites"'),
      text('subtitle', 'Section subtitle', 'Defaults to "See what everyone is adding to their cart right now."'),
      text('rightLinkLabel', 'Right link label', 'Defaults to "SHOP BEST SELLERS"'),
      url('rightLinkHref', 'Right link destination'),
      booleanField('enabled', 'Show Crowd Favorites section', 'Untick to hide this section from the homepage.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Product Card',
        minItems: 6,
        maxItems: 6,
        itemFields: CROWD_FAVORITES_ITEM_FIELDS,
      },
    ],
    disablable: true,
  },
  {
    key: 'gadzio.event_banner',
    label: 'Homepage — Feature Spotlight Banner',
    sitePaths: ['/'],
    description: 'The high-impact dark promotional banner directly below Crowd Favorites.',
    fields: [
      text('heading', 'Banner heading', 'Defaults to "The Flagship Drop Of The Year"'),
      area('subtitle', 'Banner subtitle', 'Defaults to "Order now to get the limited edition—available on the first batch only!"'),
      text('ctaLabel', 'CTA button label', 'Defaults to "SHOP THE DROP"'),
      url('ctaHref', 'CTA link destination'),
      image('image', 'Feature Image', 'High-impact image of the featured product or showcase'),
      booleanField('enabled', 'Show Feature Banner', 'Untick to hide this banner from the homepage.'),
    ],
    disablable: true,
  },
  /* — Gadzio homepage (route: /) — */
  {
    key: 'gadzio.hero_tiles',
    label: 'Homepage — Hero Tiles (New UI)',
    sitePaths: ['/'],
    description: 'New UI homepage showcase hero tiles positioned above the Diwali campaign and Crowd Favorites.',
    fields: [
      booleanField('enabled', 'Show Hero Tiles section', 'Untick to hide this section from the new homepage.'),
    ],
    lists: [
      { path: 'heroTiles', itemLabel: 'Hero tile', minItems: 1, maxItems: 6, itemFields: TILE_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'apple.hero_tiles',
    label: 'Homepage — Hero Tiles (Old UI only)',
    sitePaths: ['/'],
    description: 'Old UI only: the full-width tiles at the top of the classic homepage.',
    fields: [],
    lists: [
      { path: 'heroTiles', itemLabel: 'Hero tile', minItems: 1, maxItems: 6, itemFields: TILE_ITEM_FIELDS },
    ],
  },
  {
    key: 'apple.hero_video',
    label: 'Homepage — Hero Video Stage (Old UI only)',
    sitePaths: ['/'],
    description: 'Old UI only: the motion inside the first hero tile (Back to School). Hidden by default; enable to show the video stage.',
    fields: RESPONSIVE_IMAGE_FIELDS(),
    lists: [
      {
        path: 'clips',
        itemLabel: 'Video clip',
        minItems: 0,
        maxItems: 3,
        itemFields: [
          video('src', 'Video (WebM or MP4)'),
          text('left', 'Left position (px)', 'Distance from the stage edge. Blank keeps the original.'),
          text('width', 'Width (px)', 'Render width. Blank keeps the original.'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'apple.promo_section',
    label: 'Homepage — Promo Grid',
    sitePaths: ['/'],
    description: 'The "Explore Accessories" heading and the promo tiles.',
    fields: [text('heading', 'Section heading')],
    lists: [
      { path: 'promoTiles', itemLabel: 'Promo tile', minItems: 1, maxItems: 12, itemFields: TILE_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'apple.ribbon',
    label: 'Homepage — Promo Ribbon',
    sitePaths: ['/'],
    description: 'The EMI/cashback strip under the navigation.',
    fields: [
      area('text', 'Ribbon text'),
      url('shopHref', '"Shop" link'),
    ],
    disablable: true,
  },
  {
    key: 'apple.locale_banner',
    label: 'Homepage — Locale Banner (not shown)',
    sitePaths: ['/'],
    description: 'Not currently shown: bannerVisible starts false and is never enabled in the storefront UI.',
    fields: [
      area('copy', 'Banner copy'),
      text('selectedLabel', 'Selected region label'),
      text('continueLabel', 'Continue button label'),
      url('continueHref', 'Continue link'),
    ],
    disablable: true,
  },
  {
    key: 'apple.nav',
    label: 'Homepage — Navigation',
    sitePaths: ['/'],
    description: 'Homepage overrides only. Education and Cases do not receive these overrides. Built-in menu items use fixed links; their text is label only.',
    fields: [text('searchPlaceholder', 'Search placeholder')],
    lists: [
      { path: 'items', itemLabel: 'Nav item', minItems: 1, maxItems: 14, itemFields: [
        text('label', 'Label'),
        { ...url('href', 'Link (fixed for built-in menus)'), hint: 'Label only — link fixed for built-in items. Custom items use this link.' },
      ] },
    ],
  },
  {
    key: 'apple.footer',
    label: 'Homepage — Footer',
    sitePaths: ['/'],
    description: 'Homepage footer copyright and locale link only. Theme copyright, when set, overrides this copyright on the homepage. Other pages do not receive these overrides.',
    fields: [
      text('copyright', 'Copyright line'),
      text('localeLabel', 'Locale link label'),
      url('localeHref', 'Locale link'),
    ],
  },
  {
    key: 'apple.gallery',
    label: 'Homepage — Services Gallery',
    sitePaths: ['/'],
    description: 'The services gallery carousel copy and layout. Hidden by default when no override is saved.',
    fields: [
      booleanField('secondRowEnabled', 'Second row (smaller cards)', 'Enable or disable the second row of smaller media cards.'),
    ],
    lists: [
      {
        path: 'items',
        itemLabel: 'Gallery card',
        minItems: 1,
        maxItems: 16,
        itemFields: [
          text('title', 'Caption'),
          ...RESPONSIVE_IMAGE_FIELDS(),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'apple.seo',
    label: 'Homepage — SEO',
    sitePaths: ['/'],
    fields: [
      text('title', 'Page title'),
      area('description', 'Meta description'),
      text('ogTitle', 'Open Graph title'),
    ],
  },

  /* — Education store (route: /in-edu/store) — */
  {
    key: 'edu.hero',
    label: 'Edu Store — Hero',
    sitePaths: ['/in-edu/store'],
    description: 'Not currently rendered: EduHero is commented out in EduStorePage. Fields and saved data are retained unchanged.',
    fields: [
      text('headline', 'Headline', 'Rendered on the highlight pill.'),
      text('subhead', 'Subhead', 'Always reads "College, …" — only the part after the comma is editable.'),
    ],
  },
  {
    key: 'edu.product_nav',
    label: 'Edu Store — Product Nav',
    sitePaths: ['/in-edu/store'],
    description: 'The row of product categories directly under the hero.',
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'Category', minItems: 1, maxItems: 14, itemFields: EDU_CARD_ITEM_FIELDS },
    ],
  },
  eduShelfSchema(
    'edu.shelf_savings',
    'Edu Store — Education Savings',
    '"Education savings." — the main rail of education-priced products.',
    'Product',
    20,
  ),
  eduShelfSchema(
    'edu.shelf_ways_to_save',
    'Edu Store — Additional Ways to Save',
    '"Additional ways to save." — trade-in, financing and other saving routes.',
    'Card',
    8,
  ),
  eduShelfSchema(
    'edu.shelf_difference',
    'Edu Store — The Gadzio Store Difference',
    '"The Gadzio Store difference." — the reasons-to-shop-with-us rail.',
    'Card',
    8,
  ),
  eduShelfSchema(
    'edu.shelf_accessories',
    'Edu Store — Accessories',
    '"Accessories." — campus-ready essentials.',
    'Accessory',
    6,
  ),
  eduShelfSchema(
    'edu.shelf_potential',
    'Edu Store — Endless Potential',
    '"Endless potential." — teaching and learning resources.',
    'Card',
    8,
  ),
  eduShelfSchema(
    'edu.shelf_more_to_love',
    'Edu Store — More to Love',
    '"More to love." — further products at education pricing.',
    'Product',
    14,
  ),
  eduShelfSchema(
    'edu.shelf_experience',
    'Edu Store — The Gadzio Experience',
    '"The Gadzio experience." — apps and services.',
    'Card',
    8,
  ),
  {
    key: 'edu.quick_links',
    label: 'Edu Store — Quick Links',
    sitePaths: ['/in-edu/store'],
    description: 'The pill buttons in the Quick Links strip at the foot of the page.',
    fields: [],
    lists: [
      {
        path: 'items',
        itemLabel: 'Link',
        minItems: 1,
        maxItems: 10,
        itemFields: [text('label', 'Label'), url('href', 'Link')],
      },
    ],
  },
  {
    key: 'edu.seo',
    label: 'Edu Store — SEO',
    sitePaths: ['/in-edu/store'],
    fields: [
      text('title', 'Page title'),
      area('description', 'Meta description'),
    ],
  },

  /* — Cases & Protection (route: /in/shop/iphone/accessories/cases-protection) — */
  {
    key: 'cases.category_links',
    label: 'Cases — Category Links',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection', '/shop/iphone/accessories/cases-protection'],
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'Link', minItems: 1, maxItems: 14, itemFields: LINK_ITEM_FIELDS },
    ],
  },
  {
    key: 'cases.page_header',
    label: 'Cases — Page Header',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection', '/shop/iphone/accessories/cases-protection'],
    fields: [
      text('title', 'Page title'),
    ],
  },
  {
    key: 'cases.seo',
    label: 'Cases — SEO',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection'],
    description: 'Metadata for /in/shop/iphone/accessories/cases-protection only. The /shop/iphone/accessories/cases-protection route uses static metadata and does not read this collection.',
    fields: [
      text('title', 'Page title'),
      area('description', 'Meta description'),
    ],
  },
];

/** Site-wide settings edited on the Theme page (site_settings table). */
export const THEME_FIELDS: FieldSchema[] = [
  {
    path: 'homepageUiMode',
    label: 'Storefront UI Version',
    type: 'select',
    options: ['new', 'old'],
    hint: 'Switch between Modern Gadzio UI (hero + trust bar + category grid) and Old UI (classic showcase layout).',
  },
  {
    path: 'fontFamily',
    label: 'Font family',
    type: 'select',
    // The allow-list is the whole point: these faces are compiled in by
    // `next/font` at build time and self-hosted, so an arbitrary family name
    // has nothing to resolve to. The editor is a dropdown rather than a text
    // box so a value that cannot be loaded can't be entered.
    options: SITE_FONT_NAMES,
    hint: 'Affects global text; some homepage sections set their own face (including transducer). Self-hosted — no external font requests are made, and any other value falls back to the default.',
  },
  {
    path: 'appleCopyright',
    label: 'Homepage footer copyright (override)',
    type: 'text',
    hint: 'Leave empty to use the copyright from the Footer content section. When set, replaces it on the homepage only.',
  },
];

export function getCollection(key: string): CollectionSchema | undefined {
  return COLLECTIONS.find((c) => c.key === key);
}

export function getCollectionsBySite(sitePathPrefix: string): CollectionSchema[] {
  return COLLECTIONS.filter((c) => c.sitePaths.some((p) => p.startsWith(sitePathPrefix)));
}
