// Content for the Gadzio Education Store (India).
// Route: /in-edu/store
//
// De-branded: product names, services, and taglines are Gadzio's own. The
// layout mirrors a typical education storefront, but no Apple-owned mark is
// used as display copy. Every card destination is an in-app Gadzio route —
// see the note at the foot of this file.
//
// NOTE: the admin panel may override any of this at runtime; see
// src/lib/admin/defaults.ts and src/lib/admin/collections.ts.

export interface EduCard {
  id: string;
  headline: string;
  tag?: string;
  desc?: string;
  price?: string;
  href: string;
  image: string;
  dark?: boolean;
  savingsBadge?: boolean;
}

export interface EduShelf {
  id: string;
  headline: string;
  subhead: string;
  cols: 40 | 50;
  cards: EduCard[];
}

/**
 * One of the jiggling stickers in the hero. Each ships as a horizontal sprite
 * sheet, so the sticker is animated by stepping the background across `frames`
 * columns rather than by swapping images.
 */
export interface EduHeroSprite {
  src: string;
  /** Sheet width ÷ frame width (all frames are square). */
  frames: number;
  /** Which stage position the sticker occupies, 1–5. */
  slot: number;
  /** Seconds for one full loop. */
  duration: number;
}

export const HERO = {
  headline: 'Education Store',
  subhead: 'College, sorted.',
  backgroundImage: '/sites/edu-store/images/edu-header-background-202606.png',
  sprites: [
    { src: '/sites/edu-store/images/edu-header-icon-sprite-burst-pink-202606.png', frames: 8, slot: 1, duration: 0.9 },
    { src: '/sites/edu-store/images/edu-header-icon-sprite-burst-yellow-202606.png', frames: 8, slot: 2, duration: 0.9 },
    { src: '/sites/edu-store/images/edu-header-icon-sprite-cap-202606.png', frames: 10, slot: 3, duration: 1.1 },
    { src: '/sites/edu-store/images/edu-header-icon-sprite-eyes-202606.png', frames: 8, slot: 4, duration: 0.9 },
    { src: '/sites/edu-store/images/edu-header-icon-sprite-peace-202606.png', frames: 8, slot: 5, duration: 0.9 },
  ] satisfies EduHeroSprite[],
  chatLabel: 'Connect with a Specialist',
  specialistHref: '/support#contact',
  findStoreLabel: 'Find a Gadzio Store',
  findStoreHref: '/support',
};

export const PRODUCT_NAV: EduCard[] = [
    {
      id: "nav-1",
      headline: "Books",
      href: "/search?q=Gadzio+Book",
      image: "/sites/edu-store/images/store-cards/store-card-13-mac-nav-202603.webp",
    },
    {
      id: "nav-2",
      headline: "Pads",
      href: "/search?q=Gadzio+Pad",
      image: "/sites/edu-store/images/store-cards/store-card-13-ipad-nav-202405.webp",
    },
    {
      id: "nav-3",
      headline: "Phones",
      href: "/search?q=Gadzio+Phone",
      image: "/sites/edu-store/images/store-cards/store-card-13-iphone-nav-202609.jpg",
    },
    {
      id: "nav-4",
      headline: "Watches",
      href: "/search?q=Gadzio+Watch",
      image: "/sites/edu-store/images/store-cards/store-card-13-watch-nav-202609_GEO_IN.webp",
    },
    {
      id: "nav-5",
      headline: "Buds",
      href: "/search?q=Gadzio+Buds",
      image: "/sites/edu-store/images/store-cards/store-card-13-airpods-nav-202509.webp",
    },
    {
      id: "nav-6",
      headline: "Tags",
      href: "/search?q=Gadzio+Tag",
      image: "/sites/edu-store/images/store-cards/store-card-13-airtags-nav-202601_GEO_IN.webp",
    },
    {
      id: "nav-7",
      headline: "TV 4K",
      href: "/search?q=Gadzio+TV+4K",
      image: "/sites/edu-store/images/store-cards/store-card-13-appletv-nav-202210.webp",
    },
    {
      id: "nav-8",
      headline: "Speakers",
      href: "/search?q=Gadzio+Speakers",
      image: "/sites/edu-store/images/store-cards/store-card-13-homepod-nav-202301.webp",
    },
    {
      id: "nav-9",
      headline: "Accessories",
      href: "/shop/iphone/accessories/cases-protection",
      image: "/sites/edu-store/images/store-cards/store-card-13-accessories-nav-202609.webp",
    },
];

