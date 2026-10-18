'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { searchProducts, POPULAR_SEARCH_LINKS, type SearchResultItem } from '@/lib/search/searchService';
import { recordSearchQuery } from '@/lib/search/searchTracker';
import { SearchResetIcon, SearchSubmitIcon } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/icons';
import { WHATSAPP_ORDER_URL } from '@/lib/whatsapp';
import { ACCESSORY_NAV } from '@/components/sites/accessories/data/types';
import { CollectionProductCard } from '@/components/collection/CollectionProductCard';
import type { CollectionProduct } from '@/components/collection/types';
import { formatINR } from '@/lib/utils';

import '@/components/collection/collection.css';

const CATEGORIES = [
  'All',
  'Cases & Protection',
  'Mobile Cases',
  'Power & Cables',
  'Wired Earphones',
  'Cable & Plug Cases',
  'AirPods Cases',
];

function toCollectionProduct(item: SearchResultItem): CollectionProduct {
  return {
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    price: item.price || 0,
    priceDisplay: item.priceDisplay || formatINR(item.price || 0),
    image: item.image || '/sites/cases-protection/images/iphone17-silicone-black.jpg',
    images: [item.image || '/sites/cases-protection/images/iphone17-silicone-black.jpg'],
    colors: (item as any).colors || [],
    compatibility: (item as any).compatibility || [],
    material: '',
    brand: 'Gadzio',
    facets: {},
    features: [],
    description: item.subtitle,
    href: item.href,
    inStock: true,
  };
}

interface Props {
  initialQuery?: string;
}

export function SearchPageView({ initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [activeCategory, setActiveCategory] = useState('All');
  const router = useRouter();

  useEffect(() => {
    if (initialQuery.trim()) {
      recordSearchQuery(initialQuery.trim());
    }
  }, [initialQuery]);

  // Map display category to search service category
  const mappedCategory =
    activeCategory === 'All'
      ? 'All'
      : activeCategory === 'Power & Cables'
      ? 'Power Adapter & Cable'
      : activeCategory === 'Cable & Plug Cases'
      ? 'Cable & Plug Case'
      : activeCategory === 'AirPods Cases'
      ? 'Case for AirPods'
      : activeCategory;

  const { items, totalMatches } = searchProducts(query, {
    category: mappedCategory,
    limit: 40,
  });

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      recordSearchQuery(query.trim());
    }
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <div className="gz-collection-root flex flex-col justify-between min-h-screen">
      <div>
        {/* Header with WhatsApp banner */}
        <GadzioHeader
          bannerVisible={true}
          promoText="Order on WhatsApp"
          promoHref={WHATSAPP_ORDER_URL}
        />

        {/* Category Navigation Strip */}
        <nav className="gz-collection-nav-strip" aria-label="Accessories Categories">
          <div className="gz-collection-container">
            <div className="gz-collection-nav-list">
              {ACCESSORY_NAV.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="gz-collection-nav-link"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        <div className="gz-collection-container pb-20">
          {/* Breadcrumb Trail */}
          <div className="gz-collection-breadcrumb-bar">
            <nav className="gz-collection-breadcrumb" aria-label="Breadcrumb">
              <Link href="/" className="gz-collection-breadcrumb-link">
                Home
              </Link>
              <span className="gz-collection-breadcrumb-sep" aria-hidden="true">
                /
              </span>
              <span className="gz-collection-breadcrumb-current" aria-current="page">
                Search
              </span>
            </nav>
          </div>

          {/* Heading */}
          <header className="gz-collection-header">
            <h1 className="gz-collection-title">
              {query.trim() ? (
                <>Search results for &ldquo;{query}&rdquo;</>
              ) : (
                <>Search the Store</>
              )}
            </h1>
            <p className="gz-collection-subhead">
              {totalMatches} {totalMatches === 1 ? 'item found' : 'items found'}
            </p>
          </header>

          {/* Search Input Box */}
          <div className="mb-8">
            <form onSubmit={handleSearchSubmit} className="relative max-w-2xl">
              <div className="relative flex items-center bg-[#f5f5f7] rounded-2xl px-4 py-3 border border-black/5 focus-within:border-[#0071e3] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0071e3]/20 transition-all">
                <button
                  type="submit"
                  aria-label="Submit search"
                  className="text-[#86868b] hover:text-[#1d1d1f] mr-3 cursor-pointer"
                >
                  <SearchSubmitIcon />
                </button>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search for cases, chargers, cables, audio..."
                  className="w-full bg-transparent text-[16px] sm:text-[18px] text-[#1d1d1f] outline-none placeholder:text-[#86868b]"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                    className="text-[#86868b] hover:text-[#1d1d1f] p-1 transition cursor-pointer"
                  >
                    <SearchResetIcon />
                  </button>
                )}
              </div>
            </form>

            {/* Popular Searches */}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className="text-xs text-[#86868b] font-medium">Popular:</span>
              {POPULAR_SEARCH_LINKS.slice(0, 5).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setQuery(s.label.replace(' Cases', '').replace(' Store', ''))}
                  className="text-xs bg-[#f5f5f7] hover:bg-[#e8e8ed] text-[#1d1d1f] px-3.5 py-1.5 rounded-full transition cursor-pointer font-medium"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-xs font-medium transition cursor-pointer whitespace-nowrap min-h-[36px] ${
                  activeCategory === cat
                    ? 'bg-[#1d1d1f] text-white'
                    : 'bg-[#f5f5f7] text-[#1d1d1f] hover:bg-[#e8e8ed]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product Results Grid using shared CollectionProductCard */}
          {items.length > 0 ? (
            <div className="gz-collection-grid" role="region" aria-label="Search results">
              {items.map((item) => (
                <CollectionProductCard
                  key={item.id}
                  product={toCollectionProduct(item)}
                />
              ))}
            </div>
          ) : (
            <div className="gz-collection-empty">
              <h3 className="gz-collection-empty-title">
                No matching results found for &ldquo;{query}&rdquo;
              </h3>
              <p className="gz-collection-empty-desc">
                Try searching for another term like &ldquo;iPhone 17&rdquo;, &ldquo;Silicone Case&rdquo;, &ldquo;GaN Adapter&rdquo;, or &ldquo;Earphones&rdquo;.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setActiveCategory('All');
                  }}
                  className="min-h-[44px] px-6 rounded-full bg-[#1d1d1f] text-white text-sm font-semibold hover:bg-[#333336] transition-colors cursor-pointer"
                >
                  View All Products
                </button>
                <Link
                  href="/in/shop/iphone/accessories/cases-protection"
                  className="min-h-[44px] inline-flex items-center px-6 rounded-full border border-[#d2d2d7] text-sm font-semibold text-[#1d1d1f] hover:bg-[#f5f5f7] transition-colors"
                >
                  Explore Cases
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      <GlobalFooter />
    </div>
  );
}
