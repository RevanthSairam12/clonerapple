// Case for AirPods — placeholder catalog (INR).
import {
  buildAccessoryProduct,
  buildCategoryLinks,
  type AccessoryProduct,
  type CategoryConfig,
} from './types';

const SLUG = 'airpods-case';
const CATEGORY = 'Case for AirPods';
const IMG = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';
const IMG_A = `${IMG}/icase_large.jpg`;
const IMG_B = `${IMG}/icase_large_2x.jpg`;
const IMG_C = `${IMG}/icase_medium.jpg`;

const BLACK = { name: 'Midnight Black', hex: '#1d1d1f' };
const CLEAR = { name: 'Crystal Clear', hex: '#e8e8ed' };
const SAND = { name: 'Desert Sand', hex: '#d5c4b0' };
const MINT = { name: 'Soft Mint', hex: '#b5cec9' };
const PINK = { name: 'Blush Pink', hex: '#f2c4ce' };
const NAVY = { name: 'Deep Navy', hex: '#2c4b6e' };

export const CONFIG: CategoryConfig = {
  slug: SLUG,
  title: 'Cases for AirPods',
  subhead: 'One favorite style, endless possibilities. Protective shells and covers tailored to every AirPods model.',
  breadcrumbLeaf: 'Case for AirPods',
  countNoun: 'AirPods cases',
  categoryLinks: buildCategoryLinks(SLUG),
  // Options are limited to facet values carried by at least one remaining
  // product in PRODUCTS. Full pre-trim lists: ../removed-products/airpods-case.ts
  // (relative to the repo root; outside the repo).
  filters: [
    { id: 'model', label: 'AirPods Model', options: ['AirPods Pro 3', 'AirPods Pro 2'] },
    { id: 'material', label: 'Material', options: ['Silicone'] },
    { id: 'brand', label: 'Brand', options: ['Gadzio'] },
  ],
  quickPillFacet: 'model',
  quickPills: ['AirPods Pro 3', 'AirPods Pro 2'],
  disclaimer:
    'AirPods, AirPods Pro, AirPods Max, and MagSafe are trademarks of Apple Inc. Gadzio cases are independently designed for device compatibility and are not affiliated with, sponsored by, or endorsed by Apple Inc.',
  seo: {
    title: 'Cases for AirPods | Gadzio Store',
    description:
      'Protective cases for AirPods Pro 3, AirPods Pro 2, AirPods 4, and AirPods Max — silicone, clear, leather, and hard-shell covers with MagSafe and carabiner options.',
  },
};

export const PRODUCTS: AccessoryProduct[] = [
  buildAccessoryProduct({
    id: 'ac-gadzio-silicone-pro3',
    name: 'Gadzio Silicone Case for AirPods Pro 3',
    subtitle: 'Soft-touch with carabiner',
    price: 1299,
    image: IMG_A,
    images: [IMG_A, IMG_C],
    colors: [BLACK, MINT, PINK, NAVY],
    compatibility: ['AirPods Pro 3'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { model: 'AirPods Pro 3', material: 'Silicone', brand: 'Gadzio' },
    description:
      'A soft-touch liquid silicone case that hugs your AirPods Pro 3 charging case, with a stainless carabiner so you can clip it anywhere. The LED stays visible and MagSafe charging works through the shell.',
    highlights: [
      { title: 'MagSafe-Through Charging', desc: 'Charge wirelessly without removing the case.' },
      { title: 'Stainless Carabiner', desc: 'Clip to a bag, belt loop, or strap.' },
      { title: 'Front LED Window', desc: 'Check charge status at a glance.' },
    ],
    specs: [
      { label: 'Fits', value: 'AirPods Pro 3' },
      { label: 'Material', value: 'Liquid silicone' },
      { label: 'Charging', value: 'MagSafe / Qi compatible' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
  buildAccessoryProduct({
    id: 'ac-gadzio-silicone-pro2',
    name: 'Gadzio Silicone Case for AirPods Pro 2',
    subtitle: 'Soft-touch with carabiner',
    price: 1199,
    image: IMG_C,
    images: [IMG_C, IMG_A],
    colors: [BLACK, SAND, MINT, PINK],
    compatibility: ['AirPods Pro 2'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { model: 'AirPods Pro 2', material: 'Silicone', brand: 'Gadzio' },
    description:
      'The everyday silicone case for AirPods Pro 2 — grippy, slim, and protective, with a carabiner and precise cutouts for charging and pairing.',
    highlights: [
      { title: 'Slim Grip Fit', desc: 'Adds protection without bulk.' },
      { title: 'Carabiner Included', desc: 'Keep your AirPods close and secure.' },
      { title: 'Precise Cutouts', desc: 'Full access to the charging port and pairing button.' },
    ],
    specs: [
      { label: 'Fits', value: 'AirPods Pro 2' },
      { label: 'Material', value: 'Liquid silicone' },
      { label: 'Charging', value: 'MagSafe / Qi compatible' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
];
