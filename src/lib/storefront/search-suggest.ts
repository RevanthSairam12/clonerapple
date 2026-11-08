import type { StorefrontProductRef } from '@/lib/catalog/storefront';
import { stockBlocked } from './availability-rules';

export const MAX_SEARCH_SUGGESTIONS = 6;
export const MIN_SUGGEST_QUERY_LENGTH = 2;

/**
 * Safe public suggestion DTO returned by `/api/search/suggest`.
 *
 * Never includes `cost_paise`, `on_hand`, `reserved`, `availableStock`, or
 * internal notes.
 */
export interface SearchSuggestionItem {
  id: string;
  name: string;
  href: string;
  image: string;
  category: string;
  brand: string;
  pricePaise: number;
  priceDisplay: string;
  wasPriceDisplay: string | null;
  onSale: boolean;
  inStock: boolean;
  /** True only in normal mode when the item is out of stock ("Stock not available"); always false while a sale is live. */
  stockBlocked: boolean;
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type SuggestSourceProduct = StorefrontProductRef & {
  brand?: string;
  category?: string;
  href?: string;
  onSale?: boolean;
};

function scoreProductMatch(product: SuggestSourceProduct, rawQuery: string): number {
  const normalizedQuery = normalizeToken(rawQuery);
  if (normalizedQuery.length < MIN_SUGGEST_QUERY_LENGTH) return 0;

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return 0;

  const nameNorm = normalizeToken(product.name);
  const brandNorm = normalizeToken(product.brand ?? '');
  const categoryNorm = normalizeToken(
    product.categoryName || product.category || product.categorySlug || '',
  );
  const idNorm = normalizeToken(product.id);
  const subtitleNorm = normalizeToken(product.subtitle);
  const keywordCorpus = [
    nameNorm,
    brandNorm,
    categoryNorm,
    idNorm,
    subtitleNorm,
    ...product.keywords.map((kw) => normalizeToken(kw)),
  ]
    .filter(Boolean)
    .join(' ');

  const compactCorpus = keywordCorpus.replace(/\s+/g, '');
  const compactQuery = normalizedQuery.replace(/\s+/g, '');

  // Every query word must match either as a substring in the corpus or compact corpus
  for (const word of queryWords) {
    if (!keywordCorpus.includes(word) && !compactCorpus.includes(word)) {
      return 0;
    }
  }

  let score = 10;
  if (nameNorm === normalizedQuery) score += 100;
  else if (nameNorm.startsWith(normalizedQuery)) score += 80;
  else if (nameNorm.includes(normalizedQuery)) score += 60;

  if (idNorm === normalizedQuery || compactCorpus.includes(compactQuery)) score += 40;
  if (brandNorm && brandNorm.startsWith(normalizedQuery)) score += 30;
  if (categoryNorm && categoryNorm.startsWith(normalizedQuery)) score += 20;

  for (const word of queryWords) {
    if (nameNorm.split(/\s+/).some((part) => part.startsWith(word))) {
      score += 15;
    }
  }

  return score;
}

/**
 * Pure matcher and safe DTO projector for live search suggestions.
 */
export function matchSearchSuggestions(
  products: readonly SuggestSourceProduct[],
  query: string,
  saleLive: boolean,
  limit: number = MAX_SEARCH_SUGGESTIONS,
): SearchSuggestionItem[] {
  const trimmed = String(query ?? '').trim();
  if (trimmed.length < MIN_SUGGEST_QUERY_LENGTH) return [];

  const cap = Math.min(Math.max(1, Math.trunc(limit)), MAX_SEARCH_SUGGESTIONS);

  const scored: Array<{ product: SuggestSourceProduct; score: number }> = [];
  for (const product of products) {
    const score = scoreProductMatch(product, trimmed);
    if (score > 0) {
      scored.push({ product, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));

  return scored.slice(0, cap).map(({ product }) => {
    const blocked = stockBlocked(product.inStock, saleLive);
    const onSale = Boolean(product.onSale ?? product.wasPriceDisplay);
    return {
      id: product.id,
      name: product.name,
      href: product.href || `/shop/product/${encodeURIComponent(product.id)}`,
      image: product.image,
      category: product.categoryName || product.category || product.categorySlug || '',
      brand: product.brand || 'Gadzio',
      pricePaise: product.pricePaise,
      priceDisplay: product.priceDisplay,
      wasPriceDisplay: onSale ? (product.wasPriceDisplay ?? null) : null,
      onSale,
      inStock: saleLive ? true : product.inStock,
      stockBlocked: blocked,
    };
  });
}
