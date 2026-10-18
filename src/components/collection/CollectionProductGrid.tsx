'use client';

import React from 'react';
import type { CollectionProduct } from './types';
import { CollectionProductCard } from './CollectionProductCard';

export interface CollectionProductGridProps {
  products: CollectionProduct[];
  onClearFilters: () => void;
}

export function CollectionProductGrid({ products, onClearFilters }: CollectionProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="gz-collection-empty">
        <h3 className="gz-collection-empty-title">No matching products found</h3>
        <p className="gz-collection-empty-desc">
          Try clearing or adjusting your active filters to see all available items.
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
        <CollectionProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