export const SHELVES: EduShelf[] = [
  {
    id: "savings",
    headline: "Education savings.",
    subhead: "Get sorted with special pricing.",
    cols: 40,
    cards: [
    {
      id: "savings-1",
      headline: "Gadzio Book Air",
      desc: "Now supercharged by G5.",
      price: "From ₹137900.00 with education savings",
      href: "/search?q=Gadzio+Book+Air",
      image: "/sites/edu-store/images/store-cards/store-card-40-macbook-air-202603.webp",
      savingsBadge: true,
    },
    {
      id: "savings-2",
      headline: "Gadzio Book Neo",
      desc: "Serious power at a student price.",
      price: "From ₹69900.00 with education savings",
      href: "/search?q=Gadzio+Book+Neo",
      image: "/sites/edu-store/images/store-cards/store-card-40-macbook-neo-202603.webp",
      savingsBadge: true,
    },
    {
      id: "savings-3",
      headline: "Gadzio Watch Series 12",
      tag: "NEW",
      desc: "The most accurate heart rate sensing in a wearable.",
      price: "₹50900.00 with education savings",
      href: "/search?q=Gadzio+Watch+Series+12",
      image: "/sites/edu-store/images/store-cards/store-card-40-watch-series-12-202609_GEO_IN.webp",
      dark: true,
      savingsBadge: true,
    },
    {
      id: "savings-4",
      headline: "Gadzio Mini",
      tag: "NEW",
      desc: "Now with G6 and G5 Pro.",
      price: "From ₹88900.00 with education savings",
      href: "/search?q=Gadzio+Mini",
      image: "/sites/edu-store/images/store-cards/store-card-40-mac-mini-202609.webp",
      savingsBadge: true,
    },
    {
      id: "savings-5",
      headline: "Gadzio Studio",
      tag: "NEW",
      desc: "Now with G5 Max and G5 Ultra.",
      price: "From ₹256900.00 with education savings",
      href: "/search?q=Gadzio+Studio",
      image: "/sites/edu-store/images/store-cards/store-card-40-mac-studio-202609.webp",
      savingsBadge: true,
    },
    {
      id: "savings-6",
      headline: "Gadzio Watch Ultra 4",
      tag: "NEW",
      desc: "A battery you can’t outrun.",
      price: "₹98900.00 with education savings",
      href: "/search?q=Gadzio+Watch+Ultra+4",
      image: "/sites/edu-store/images/store-cards/store-card-40-watch-ultra-4-202609_GEO_IN.webp",
      dark: true,
      savingsBadge: true,
    },
    {
      id: "savings-7",
      headline: "Gadzio Pad Air",
      desc: "Now supercharged by G4.",
      price: "From ₹83900.00 with education savings",
      href: "/search?q=Gadzio+Pad+Air",
      image: "/sites/edu-store/images/store-cards/store-card-40-ipad-air-202603.webp",
      savingsBadge: true,
    },
    {
      id: "savings-8",
      headline: "Gadzio Book Pro",
      desc: "Now with G5, G5 Pro and G5 Max.",
      price: "From ₹227900.00 with education savings",
      href: "/search?q=Gadzio+Book+Pro",
      image: "/sites/edu-store/images/store-cards/store-card-40-macbook-pro-202510.webp",
      dark: true,
      savingsBadge: true,
    },
    {
      id: "savings-9",
      headline: "Gadzio Pad",
      desc: "Write on it. Draw on it. Love it.",
      price: "From ₹47900.00 with education savings",
      href: "/search?q=Gadzio+Pad",
      image: "/sites/edu-store/images/store-cards/store-card-40-ipad-202503_GEO_IN.jpg",
      savingsBadge: true,
    },
    {
      id: "savings-10",
      headline: "Gadzio Pad Pro",
      desc: "Desktop-class power. Tablet-slim.",
      price: "From ₹127900.00 with education savings",
      href: "/search?q=Gadzio+Pad+Pro",
      image: "/sites/edu-store/images/store-cards/store-card-40-ipad-pro-202510.jpg",
      dark: true,
      savingsBadge: true,
    },
    {
      id: "savings-11",
      headline: "Gadzio Watch SE 3",
      desc: "Walk it. Track it. Love it.",
      price: "₹26900.00 with education savings",
      href: "/search?q=Gadzio+Watch+SE+3",
      image: "/sites/edu-store/images/store-cards/store-card-40-watch-se-202609_GEO_IN.webp",
      savingsBadge: true,
    },
    {
      id: "savings-12",
      headline: "Gadzio One",
      desc: "One screen. Zero clutter.",
      price: "From ₹168900.00 with education savings",
      href: "/search?q=Gadzio+One",
      image: "/sites/edu-store/images/store-cards/store-card-40-imac-202410.jpg",
      savingsBadge: true,
    },
    {
      id: "savings-13",
      headline: "Gadzio Pad Mini",
      desc: "Fits one hand. Does everything.",
      price: "From ₹63900.00 with education savings",
      href: "/search?q=Gadzio+Pad+Mini",
      image: "/sites/edu-store/images/store-cards/store-card-40-ipad-mini-202410_GEO_IN.jpg",
      savingsBadge: true,
    },
    ],
  },
  {
    id: "ways-to-save",
    headline: "Additional ways to save.",
    subhead: "For college students, educators and more.",
    cols: 40,
    cards: [
    {
      id: "ways-to-save-1",
      headline: "Learn about education savings available only at Gadzio.",
      href: "/in-edu/store",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-offer-202606.jpg",
    },
    {
      id: "ways-to-save-2",
      headline: "Explore accessories with education savings.",
      href: "/shop/iphone/accessories/cases-protection",
      image: "/sites/edu-store/images/store-cards/store-ipad-card-40-acc-202404_GEO_IN.jpg",
    },
    {
      id: "ways-to-save-3",
      headline: "₹199 per month for students and educators.",
      tag: "GADZIO CREATOR STUDIO",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-40-apple-creator-studio-202606.webp",
    },
    {
      id: "ways-to-save-4",
      headline: "Gadzio Music Student Plan comes with Gadzio TV for free.",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-40-bts-apple-music-202607.webp",
    },
    {
      id: "ways-to-save-5",
      headline: "We’ve got you covered.",
      tag: "GADZIOCARE+",
      href: "/support#products",
      image: "/sites/edu-store/images/store-cards/store-card-40-applecare-202606.webp",
    },
    ],
  },
  {
    id: "difference",
    headline: "The Gadzio Store difference.",
    subhead: "Even more reasons to shop with us.",
    cols: 40,
    cards: [
    {
      id: "difference-1",
      headline: "Flexible ways to pay.",
      tag: "PAYMENT OPTIONS",
      href: "/support#payments",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-financing-202606.jpg",
    },
    {
      id: "difference-2",
      headline: "Build it just the way you want.",
      tag: "CUSTOMISE YOUR BOOK",
      href: "/support#products",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-mac-cto-202606.jpg",
    },
    {
      id: "difference-3",
      headline: "Make them yours.",
      tag: "FREE ENGRAVING",
      href: "/support#products",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-engraving-202606_GEO_IN.jpg",
    },
    {
      id: "difference-4",
      headline: "Shop one-to-one with a Specialist. Online or in a store.",
      tag: "GADZIO SPECIALIST",
      href: "/support#contact",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-specialist-202606.jpg",
    },
    {
      id: "difference-5",
      headline: "Trade in your eligible Book, Watch or Pad for instant credit. In-store only.",
      tag: "GADZIO TRADE IN",
      href: "/support#products",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-trade-in-202606_GEO_IN.jpg",
    },
    {
      id: "difference-6",
      headline: "Set up your new device with help from a Specialist.",
      tag: "PERSONAL SETUP",
      href: "/support#contact",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-setup-202606.jpg",
    },
    ],
  },
  {
    id: "accessories",
    headline: "Accessories.",
    subhead: "Campus-ready essentials.",
    cols: 40,
    cards: [
    {
      id: "accessories-1",
      headline: "Find your study buddies.",
      href: "/shop/iphone/accessories/cases-protection",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-accessories-202609.webp",
    },
    ],
  },
  {
    id: "potential",
    headline: "Endless potential.",
    subhead: "Take teaching and learning further with Gadzio.",
    cols: 40,
    cards: [
    {
      id: "potential-1",
      headline: "Top class. In every class.",
      tag: "GADZIO FOR UNIVERSITY",
      href: "/in-edu/store",
      image: "/sites/edu-store/images/store-cards/store-card-40-bts-apple-college-202607.jpg",
    },
    {
      id: "potential-2",
      headline: "Surprise yourself with what’s possible.",
      tag: "WATCH AND LEARN",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-college-essentials-split-view-202404.webp",
    },
    {
      id: "potential-3",
      headline: "Set your sights high.",
      href: "/support",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-careers-202404.webp",
    },
    {
      id: "potential-4",
      headline: "Explore success stories.",
      href: "/support",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-success-202404.webp",
    },
    {
      id: "potential-5",
      headline: "Brush up on code.",
      tag: "LEARN TO BUILD APPS",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-40-edu-swift-202510.webp",
    },
    ],
  },
  {
    id: "more-to-love",
    headline: "More to love.",
    subhead: "Find your new favourites.",
    cols: 40,
    cards: [
    {
      id: "more-to-love-1",
      headline: "Gadzio Phone 18 Pro",
      tag: "NEW",
      desc: "The ultimate performance and camera of any Gadzio Phone, with exceptional battery life.",
      price: "From ₹164900.00",
      href: "/search?q=Gadzio+Phone+18+Pro",
      image: "/sites/edu-store/images/store-cards/store-card-40-iphone-18-pro-202609.webp",
      dark: true,
    },
    {
      id: "more-to-love-2",
      headline: "Gadzio Buds 5",
      tag: "NEW",
      desc: "Discover the magic of Active Noise Cancellation.",
      price: "From ₹14900.00",
      href: "/search?q=Gadzio+Buds+5",
      image: "/sites/edu-store/images/store-cards/store-card-40-airpods-5-202609.webp",
    },
    {
      id: "more-to-love-3",
      headline: "Gadzio Phone 17",
      desc: "Colour, reimagined.",
      price: "From ₹99900.00",
      href: "/search?q=Gadzio+Phone+17",
      image: "/sites/edu-store/images/store-cards/store-card-40-iphone-17-202509.webp",
    },
    {
      id: "more-to-love-4",
      headline: "Gadzio Buds Max 2",
      desc: "New intelligent features. More immersive listening.",
      price: "₹74900.00",
      href: "/search?q=Gadzio+Buds+Max+2",
      image: "/sites/edu-store/images/store-cards/store-card-40-airpods-max-202409.webp",
    },
    {
      id: "more-to-love-5",
      headline: "Gadzio Phone 17e",
      desc: "Feature stacked. Value packed.",
      price: "From ₹79900.00",
      href: "/search?q=Gadzio+Phone+17e",
      image: "/sites/edu-store/images/store-cards/store-card-40-iphone-17e-202603.webp",
    },
    {
      id: "more-to-love-6",
      headline: "Gadzio Phone Air",
      desc: "The thinnest Gadzio Phone ever.",
      price: "From ₹149900.00",
      href: "/search?q=Gadzio+Phone+Air",
      image: "/sites/edu-store/images/store-cards/store-card-40-iphone-air-202509.webp",
    },
    {
      id: "more-to-love-7",
      headline: "Gadzio Tag",
      desc: "The most findable Gadzio Tag yet.",
      price: "From ₹3790.00",
      href: "/search?q=Gadzio+Tag",
      image: "/sites/edu-store/images/store-cards/store-card-40-airtag-202601_GEO_IN.jpg",
    },
    ],
  },
  {
    id: "experience",
    headline: "The Gadzio experience.",
    subhead: "Balance work and play with apps and services.",
    cols: 50,
    cards: [
    {
      id: "experience-1",
      headline: "Gadzio Intelligence and Gadzio Assistant. More personal. More powerful.",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-50-apple-intelligence-202609.webp",
    },
    {
      id: "experience-2",
      headline: "Explore Gadzio Intelligence",
      tag: "Today at Gadzio",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-50-taa-ai-202604.webp",
    },
    {
      id: "experience-3",
      headline: "All the storage you need. Now with Gadzio TV and Gadzio Arcade included.",
      tag: "GADZIO CLOUD+",
      href: "/search",
      image: "/sites/edu-store/images/store-cards/store-card-50-app-bundle-202609.jpg",
    },
    ],
  },
];

