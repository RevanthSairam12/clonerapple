// Power Adapter & Cable — placeholder catalog (INR).
import {
  buildAccessoryProduct,
  buildCategoryLinks,
  type AccessoryProduct,
  type CategoryConfig,
} from './types';

const SLUG = 'power-adapter-cable';
const CATEGORY = 'Power Adapter & Cable';
const IMG = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';
const IMG_A = `${IMG}/2_promo_adapter_large_2x.jpg.jpg`;
const IMG_B = `${IMG}/1_promo_adapter_large.jpg.jpg`;

const WHITE = { name: 'White', hex: '#f5f5f7' };
const MIDNIGHT = { name: 'Midnight', hex: '#1d1d1f' };
const SILVER = { name: 'Silver', hex: '#d6d6d6' };

export const CONFIG: CategoryConfig = {
  slug: SLUG,
  title: 'Power Adapters & Cables',
  subhead: 'Fast, efficient GaN adapters and braided cables engineered by Gadzio for safe, high-speed charging anywhere.',
  breadcrumbLeaf: 'Power Adapter & Cable',
  countNoun: 'power accessories',
  categoryLinks: buildCategoryLinks(SLUG),
  // Options are limited to facet values carried by at least one remaining
  // product in PRODUCTS. Full pre-trim lists: ../removed-products/power-adapter-cable.ts
  // (relative to the repo root; outside the repo).
  filters: [
    { id: 'wattage', label: 'Wattage', options: ['20W', '35W'] },
    { id: 'connector', label: 'Connector', options: ['USB-C'] },
    { id: 'brand', label: 'Brand', options: ['Gadzio'] },
  ],
  quickPillFacet: 'wattage',
  quickPills: ['20W', '35W'],
  disclaimer:
    'iPhone, iPad, MacBook, Lightning, and MagSafe are trademarks of Apple Inc. Gadzio power accessories are independently engineered for device compatibility and are not affiliated with, sponsored by, or endorsed by Apple Inc.',
  seo: {
    title: 'Power Adapters & Charging Cables | Gadzio Store',
    description:
      'Shop Gadzio USB-C power adapters and braided charging cables — 20W to 140W GaN chargers with fast, safe high-speed charging for iPhone, iPad, and Mac.',
  },
};

export const PRODUCTS: AccessoryProduct[] = [
  buildAccessoryProduct({
    id: 'pa-gadzio-20w-usbc',
    name: 'Gadzio 20W USB-C Power Adapter',
    subtitle: 'Compact fast charger',
    price: 1499,
    image: IMG_A,
    images: [IMG_A, IMG_B],
    colors: [WHITE],
    compatibility: ['iPhone 15 and later', 'iPad', 'AirPods'],
    material: 'USB-C Adapter',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { wattage: '20W', connector: 'USB-C', brand: 'Gadzio' },
    description:
      'The Gadzio 20W USB-C Power Adapter delivers fast, efficient charging in a pocket-friendly shell. Pair it with a USB-C to Lightning or USB-C cable to power up your iPhone, iPad, or AirPods at full speed.',
    highlights: [
      { title: 'Fast 20W Output', desc: 'Charges a compatible iPhone up to 50% in around 30 minutes.' },
      { title: 'Compact & Foldable', desc: 'Pocketable footprint with smooth, snag-free edges for travel.' },
      { title: 'Smart Safety IC', desc: 'Over-current, over-voltage, and thermal protection built in.' },
    ],
    specs: [
      { label: 'Output', value: '20W (5V/3A, 9V/2.22A)' },
      { label: 'Ports', value: '1x USB-C' },
      { label: 'Protection', value: 'OCP / OVP / OTP' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
  buildAccessoryProduct({
    id: 'pa-gadzio-35w-dual',
    name: 'Gadzio 35W Dual-Port USB-C Adapter',
    subtitle: 'Charge two devices',
    price: 3499,
    image: IMG_B,
    images: [IMG_B, IMG_A],
    colors: [WHITE, MIDNIGHT],
    compatibility: ['iPhone 15 and later', 'iPad', 'AirPods', 'Apple Watch'],
    material: 'USB-C Adapter',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { wattage: '35W', connector: 'USB-C', brand: 'Gadzio' },
    description:
      'Two USB-C ports in one slim GaN body let you top up your iPhone and AirPods together. Intelligent power sharing balances output across both ports automatically.',
    highlights: [
      { title: 'Dual USB-C Ports', desc: 'Charge two devices at once with smart power distribution.' },
      { title: 'GaN II Efficiency', desc: 'Runs cooler and smaller than conventional silicon chargers.' },
      { title: 'Universal Voltage', desc: '100–240V input for worry-free international travel.' },
    ],
    specs: [
      { label: 'Output', value: '35W shared (max 35W single port)' },
      { label: 'Ports', value: '2x USB-C' },
      { label: 'Technology', value: 'GaN II' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
];
