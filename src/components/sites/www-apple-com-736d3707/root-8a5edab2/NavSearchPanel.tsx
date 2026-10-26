'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchArrowIcon, SearchResetIcon, SearchSubmitIcon } from './icons';
import {
  scoreProducts,
  PAGE_SEARCH_ITEMS,
  type SearchResultItem,
} from '@/lib/search/searchService';
import { recordSearchQuery } from '@/lib/search/searchTracker';
import { toSearchCandidates, useLiveCatalog } from '@/lib/catalog/client-catalog';

// Heading over the quick-link rail. Static copy, kept local so this panel does
// not read from the static catalogue data modules.
const QUICK_LINKS_HEADING = 'Quick Collections';

interface Props {
  onClose?: () => void;
}

export function NavSearchPanel({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [totalMatches, setTotalMatches] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { products: liveProducts, ready } = useLiveCatalog();

  // Products from the live catalogue; page entries are fixed navigation.
  const candidates = useMemo(
    () => [...toSearchCandidates(liveProducts), ...PAGE_SEARCH_ITEMS],
    [liveProducts],
  );

  // Focus input automatically on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Real-time search query execution
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setTotalMatches(0);
      return;
    }
    if (!ready) return;
    const searchRes = scoreProducts(candidates, query, { limit: 8 });
    setResults(searchRes.items);
    setTotalMatches(searchRes.totalMatches);
  }, [query, candidates, ready]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    recordSearchQuery(query.trim());
    onClose?.();
    router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  const handleLinkClick = () => {
    onClose?.();
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div className="mx-auto max-w-[1024px] px-[22px] pt-[28px] pb-[50px] transition-all">
      {/* Search Input Bar */}
      <form onSubmit={handleSubmit} className="block">
        <div className="flex h-[44px] items-center border-b border-black/10 pb-2">
          <button
            type="submit"
            aria-label="Submit search"
            className="relative -ml-[6px] flex h-[31px] w-[30px] shrink-0 items-center justify-center text-[#1d1d1f] hover:text-[#0071e3] transition-colors cursor-pointer"
          >
            <SearchSubmitIcon />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cases, models, accessories, books, pads..."
            aria-label="Search"
            autoCorrect="off"
            autoCapitalize="off"
            autoComplete="off"
            className="h-[40px] grow bg-transparent px-2 pt-[1px] text-[20px] sm:text-[24px] text-[#1d1d1f] outline-none placeholder:text-[#86868b] font-normal"
          />

          {hasQuery && (
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear search"
              className="relative flex h-[32px] w-[30px] shrink-0 items-center justify-center py-[2px] text-[#86868b] hover:text-[#1d1d1f] transition-colors cursor-pointer"
            >
              <SearchResetIcon />
            </button>
          )}
        </div>
      </form>

      {/* Dynamic Results or Quick Links */}
      {!hasQuery ? (
        <div className="mt-[28px] animate-in fade-in duration-200">
          <h2 className="text-[12px] font-medium leading-[16px] tracking-[-0.12px] text-[#6e6e73]">
            {QUICK_LINKS_HEADING}
          </h2>
          <ul className="mt-[10px] grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
            <li>
              <Link
                href="/shop/iphone/accessories/cases-protection"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">Phone Cases &amp; Protection</span>
              </Link>
            </li>
            <li>
              <Link
                href="/in-edu/store"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">Gadzio Education Store</span>
              </Link>
            </li>
            <li>
              <Link
                href="/search?q=silicone"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">MagPulse Liquid Silicone Cases</span>
              </Link>
            </li>
            <li>
              <Link
                href="/search?q=clear"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">CrystalArmor Clear Cases</span>
              </Link>
            </li>
            <li>
              <Link
                href="/checkout"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">Shopping Bag &amp; Checkout</span>
              </Link>
            </li>
            <li>
              <Link
                href="/support"
                onClick={handleLinkClick}
                className="gz-search-quicklink -mx-[8px] flex items-center py-1.5 px-2 rounded-lg hover:bg-black/5 transition"
              >
                <span className="mr-[11px] flex h-[16px] w-[9px] shrink-0 items-center text-[#6e6e73]">
                  <SearchArrowIcon />
                </span>
                <span className="text-[13px] text-[#1d1d1f] font-normal">Order &amp; Delivery Help</span>
              </Link>
            </li>
          </ul>
        </div>
      ) : (
        <div className="mt-[20px] animate-in fade-in duration-150">
          {results.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] font-semibold text-[#86868b] tracking-wider uppercase">
                  Products &amp; Suggestions ({totalMatches})
                </span>
                <Link
                  href={`/search?q=${encodeURIComponent(query.trim())}`}
                  onClick={handleLinkClick}
                  className="text-[12px] text-[#0071e3] hover:underline font-medium flex items-center gap-1"
                >
                  <span>See all {totalMatches} results</span>
                  <span>→</span>
                </Link>
              </div>

              {/* Grid of Results */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 max-h-[360px] overflow-y-auto pr-1">
                {results.map((item) => {
                  // Out of stock, or no real price, means the card must not
                  // advertise a purchasable figure.
                  const sellable =
                    item.inStock !== false &&
                    typeof item.price === 'number' &&
                    item.price > 0;
                  const priceLabel =
                    item.type === 'page' ? null : sellable ? item.priceDisplay : 'Unavailable';

                  return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={handleLinkClick}
                    className="flex flex-col p-3 rounded-xl bg-white border border-black/8 hover:border-[#0071e3]/40 hover:shadow-md transition-all group"
                  >
                    {item.image && (
                      <div className="w-full aspect-square bg-[#f5f5f7] rounded-lg mb-2 p-2 flex items-center justify-center overflow-hidden">
                        <img
                          src={item.image}
                          alt={item.name}
                          className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                        />
                      </div>
                    )}
                    <div className="flex flex-col flex-1 justify-between">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">
                          {item.category}
                        </span>
                        <h4 className="text-[13px] font-semibold text-[#1d1d1f] group-hover:text-[#0071e3] transition-colors line-clamp-1 leading-snug">
                          {item.name}
                        </h4>
                        <p className="text-[11px] text-[#86868b] line-clamp-1 mt-0.5">
                          {item.subtitle}
                        </p>
                      </div>
                      {priceLabel && (
                        <p className="text-[13px] font-semibold text-[#1d1d1f] mt-2">
                          {priceLabel}
                        </p>
                      )}
                    </div>
                  </Link>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-[#86868b]">
              <p className="text-[15px] font-medium text-[#1d1d1f] mb-1">
                No results found for &ldquo;{query}&rdquo;
              </p>
              <p className="text-[13px]">
                Try searching for &ldquo;Phone&rdquo;, &ldquo;Case&rdquo;, &ldquo;Silicone&rdquo;, &ldquo;Clear&rdquo;, or &ldquo;Book&rdquo;.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
