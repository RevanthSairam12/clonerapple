'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Product } from './data/products';
import { useCart } from '@/lib/cart/CartContext';

const MAX_VISIBLE_SWATCHES = 6;

export function ProductCard({ product }: { product: Product }) {
  const [activeColor, setActiveColor] = useState(0);
  const [imgError, setImgError] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const { addItem } = useCart();

  const visibleSwatches = product.colors.slice(0, MAX_VISIBLE_SWATCHES);
  const extraCount = product.colors.length - MAX_VISIBLE_SWATCHES;
  const currentColor = product.colors[activeColor] ?? product.colors[0];

  const productUrl = `/shop/product/${encodeURIComponent(product.id)}`;

  return (
    <div className="group relative flex flex-col cursor-pointer transition-all duration-200">
      {/* Full-card link navigating to product description page */}
      <Link
        href={productUrl}
        className="absolute inset-0 z-10"
        aria-label={`View details for ${product.name}`}
      />

      {/* Rounded image tile */}
      <div className="relative w-full aspect-square bg-[#f5f5f7] rounded-[18px] overflow-hidden flex items-center justify-center p-6 mb-3 transition-transform duration-300 ease-out group-hover:scale-[1.02]">
        {imgError ? (
          <div className="w-full h-full flex flex-col items-center justify-center text-[#6e6e73] text-xs p-4 text-center">
            <span className="font-semibold text-[#1d1d1f] mb-1">{product.brand}</span>
            <span>{product.name}</span>
          </div>
        ) : (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full object-contain select-none transition-transform duration-300"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        )}
      </div>

      {/* Information Area below image */}
      <div className="flex flex-col gap-1 px-1">
        {/* Color Swatches (z-20 so clicks register without triggering navigation) */}
        {product.colors && product.colors.length > 0 && (
          <div className="relative z-20 flex items-center gap-1.5 mb-1 pt-0.5" aria-label="Color options">
            {visibleSwatches.map((color, i) => (
              <button
                key={color.name}
                type="button"
                className={`w-3.5 h-3.5 rounded-full transition-all duration-150 border border-black/10 ${
                  i === activeColor
                    ? 'ring-2 ring-offset-2 ring-[#1d1d1f] scale-110'
                    : 'hover:scale-115'
                }`}
                style={{ backgroundColor: color.hex }}
                title={color.name}
                aria-label={color.name}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveColor(i);
                }}
              />
            ))}
            {extraCount > 0 && (
              <span className="text-[11px] text-[#6e6e73] font-medium ml-1">
                +{extraCount}
              </span>
            )}
          </div>
        )}

        {/* Product Title */}
        <h3 className="text-[15px] font-semibold text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors leading-[1.35] line-clamp-2">
          {product.name}
        </h3>

        {/* Color / Subtitle */}
        <p className="text-[13px] text-[#6e6e73] leading-tight">
          {currentColor?.name ?? product.subtitle}
        </p>

        {/* Price & Quick Add Button */}
        <div className="flex items-center justify-between mt-2 pt-1">
          <p className="text-[15px] font-semibold text-[#1d1d1f] tracking-tight">
            {product.priceDisplay}
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              addItem({
                productId: product.id,
                name: product.name,
                subtitle: `${currentColor?.name || product.subtitle}`,
                price: product.price,
                priceDisplay: product.priceDisplay,
                image: product.image,
                color: currentColor?.name,
                model: product.compatibility[0],
                quantity: 1,
                href: productUrl,
              });
              setIsAdded(true);
              setTimeout(() => setIsAdded(false), 2000);
            }}
            className={`relative z-20 text-[11px] font-semibold px-3 py-1 rounded-full transition-all cursor-pointer ${
              isAdded
                ? 'bg-[#34c759] text-white'
                : 'bg-[#f5f5f7] hover:bg-[#0071e3] text-[#1d1d1f] hover:text-white active:scale-95'
            }`}
          >
            {isAdded ? 'Added ✓' : 'Add to Bag'}
          </button>
        </div>
      </div>
    </div>
  );
}
