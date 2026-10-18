// Wired Earphones — placeholder catalog (INR).
import {
  buildAccessoryProduct,
  buildCategoryLinks,
  type AccessoryProduct,
  type CategoryConfig,
} from './types';

const SLUG = 'wired-earphones';
const CATEGORY = 'Wired Earphones';
const IMG = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';
const IMG_A = `${IMG}/iearphones_large.jpg`;
const IMG_B = `${IMG}/iearphones_large_2x.jpg`;
const IMG_C = `${IMG}/iearphones_medium.jpg`;

const WHITE = { name: 'White', hex: '#f5f5f7' };
const BLACK = { name: 'Black', hex: '#1d1d1f' };
const BLUE = { name: 'Ocean Blue', hex: '#2c4b6e' };

export const CONFIG: CategoryConfig = {
  slug: SLUG,
  title: 'Wired Earphones',
  subhead: 'Zero charging, pure sound. In-ear monitors with tuned drivers and inline controls for every device.',
  breadcrumbLeaf: 'Wired Earphones',
  countNoun: 'wired earphones',
  categoryLinks: buildCategoryLinks(SLUG),
  // Options are limited to facet values carried by at least one remaining
  // product in PRODUCTS. Full pre-trim lists: ../removed-products/wired-earphones.ts
  // (relative to the repo root; outside the repo).
  filters: [
    { id: 'connector', label: 'Connector', options: ['USB-C', '3.5mm'] },
    { id: 'driver', label: 'Driver Type', options: ['Dynamic'] },
    { id: 'brand', label: 'Brand', options: ['Gadzio'] },
  ],
  quickPillFacet: 'connector',
  quickPills: ['USB-C', '3.5mm'],
  disclaimer:
    'iPhone, iPad, Lightning, and USB-C are trademarks of their respective owners. Gadzio audio accessories are independently engineered for device compatibility and are not affiliated with, sponsored by, or endorsed by Apple Inc.',
  seo: {
    title: 'Wired Earphones | Gadzio Store',
    description:
      'Shop wired earphones with USB-C, 3.5mm, and Lightning connectors. Tuned dynamic and hybrid drivers with inline mic and remote from Gadzio, Sony, JBL, and more.',
  },
};

export const PRODUCTS: AccessoryProduct[] = [
  buildAccessoryProduct({
    id: 'we-gadzio-pulse-usbc',
    name: 'Gadzio Pulse USB-C Earphones',
    subtitle: 'Dynamic driver, inline mic',
    price: 1499,
    image: IMG_A,
    images: [IMG_A, IMG_C],
    colors: [WHITE, BLACK],
    compatibility: ['iPhone 15 and later', 'iPad (USB-C)', 'MacBook', 'Android (USB-C)'],
    material: 'Dynamic Driver',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { connector: 'USB-C', driver: 'Dynamic', brand: 'Gadzio' },
    description:
      'The Gadzio Pulse plugs straight into USB-C for lag-free, hi-res audio with no charging required. A built-in DAC drives punchy 10mm dynamic drivers.',
    highlights: [
      { title: 'Built-in DAC', desc: 'Dedicated digital-to-analog converter for clean, detailed sound.' },
      { title: '10mm Dynamic Drivers', desc: 'Deep bass and crisp highs tuned for everyday listening.' },
      { title: 'Inline Remote & Mic', desc: 'Answer calls and control playback without reaching for your phone.' },
    ],
    specs: [
      { label: 'Driver', value: '10mm dynamic' },
      { label: 'Connector', value: 'USB-C (with DAC)' },
      { label: 'Mic', value: 'Inline, omnidirectional' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
  buildAccessoryProduct({
    id: 'we-gadzio-pulse-35mm',
    name: 'Gadzio Pulse 3.5mm Earphones',
    subtitle: 'Universal analog fit',
    price: 999,
    image: IMG_C,
    images: [IMG_C, IMG_A],
    colors: [WHITE, BLACK],
    compatibility: ['3.5mm devices', 'Laptops', 'Android', 'DAC dongles'],
    material: 'Dynamic Driver',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { connector: '3.5mm', driver: 'Dynamic', brand: 'Gadzio' },
    description:
      'The classic 3.5mm Gadzio Pulse works with any headphone jack — laptops, consoles, and dongles alike. Tuned for balanced vocals and reliable call clarity.',
    highlights: [
      { title: 'Universal 3.5mm', desc: 'Plug-and-play with any standard headphone jack.' },
      { title: 'Balanced Tuning', desc: 'Natural vocals with controlled, non-fatiguing bass.' },
      { title: 'Tangle-Free Cable', desc: 'Flat cable design resists knots in your bag.' },
    ],
    specs: [
      { label: 'Driver', value: '10mm dynamic' },
      { label: 'Connector', value: '3.5mm TRRS' },
      { label: 'Cable', value: 'Flat, 1.2m' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
];
