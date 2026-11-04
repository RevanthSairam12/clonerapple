/**
 * Built-in content of the Gadzio homepage sections.
 *
 * The section components render these when no content_blocks row exists, and
 * the Website editor pre-fills from the same values, so saving an untouched
 * section cannot change the page. Plain module (no 'use client') so server
 * code can read the values, not a client reference.
 */
export interface TrustBadgeItem {
  title: string;
  subtitle?: string;
  icon?: string;
  href?: string;
}

export const TRUST_BADGES_ITEMS: TrustBadgeItem[] = [
  {
    title: 'FREE SHIP $75+',
    subtitle: 'Free delivery on orders over ₹999',
    icon: 'shipping',
    href: '',
  },
  {
    title: '30-DAY RETURNS',
    subtitle: 'Hassle-free replacement guarantee',
    icon: 'returns',
    href: '',
  },
  {
    title: '1% DONATED',
    subtitle: 'Giving back with every single order',
    icon: 'heart',
    href: '',
  },
];

export interface CategoryGridCard {
  title: string;
  subtitle?: string;
  image: string;
  href: string;
  badge?: string;
}

export const CATEGORY_GRID_ITEMS: CategoryGridCard[] = [
  {
    title: 'CASES',
    subtitle: 'Drop Protection & MagSafe',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/icase_large_2x.jpg',
    href: '/in/shop/iphone/accessories/cases-protection',
    badge: '',
  },
  {
    title: 'CHARGERS',
    subtitle: 'High-speed adapters & braided cables',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/1_promo_adapter_large.jpg.jpg',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
    badge: '',
  },
  {
    title: 'AUDIO',
    subtitle: 'Studio grade sound & noise isolation',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/iearphones_large_2x.jpg',
    href: '/in/shop/iphone/accessories/wired-earphones',
    badge: '',
  },
  {
    title: 'ACCESSORIES',
    subtitle: 'Everyday tech essentials',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (1).jpg',
    href: '/in/shop/iphone/accessories/cable-plug-case',
    badge: '',
  },
];

export interface BrandLogoItem {
  name: string;
  subhead?: string;
  href?: string;
}

export const BRAND_BAR_ITEMS: BrandLogoItem[] = [
  { name: 'GADZIO', href: '/in/shop/iphone/accessories/cases-protection' },
  { name: 'GADZIO GAMES', href: '/in/shop/iphone/accessories/cases-protection' },
  { name: 'GADZIO BY MRBEAST', href: '/in/shop/iphone/accessories/cases-protection' },
  { name: 'GADZIO ATHLETICS', href: '/in/shop/iphone/accessories/power-adapter-cable' },
  { name: 'GADZIO LAB', href: '/in/shop/iphone/accessories/wired-earphones' },
  { name: 'GADZIO SIGNATURE', href: '/in/shop/iphone/accessories/cable-plug-case' },
];

export interface FestiveProductCard {
  unavailable?: boolean;
  title: string;
  tagPrimary?: string;
  tagSecondary?: string;
  amountText: string;
  originalAmountText?: string;
  savingsText?: string;
  image: string;
  href?: string;
}

