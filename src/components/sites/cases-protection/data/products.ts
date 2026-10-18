// Gadzio Cases & Protection Product Catalog
// Premium engineered accessories designed for iPhone compatibility.
// Prices in INR (₹). Authoritative records for store and PayU checkout.

export interface ColorSwatch {
  name: string;
  hex: string;
}

export interface ProductSpecs {
  material: string;
  weight: string;
  thickness: string;
  magneticHold: string;
  dropProtection: string;
  warranty: string;
}

export interface ProductHighlight {
  title: string;
  desc: string;
}

export interface Product {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  priceDisplay: string;
  image: string;
  hoverImage?: string;
  colors: ColorSwatch[];
  compatibility: string[];
  material: 'Liquid Silicone' | 'Crystal Clear' | 'AeroWeave Textile' | 'Heavy-Duty Armor' | 'MagSafe Compatible';
  brand: 'Gadzio Signature' | 'Gadzio Pro' | 'Spigen' | 'OtterBox' | 'Nomad' | 'Belkin';
  features: string[];
  description: string;
  highlights: ProductHighlight[];
  specs: ProductSpecs;
  inTheBox: string[];
  /** Corner pill on the grid card, e.g. "New". Declared by the admin schema. */
  badge?: string;
  href: string;
}

// Filter options are limited to values carried by at least one remaining
// product in PRODUCTS. The full pre-trim lists (13 models / 5 materials /
// 6 brands) are preserved in ../removed-products/cases-protection.ts
// (relative to the repo root; that folder is outside the repo).
export const FILTER_MODELS = [
  'iPhone 18 Pro Max',
  'iPhone 18 Pro',
  'iPhone 17',
];

export const FILTER_MATERIALS = [
  'Liquid Silicone',
  'Crystal Clear',
];

export const FILTER_BRANDS = [
  'Gadzio Signature',
  'Gadzio Pro',
];