export const QUICK_LINKS = [
  { label: 'Find a Store', href: '/support' },
  { label: 'Order Status', href: '/support#order-help' },
  { label: 'Shopping Help', href: '/support' },
  { label: 'Returns', href: '/support#returns' },
  { label: 'Your Saves', href: '/cart' },
];

/**
 * Eligibility terms for the student offers above.
 *
 * KEPT deliberately, though nothing imports it yet. It is the only de-branded
 * eligibility copy in the repository — Phase 1 rewrote it to replace Apple's
 * verbatim education-store sentence — and the page currently shows no
 * eligibility terms at all (`EduStorePage` renders no footnote block). Deleting
 * it would discard the copy without answering whether `/in-edu` ought to
 * display it; wiring it in is a product decision, not a code cleanup. Either
 * decision keeps this text: render it, or move it into the CMS.
 */
export const FOOTNOTES = [
  'Gadzio student offers are available to eligible college students. Eligibility may be verified before an offer is applied.',
];

/**
 * Every product card in the store, de-duplicated by headline — the one list the
 * search index and the checkout catalog both read from. Products that appear in
 * more than one rail (a Pad in both "Education savings." and "More to love.")
 * are listed once, keeping the first occurrence.
 */
export const EDU_PRODUCTS: EduCard[] = (() => {
  const seen = new Set<string>();
  const out: EduCard[] = [];
  for (const card of [...PRODUCT_NAV, ...SHELVES.flatMap((shelf) => shelf.cards)]) {
    const key = card.headline.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(card);
  }
  return out;
})();

