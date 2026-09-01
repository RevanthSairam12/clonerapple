'use client';

import type { Product } from './data/products';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: Product[];
  onClear: () => void;
}

export function ProductGrid({ products, onClear }: ProductGridProps) {
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
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
