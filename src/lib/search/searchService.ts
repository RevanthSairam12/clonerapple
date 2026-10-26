/**
 * Search scoring for the storefront.
 *
 * The product half of every result now comes from the live database catalogue:
 * the caller passes the candidates it fetched (see `toSearchCandidates` in
 * `@/lib/catalog/client-catalog`). Only the page entries below stay hard-coded,
 * because they describe routes rather than products.
 */

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
  /** Live catalogue availability. Absent on navigation entries. */
  inStock?: boolean;
}

export interface QuickSuggestion {
  label: string;
  href: string;
  category?: string;
}

/**
 * Key site categories and pages. These are navigation, not products: they carry
 * no price and always render as plain links.
 */
export const PAGE_SEARCH_ITEMS: SearchResultItem[] = [
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

/**
 * Score a caller-supplied candidate list against `query`.
 *
 * Pure: the candidates decide what can be found, so the same function serves
 * live catalogue products (`toSearchCandidates`) and the fixed navigation
 * entries in `PAGE_SEARCH_ITEMS` — callers pass both, concatenated.
 */
export function scoreProducts(
  candidates: SearchResultItem[],
  query: string,
  options?: { category?: string; limit?: number },
): {
  items: SearchResultItem[];
  totalMatches: number;
  suggestions: QuickSuggestion[];
} {
  const cleanQuery = (query || '').trim().toLowerCase();
  const limit = options?.limit || 24;
  const categoryFilter = options?.category && options.category !== 'All' ? options.category : null;

  if (!cleanQuery) {
    let filtered = candidates;
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

  const scoredItems = candidates
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