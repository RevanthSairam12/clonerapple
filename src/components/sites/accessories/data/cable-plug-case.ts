// Cable & Plug Case — placeholder catalog (INR).
import {
  buildAccessoryProduct,
  buildCategoryLinks,
  type AccessoryProduct,
  type CategoryConfig,
} from './types';

const SLUG = 'cable-plug-case';
const CATEGORY = 'Cable & Plug Case';
const IMG = '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles';
const IMG_A = `${IMG}/chargercover_large.jpg`;
const IMG_B = `${IMG}/chargercover_large_2x.jpg`;
const IMG_C = `${IMG}/chargercover_medium.jpg`;

const BLACK = { name: 'Black', hex: '#1d1d1f' };
const SAND = { name: 'Sand', hex: '#d5c4b0' };
const NAVY = { name: 'Navy', hex: '#2c4b6e' };
const GRAY = { name: 'Stone Gray', hex: '#8e8e93' };

export const CONFIG: CategoryConfig = {
  slug: SLUG,
  title: 'Cable & Plug Cases',
  subhead: 'No frayed ends, just solid defense. Organizers, charger shells, and travel pouches that keep your power kit tidy and protected.',
  breadcrumbLeaf: 'Cable & Plug Case',
  countNoun: 'cable & plug cases',
  categoryLinks: buildCategoryLinks(SLUG),
  // Options are limited to facet values carried by at least one remaining
  // product in PRODUCTS. Full pre-trim lists: ../removed-products/cable-plug-case.ts
  // (relative to the repo root; outside the repo).
  filters: [
    { id: 'type', label: 'Case Type', options: ['Cable Organizer', 'Charger Case'] },
    { id: 'material', label: 'Material', options: ['Silicone'] },
    { id: 'brand', label: 'Brand', options: ['Gadzio'] },
  ],
  quickPillFacet: 'type',
  quickPills: ['Cable Organizer', 'Charger Case'],
  disclaimer:
    'Gadzio protective organizers and cases are independently designed accessories. All third-party trademarks are the property of their respective owners.',
  seo: {
    title: 'Cable & Plug Cases | Gadzio Store',
    description:
      'Keep your charging kit tidy with Gadzio cable organizers, charger cases, plug covers, and travel pouches in silicone, leather, nylon, and hard shell.',
  },
};

export const PRODUCTS: AccessoryProduct[] = [
  buildAccessoryProduct({
    id: 'cpc-gadzio-silicone-organizer',
    name: 'Gadzio Silicone Cable Organizer',
    subtitle: 'Snap-wrap set of 3',
    price: 799,
    image: IMG_A,
    images: [IMG_A, IMG_C],
    colors: [BLACK, NAVY, SAND],
    compatibility: ['Charging cables', 'Earphone cords', 'USB-C & Lightning cables'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { type: 'Cable Organizer', material: 'Silicone', brand: 'Gadzio' },
    description:
      'Soft silicone wraps that snap around any cable to end tangles in your bag or on your desk. Pack of three in coordinated colors.',
    highlights: [
      { title: 'Snap-Shut Wrap', desc: 'Secures loops of cable in one quick press.' },
      { title: 'Grippy Silicone', desc: 'Non-slip finish stays put on desks and in bags.' },
      { title: 'Set of 3', desc: 'Sized for thin earphone cords to thick laptop cables.' },
    ],
    specs: [
      { label: 'Type', value: 'Cable organizer (x3)' },
      { label: 'Material', value: 'Food-grade silicone' },
      { label: 'Fits', value: 'Cables 2–8mm diameter' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
  buildAccessoryProduct({
    id: 'cpc-gadzio-charger-shell-20w',
    name: 'Gadzio Charger Protective Shell',
    subtitle: 'For 20W adapters',
    price: 599,
    image: IMG_B,
    images: [IMG_B, IMG_A],
    colors: [BLACK, NAVY],
    compatibility: ['20W USB-C adapters', 'Compact wall chargers'],
    material: 'Silicone',
    brand: 'Gadzio',
    category: CATEGORY,
    categorySlug: SLUG,
    facets: { type: 'Charger Case', material: 'Silicone', brand: 'Gadzio' },
    description:
      'A snug silicone skin that cushions your 20W adapter against drops and scuffs while adding a confident grip.',
    highlights: [
      { title: 'Shock-Absorbing', desc: 'Cushions corners against daily drops.' },
      { title: 'Precise Cutouts', desc: 'Full access to the USB-C port and prongs.' },
      { title: 'Anti-Slip', desc: 'Textured grip keeps the charger seated in sockets.' },
    ],
    specs: [
      { label: 'Type', value: 'Charger case' },
      { label: 'Material', value: 'Silicone' },
      { label: 'Fits', value: '20W compact USB-C adapters' },
      { label: 'Warranty', value: '1-Year Gadzio Warranty' },
    ],
  }),
];
