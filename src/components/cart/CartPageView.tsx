'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { useCart, type CartItem } from '@/lib/cart/CartContext';
import { getSuggestedProducts } from '@/lib/search/searchTracker';
import { getProductFromCatalog } from '@/lib/payu/catalog';
import { getCartLineBaseId } from '@/lib/cart/cart-id';
import type { SearchResultItem } from '@/lib/search/searchService';

interface UserAuth {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export function CartPageView() {
  const { items, totalCount, updateQuantity, removeItem, addItem } = useCart();
  const [suggestedProducts, setSuggestedProducts] = useState<SearchResultItem[]>([]);
  const [recommendationReason, setRecommendationReason] = useState<string>('Trending & Popular Products');
  const [topSearchTerms, setTopSearchTerms] = useState<string[]>([]);
  const [addedItemIds, setAddedItemIds] = useState<Record<string, boolean>>({});
  const [user, setUser] = useState<UserAuth | null>(null);

  // Only lines the PayU catalog knows are payable. A stale/education id is
  // shown as unavailable and excluded from the displayed totals.
  const availableItems = items.filter((item) =>
    Boolean(getProductFromCatalog(getCartLineBaseId(item.productId || item.id) || ''))
  );
  const hasUnavailable = availableItems.length !== items.length;
  const payableCount = availableItems.reduce((sum, item) => sum + item.quantity, 0);
  const payableAmount = availableItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  // Check user session
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data.authenticated && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  // Load and refresh suggested products based on cart and search history
  const refreshSuggestions = useCallback(() => {
    const excludeIds = items.map((i) => i.productId || i.id);
    const { products, reason, topTerms } = getSuggestedProducts({
      excludeIds,
      limit: 4,
    });
    setSuggestedProducts(products);
    setRecommendationReason(reason);
    setTopSearchTerms(topTerms);
  }, [items]);

  useEffect(() => {
    refreshSuggestions();

    const handleSearchUpdate = () => {
      refreshSuggestions();
    };

    window.addEventListener('gadzio_search_updated', handleSearchUpdate);
    return () => window.removeEventListener('gadzio_search_updated', handleSearchUpdate);
  }, [refreshSuggestions]);

  const handleAddSuggested = (item: SearchResultItem, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Never invent a price for a suggestion. Without a real one it is not
    // addable — the card renders an "Unavailable" label instead.
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
      // so a suggested item without its own image added a 404 to the bag.
      image: item.image || '/sites/cases-protection/images/iphone17-silicone-black.jpg',
      href: item.href,
      quantity: 1,
    });

