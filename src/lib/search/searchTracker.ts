'use client';

import { allSearchItems, searchProducts, type SearchResultItem } from './searchService';

export interface SearchHistoryEntry {
  query: string;
  count: number;
  lastSearchedAt: number;
}

const STORAGE_KEY = 'gadzio_search_history_v1';
const MAX_HISTORY_ITEMS = 25;

/**
 * Records a search term entered by the user, tracking frequency and recency.
 */
export function recordSearchQuery(rawQuery: string): void {
  if (typeof window === 'undefined') return;

  const query = (rawQuery || '').trim().toLowerCase();
  // Don't track single character queries
  if (!query || query.length < 2) return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    let history: SearchHistoryEntry[] = raw ? JSON.parse(raw) : [];

    if (!Array.isArray(history)) {
      history = [];
    }

    const existingIndex = history.findIndex((h) => h.query.toLowerCase() === query);

    if (existingIndex >= 0) {
      history[existingIndex] = {
        query,
        count: (history[existingIndex].count || 1) + 1,
        lastSearchedAt: Date.now(),
      };
    } else {
      history.unshift({
        query,
        count: 1,
        lastSearchedAt: Date.now(),
      });
    }

    // Sort by count descending, then recency
    history.sort((a, b) => b.count - a.count || b.lastSearchedAt - a.lastSearchedAt);

    if (history.length > MAX_HISTORY_ITEMS) {
      history = history.slice(0, MAX_HISTORY_ITEMS);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    // Notify components listening on window
    window.dispatchEvent(new CustomEvent('gadzio_search_updated', { detail: { query } }));
  } catch {
    // ignore quota/JSON errors
  }
}

/**
 * Returns user's most frequently searched queries.
 */
export function getMostSearchedTerms(limit: number = 5): string[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const history: SearchHistoryEntry[] = JSON.parse(raw);
    if (!Array.isArray(history)) return [];

    return history
      .sort((a, b) => b.count - a.count || b.lastSearchedAt - a.lastSearchedAt)
      .slice(0, limit)
      .map((h) => h.query);
  } catch {
    return [];
  }
}

/**
 * Gets personalized suggested products based on the user's most-searched terms.
 * If no search history exists, falls back to trending/popular store products.
 */
export function getSuggestedProducts(options?: {
  excludeIds?: string[];
  limit?: number;
}): {
  products: SearchResultItem[];
  reason: string;
  topTerms: string[];
} {
  const limit = options?.limit || 4;
  const excludeSet = new Set(options?.excludeIds || []);

  const topTerms = getMostSearchedTerms(4);
  const matchedProducts: SearchResultItem[] = [];
  const seenIds = new Set<string>();

  // 1. Gather products matching the user's most searched queries
  if (topTerms.length > 0) {
    for (const term of topTerms) {
      const searchRes = searchProducts(term, { limit: 6 });
      for (const item of searchRes.items) {
        if (!excludeSet.has(item.id) && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          matchedProducts.push(item);
          if (matchedProducts.length >= limit) break;
        }
      }
      if (matchedProducts.length >= limit) break;
    }
  }

  // 2. If fewer than limit, fill with trending products from the store
  if (matchedProducts.length < limit) {
    const trendingFallback = allSearchItems.filter(
      (item) => item.type === 'product' || item.type === 'hardware'
    );

    for (const item of trendingFallback) {
      if (!excludeSet.has(item.id) && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        matchedProducts.push(item);
        if (matchedProducts.length >= limit) break;
      }
    }
  }

  const reason =
    topTerms.length > 0
      ? `Based on your recent searches for "${topTerms.slice(0, 2).join('", "')}"`
      : 'Trending & Popular Products';

  return {
    products: matchedProducts.slice(0, limit),
    reason,
    topTerms,
  };
}
