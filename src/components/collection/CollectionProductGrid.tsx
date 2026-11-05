'use client';

import React from 'react';
import type { CollectionProduct } from './types';
import { CollectionProductCard } from './CollectionProductCard';

export interface CollectionProductGridProps {
  products: CollectionProduct[];
  onClearFilters: () => void;
  /** While a sale is live, stock never disables a card's quick add. */
  saleLive?: boolean;
  /** A filter-specific explanation; the generic text is used when omitted. */
  emptyMessage?: string;
}

export function CollectionProductGrid({
  products,
  onClearFilters,
  saleLive = false,
  emptyMessage,
}: CollectionProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="gz-collection-empty">
        <h3 className="gz-collection-empty-title">
          {emptyMessage ? 'No products match these filters' : 'No matching products found'}
        </h3>
        <p className="gz-collection-empty-desc">
          {emptyMessage ?? 'Try clearing or adjusting your active filters to see all available items.'}
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="min-h-[44px] px-6 rounded-full bg-[#1d1d1f] text-white text-sm font-semibold hover:bg-[#333336] transition-colors cursor-pointer"
        >
          Clear All Filters
        </button>
      </div>
    );
  }

  return (
    <div className="gz-collection-grid" role="region" aria-label="Product list">
      {products.map((product) => (
        <CollectionProductCard key={product.id} product={product} saleLive={saleLive} />
      ))}
    </div>
  );
}