    setAddedItemIds((prev) => ({ ...prev, [item.id]: true }));
    setTimeout(() => {
      setAddedItemIds((prev) => ({ ...prev, [item.id]: false }));
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-[#fff] text-[#1d1d1f] font-sans antialiased selection:bg-[#0071e3] selection:text-white flex flex-col justify-between">
      <div>
        <GlobalNav bannerVisible={false} />

        {/* No top padding: GadzioHeader is sticky, so it already occupies
            layout space. The 54px this used to carry cleared the old fixed
            44px nav and now only adds a dead zone under the header. */}
        <main className="pb-24 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Breadcrumbs */}
          <div className="py-4 border-b border-[#e5e5ea] mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-[#86868b]">
              <Link href="/" className="hover:text-[#1d1d1f] transition">Store</Link>
              <span>›</span>
              <span className="text-[#1d1d1f] font-medium">Shopping Bag</span>
            </div>
            <Link
              href="/shop/iphone/accessories/cases-protection"
              className="text-xs text-[#0071e3] hover:underline font-medium"
            >
              Continue Shopping →
            </Link>
          </div>

          {/* Delivery & Assurance Strip */}
          <div className="mb-8 p-4 rounded-2xl bg-[#f5f5f7] border border-black/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-[#1d1d1f]">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[#0071e3] shadow-2xs font-bold text-sm">
                🚚
              </span>
              <span>
                <strong>Free delivery across India</strong> on all orders. Free 7-day returns.
              </span>
            </div>
            <div className="flex items-center gap-2 text-[#86868b]">
              <span>🔒 256-Bit SSL Encrypted &amp; PayU Verified</span>
            </div>
          </div>

          {/* Header Title */}
          <div className="mb-8 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-3 border-b border-[#e5e5ea] pb-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-[#1d1d1f]">
                {items.length === 0 ? 'Your Bag is empty.' : 'Review your Bag.'}
              </h1>
              <p className="text-sm text-[#86868b] mt-1">
                {items.length === 0
                  ? 'Items you add from the store will appear here.'
                  : `You have ${totalCount} ${totalCount === 1 ? 'item' : 'items'} in your bag.`}
              </p>
            </div>
            {user ? (
              <div className="text-xs text-[#86868b] flex items-center gap-2">
                <span>Account:</span>
                <strong className="text-[#1d1d1f]">{user.firstName} {user.lastName}</strong>
                <span>•</span>
                <button
                  type="button"
                  onClick={async () => {
                    await fetch('/api/auth/signout', { method: 'POST' });
                    setUser(null);
                  }}
                  className="text-[#0071e3] hover:underline cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <div className="text-xs text-[#86868b]">
                Already have an account?{' '}
                <Link href="/auth?redirect=/cart" className="text-[#0071e3] hover:underline font-semibold">
                  Sign in
                </Link>
              </div>
            )}
          </div>

          {/* Main Cart Body */}
          {items.length === 0 ? (
            <div className="py-12 px-6 rounded-3xl bg-[#fbfbfd] border border-[#e5e5ea] text-center mb-16">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white shadow-xs flex items-center justify-center text-[#86868b]">
                <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-[#1d1d1f] mb-2">Your Bag is empty</h2>
              <p className="text-sm text-[#86868b] max-w-md mx-auto mb-6">
                Explore our selection of premium MagSafe protective cases, accessories, Mac, and iPad devices.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/shop/iphone/accessories/cases-protection"
                  className="bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold px-6 py-3 rounded-xl transition shadow-xs"
                >
                  Shop Cases &amp; Protection
                </Link>
                <Link
                  href="/in-edu/store"
                  className="bg-white hover:bg-[#f5f5f7] border border-[#d2d2d7] text-[#1d1d1f] text-xs font-semibold px-6 py-3 rounded-xl transition"
                >
                  Gadzio Education Store
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 mb-16 items-start">
              {/* Left Column: Line Items */}
              <div className="lg:col-span-8 divide-y divide-[#e5e5ea] border-y border-[#e5e5ea]">
                {items.map((item) => {
                  const isAvailable = Boolean(
                    getProductFromCatalog(getCartLineBaseId(item.productId || item.id) || '')
                  );
                  return (
                  <div key={item.id} className="py-6 flex flex-col sm:flex-row gap-5 items-start">
                    {/* Thumbnail Image */}
                    <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-2xl bg-[#f5f5f7] p-3 border border-black/5 flex items-center justify-center overflow-hidden">
                      <img
                        src={item.image}
                        alt={item.name}
                        className="w-full h-full object-contain select-none"
                      />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                        <div>
                          <h3 className="text-base sm:text-lg font-semibold text-[#1d1d1f] leading-snug">
                            {item.href ? (
                              <Link href={item.href} className="hover:text-[#0071e3] transition">
                                {item.name}
                              </Link>
                            ) : (
                              item.name
                            )}
                          </h3>
                          {(item.color || item.model) && (
                            <p className="text-xs text-[#86868b] mt-1">
                              {[item.color, item.model].filter(Boolean).join(' • ')}
                            </p>
                          )}
                        </div>
                        <div className="text-right sm:text-right font-bold text-base sm:text-lg text-[#1d1d1f] mt-1 sm:mt-0">
                          {isAvailable ? (
                            <>₹{(item.price * item.quantity).toLocaleString('en-IN')}</>
                          ) : (
                            <span className="text-sm font-semibold text-[#e30000]">Unavailable</span>
                          )}
                        </div>
                      </div>

                      {/* Stock note */}
                      {isAvailable ? (
                        <p className="text-xs text-[#34c759] font-medium mt-2 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
                          In stock and ready to ship
                        </p>
                      ) : (
                        <p className="text-xs text-[#e30000] font-medium mt-2">
                          This item is no longer in our catalog. Remove it to continue.
                        </p>
                      )}

                      {/* Quantity Stepper & Remove */}
                      <div className="flex items-center justify-between mt-4 pt-3 border-t border-black/5">
                        {isAvailable ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-[#86868b] font-medium">Quantity:</span>
                            <div className="flex items-center border border-black/10 rounded-xl bg-[#f5f5f7] overflow-hidden">
                              <button
                                type="button"
                                aria-label="Decrease quantity"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                className="w-8 h-8 flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/5 transition cursor-pointer text-sm"
                              >
                                –
                              </button>
                              <span className="w-8 text-center text-xs font-bold text-[#1d1d1f]">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                aria-label="Increase quantity"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                className="w-8 h-8 flex items-center justify-center text-[#86868b] hover:text-[#1d1d1f] hover:bg-black/5 transition cursor-pointer text-sm"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-[#6e6e73]">
                            Remove this unavailable item to check out.
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => removeItem(item.id)}
                          className="text-xs text-[#0071e3] hover:underline cursor-pointer flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>

              {/* Right Column: Order Summary (Sticky) */}
              <div className="lg:col-span-4 lg:sticky lg:top-[64px]">
                <div className="rounded-3xl bg-[#fbfbfd] border border-[#e5e5ea] p-6 shadow-sm">
                  <h2 className="text-lg font-semibold tracking-tight text-[#1d1d1f] mb-4">
                    Order Summary
                  </h2>

                  <div className="space-y-3 text-sm border-b border-[#e5e5ea] pb-4 mb-4">
                    <div className="flex justify-between text-[#86868b]">
                      <span>Subtotal ({payableCount} items)</span>
                      <span className="text-[#1d1d1f] font-medium">₹{payableAmount.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-[#86868b]">
                      <span>Shipping</span>
                      <span className="text-[#34c759] font-semibold">FREE</span>
                    </div>
                  </div>

                  <div className="flex justify-between items-baseline mb-6">
                    <span className="font-semibold text-base text-[#1d1d1f]">Total Payable</span>
                    <span className="text-2xl font-bold tracking-tight text-[#1d1d1f]">
                      ₹{payableAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>

                  {hasUnavailable && (
                    <div
                      id="cart-unavailable-note"
                      role="alert"
                      className="mb-4 p-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700"
                    >
                      Remove the unavailable item{items.length - availableItems.length === 1 ? '' : 's'} above to check out.
                    </div>
                  )}

                  {user ? (
                    <>
                      <div className="mb-4 p-3 rounded-2xl bg-[#f5f5f7] border border-[#e5e5ea] flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-[#1d1d1f] text-white flex items-center justify-center font-bold text-[11px] shrink-0">
                            {user.firstName[0]?.toUpperCase() || 'U'}
                          </span>
                          <div className="truncate">
                            <span className="font-semibold text-[#1d1d1f] block truncate">
                              {user.firstName} {user.lastName}
                            </span>
                            <span className="text-[11px] text-[#86868b] block truncate">{user.email}</span>
                          </div>
                        </div>
                      </div>

                      {hasUnavailable ? (
                        <button
                          type="button"
                          disabled
                          aria-describedby="cart-unavailable-note"
                          className="w-full bg-[#e8e8ed] text-[#6e6e73] text-[15px] font-semibold py-3.5 rounded-2xl text-center cursor-not-allowed"
                        >
                          Remove unavailable items to check out
                        </button>
                      ) : (
                        <Link
                          href="/checkout"
                          className="w-full bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0066cc] text-white text-[15px] font-semibold py-3.5 rounded-2xl text-center transition-all active:scale-[0.99] shadow-sm flex items-center justify-center gap-2"
                        >
                          <span>Check Out with PayU</span>
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                          </svg>
                        </Link>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="mb-4 p-3.5 rounded-2xl bg-[#0071e3]/5 border border-[#0071e3]/20">
                        <div className="flex items-start gap-2.5">
                          <svg className="w-4 h-4 text-[#0071e3] mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <div>
                            <p className="text-xs font-semibold text-[#1d1d1f]">Account required to buy</p>
                            <p className="text-[11px] text-[#6e6e73] mt-0.5 leading-snug">
                              Please sign in to proceed, or create an account if you don&apos;t have one yet.
                            </p>
                          </div>
                        </div>
                      </div>

                      <Link
                        href="/auth?redirect=/checkout"
                        className="w-full bg-[#0071e3] hover:bg-[#0077ed] active:bg-[#0066cc] text-white text-[15px] font-semibold py-3.5 rounded-2xl text-center transition-all active:scale-[0.99] shadow-sm flex items-center justify-center gap-2"
                      >
                        <span>Sign In to Check Out</span>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </Link>

                      <div className="mt-3 text-center">
                        <span className="text-xs text-[#86868b]">Don&apos;t have an account? </span>
                        <Link
                          href="/auth?mode=signup&redirect=/checkout"
                          className="text-xs font-semibold text-[#0071e3] hover:underline"
                        >
                          Create account
                        </Link>
                      </div>
                    </>
                  )}

                  <div className="mt-4 pt-4 border-t border-[#e5e5ea] text-xs text-[#86868b] space-y-2">
                    <div className="flex items-center gap-2">
                      <span>💳</span>
                      <span>Pay via UPI, Cards, NetBanking, and Wallets</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>📦</span>
                      <span>Express dispatch with order tracking</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------- */}
          {/* Suggested Products Section (User's Most Searched / Trending) */}
          {/* ------------------------------------------------------------- */}
          <div className="mt-16 pt-10 border-t border-[#e5e5ea]">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-8 gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-[#0071e3]/10 text-[#0071e3] text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    {topSearchTerms.length > 0 ? 'Searched Most' : 'Recommended'}
                  </span>
                  <span className="text-xs text-[#86868b]">
                    {topSearchTerms.length > 0 && `Searches: ${topSearchTerms.slice(0, 3).join(', ')}`}
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#1d1d1f]">
                  Suggested Products
                </h2>
                <p className="text-xs sm:text-sm text-[#86868b] mt-0.5">
                  {recommendationReason}
                </p>
              </div>

              <Link
                href="/shop/iphone/accessories/cases-protection"
                className="text-xs sm:text-sm font-semibold text-[#0071e3] hover:underline flex items-center gap-1"
              >
                <span>View all products</span>
                <span>→</span>
              </Link>
            </div>

            {/* Suggested Products Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {suggestedProducts.map((item) => {
                const isAdded = !!addedItemIds[item.id];
                const canAdd =
                      (item.type === 'product' || item.type === 'accessory') &&
                      typeof item.price === 'number' &&
                      Number.isFinite(item.price) &&
                      item.price > 0 &&
                      Boolean(getProductFromCatalog(getCartLineBaseId(item.id) || ''));
                return (
                  <div
                    key={item.id}
                    className="group relative flex flex-col bg-white rounded-2xl border border-black/8 hover:border-[#0071e3]/30 hover:shadow-xl transition-all duration-300 overflow-hidden p-4"
                  >
                    {/* Thumbnail Image Tile */}
                    <Link
                      href={item.href}
                      className="relative w-full aspect-square bg-[#f5f5f7] rounded-xl overflow-hidden flex items-center justify-center p-6 mb-3 group-hover:scale-[1.02] transition-transform duration-300"
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-contain select-none"
                          loading="lazy"
                        />
                      ) : (
                        <div className="text-center p-4 text-xs text-[#86868b]">
                          {item.name}
                        </div>
                      )}

                      {/* Category Badge */}
                      <span className="absolute top-2.5 left-2.5 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full tracking-wider">
                        {item.category}
                      </span>
                    </Link>

                    {/* Content */}
                    <div className="flex flex-col flex-1 justify-between">
                      <div>
                        <h3 className="text-[14px] font-semibold text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors leading-snug line-clamp-2">
                          <Link href={item.href}>{item.name}</Link>
                        </h3>
                        <p className="text-[12px] text-[#86868b] mt-1 line-clamp-1">
                          {item.subtitle}
                        </p>
                      </div>

                      {/* Price & Action */}
                      <div className="mt-4 pt-3 border-t border-black/5 flex items-center justify-between">
                        <div>
                          {item.priceDisplay ? (
                            <span className="text-[15px] font-bold text-[#1d1d1f]">
                              {item.priceDisplay}
                            </span>
                         ) : item.type === 'product' || item.type === 'accessory' ? (
                            <span className="text-xs font-semibold text-[#e30000]">Unavailable</span>
                          ) : (
                            <span className="text-xs text-[#86868b]">Explore</span>
                          )}
                        </div>

                        {canAdd ? (
                          <button
                            type="button"
                            onClick={(e) => handleAddSuggested(item, e)}
                            className={`text-xs font-semibold px-3.5 py-1.5 rounded-xl transition-all active:scale-95 cursor-pointer shadow-2xs ${
                              isAdded
                                ? 'bg-[#34c759] text-white'
                                : 'bg-[#0071e3] hover:bg-[#0077ed] text-white'
                            }`}
                          >
                            {isAdded ? 'Added ✓' : 'Add to Bag'}
                          </button>
                        ) : item.type === 'product' ? (
                          <span className="text-xs font-semibold text-[#e30000]">Unavailable</span>
                        ) : (
                          <Link
                            href={item.href}
                            className="text-xs font-semibold px-3.5 py-1.5 rounded-xl bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] transition"
                          >
                            View
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      <GlobalFooter />
    </div>
  );
}