/**
 * A card's price line ("From ₹137900.00 with education savings") as a number.
 * Drops the paise before reading the whole rupees, so 137900.00 is 137900 and
 * not 13790000. Returns 0 when the card carries no usable price.
 */
export function priceToNumber(price?: string): number {
  if (!price) return 0;
  const whole = price.replace(/\.\d+/g, '');
  const digits = /(\d[\d,]*)/.exec(whole)?.[1] ?? '';
  return parseInt(digits.replace(/,/g, ''), 10) || 0;
}

// Note on `href` values: display copy is de-branded and every destination
// resolves to a route that exists in this app — /search (bare, or with a
// product query), /support with one of its anchors (order-help, shipping,
// returns, products, payments, contact), /shop/iphone/accessories/cases-protection,
// /cart, or /in-edu/store. No third-party or apple.com URL remains, and no
// /in-edu/shop/... path remains either: those were Apple's own route shapes and
// none of them was built here, so every one of them 404'd.
//
// Two caveats worth knowing when the catalog grows:
//   * Cards naming a product the catalog does not carry yet (Watches, Buds,
//     Tags, TV 4K, Speakers) search for their own headline, so they land on a
//     results page that may only surface loosely related items. Give them real
//     product routes and repoint them.
//   * "Your Saves" (/cart) is a placeholder: there is no saved-items route, so
//     it points at the bag, the only surface that holds a shopper's own items.
