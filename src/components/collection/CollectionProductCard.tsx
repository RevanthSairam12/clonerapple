'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { CollectionProduct } from './types';
import { useCart } from '@/lib/cart/CartContext';
import { formatINR } from '@/lib/utils';

export interface CollectionProductCardProps {
  product: CollectionProduct;
}

export function CollectionProductCard({ product }: CollectionProductCardProps) {
  const [selectedColorIdx, setSelectedColorIdx] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const { addItem } = useCart();

  const colors = product.colors || [];
  const currentColor = colors[selectedColorIdx] || colors[0];
  const hoverImg = product.hoverImage;
  const hasHover = Boolean(hoverImg && hoverImg !== product.image);

  // Truthful badges only
  const isOutOfStock = product.inStock === false;
  const isNew = Boolean(product.isNew || product.badge === 'New');

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    addItem({
      productId: product.id,
      name: product.name,
      subtitle: currentColor ? currentColor.name : product.subtitle,
      price: product.price,
      priceDisplay: formatINR(product.price),
      image: product.image,
      color: currentColor ? currentColor.name : undefined,
      href: product.href,
    });

    setIsAdded(true);
    setTimeout(() => {
      setIsAdded(false);
    }, 1500);
  };

  return (
    <article className="gz-collection-card group" aria-label={product.name}>
      {/* Full-card semantic link navigating to product page */}
      <Link
        href={product.href}
        className="gz-collection-card-link"
        aria-label={`View ${product.name} details`}
      />

      {/* Media Tile with 1:1 Aspect Ratio */}
      <div className="gz-collection-card-media">
        {/* Truthful badge: only if real data indicates */}
        {isOutOfStock ? (
          <span className="gz-collection-card-badge out-of-stock">Out of stock</span>
        ) : isNew ? (
          <span className="gz-collection-card-badge">New</span>
        ) : null}

        {imgError ? (
          <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center text-xs text-[#6e6e73]">
            <span className="mb-1 font-semibold text-[#1d1d1f]">{product.brand}</span>
            <span className="line-clamp-2">{product.name}</span>
          </div>
        ) : (
          <>
            <img
              src={product.image}
              alt={product.name}
              className={`gz-collection-card-img ${hasHover ? 'primary-has-hover' : ''}`}
              loading="lazy"
              onError={() => setImgError(true)}
            />
            {hasHover && (
              <img
                src={hoverImg}
                alt={`${product.name} alternate view`}
                className="gz-collection-card-img-hover"
                loading="lazy"
                aria-hidden="true"
              />
            )}
          </>
        )}
      </div>

      {/* Information Area */}
      <div className="gz-collection-card-body">
        {/* Color swatches if multiple variants exist */}
        {colors.length > 1 && (
          <div className="gz-collection-card-swatches" aria-label="Available colors">
            {colors.slice(0, 6).map((color, idx) => (
              <button
                key={color.name}
                type="button"
                className={`gz-collection-swatch-btn ${idx === selectedColorIdx ? 'active' : ''}`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
                aria-label={`Select ${color.name} color`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedColorIdx(idx);
                }}
              />
            ))}
            {colors.length > 6 && (
              <span className="text-[11px] font-medium text-[#86868b]">
                +{colors.length - 6}
              </span>
            )}
          </div>
        )}

        {/* Product Title */}
        <h3 className="gz-collection-card-title">{product.name}</h3>

        {/* Subtitle / Selected Color */}
        <p className="gz-collection-card-sub">
          {currentColor ? currentColor.name : product.subtitle}
        </p>

        {/* Price & Quick Add Button */}
        <div className="gz-collection-card-bottom">
          <span className="gz-collection-card-price">{formatINR(product.price)}</span>

          <button
            type="button"
            className={`gz-collection-quick-add-btn ${isAdded ? 'added' : ''}`}
            onClick={handleQuickAdd}
            disabled={isOutOfStock}
            aria-label={`Add ${product.name} to bag`}
          >
            {isOutOfStock ? 'Sold Out' : isAdded ? 'Added ✓' : 'Add to bag'}
          </button>
        </div>
      </div>
    </article>
  );
}
