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

export const COLLECTIONS: CollectionSchema[] = [
  /* — Gadzio homepage (route: /) — */
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
    label: 'Global Nav (all storefront pages)',
    sitePaths: ['/', '/in-edu/store', '/in/shop/iphone/accessories/cases-protection'],
    description: 'Labels of the top navigation items (shared by every storefront page).',
    fields: [text('searchPlaceholder', 'Search placeholder')],
    lists: [
      { path: 'items', itemLabel: 'Nav item', minItems: 1, maxItems: 14, itemFields: LINK_ITEM_FIELDS },
    ],
  },
  {
    key: 'apple.footer',
    label: 'Global Footer (all storefront pages)',
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
    label: 'Homepage — Services Gallery',
    sitePaths: ['/'],
    description: 'The services gallery carousel copy and layout.',
    fields: [
      text('heading', 'Section heading', 'Not currently displayed by the site; kept for future use.'),
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
    description: 'The headline over the animated header artwork.',
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
  {
    path: 'fontFamily',
    label: 'Font family',
    type: 'select',
    // The allow-list is the whole point: these faces are compiled in by
    // `next/font` at build time and self-hosted, so an arbitrary family name
    // has nothing to resolve to. The editor is a dropdown rather than a text
    // box so a value that cannot be loaded can't be entered.
    options: SITE_FONT_NAMES,
    hint: 'Site-wide typeface. Self-hosted — no external font requests are made, and any other value falls back to the default.',
  },
  { path: 'logoText', label: 'Logo text (OPPO nav)', type: 'text', hint: 'Text shown as the OPPO nav logo.' },
  { path: 'appleCopyright', label: 'Storefront footer copyright', type: 'text' },
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
