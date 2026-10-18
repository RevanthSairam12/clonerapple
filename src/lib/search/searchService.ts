import { PRODUCTS, type Product } from '@/components/sites/cases-protection/data/products';
import { EDU_PRODUCTS, priceToNumber } from '@/components/sites/edu-store/data/content';
import { ALL_ACCESSORY_PRODUCTS } from '@/lib/products/registry';

export interface SearchResultItem {
  id: string;
  type: 'product' | 'hardware' | 'page' | 'accessory';
  name: string;
  subtitle: string;
  category: string;
  price?: number;
  priceDisplay?: string;
  image?: string;
  href: string;
  badges?: string[];
  keywords: string[];
}

export interface QuickSuggestion {
  label: string;
  href: string;
  category?: string;
}

// Build unified catalog of searchable items
export const allSearchItems: SearchResultItem[] = [
  // 1. Cases & Protection Products
  ...PRODUCTS.map((p): SearchResultItem => {
    const models = p.compatibility ? p.compatibility.join(' ') : '';
    const colorNames = p.colors ? p.colors.map((c) => c.name).join(' ') : '';
    return {
      id: p.id,
      type: 'product',
      name: p.name,
      subtitle: `${p.subtitle || ''} • ${p.material || ''}`.trim(),
      category: 'Cases & Protection',
      price: p.price,
      priceDisplay: p.priceDisplay,
      image: p.image,
      href: `/shop/product/${encodeURIComponent(p.id)}`,
      badges: [p.brand, p.material],
      keywords: [
        p.name.toLowerCase(),
        (p.subtitle || '').toLowerCase(),
        p.material.toLowerCase(),
        p.brand.toLowerCase(),
        models.toLowerCase(),
        colorNames.toLowerCase(),
        'case',
        'cover',
        'protection',
        'magsafe',
        'apple',
        'gadzio',
      ],
    };
  }),

  // 2. Computers from the Education Store. Only cards carrying a price are real
  //    products — the service and editorial rails reuse the same card type.
  ...EDU_PRODUCTS.filter((c) => c.price && /^gadzio (book|mini|studio|one)/i.test(c.headline)).map(
    (m): SearchResultItem => ({
      id: m.id,
      type: 'hardware',
      name: m.headline,
      subtitle: m.desc || 'Education Store',
      category: 'Computers',
      price: priceToNumber(m.price),
      priceDisplay: m.price,
      image: m.image,
      href: '/in-edu/store',
      badges: m.tag ? ['Computer', m.tag] : ['Computer'],
      keywords: [
        m.headline.toLowerCase(),
        (m.desc || '').toLowerCase(),
        'computer',
        'laptop',
        'notebook',
        'desktop',
        'all-in-one',
        'gadzio book',
        'gadzio mini',
        'gadzio studio',
        'gadzio one',
      ],
    }),
  ),

  // 3. Tablets from the Education Store
  ...EDU_PRODUCTS.filter((c) => c.price && /^gadzio pad/i.test(c.headline)).map(
    (ip): SearchResultItem => ({
      id: ip.id,
      type: 'hardware',
      name: ip.headline,
      subtitle: ip.desc || 'Education Store',
      category: 'Tablets',
      price: priceToNumber(ip.price),
      priceDisplay: ip.price,
      image: ip.image,
      href: '/in-edu/store',
      badges: ip.tag ? ['Tablet', ip.tag] : ['Tablet'],
      keywords: [
        ip.headline.toLowerCase(),
        (ip.desc || '').toLowerCase(),
        'tablet',
        'stylus',
        'pro',
        'air',
        'mini',
        'gadzio pad',
      ],
    }),
  ),

  // 4. Generic Accessories (power adapters, wired earphones, cable & plug cases,
  //    AirPods cases, mobile cases). Grouped under a single "Accessories" facet
  //    for a tidy filter bar; the specific category rides in the subtitle.
  ...ALL_ACCESSORY_PRODUCTS.map((p): SearchResultItem => {
    const compat = p.compatibility.join(' ');
    const colorNames = p.colors.map((c) => c.name).join(' ');
    const facetValues = Object.values(p.facets).join(' ');
    return {
      id: p.id,
      type: 'accessory',
      name: p.name,
      subtitle: `${p.subtitle} • ${p.category}`,
      category: 'Accessories',
      price: p.price,
      priceDisplay: p.priceDisplay,
      image: p.image,
      href: `/shop/product/${encodeURIComponent(p.id)}`,
      badges: [p.brand, p.material],
      keywords: [
        p.name.toLowerCase(),
        p.subtitle.toLowerCase(),
        p.material.toLowerCase(),
        p.brand.toLowerCase(),
        p.category.toLowerCase(),
        compat.toLowerCase(),
        colorNames.toLowerCase(),
        facetValues.toLowerCase(),
        'accessory',
        'accessories',
        'gadzio',
      ].filter(Boolean),
    };
  }),

  // 5. Key Site Categories and Pages
  {
    id: 'page-cases-protection',
    type: 'page',
    name: 'iPhone Cases & Protection Store',
    subtitle: 'Explore all MagSafe cases, clear covers, and drop defense shields',
    category: 'Store',
    // Existing Gadzio case art. The previous path
    // (`/sites/edu-store/images/category-iphone.png`) was never in public/, so
    // this card rendered a broken image.
    image: '/sites/cases-protection/images/iphone17-silicone-black.jpg',
    href: '/shop/iphone/accessories/cases-protection',
    badges: ['Store', 'Accessories'],
    keywords: ['cases', 'protection', 'iphone cases', 'covers', 'accessories', 'magsafe'],
  },
  {
    id: 'page-edu-store',
    type: 'page',
    name: 'Gadzio Education Store India',
    subtitle: 'Education pricing on Mac and iPad for students and teachers',
    category: 'Store',
    href: '/in-edu/store',
    badges: ['Education', 'Offers'],
    keywords: ['education', 'student', 'college', 'discount', 'back to school', 'mac discount'],
  },
  {
    id: 'page-checkout-bag',
    type: 'page',
    name: 'Review Bag & Checkout',
    subtitle: 'View items in your bag, calculate totals, and place orders',
    category: 'Bag',
    href: '/checkout',
    badges: ['Cart', 'Checkout'],
    keywords: ['bag', 'cart', 'checkout', 'buy', 'order', 'pay'],
  },
  {
    id: 'page-support',
    type: 'page',
    name: 'Gadzio Support',
    subtitle: 'Order help, shipping, returns, payments, and product support',
    category: 'Support',
    href: '/support',
    badges: ['Help', 'Orders'],
    keywords: ['support', 'order', 'help', 'track', 'receipt', 'return', 'refund', 'shipping', 'payment'],
  },
  {
    id: 'page-power-adapter-cable',
    type: 'page',
    name: 'Power Adapter & Cable',
    subtitle: 'Fast chargers, GaN adapters, and durable charging cables',
    category: 'Store',
    href: '/in/shop/iphone/accessories/power-adapter-cable',
    badges: ['Store', 'Accessories'],
    keywords: ['power', 'adapter', 'charger', 'cable', 'usb-c', 'fast charging', 'gan', 'accessories'],
  },
  {
    id: 'page-wired-earphones',
    type: 'page',
    name: 'Wired Earphones',
    subtitle: 'USB-C, 3.5mm, and Lightning in-ear headphones',
    category: 'Store',
    href: '/in/shop/iphone/accessories/wired-earphones',
    badges: ['Store', 'Accessories'],
    keywords: ['wired', 'earphones', 'headphones', 'earbuds', 'usb-c', '3.5mm', 'lightning', 'audio', 'accessories'],
  },
  {
    id: 'page-cable-plug-case',
    type: 'page',
    name: 'Cable & Plug Case',
    subtitle: 'Cable organizers, charger cases, and travel pouches',
    category: 'Store',
    href: '/in/shop/iphone/accessories/cable-plug-case',
    badges: ['Store', 'Accessories'],
    keywords: ['cable', 'plug', 'case', 'organizer', 'charger case', 'travel pouch', 'accessories'],
  },
  {
    id: 'page-airpods-case',
    type: 'page',
    name: 'Cases for AirPods',
    subtitle: 'Protective covers for AirPods Pro, AirPods 4, and AirPods Max',
    category: 'Store',
    href: '/in/shop/iphone/accessories/airpods-case',
    badges: ['Store', 'Accessories'],
    keywords: ['airpods', 'case', 'cover', 'airpods pro', 'airpods max', 'protection', 'accessories'],
  },
  {
    id: 'page-mobile-cases',
    type: 'page',
    name: 'Mobile Cases',
    subtitle: 'Slim, clear, leather, and rugged cases for iPhone, Samsung & more',
    category: 'Store',
    href: '/in/shop/iphone/accessories/mobile-cases',
    badges: ['Store', 'Accessories'],
    keywords: ['mobile', 'cases', 'phone case', 'iphone', 'samsung', 'oneplus', 'cover', 'rugged', 'clear', 'leather', 'accessories'],
  },
];

