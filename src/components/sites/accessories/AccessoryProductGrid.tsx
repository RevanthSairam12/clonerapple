'use client';

import type { AccessoryProduct } from './data/types';
import { AccessoryProductCard } from './AccessoryProductCard';

interface AccessoryProductGridProps {
  products: AccessoryProduct[];
  onClear: () => void;
}

export function AccessoryProductGrid({ products, onClear }: AccessoryProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="cp-grid">
        <div className="cp-empty">
          <p className="cp-empty-title">No Results</p>
          <p className="cp-empty-text">
            There are no products available that match your selected filters.
          </p>
          <span className="cp-empty-btn" onClick={onClear}>
            Clear All Filters
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="cp-grid">
      {products.map((product) => (
        <AccessoryProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
