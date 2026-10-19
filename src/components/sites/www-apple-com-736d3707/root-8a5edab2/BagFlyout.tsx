'use client';

import React, { useRef, useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart } from '@/lib/cart/CartContext';
import { getSuggestedProducts } from '@/lib/search/searchTracker';
import { getProductFromCatalog } from '@/lib/payu/catalog';
import type { SearchResultItem } from '@/lib/search/searchService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function BagFlyout({ isOpen, onClose }: Props) {
  const { items, totalCount, removeItem, updateQuantity, addItem } = useCart();
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [suggestedProducts, setSuggestedProducts] = useState<SearchResultItem[]>([]);
  const [addedIds, setAddedIds] = useState<Record<string, boolean>>({});

  // Only catalog-backed lines are payable; stale ids render as unavailable and
  // do not contribute to the displayed total.
  const availableItems = items.filter((item) =>
    Boolean(getProductFromCatalog(item.productId || item.id))
  );
  const hasUnavailable = availableItems.length !== items.length;
  const payableAmount = availableItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Load suggested products based on user's searches
  useEffect(() => {
    if (!isOpen) return;
    const { products } = getSuggestedProducts({
      excludeIds: items.map((i) => i.productId || i.id),
      limit: 2,
    });
    setSuggestedProducts(products);
  }, [isOpen, items]);

  const handleQuickAdd = (item: SearchResultItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Never invent a price. Anything without a real catalog price stays
    // unaddable.
    const price = item.price;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;

    addItem({
      productId: item.id,
      name: item.name,
      subtitle: item.subtitle,
      price,
      priceDisplay: item.priceDisplay,
      // Existing Gadzio case art. The previous path
      // (`/sites/edu-store/images/category-iphone.png`) was never in public/,
      // so a result without its own image added a 404 to the bag.
      image: item.image || '/sites/cases-protection/images/iphone17-silicone-black.jpg',
      href: item.href,
      quantity: 1,
    });

    setAddedIds((prev) => ({ ...prev, [item.id]: true }));
    setTimeout(() => {
      setAddedIds((prev) => ({ ...prev, [item.id]: false }));
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={flyoutRef}
      role="dialog"
      aria-label="Your Bag"
      className="absolute top-[calc(100%+8px)] right-4 sm:right-6 md:right-10 z-9999 w-[calc(100vw-32px)] sm:w-[390px] max-w-[430px] rounded-2xl bg-[#fafafc]/95 backdrop-blur-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3),0_0_0_1px_rgba(0,0,0,0.08)] border border-white/60 p-5 text-[#1d1d1f] animate-in fade-in zoom-in-95 duration-200"
    >
      {/* Arrow caret pointing to bag icon */}
      <div className="absolute -top-2 right-6 sm:right-8 w-4 h-4 rotate-45 bg-[#fafafc] border-l border-t border-black/8" />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-black/8">
        <div className="flex items-center gap-2">
          <h3 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">
            {totalCount === 0 ? 'Your Bag is empty' : `Your Bag (${totalCount})`}
          </h3>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/cart"
            onClick={onClose}
            className="text-xs text-[#0071e3] hover:underline font-medium"
          >
            Review Bag
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Bag"
            className="text-[#86868b] hover:text-[#1d1d1f] p-1 -mr-1 transition-colors cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        <div className="py-6 text-center">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#f5f5f7] flex items-center justify-center text-[#86868b]">
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
            </svg>
          </div>
          <p className="text-[14px] text-[#86868b] mb-4">
            Items added to your bag will appear here.
          </p>
          <div className="flex flex-col gap-2">
            <Link
              href="/cart"
              onClick={onClose}
              className="inline-flex items-center justify-center w-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium py-2.5 px-4 rounded-xl transition active:scale-[0.98]"
            >
              Go to Bag Page
            </Link>
            <Link
              href="/shop/iphone/accessories/cases-protection"
              onClick={onClose}
              className="inline-flex items-center justify-center w-full bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-[13px] font-medium py-2 px-4 rounded-xl transition active:scale-[0.98]"
            >
              Shop Cases &amp; Protection
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* Items list */}
          <div className="max-h-[240px] overflow-y-auto py-2 divide-y divide-black/5 pr-1 -mr-1">
            {items.map((item) => {
              const isAvailable = Boolean(
                getProductFromCatalog(item.productId || item.id)
              );
              return (
              <div key={item.id} className="py-3 flex gap-3 items-center group">
                {/* Thumbnail */}
                <div className="w-12 h-12 shrink-0 rounded-xl bg-[#f5f5f7] p-1 flex items-center justify-center overflow-hidden border border-black/5">
                  <img
                    src={item.image}
                    alt={item.name}
                    className="w-full h-full object-contain select-none"
                    loading="lazy"
                  />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] font-semibold text-[#1d1d1f] truncate leading-tight">
                    {item.name}
                  </h4>
                  {(item.color || item.model) && (
                    <p className="text-[11px] text-[#86868b] truncate mt-0.5">
                      {[item.color, item.model].filter(Boolean).join(' • ')}
                    </p>
                  )}
                  <p className={`text-[12px] font-semibold mt-1 ${isAvailable ? 'text-[#1d1d1f]' : 'text-[#e30000]'}`}>
                    {isAvailable
                      ? `₹${(item.price * item.quantity).toLocaleString('en-IN')}`
                      : 'Unavailable'}
                  </p>
                </div>

                {/* Quantity Controls & Remove */}
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {isAvailable && (
                    <div className="flex items-center border border-black/10 rounded-lg bg-white overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        className="w-5 h-5 flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition cursor-pointer text-xs"
                      >
                        –
                      </button>
                      <span className="w-5 text-center text-[11px] font-semibold text-[#1d1d1f]">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        className="w-5 h-5 flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] hover:bg-[#f5f5f7] transition cursor-pointer text-xs"
                      >
                        +
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="text-[10px] text-[#e30000] hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          {/* Subtotal & Actions */}
          <div className="pt-3 mt-1 border-t border-black/8 flex flex-col gap-2.5">
            <div className="flex justify-between items-center text-sm">
              <span className="text-[#86868b] text-[13px]">Total</span>
              <span className="font-bold text-[16px] text-[#1d1d1f]">
                ₹{payableAmount.toLocaleString('en-IN')}
              </span>
            </div>

            {hasUnavailable && (
              <p className="text-[10px] text-[#e30000] leading-snug">
                Remove unavailable items to check out.
              </p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/cart"
                onClick={onClose}
                className="w-full bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] text-[13px] font-semibold py-2.5 rounded-xl text-center transition active:scale-[0.98] border border-black/5"
              >
                Review Bag
              </Link>
              {hasUnavailable ? (
                <div className="w-full bg-[#e8e8ed] text-[#86868b] text-[13px] font-semibold py-2.5 rounded-xl text-center cursor-not-allowed">
                  Remove items
                </div>
              ) : (
                <Link
                  href="/checkout"
                  onClick={onClose}
                  className="w-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-semibold py-2.5 rounded-xl text-center transition active:scale-[0.98] shadow-xs flex items-center justify-center gap-1"
                >
                  <span>Check Out</span>
                  <span>→</span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Suggested Products Section in Cart Flyout */}
      {suggestedProducts.length > 0 && (
        <div className="mt-4 pt-3 border-t border-black/8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-[#86868b] uppercase tracking-wider">
              Suggested for You
            </span>
            <Link
              href="/cart"
              onClick={onClose}
              className="text-[11px] text-[#0071e3] hover:underline font-medium"
            >
              See all
            </Link>
          </div>
          <div className="space-y-2">
            {suggestedProducts.map((p) => {
              const isAdded = !!addedIds[p.id];
              const canAdd =
                typeof p.price === 'number' &&
                Number.isFinite(p.price) &&
                p.price > 0 &&
                Boolean(getProductFromCatalog(p.id));
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-xl bg-black/2 hover:bg-black/4 transition border border-black/5"
                >
                  <Link
                    href={p.href}
                    onClick={onClose}
                    className="flex items-center gap-2 min-w-0 flex-1"
                  >
                    {p.image && (
                      <div className="w-9 h-9 shrink-0 rounded-lg bg-white p-0.5 border border-black/5 flex items-center justify-center overflow-hidden">
                        <img src={p.image} alt={p.name} className="w-full h-full object-contain" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[#1d1d1f] truncate leading-tight">
                        {p.name}
                      </p>
                      <p className={`text-[10px] ${canAdd ? 'text-[#86868b]' : 'text-[#e30000]'}`}>
                        {canAdd
                          ? p.priceDisplay || `₹${(p.price as number).toLocaleString('en-IN')}`
                          : 'Unavailable'}
                      </p>
                    </div>
                  </Link>

                  {canAdd && (
                    <button
                      type="button"
                      onClick={(e) => handleQuickAdd(p, e)}
                      className={`text-[10px] font-semibold px-2 py-1 rounded-lg shrink-0 transition-all cursor-pointer ${
                        isAdded
                          ? 'bg-[#34c759] text-white'
                          : 'bg-white hover:bg-[#0071e3] text-[#1d1d1f] hover:text-white border border-black/10'
                      }`}
                    >
                      {isAdded ? 'Added ✓' : '+ Add'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
