// Mobile Cases — placeholder catalog (INR).
// A broad cross-brand mobile case category (iPhone + Android), distinct from the
// iPhone-only cases-protection page.
import {
  buildAccessoryProduct,
  buildCategoryLinks,
  type AccessoryProduct,
  type CategoryConfig,
} from './types';

const SLUG = 'mobile-cases';
const CATEGORY = 'Mobile Cases';
const IMG = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';
const IMG_A = `${IMG}/1_iph_case_large.jpg`;
const IMG_B = `${IMG}/5_iph_case_large_2x.jpg`;
const IMG_C = `${IMG}/3_iph_case_medium.jpg`;

const BLACK = { name: 'Midnight Black', hex: '#1d1d1f' };
const CLEAR = { name: 'Crystal Clear', hex: '#e8e8ed' };
const BLUE = { name: 'Pacific Blue', hex: '#2c4b6e' };
const SAGE = { name: 'Sage Green', hex: '#9caf88' };
const PLUM = { name: 'Deep Plum', hex: '#6b4a6e' };
const SAND = { name: 'Desert Sand', hex: '#d5c4b0' };

export const CONFIG: CategoryConfig = {
  slug: SLUG,
  title: 'Mobile Cases',
  subhead: 'One case, total confidence. Slim, clear, leather, and rugged cases for the phones people actually carry — across iPhone, Samsung, and OnePlus.',
  breadcrumbLeaf: 'Mobile Cases',
  countNoun: 'mobile cases',
  categoryLinks: buildCategoryLinks(SLUG),
  // Options are limited to facet values carried by at least one remaining
  // product in PRODUCTS. Full pre-trim lists: ../removed-products/mobile-cases.ts
  // (relative to the repo root; outside the repo).
  filters: [
    {
      id: 'model',
      label: 'Compatible With',
      options: ['iPhone 17 Pro Max', 'iPhone 17 Pro'],
    },
    { id: 'material', label: 'Material', options: ['Silicone', 'Clear'] },
    { id: 'brand', label: 'Brand', options: ['Gadzio'] },
  ],
  quickPillFacet: 'model',
  quickPills: ['iPhone 17 Pro Max', 'iPhone 17 Pro'],
  disclaimer:
    'iPhone is a trademark of Apple Inc. Samsung and Galaxy are trademarks of Samsung Electronics. OnePlus is a trademark of OnePlus Technology. Gadzio cases are independently designed for device compatibility and are not affiliated with, sponsored by, or endorsed by these companies.',
  seo: {
    title: 'Mobile Cases | Gadzio Store',
    description:
      'Shop mobile cases for iPhone 17, iPhone 16 Pro, Samsung Galaxy S25, and OnePlus 13 — slim silicone, clear, leather, and rugged armor cases from Gadzio, Spigen, OtterBox, and more.',
  },
};

export const PRODUCTS: AccessoryProduct[] = [
  buildAccessoryProduct({
    id: 'mc-gadzio-silicone-17promax',
    name: 'Gadzio Silicone Case for iPhone 17 Pro Max',
    subtitle: 'Soft-touch with MagSafe',
    price: 1999,
    image: IMG_A,
    images: [IMG_A, IMG_C],
    colors: [BLACK, BLUE, SAGE, PLUM],
    compatibility: ['iPhone 17 Pro Max'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { model: 'iPhone 17 Pro Max', material: 'Silicone', brand: 'Gadzio' },
    description:
      'A soft-touch liquid silicone case with a built-in MagSafe magnet array for a satisfying snap and reliable wireless charging. The microfibre lining cradles your iPhone 17 Pro Max without scratches.',
    highlights: [
      { title: 'MagSafe Magnets', desc: 'Perfect alignment for chargers, wallets, and mounts.' },
      { title: 'Soft-Touch Finish', desc: 'Silky silicone exterior that resists fingerprints.' },
      { title: 'Microfibre Lining', desc: 'Scratch-free interior protects your finish.' },
    ],
    specs: [
      { label: 'Fits', value: 'iPhone 17 Pro Max' },
      { label: 'Material', value: 'Liquid silicone' },
      { label: 'MagSafe', value: 'Yes — magnet array' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
  buildAccessoryProduct({
    id: 'mc-gadzio-clear-17pro',
    name: 'Gadzio Clear Case for iPhone 17 Pro',
    subtitle: 'Anti-yellow MagSafe',
    price: 1699,
    image: IMG_B,
    images: [IMG_B, IMG_A],
    colors: [CLEAR],
    compatibility: ['iPhone 17 Pro'],
    material: 'Clear',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { model: 'iPhone 17 Pro', material: 'Clear', brand: 'Gadzio' },
    description:
      'Show off your iPhone 17 Pro with a crystal-clear, anti-yellowing shell. A ring of MagSafe magnets is visible through the back for perfect accessory alignment.',
    highlights: [
      { title: 'Anti-Yellowing', desc: 'UV-stabilised polymer stays clear over time.' },
      { title: 'Visible MagSafe Ring', desc: 'Snap-on alignment you can see.' },
      { title: 'Raised Bezels', desc: 'Protects screen and camera when set down.' },
    ],
    specs: [
      { label: 'Fits', value: 'iPhone 17 Pro' },
      { label: 'Material', value: 'Anti-yellowing TPU + PC' },
      { label: 'MagSafe', value: 'Yes — visible ring' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
];
