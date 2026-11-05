'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { GadzioHeader } from '@/components/header/GadzioHeader';
import { GadzioTrustBar } from '@/components/trust/GadzioTrustBar';
import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { WHATSAPP_ORDER_URL } from '@/lib/whatsapp';

import type {
  CollectionConfig,
  CollectionFilterKind,
  CollectionFilterSelection,
  CollectionProduct,
} from './types';
import { CollectionProductGrid } from './CollectionProductGrid';
import { CollectionFilters, SORT_OPTIONS } from './CollectionFilters';
import { CollectionPagination } from './CollectionPagination';
import {
  buildCategoryFilterOptions,
  cardForFilterSelection,
  categoryFilterQuery,
  emptyFilterSelection,
  filterCategoryProducts,
  filterSelectionIsEmpty,
  filterValueLabel,
  parseCategoryFilterSearch,
  sanitiseCategoryFilterSelection,
  toggleFilterSelection,
} from '@/lib/storefront/category-filters';

import './collection.css';

export interface CollectionPageProps {
  config: CollectionConfig;
  products: CollectionProduct[];
  /** The sale switch on the database clock; a live sale never disables a card. */
  saleLive?: boolean;
  /** Optional overrides from CMS for header, category links, or products */
  overrides?: {
    header?: { title?: string; sortLabel?: string };
    categoryLinks?: Array<{ label?: string; href?: string }>;
    products?: any[];
  };
}