export const SORT_OPTIONS = [
  { label: 'Featured', value: 'featured' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Newest Arrivals', value: 'newest' },
];

function buildProductDetails(
  id: string,
  name: string,
  subtitle: string,
  price: number,
  image: string,
  colors: ColorSwatch[],
  compatibility: string[],
  material: Product['material'],
  brand: Product['brand']
): Product {
  let description = '';
  let highlights: ProductHighlight[] = [];
  let specs: ProductSpecs;

  if (material === 'Liquid Silicone') {
    description =
      `Engineered by Gadzio specifically for ${compatibility[0]}, the MagPulse Liquid Silicone Case offers exceptional tactile comfort and military-grade impact defense. The velvety soft-touch silicone exterior feels natural and secure in hand, while an inner micro-fiber cushion preserves your device's pristine finish. Integrated high-gauss N52 neodymium magnets align instantly with MagSafe wireless chargers, car mounts, and magnetic wallets.`;
    highlights = [
      {
        title: 'N52 Magnetic Array',
        desc: 'Precision aligned neodymium magnets ensure instant wireless charging alignment and a rock-solid 1,200g magnetic hold.',
      },
      {
        title: '10ft Impact Armor',
        desc: 'Triple-layer composite shell disperses severe drop shocks away from vulnerable glass edges and camera assemblies.',
      },
      {
        title: 'Microfiber Inner Bedding',
        desc: 'Ultra-fine soft lining cradles the titanium or aluminum frame to prevent micro-scratches and dust abrasion.',
      },
      {
        title: 'Sculpted Camera Defense',
        desc: 'A 1.6mm raised perimeter ring ensures lenses never make contact when placed flat on tables or rough terrain.',
      },
    ];
    specs = {
      material: 'Silky Liquid Silicone, Impact Polycarbonate Frame, Microfiber Lining',
      weight: '36g',
      thickness: '1.8mm',
      magneticHold: '1,200g Hold Force',
      dropProtection: 'MIL-STD-810H 10ft Drop Tested',
      warranty: '1-Year Gadzio Replacement Guarantee',
    };
  } else if (material === 'Crystal Clear') {
    description =
      `Showcase the sleek industrial geometry and vivid color of your ${compatibility[0]} with crystal clarity. The Gadzio CrystalArmor Case is molded from premium German Bayer polycarbonate infused with advanced anti-UV chemistry, resisting yellowing and oxidation for years. Designed with precision corner shock-airbags and high-transparency magnetic rings for uncompromised MagSafe utility.`;
    highlights = [
      {
        title: 'Bayer Anti-Yellowing Shield',
        desc: 'Advanced optical-grade polymer formulated with UV-absorbing inhibitors prevents discoloration over extended sunlight exposure.',
      },
      {
        title: 'Dual 4H Scratch Armor',
        desc: 'Hardened dual-sided hydrophobic coating resists keys, coins, and everyday pocket friction.',
      },
      {
        title: 'MagSafe Fast Charge Ring',
        desc: 'Optimized 36-magnet embedded core enables full 15W Qi2/MagSafe inductive energy transfer without heat buildup.',
      },
      {
        title: 'Air-Damped Corners',
        desc: 'Internal perimeter air pockets absorb and redistribute shock forces upon corner impacts.',
      },
    ];
    specs = {
      material: 'German Bayer Anti-Yellowing Polycarbonate & Flexible TPU',
      weight: '32g',
      thickness: '1.5mm',
      magneticHold: '1,150g Hold Force',
      dropProtection: '10ft Certified Drop Absorption',
      warranty: '1-Year Gadzio Clarity & Protection Warranty',
    };
  } else {
    // AeroWeave Textile
    description =
      `Crafted from precision micro-twill, the Gadzio AeroWeave Case delivers a distinctive suede-like hand feel and refined executive aesthetic for ${compatibility[0]}. Woven from high-durability technical yarns with 68% recycled fiber content, it provides robust drop shielding without unnecessary bulk, complemented by tactile machined aluminum button accents.`;
    highlights = [
      {
        title: 'High-Density Micro-Twill',
        desc: 'Technical woven fabric provides an ultra-comfortable non-slip tactile texture that resists pilling and fraying.',
      },
      {
        title: 'Machined Aluminum Buttons',
        desc: 'Independent anodized metal buttons deliver satisfying, tactile click feedback identical to the native device buttons.',
      },
      {
        title: 'Eco-Forward Engineering',
        desc: 'Engineered with 68% post-consumer recycled technical fibers, reducing environmental impact while boosting durability.',
      },
      {
        title: 'Embedded MagSafe Alignment',
        desc: 'Rare-earth magnetic core embedded beneath the fabric layer ensures secure attachment to all MagSafe chargers and stands.',
      },
    ];
    specs = {
      material: '68% Recycled Technical Micro-Twill, Anodized Aluminum, Polycarbonate Core',
      weight: '38g',
      thickness: '1.9mm',
      magneticHold: '1,250g Hold Force',
      dropProtection: '10ft Certified Drop Absorption',
      warranty: '1-Year Gadzio Craftsmanship Warranty',
    };
  }

  return {
    id,
    name,
    subtitle,
    price,
    priceDisplay: `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`,
    image,
    colors,
    compatibility,
    material,
    brand,
    features: highlights.map((h) => h.title),
    description,
    highlights,
    specs,
    inTheBox: [
      `1x ${name} (${subtitle})`,
      '1x Quick Start & Maintenance Guide',
      '1x 1-Year Authenticity & Warranty Card',
    ],
    href: `/shop/product/${id}`,
  };
}

export const PRODUCTS: Product[] = [
  buildProductDetails(
    'iphone18pro-max-clear-magsafe',
    'Gadzio CrystalArmor Clear Case with MagSafe',
    'Clear',
    3499,
    '/sites/cases-protection/images/iphone17pro-clear-magsafe.jpg',
    [
      { name: 'Diamond Clear', hex: '#e8e8ed' },
    ],
    ['iPhone 18 Pro Max', 'iPhone 18 Pro'],
    'Crystal Clear',
    'Gadzio Pro'
  ),
  buildProductDetails(
    'iphone17-silicone-black',
    'Gadzio MagPulse Liquid Silicone Case',
    'Midnight Black',
    3499,
    '/sites/cases-protection/images/iphone17-silicone-black.jpg',
    [
      { name: 'Midnight Black', hex: '#1d1d1f' },
      { name: 'Storm Blue', hex: '#6b7f9e' },
      { name: 'Plum Violet', hex: '#6b4f6a' },
      { name: 'Soft Mint', hex: '#b5cec9' },
      { name: 'Indigo Denim', hex: '#4f6f8f' },
      { name: 'Blush Pink', hex: '#f2c4ce' },
      { name: 'Stone Gray', hex: '#8e8e93' },
    ],
    ['iPhone 17'],
    'Liquid Silicone',
    'Gadzio Signature'
  ),
];

/**
 * Returns a product by ID from the catalog.
 */
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find((p) => p.id === id);
}

/**
 * Returns all product IDs.
 */
export function getAllProductIds(): string[] {
  return PRODUCTS.map((p) => p.id);
}