export const DIWALI_ITEMS: FestiveProductCard[] = [
  {
    title: 'Gadzio Diwali Festive Tech Hamper 2026 (Limited Box)',
    tagPrimary: 'LIMITED RELEASE',
    tagSecondary: '⚡ NEW',
    amountText: '₹2,999',
    originalAmountText: '₹4,499',
    savingsText: 'SAVE 33%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (3).jpg',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
  {
    title: 'Diwali Gold Edition 3-in-1 Fast Wireless Charging Station',
    tagSecondary: '⚡ NEW',
    amountText: '₹1,899',
    originalAmountText: '₹2,699',
    savingsText: 'SAVE 30%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/1_promo_adapter_large.jpg.jpg',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
  },
  {
    title: 'Gadzio Pulse ANC Wireless Earphones - Festive Edition',
    tagPrimary: 'SAVE',
    tagSecondary: '⚡ NEW',
    amountText: '₹1,499',
    originalAmountText: '₹2,199',
    savingsText: 'SAVE 32%',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/iearphones_large_2x.jpg',
    href: '/in/shop/iphone/accessories/wired-earphones',
  },
  {
    title: 'Diwali Elite MagSafe Protection Combo (Case + Screen Glass)',
    tagPrimary: 'BESTSELLER',
    tagSecondary: '⚡ FESTIVE',
    amountText: '₹1,299',
    originalAmountText: '₹1,899',
    savingsText: 'SAVE 31%',
    image: '/sites/cases-protection/images/iphone16pro-clear-magsafe.jpg',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
];

export const DIWALI_COPY = {
  bannerKicker: 'DIWALI 2026',
  bannerTitle: 'ARE YOU READY?',
  bannerButtonLabel: 'SHOP DIWALI',
  bannerButtonHref: '/in/shop/iphone/accessories/cases-protection',
};

export interface CrowdFavoriteItem {
  unavailable?: boolean;
  title: string;
  /** Display-only price text; not a commerce field (the boundary rejects `price`). */
  priceDisplay?: string;
  /** Rows saved before the rename. */
  price?: string;
  image: string;
  href: string;
  badge?: string;
  badgeColor?: 'lavender' | 'yellow' | 'green' | 'default';
  secondaryBadge?: string;
  secondaryBadgeColor?: 'pink' | 'yellow' | 'green' | 'default';
  colorDots?: string;
}

export const CROWD_FAVORITES_ITEMS: CrowdFavoriteItem[] = [
  {
    title: 'Gadzio CrystalArmor Clear Case with MagSafe',
    priceDisplay: '₹3,499',
    image: '/sites/cases-protection/images/iphone17pro-clear-magsafe.jpg',
    href: '/shop/product/iphone18pro-max-clear-magsafe',
    badge: 'LIMITED RELEASE',
    badgeColor: 'lavender',
    secondaryBadge: '⚡ NEW',
    secondaryBadgeColor: 'yellow',
    colorDots: '#e8e8ed, #1d1d1f',
  },
  {
    title: 'Gadzio MagPulse Liquid Silicone Case',
    priceDisplay: '₹3,499',
    image: '/sites/cases-protection/images/iphone17-silicone-black.jpg',
    href: '/shop/product/iphone17-silicone-black',
    badge: '⚡ NEW',
    badgeColor: 'yellow',
    secondaryBadge: 'TOP ITEM',
    secondaryBadgeColor: 'pink',
    colorDots: '#1d1d1f, #8e8e93',
  },
  {
    title: 'Gadzio 20W USB-C GaN Fast Power Adapter',
    priceDisplay: '₹1,499',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/1_promo_adapter_large.jpg.jpg',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
    badge: 'TRENDING',
    badgeColor: 'green',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#f5f5f7, #1d1d1f',
  },
  {
    title: 'Gadzio Pulse USB-C Studio Hi-Res Earphones',
    priceDisplay: '₹1,499',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/iearphones_large_2x.jpg',
    href: '/in/shop/iphone/accessories/wired-earphones',
    badge: 'TRENDING',
    badgeColor: 'green',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#ffffff, #1d1d1f',
  },
  {
    title: 'Gadzio Ultra-Durable Braided USB-C Cable',
    priceDisplay: '₹999',
    image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/12_Untitled (2136 x 1140 px) (1).jpg',
    href: '/in/shop/iphone/accessories/cable-plug-case',
    badge: 'BESTSELLER',
    badgeColor: 'yellow',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#1d1d1f',
  },
  {
    title: 'Gadzio Rugged Armor Case for AirPods Pro',
    priceDisplay: '₹1,299',
    image: '/sites/cases-protection/images/iphone17pro-max-silicone.jpg',
    href: '/in/shop/iphone/accessories/airpods-case',
    badge: 'NEW',
    badgeColor: 'yellow',
    secondaryBadge: '',
    secondaryBadgeColor: 'default',
    colorDots: '#1d1d1f, #4f6f8f',
  },
];

export const CROWD_FAVORITES_COPY = {
  heading: 'The Crowd Favorites',
  subtitle: 'See what everyone is adding to their cart right now.',
  rightLinkLabel: 'SHOP BEST SELLERS',
  rightLinkHref: '/in/shop/iphone/accessories/cases-protection',
};

export interface CustomerReviewItem {
  headline: string;
  rating?: string | number;
  content: string;
  author: string;
  badgeText?: string;
}

export const REVIEWS_ITEMS: CustomerReviewItem[] = [
  {
    headline: 'CrystalArmor Case is unbelievable!',
    content:
      'The MagSafe magnets are insanely strong, and the drop protection saved my iPhone twice already. Crystal clear finish with zero yellowing even after months of daily use.',
    author: 'Aarav M.',
    badgeText: 'Verified Buyer',
  },
  {
    headline: 'Insane charging speed & durable cable!',
    content:
      'The 65W GaN adapter and braided cable charge my phone from 0 to 80% in half an hour. The metal reinforced connectors feel practically indestructible.',
    author: 'Priya S.',
    badgeText: 'Verified Buyer',
  },
  {
    headline: 'Studio earphones blew me away!!',
    content:
      'Crisp highs, deep punchy bass, and phenomenal noise isolation. Outstanding audio clarity for daily travel and long work calls. Truly 10/10!',
    author: 'Rohan K.',
    badgeText: 'Verified Buyer',
  },
];

export const REVIEWS_COPY = {
  kicker: 'LOVED BY CREATORS & CUSTOMERS',
  heading: '4.9 Average Star Rating',
  subheading: 'With over 25,000 5-star reviews, Gadzio tech and everyday essentials are trusted by creators and tech lovers across India!',
};

export interface WildPhotoItem {
  image: string;
  alt?: string;
  caption?: string;
  href?: string;
}

export const IN_THE_WILD_ITEMS: WildPhotoItem[] = [
  {
    image: '/images/wild/gadzio-wild-1.jpg',
    alt: 'Creator working outdoors with Gadzio phone case and accessories',
    caption: 'Campus & creator essentials • @aarav_tech',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
  {
    image: '/images/wild/gadzio-wild-2.jpg',
    alt: 'Gadzio CrystalArmor MagSafe clear case in studio',
    caption: 'CrystalArmor MagSafe setup • @priya_creations',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
  {
    image: '/images/wild/gadzio-wild-3.jpg',
    alt: 'Listening to music with Gadzio Studio Earphones',
    caption: 'Commute in pure sound • @rohan_pulse',
    href: '/in/shop/iphone/accessories/wired-earphones',
  },
  {
    image: '/images/wild/gadzio-wild-4.jpg',
    alt: 'Minimalist desk setup with Gadzio charging station',
    caption: 'Studio desk setup • @vikram_workstation',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
  },
  {
    image: '/images/wild/gadzio-wild-5.jpg',
    alt: 'Tech creator inspecting Gadzio gear',
    caption: 'Unboxing day with Gadzio • @neha_daily',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
  {
    image: '/images/wild/gadzio-wild-6.jpg',
    alt: 'Heavy-duty braided cables on desk',
    caption: 'High-speed charging setup • @kabir_edits',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
  },
  {
    image: '/images/wild/gadzio-wild-7.jpg',
    alt: 'Silicone protection case and AirTag accessory',
    caption: 'Travel ready with Gadzio • @ananya_travels',
    href: '/in/shop/iphone/accessories/cases-protection',
  },
];

export const IN_THE_WILD_COPY = {
  heading: 'Gadzio in the Wild',
  subheading: "Want to be featured here? Tag your photos with #GadzioInTheWild and show us your tech setups and everyday carry.",
};

export const EVENT_BANNER_COPY = {
  heading: 'The Flagship Drop Of The Year',
  subtitle:
    'Order now to get the limited deluxe titanium edition—engineered with aerospace-grade defense and high-gauss MagSafe.',
  ctaLabel: 'SHOP THE DROP',
  ctaHref: '/in/shop/iphone/accessories/cases-protection',
  image: '/sites/www-apple-com-736d3707/root-8a5edab2/images/tiles/icase_large_2x.jpg',
};