export function CollectionPage({ config, products, saleLive = false, overrides }: CollectionPageProps) {
  // Merge any CMS overrides
  const resolvedTitle = overrides?.header?.title || config.title;
  const resolvedLinks = useMemo(() => {
    if (!overrides?.categoryLinks) return config.categoryLinks;
    return config.categoryLinks.map((link, idx) => {
      const ov = overrides.categoryLinks?.[idx];
      return {
        ...link,
        label: ov?.label || link.label,
        href: ov?.href || link.href,
      };
    });
  }, [config.categoryLinks, overrides?.categoryLinks]);

  // Selected filters: facetId -> selected values
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [sortBy, setSortBy] = useState('featured');
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);

  // Phone model, Colour and Price live in the URL so a filtered page is
  // shareable and a deep link renders the same grid.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const initialSelection = useMemo(
    () => parseCategoryFilterSearch(searchParams),
    [searchParams],
  );
  const [optionSelection, setOptionSelection] = useState<CollectionFilterSelection>(initialSelection);
  const initialSelectionKey = categoryFilterQuery(initialSelection);
  const lastUrlSelection = useRef(initialSelectionKey);

  useEffect(() => {
    // Only a real URL change resets the state; our own replaceState must not.
    if (lastUrlSelection.current === initialSelectionKey) return;
    lastUrlSelection.current = initialSelectionKey;
    setOptionSelection(parseCategoryFilterSearch(searchParams));
  }, [initialSelectionKey, searchParams]);

  // Drop values that no longer exist in this category; keep valid combinations.
  const effectiveSelection = useMemo(
    () => sanitiseCategoryFilterSelection(products, optionSelection),
    [products, optionSelection],
  );

  const filterOptions = useMemo(
    () => buildCategoryFilterOptions(products, effectiveSelection),
    [products, effectiveSelection],
  );

  const writeFilterUrl = (selection: CollectionFilterSelection) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    for (const key of ['model', 'colour', 'price']) params.delete(key);
    for (const id of selection.models) params.append('model', id);
    for (const id of selection.colours) params.append('colour', id);
    for (const id of selection.prices) params.append('price', id);
    const query = params.toString();
    window.history.replaceState(null, '', `${pathname}${query ? `?${query}` : ''}`);
  };

  const toggleOption = (kind: CollectionFilterKind, id: string) => {
    const next = toggleFilterSelection(effectiveSelection, kind, id);
    setOptionSelection(next);
    writeFilterUrl(next);
  };

  // Toggle a single config facet value
  const toggleFilter = (facetId: string, value: string) => {
    setSelected((prev) => {
      const current = prev[facetId] || [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { ...prev, [facetId]: next };
    });
  };

  const clearAllFilters = () => {
    setSelected({});
    setOptionSelection(emptyFilterSelection());
    writeFilterUrl(emptyFilterSelection());
  };

  const activeCount =
    Object.values(selected).reduce((acc, curr) => acc + curr.length, 0)
    + effectiveSelection.models.length
    + effectiveSelection.colours.length
    + effectiveSelection.prices.length;

  // Flatten active chips for display
  const activeChips = useMemo(() => {
    const optionChips = ([
      ['model', effectiveSelection.models],
      ['colour', effectiveSelection.colours],
      ['price', effectiveSelection.prices],
    ] as const).flatMap(([kind, ids]) =>
      ids.map((id) => ({
        key: `${kind}:${id}`,
        label: filterValueLabel(products, kind, id),
        onRemove: () => toggleOption(kind, id),
      })),
    );
    return [
      ...optionChips,
      ...Object.entries(selected).flatMap(([facetId, values]) =>
        values.map((val) => ({
          key: `${facetId}:${val}`,
          label: val,
          onRemove: () => toggleFilter(facetId, val),
        })),
      ),
    ];
  }, [selected, effectiveSelection, products]);

  // Filtered & sorted product list
  const filteredProducts = useMemo(() => {
    let result = products;

    // Filter by each active config facet. Phone model and compatibility are
    // handled by the data-backed model filter below.
    for (const [facetId, selectedVals] of Object.entries(selected)) {
      if (facetId === 'model' || facetId === 'compatibility') continue;
      if (selectedVals.length > 0) {
        result = result.filter((p) => {
          // Check product.facets
          const facetVal = p.facets?.[facetId];
          if (facetVal && selectedVals.includes(facetVal)) {
            return true;
          }
          // Check direct fields (material, brand)
          if (facetId === 'material' && selectedVals.includes(p.material)) {
            return true;
          }
          if (facetId === 'brand' && selectedVals.includes(p.brand)) {
            return true;
          }
          return false;
        });
      }
    }

    result = filterCategoryProducts(result, effectiveSelection);

    // Sort
    if (sortBy === 'price-asc') {
      result = [...result].sort((a, b) => a.price - b.price);
    } else if (sortBy === 'price-desc') {
      result = [...result].sort((a, b) => b.price - a.price);
    } else if (sortBy === 'newest') {
      result = [...result].reverse();
    }

    return result;
  }, [products, selected, sortBy, effectiveSelection]);

  // The card price, sold-out mark and colour photo follow the active choice.
  const cards = useMemo(
    () => filteredProducts.map((product) => cardForFilterSelection(product, effectiveSelection)),
    [filteredProducts, effectiveSelection],
  );

  // Config facets rendered in the sidebar; the model filter replaces the old
  // compatibility checkbox list.
  const facetFilters = useMemo(
    () => config.filters.filter((facet) => facet.id !== 'model' && facet.id !== 'compatibility'),
    [config.filters],
  );

  // Quick pills
  const quickPillFacet = config.quickPillFacet;
  const quickPills = quickPillFacet ? config.quickPills || [] : [];
  const quickPillKind: CollectionFilterKind | null =
    quickPillFacet === 'model' ? 'model' : null;

  // A model pill selects the shared model id the option filters know.
  const modelOptionIds = useMemo(() => {
    const byName = new Map<string, string>();
    for (const group of filterOptions.models) {
      for (const option of group.options) byName.set(option.name.toLowerCase(), option.id);
    }
    return byName;
  }, [filterOptions.models]);

  const isPillActive = (pill: string) =>
    quickPillKind === 'model'
      ? effectiveSelection.models.includes(modelOptionIds.get(pill.toLowerCase()) ?? pill)
      : (selected[quickPillFacet || ''] || []).includes(pill);

  const togglePill = (pill: string) => {
    if (!quickPillFacet) return;
    if (quickPillKind === 'model') {
      const id = modelOptionIds.get(pill.toLowerCase());
      if (!id) return;
      toggleOption('model', id);
      return;
    }
    toggleFilter(quickPillFacet, pill);
  };

  return (
    <div className="gz-collection-root">
      {/* 1. Header with Slim Announcement Bar */}
      <GadzioHeader
        bannerVisible={true}
        promoText="Order on WhatsApp"
        promoHref={WHATSAPP_ORDER_URL}
      />

      {/* Category Sub-Navigation Bar */}
      {resolvedLinks && resolvedLinks.length > 0 && (
        <nav className="gz-collection-nav-strip" aria-label="Accessories Categories">
          <div className="gz-collection-container">
            <div className="gz-collection-nav-list">
              {resolvedLinks.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className={`gz-collection-nav-link ${link.active ? 'active' : ''}`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
      )}

      <div className="gz-collection-container flex-1">
        {/* 2. Breadcrumb (Home / Category) */}
        <div className="gz-collection-breadcrumb-bar">
          <nav className="gz-collection-breadcrumb" aria-label="Breadcrumb">
            <Link href="/" className="gz-collection-breadcrumb-link">
              Home
            </Link>
            <span className="gz-collection-breadcrumb-sep" aria-hidden="true">
              /
            </span>
            <span className="gz-collection-breadcrumb-current" aria-current="page">
              {config.breadcrumbLeaf || resolvedTitle}
            </span>
          </nav>
        </div>

        {/* Collection Title & Description */}
        <header className="gz-collection-header">
          <h1 className="gz-collection-title">{resolvedTitle}</h1>
          {config.subhead && <p className="gz-collection-subhead">{config.subhead}</p>}
        </header>

        {/* Quick Filter Pills Row (if defined) */}
        {quickPillFacet && quickPills.length > 0 && (
          <div
            className="gz-collection-quick-pills"
            role="region"
            aria-label="Quick category filters"
          >
            {quickPills.map((pill) => {
              const isActive = isPillActive(pill);
              return (
                <button
                  key={pill}
                  type="button"
                  className={`gz-collection-quick-pill ${isActive ? 'active' : ''}`}
                  onClick={() => togglePill(pill)}
                  aria-pressed={isActive}
                >
                  {pill} {isActive && '✓'}
                </button>
              );
            })}
          </div>
        )}

        {/* Main Section: Sidebar Filters + Products Grid */}
        <div className="gz-collection-main">
          {/* 7. Filters: Sidebar on Desktop & Drawer on Mobile */}
          <CollectionFilters
            filters={facetFilters}
            selected={selected}
            onToggle={toggleFilter}
            onClear={clearAllFilters}
            mobileOpen={mobileFilterOpen}
            onCloseMobile={() => setMobileFilterOpen(false)}
            modelGroups={filterOptions.models}
            colours={filterOptions.colours}
            prices={filterOptions.prices}
            optionSelection={effectiveSelection}
            onToggleOption={toggleOption}
          />

          {/* Product Grid Column */}
          <main className="gz-collection-content" id="collection-grid-content">
            {/* Toolbar: Mobile Filter Button + Results Count + Sort Dropdown */}
            <div className="gz-collection-toolbar">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="gz-collection-filter-toggle"
                  onClick={() => setMobileFilterOpen(true)}
                  aria-expanded={mobileFilterOpen}
                  aria-label="Open filter menu"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path
                      d="M0 2h14M2.5 7h9M5 12h4"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <span>Filters {activeCount > 0 && `(${activeCount})`}</span>
                </button>

                <div className="gz-collection-count">
                  Showing <strong>{filteredProducts.length}</strong>{' '}
                  {config.countNoun || 'products'}
                </div>
              </div>

              {/* Sort Dropdown */}
              <div className="gz-collection-sort-wrap">
                <label htmlFor="collection-sort-select" className="gz-collection-sort-label">
                  Sort by:
                </label>
                <select
                  id="collection-sort-select"
                  className="gz-collection-sort-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  aria-label="Sort products"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Active Filter Chips */}
            {activeChips.length > 0 && (
              <div
                className="gz-collection-active-chips"
                role="list"
                aria-label="Active filter chips"
              >
                {activeChips.map((chip) => (
                  <div key={chip.key} className="gz-collection-chip" role="listitem">
                    <span>{chip.label}</span>
                    <button
                      type="button"
                      className="gz-collection-chip-remove"
                      onClick={chip.onRemove}
                      aria-label={`Remove filter: ${chip.label}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="gz-collection-clear-all"
                  onClick={clearAllFilters}
                >
                  Clear all
                </button>
              </div>
            )}

            {/* 4. Product Grid */}
            <CollectionProductGrid
              products={cards}
              onClearFilters={clearAllFilters}
              saleLive={saleLive}
              emptyMessage={
                filterSelectionIsEmpty(effectiveSelection) && activeCount === 0
                  ? undefined
                  : 'No products match these filters. Clear all filters to see everything.'
              }
            />

            {/* 8. Pagination: only renders if total products > 24 */}
            <CollectionPagination
              totalItems={filteredProducts.length}
              pageSize={24}
              currentPage={1}
            />

            {/* Nominative Fair-Use Trademark Notice */}
            {config.disclaimer && (
              <div className="gz-collection-disclaimer-box" role="note">
                <p className="gz-collection-disclaimer-title">Brand &amp; Trademark Notice</p>
                <p>{config.disclaimer}</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* Trust Badges Bar */}
      <div className="w-full mt-10 border-t border-[#e5e5ea]">
        <GadzioTrustBar />
      </div>

      {/* 11. Global Footer */}
      <GlobalFooter />
    </div>
  );
}
