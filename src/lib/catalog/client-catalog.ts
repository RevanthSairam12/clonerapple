'use client';

/**
 * Client-side catalogue feed backed by /api/catalog/summary.
 *
 * Search, the bag flyout, the cart page and the checkout form used to check
 * the bundled static product map. That hid every product created in the store
 * admin: a line the static map did not know rendered as "unavailable" and was
 * dropped from the amount. This hook is the live replacement — one fetch,
 * shared across every consumer through a module-level promise.
 */

import { useEffect, useState } from 'react';

import type { StorefrontProductRef } from '@/lib/catalog/storefront';

export type { StorefrontProductRef };

interface CatalogSummaryResponse {
  products: StorefrontProductRef[];
}

let cachedPromise: Promise<StorefrontProductRef[]> | null = null;

function loadCatalog(): Promise<StorefrontProductRef[]> {
  if (!cachedPromise) {
    cachedPromise = fetch('/api/catalog/summary')
      .then((response) => {
        if (!response.ok) throw new Error(`catalog summary ${response.status}`);
        return response.json() as Promise<CatalogSummaryResponse>;
      })
      .then((body) => body.products ?? [])
      .catch(() => {
        // A failed fetch must not poison the cache for the session; drop it
        // so the next consumer retries.
        cachedPromise = null;
        return [] as StorefrontProductRef[];
      });
  }
  return cachedPromise;
}

/** Live product refs; `ready` is false until the first successful fetch. */
export function useLiveCatalog(): { products: StorefrontProductRef[]; ready: boolean } {
  const [products, setProducts] = useState<StorefrontProductRef[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadCatalog().then((list) => {
      if (cancelled) return;
      setProducts(list);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return { products, ready };
}

export interface SearchCandidate {
  id: string;
  type: 'product';
  name: string;
  subtitle: string;
  category: string;
  price: number;
  priceDisplay: string;
  image: string;
  href: string;
  keywords: string[];
  inStock: boolean;
}

const FALLBACK_IMAGE = '/sites/cases-protection/images/iphone17-silicone-black.jpg';

/** Convert live refs into the result shape the search UIs already render. */
export function toSearchCandidates(products: StorefrontProductRef[]): SearchCandidate[] {
  return products.map((product) => ({
    id: product.id,
    type: 'product' as const,
    name: product.name,
    subtitle: product.subtitle || product.categoryName,
    category: product.categoryName,
    price: product.pricePaise / 100,
    priceDisplay: product.priceDisplay,
    image: product.image || FALLBACK_IMAGE,
    href: `/shop/product/${encodeURIComponent(product.id)}`,
    keywords: product.keywords,
    inStock: product.inStock,
  }));
}

/** Case-insensitive exact-match id lookup over the live catalogue. */
export function findLiveProduct(
  products: StorefrontProductRef[],
  id: string | null | undefined,
): StorefrontProductRef | null {
  if (!id) return null;
  const needle = id.trim().toLowerCase();
  if (!needle) return null;
  return products.find((product) => product.id.toLowerCase() === needle) ?? null;
}

/**
 * Payability check for cart lines, backed by the live catalogue.
 *
 * While the catalogue is still loading every line reports available: a bag
 * render must never flash "unavailable" over a product the store does sell,
 * and checkout must never drop a real line from the amount. Once loaded, a
 * line is payable only if its base id exists in the catalogue.
 */
export function useProductAvailability(): {
  ready: boolean;
  isAvailable: (id: string | null | undefined) => boolean;
} {
  const { products, ready } = useLiveCatalog();
  return {
    ready,
    isAvailable: (id) => (ready ? findLiveProduct(products, id) !== null : true),
  };
}