export const POPULAR_SEARCH_LINKS: QuickSuggestion[] = [
  { label: 'iPhone 17 Silicone Cases', href: '/search?q=silicone' },
  { label: 'Power Adapter', href: '/search?q=adapter' },
  { label: 'Wired Earphones', href: '/search?q=earphones' },
  { label: 'AirPods Cases', href: '/search?q=airpods' },
  { label: 'Mobile Cases', href: '/search?q=case' },
  { label: 'Crystal Clear MagSafe Cases', href: '/search?q=clear' },
  { label: 'AeroWeave Textile Cases', href: '/search?q=aeroweave' },
  { label: 'Gadzio Book Air', href: '/search?q=book' },
  { label: 'Gadzio Pad Pro', href: '/search?q=pad' },
  { label: 'Education Store Savings', href: '/in-edu/store' },
  { label: 'All Cases & Protection', href: '/shop/iphone/accessories/cases-protection' },
];

export function searchProducts(query: string, options?: { category?: string; limit?: number }): {
  items: SearchResultItem[];
  totalMatches: number;
  suggestions: QuickSuggestion[];
} {
  const cleanQuery = (query || '').trim().toLowerCase();
  const limit = options?.limit || 24;
  const categoryFilter = options?.category && options.category !== 'All' ? options.category : null;

  if (!cleanQuery) {
    let filtered = allSearchItems;
    if (categoryFilter) {
      filtered = filtered.filter((i) => i.category === categoryFilter);
    }
    return {
      items: filtered.slice(0, limit),
      totalMatches: filtered.length,
      suggestions: POPULAR_SEARCH_LINKS,
    };
  }

  const queryTerms = cleanQuery.split(/\s+/).filter(Boolean);

  const scoredItems = allSearchItems
    .map((item) => {
      if (categoryFilter && item.category !== categoryFilter) {
        return { item, score: -1 };
      }

      let score = 0;
      const lowerName = item.name.toLowerCase();
      const lowerSub = item.subtitle.toLowerCase();
      const lowerCat = item.category.toLowerCase();

      // Exact full match
      if (lowerName === cleanQuery) score += 100;
      else if (lowerName.includes(cleanQuery)) score += 50;

      // Subtitle match
      if (lowerSub.includes(cleanQuery)) score += 20;

      // Category match
      if (lowerCat.includes(cleanQuery)) score += 15;

      // Term-by-term scoring
      for (const term of queryTerms) {
        if (lowerName.includes(term)) {
          score += 15;
        } else if (item.keywords.some((k) => k.includes(term))) {
          score += 8;
        } else if (lowerSub.includes(term)) {
          score += 5;
        }
      }

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);

  // Suggestions based on search terms
  const suggestions = POPULAR_SEARCH_LINKS.filter(
    (s) => s.label.toLowerCase().includes(cleanQuery) || cleanQuery.includes(s.label.toLowerCase())
  );

  return {
    items: scoredItems.slice(0, limit),
    totalMatches: scoredItems.length,
    suggestions: suggestions.length > 0 ? suggestions : POPULAR_SEARCH_LINKS.slice(0, 5),
  };
}
