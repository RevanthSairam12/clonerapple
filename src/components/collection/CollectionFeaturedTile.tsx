'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { CollectionProduct } from './types';
import { useCart } from '@/lib/cart/CartContext';
import { formatINR } from '@/lib/utils';

export interface CollectionFeaturedTileProps {
  product: CollectionProduct;
}

export function CollectionFeaturedTile({ product }: CollectionFeaturedTileProps) {
  const [isAdded, setIsAdded] = useState(false);
  const { addItem } = useCart();

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    addItem({
      productId: product.id,
      name: product.name,
      subtitle: product.subtitle,
      price: product.price,
      priceDisplay: formatINR(product.price),
      image: product.image,
      href: product.href,
    });

    setIsAdded(true);
    setTimeout(() => setIsAdded(false), 1500);
  };

  const isOutOfStock = product.inStock === false;

  return (
    <div className="gz-collection-featured p-6 md:p-8 mb-8" aria-label="Featured Collection Product">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-center">
        {/* Left: Image */}
        <div className="md:col-span-5 flex items-center justify-center">
          <Link
            href={product.href}
            className="group block relative w-full aspect-square max-w-[340px] bg-white rounded-2xl p-6 border border-[#e5e5ea] overflow-hidden flex items-center justify-center transition-transform duration-300 hover:scale-[1.02]"
            aria-label={`View featured product: ${product.name}`}
          >
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-contain"
              loading="eager"
            />
          </Link>
        </div>

        {/* Right: Editorial Information */}
        <div className="md:col-span-7 flex flex-col justify-center space-y-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-[#1d1d1f] text-white uppercase tracking-wider">
              Featured Highlight
            </span>
            {product.badge && product.badge !== 'New' && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#f5f5f7] text-[#1d1d1f] border border-[#d2d2d7]">
                {product.badge}
              </span>
            )}
          </div>

          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d1d1f] leading-snug">
            <Link href={product.href} className="hover:text-[#0071e3] transition-colors">
              {product.name}
            </Link>
          </h2>

          <p className="text-sm sm:text-base text-[#6e6e73] leading-relaxed max-w-xl">
            {product.description || product.subtitle || 'Engineered for seamless compatibility and daily reliability.'}
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-4">
            <span className="text-2xl font-bold text-[#1d1d1f] tracking-tight">
              {formatINR(product.price)}
            </span>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className={`min-h-[44px] px-6 rounded-full font-semibold text-sm transition-all duration-200 cursor-pointer ${
                  isOutOfStock
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : isAdded
                    ? 'bg-[#34c759] text-white'
                    : 'bg-[#1d1d1f] text-white hover:bg-[#333336]'
                }`}
                onClick={handleQuickAdd}
                disabled={isOutOfStock}
                aria-label={`Quick add ${product.name} to bag`}
              >
                {isOutOfStock ? 'Sold Out' : isAdded ? 'Added to Bag ✓' : 'Add to Bag'}
              </button>

              <Link
                href={product.href}
                className="min-h-[44px] inline-flex items-center px-5 rounded-full text-sm font-semibold text-[#1d1d1f] border border-[#d2d2d7] hover:border-[#1d1d1f] transition-colors"
              >
                View Details
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
