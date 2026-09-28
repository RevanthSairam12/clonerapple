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

export type FieldType = 'text' | 'textarea' | 'image' | 'video' | 'url' | 'color' | 'boolean';

export interface FieldSchema {
  /** JSON path into the collection value, e.g. "items[0].title" (or relative to a list item when part of ListSchema). */
  path: string;
  label: string;
  type: FieldType;
  /** Optional helper text under the input. */
  hint?: string;
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

const text = (path: string, label: string, hint?: string): FieldSchema => ({ path, label, type: 'text', hint });
const area = (path: string, label: string, hint?: string): FieldSchema => ({ path, label, type: 'textarea', hint });
const image = (path: string, label: string, hint?: string): FieldSchema => ({ path, label, type: 'image', hint });
const video = (path: string, label: string, hint?: string): FieldSchema => ({ path, label, type: 'video', hint });
const url = (path: string, label: string): FieldSchema => ({ path, label, type: 'url' });
const booleanField = (path: string, label: string, hint?: string): FieldSchema => ({ path, label, type: 'boolean', hint });

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

/* ------------------------------------------------------------- Apple site */

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

/* -------------------------------------------------------------- OPPO site */

const OPPO_SLIDE_ITEM_FIELDS: FieldSchema[] = [
  text('title', 'Title'),
  text('subtitle', 'Subtitle'),
  image('image', 'Image'),
  url('learnMoreHref', 'Learn More link'),
  url('buyNowHref', 'Buy Now link'),
];

const OPPO_PRODUCT_ITEM_FIELDS: FieldSchema[] = [
  text('title', 'Title'),
  text('titleSup', 'Superscript'),
  image('image', 'Image', 'Leave blank to keep the stylised placeholder.'),
  area('descriptions', 'Descriptions (one per line)'),
  url('learnHref', 'Learn more link'),
  url('buyHref', 'Buy now link'),
];

const CARD_ITEM_FIELDS: FieldSchema[] = [
  text('title', 'Title'),
  area('description', 'Description'),
  image('image', 'Image'),
  url('href', 'Link'),
];

/* ------------------------------------------------------------- Edu store */

const EDU_PRODUCT_ITEM_FIELDS: FieldSchema[] = [
  text('name', 'Name'),
  text('descriptor', 'Descriptor'),
  text('chip', 'Chip line'),
  text('price', 'Price'),
  text('priceNote', 'Price note'),
  image('image', 'Image'),
  url('buyHref', 'Buy link'),
  url('learnHref', 'Learn more link'),
];

/* ------------------------------------------------------------------ build */

export const COLLECTIONS: CollectionSchema[] = [
  /* — Apple homepage (route: /) — */
  {
    key: 'apple.hero_tiles',
    label: 'Homepage — Hero Tiles',
    sitePaths: ['/'],
    description: 'The full-width tiles at the top of the homepage.',
    fields: [],
    lists: [
      { path: 'heroTiles', itemLabel: 'Hero tile', minItems: 1, maxItems: 6, itemFields: TILE_ITEM_FIELDS },
    ],
  },
  {
    key: 'apple.hero_video',
    label: 'Homepage — Hero Video Stage',
    sitePaths: ['/'],
    description: 'The motion inside the first hero tile (Back to School): poster image + up to three autoplaying video clips.',
    fields: RESPONSIVE_IMAGE_FIELDS(),
    lists: [
      {
        path: 'clips',
        itemLabel: 'Video clip',
        minItems: 0,
        maxItems: 3,
        itemFields: [
          text('label', 'Clip name', 'For reference only.'),
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
    label: 'Homepage — Locale Banner',
    sitePaths: ['/'],
    description: 'The "Choose another country or region" banner.',
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
    label: 'Global Nav (all Apple pages)',
    sitePaths: ['/', '/in-edu/store', '/in/shop/iphone/accessories/cases-protection'],
    description: 'Labels of the top navigation items (shared by every Apple-style page).',
    fields: [text('searchPlaceholder', 'Search placeholder')],
    lists: [
      { path: 'items', itemLabel: 'Nav item', minItems: 1, maxItems: 14, itemFields: LINK_ITEM_FIELDS },
    ],
  },
  {
    key: 'apple.footer',
    label: 'Global Footer (all Apple pages)',
    sitePaths: ['/', '/in-edu/store', '/in/shop/iphone/accessories/cases-protection'],
    description: 'Footer directory headings/links and the bottom legal row.',
    fields: [
      area('footnotesHtml', 'Footnotes (HTML)'),
      text('copyright', 'Copyright line'),
      text('localeLabel', 'Locale link label'),
      url('localeHref', 'Locale link'),
    ],
  },
  {
    key: 'apple.gallery',
    label: 'Homepage — Entertainment Gallery',
    sitePaths: ['/'],
    description: 'The Apple TV / Music gallery carousel copy and layout.',
    fields: [
      text('heading', 'Section heading', 'Not currently displayed by the site; kept for future use.'),
      booleanField('secondRowEnabled', 'Second row (Music / Arcade / Fitness+)', 'Enable or disable the second row of smaller entertainment cards.'),
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

  /* — OPPO India (route: /android) — */
  {
    key: 'oppo.announce',
    label: 'OPPO — Announcement Bar',
    sitePaths: ['/android'],
    fields: [
      text('text', 'Announcement text'),
      text('linkLabel', 'Link label'),
      url('linkHref', 'Link'),
    ],
    disablable: true,
  },
  {
    key: 'oppo.nav',
    label: 'OPPO — Navigation',
    sitePaths: ['/android'],
    fields: [text('logoText', 'Logo text')],
    lists: [
      { path: 'leftLinks', itemLabel: 'Left nav link', minItems: 0, maxItems: 10, itemFields: LINK_ITEM_FIELDS },
      { path: 'rightLinks', itemLabel: 'Right nav link', minItems: 0, maxItems: 10, itemFields: LINK_ITEM_FIELDS },
    ],
  },
  {
    key: 'oppo.hero_slides',
    label: 'OPPO — Hero Carousel',
    sitePaths: ['/android'],
    fields: [],
    lists: [
      { path: 'slides', itemLabel: 'Slide', minItems: 1, maxItems: 8, itemFields: OPPO_SLIDE_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'oppo.hot_sale',
    label: 'OPPO — Hot Sale Card',
    sitePaths: ['/android'],
    fields: [
      text('badge', 'Badge'),
      text('title', 'Product title'),
      area('tagline', 'Tagline'),
      image('image', 'Product image'),
      text('learnLabel', 'Learn more label'),
      text('buyLabel', 'Buy now label'),
    ],
    disablable: true,
  },
  {
    key: 'oppo.products',
    label: 'OPPO — Product Grid',
    sitePaths: ['/android'],
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'Product', minItems: 1, maxItems: 16, itemFields: OPPO_PRODUCT_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'oppo.offers',
    label: 'OPPO — Offers Section',
    sitePaths: ['/android'],
    fields: [text('heading', 'Section heading')],
    lists: [
      { path: 'items', itemLabel: 'Offer', minItems: 1, maxItems: 8, itemFields: CARD_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'oppo.explore',
    label: 'OPPO — Explore Carousel',
    sitePaths: ['/android'],
    fields: [text('heading', 'Section heading')],
    lists: [
      { path: 'items', itemLabel: 'Card', minItems: 1, maxItems: 12, itemFields: CARD_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'oppo.support',
    label: 'OPPO — Support Links',
    sitePaths: ['/android'],
    fields: [text('heading', 'Section heading')],
    lists: [
      { path: 'items', itemLabel: 'Link', minItems: 0, maxItems: 12, itemFields: [text('', 'Label')] },
    ],
    disablable: true,
  },
  {
    key: 'oppo.community',
    label: 'OPPO — Community Section',
    sitePaths: ['/android'],
    fields: [
      text('heading', 'Section heading'),
      text('viewAllLabel', '"View all" label'),
      area('tagline', 'Tagline'),
    ],
    lists: [
      {
        path: 'cards',
        itemLabel: 'Card',
        minItems: 1,
        maxItems: 6,
        itemFields: [
          text('title', 'Title'),
          area('subtitle', 'Subtitle'),
          image('image', 'Card image', 'Replaces the gradient placeholder. Leave blank to keep it.'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'oppo.footer',
    label: 'OPPO — Footer',
    sitePaths: ['/android'],
    fields: [
      area('disclaimer1', 'Disclaimer line 1'),
      area('disclaimer2', 'Disclaimer line 2'),
      area('disclaimer3', 'Disclaimer line 3'),
      text('tagline', 'Footer tagline'),
    ],
  },
  {
    key: 'oppo.seo',
    label: 'OPPO — SEO',
    sitePaths: ['/android'],
    fields: [
      text('title', 'Page title'),
      area('description', 'Meta description'),
    ],
  },

  /* — Education store (route: /in-edu/store) — */
  {
    key: 'edu.hero',
    label: 'Edu Store — Hero',
    sitePaths: ['/in-edu/store'],
    fields: [
      text('badge', 'Badge'),
      text('headline', 'Headline'),
      area('subhead', 'Subhead'),
      text('promoHeadline', 'Promo box headline'),
      area('promoOffer', 'Promo box offer'),
      area('promoDisclaimer', 'Promo box disclaimer'),
    ],
  },
  {
    key: 'edu.bts_offers',
    label: 'Edu Store — Back to School Offers',
    sitePaths: ['/in-edu/store'],
    fields: [],
    lists: [
      {
        path: 'items',
        itemLabel: 'Offer',
        minItems: 1,
        maxItems: 6,
        itemFields: [
          text('kicker', 'Kicker'),
          text('headline', 'Headline'),
          area('offer', 'Offer text'),
          area('upgradeNote', 'Upgrade note'),
          image('image', 'Image'),
          text('ctaPrimaryLabel', 'Primary CTA label'),
          url('ctaPrimaryHref', 'Primary CTA link'),
          text('ctaSecondaryLabel', 'Secondary CTA label'),
          url('ctaSecondaryHref', 'Secondary CTA link'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'edu.mac_products',
    label: 'Edu Store — Mac Products',
    sitePaths: ['/in-edu/store'],
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'Mac', minItems: 1, maxItems: 8, itemFields: EDU_PRODUCT_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'edu.ipad_products',
    label: 'Edu Store — iPad Products',
    sitePaths: ['/in-edu/store'],
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'iPad', minItems: 1, maxItems: 8, itemFields: EDU_PRODUCT_ITEM_FIELDS },
    ],
    disablable: true,
  },
  {
    key: 'edu.sections',
    label: 'Edu Store — Section Headings',
    sitePaths: ['/in-edu/store'],
    fields: [
      text('mac.eyebrow', 'Mac section eyebrow'),
      text('mac.headline', 'Mac section headline'),
      area('mac.subhead', 'Mac section subhead'),
      text('ipad.eyebrow', 'iPad section eyebrow'),
      text('ipad.headline', 'iPad section headline'),
      area('ipad.subhead', 'iPad section subhead'),
      text('action.eyebrow', 'Education in Action eyebrow'),
      text('action.headline', 'Education in Action headline'),
      area('action.subhead', 'Education in Action subhead'),
      text('categories.headline', 'Browse categories headline'),
    ],
  },
  {
    key: 'edu.in_action',
    label: 'Edu Store — Education in Action',
    sitePaths: ['/in-edu/store'],
    fields: [],
    lists: [
      {
        path: 'items',
        itemLabel: 'Card',
        minItems: 1,
        maxItems: 8,
        itemFields: [
          text('field', 'Field'),
          text('device', 'Device'),
          text('headline', 'Headline'),
          area('body', 'Body'),
          text('app', 'App pill'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'edu.eligibility',
    label: 'Edu Store — Eligibility Banner',
    sitePaths: ['/in-edu/store'],
    fields: [
      text('headline', 'Headline'),
      area('body', 'Body copy'),
      area('tags', 'Eligibility tags (one per line)'),
      text('ctaLabel', 'CTA label'),
      url('ctaHref', 'CTA link'),
    ],
    disablable: true,
  },
  {
    key: 'edu.how_to_buy',
    label: 'Edu Store — How to Buy Steps',
    sitePaths: ['/in-edu/store'],
    fields: [
      text('eyebrow', 'Eyebrow'),
      text('headline', 'Headline'),
    ],
    lists: [
      {
        path: 'steps',
        itemLabel: 'Step',
        minItems: 1,
        maxItems: 6,
        itemFields: [
          text('step', 'Step number'),
          text('headline', 'Headline'),
          area('body', 'Body'),
          text('linkLabel', 'Link label'),
          url('linkHref', 'Link URL'),
        ],
      },
    ],
    disablable: true,
  },
  {
    key: 'edu.categories',
    label: 'Edu Store — Shop Categories',
    sitePaths: ['/in-edu/store'],
    fields: [],
    lists: [
      {
        path: 'items',
        itemLabel: 'Category',
        minItems: 1,
        maxItems: 14,
        itemFields: [
          text('label', 'Label'),
          text('icon', 'Icon (emoji)'),
          url('href', 'Link'),
        ],
      },
    ],
    disablable: true,
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
    sitePaths: ['/in/shop/iphone/accessories/cases-protection'],
    fields: [],
    lists: [
      { path: 'items', itemLabel: 'Link', minItems: 1, maxItems: 14, itemFields: LINK_ITEM_FIELDS },
    ],
  },
  {
    key: 'cases.page_header',
    label: 'Cases — Page Header',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection'],
    fields: [
      text('title', 'Page title'),
      text('sortLabel', 'Sort label'),
    ],
  },
  {
    key: 'cases.products',
    label: 'Cases — Product Catalog',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection'],
    description: 'The cases in the grid. Blank fields keep the current value.',
    fields: [],
    lists: [
      {
        path: 'items',
        itemLabel: 'Product',
        minItems: 1,
        maxItems: 24,
        itemFields: [
          text('name', 'Name'),
          text('subtitle', 'Subtitle / colour'),
          text('price', 'Price (₹, numbers only)', 'Used for sorting; keep in sync with the display price.'),
          text('priceDisplay', 'Display price', 'Shown in the grid, e.g. ₹5,900.00.'),
          image('image', 'Image'),
          text('badge', 'Badge', 'e.g. "New". Leave blank for no badge.'),
          url('href', 'Product page link'),
        ],
      },
    ],
  },
  {
    key: 'cases.seo',
    label: 'Cases — SEO',
    sitePaths: ['/in/shop/iphone/accessories/cases-protection'],
    fields: [
      text('title', 'Page title'),
      area('description', 'Meta description'),
    ],
  },
];

/** Site-wide settings edited on the Theme page (site_settings table). */
export const THEME_FIELDS: FieldSchema[] = [
  { path: 'fontFamily', label: 'Font family', type: 'text', hint: 'CSS font-family value, e.g. "Inter" or "Poppins". Loaded from Google Fonts automatically.' },
  { path: 'logoText', label: 'Logo text (OPPO nav)', type: 'text', hint: 'Text shown as the OPPO nav logo.' },
  { path: 'appleCopyright', label: 'Apple footer copyright', type: 'text' },
  { path: 'oppoPrimaryColor', label: 'OPPO primary color', type: 'color' },
  { path: 'oppoGreenDark', label: 'OPPO dark green', type: 'color' },
  { path: 'oppoGreenLight', label: 'OPPO light green', type: 'color' },
];

export function getCollection(key: string): CollectionSchema | undefined {
  return COLLECTIONS.find((c) => c.key === key);
}

export function getCollectionsBySite(sitePathPrefix: string): CollectionSchema[] {
  return COLLECTIONS.filter((c) => c.sitePaths.some((p) => p.startsWith(sitePathPrefix)));
}
