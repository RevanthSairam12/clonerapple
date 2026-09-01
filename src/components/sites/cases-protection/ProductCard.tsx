'use client';

import { useState } from 'react';

import type { Product } from './data/products';

const MAX_VISIBLE_SWATCHES = 5;

export function ProductCard({ product }: { product: Product }) {
  const [activeColor, setActiveColor] = useState(0);
  const [imgError, setImgError] = useState(false);

  const visibleSwatches = product.colors.slice(0, MAX_VISIBLE_SWATCHES);
  const extraCount = product.colors.length - MAX_VISIBLE_SWATCHES;

  return (
    <article className="cp-card">
      {/* Full-card link (sits behind swatches) */}
      <a
        href={product.href}
        target="_blank"
        rel="noopener noreferrer"
        className="cp-card-link"
        aria-label={product.name}
      />

      {/* Image */}
      <div className="cp-card-image-wrap">
        {product.badge && (
          <span className="cp-card-badge">{product.badge}</span>
        )}
        {imgError ? (
          /* Fallback: coloured placeholder */
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f5f5f7',
              color: '#6e6e73',
              fontSize: '13px',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            {product.name}
          </div>
        ) : (
          <img
            src={product.image}
            alt={product.name}
            className="cp-card-img"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Info */}
      <div className="cp-card-info">
        <p className="cp-card-name">{product.name}</p>
        <p className="cp-card-subtitle">
          {product.colors[activeColor]?.name ?? product.subtitle}
        </p>

        {/* Color swatches — above the card link (z-index via position) */}
        <div className="cp-card-swatches" style={{ position: 'relative', zIndex: 2 }}>
          {visibleSwatches.map((color, i) => (
            <button
              key={color.name}
              type="button"
              className={`cp-swatch ${i === activeColor ? 'active' : ''}`}
              style={{ background: color.hex }}
              title={color.name}
              aria-label={color.name}
              onClick={(e) => {
                e.preventDefault();
                setActiveColor(i);
              }}
            />
          ))}
          {extraCount > 0 && (
            <span className="cp-swatch-more">+{extraCount}</span>
          )}
        </div>

        <p className="cp-card-price">{product.priceDisplay}</p>
      </div>
    </article>
  );
}
