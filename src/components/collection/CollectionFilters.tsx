'use client';

import React, { useEffect } from 'react';
import type { CollectionFacetDef } from './types';

export const SORT_OPTIONS = [
  { label: 'Featured', value: 'featured' },
  { label: 'Price: Low to High', value: 'price-asc' },
  { label: 'Price: High to Low', value: 'price-desc' },
  { label: 'Newest Arrivals', value: 'newest' },
];

export interface CollectionFiltersProps {
  filters: CollectionFacetDef[];
  selected: Record<string, string[]>;
  onToggle: (facetId: string, value: string) => void;
  onClear: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function CollectionFilters({
  filters,
  selected,
  onToggle,
  onClear,
  mobileOpen,
  onCloseMobile,
}: CollectionFiltersProps) {
  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mobileOpen) {
        onCloseMobile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  const activeCount = Object.values(selected).reduce((acc, curr) => acc + curr.length, 0);

  const renderFilterContent = () => (
    <div className="space-y-6">
      {filters.map((facet) => (
        <fieldset key={facet.id} className="gz-collection-filter-group border-none p-0 m-0">
          <legend className="gz-collection-filter-title">{facet.label}</legend>
          <div className="gz-collection-filter-options">
            {facet.options.map((option) => {
              const isChecked = (selected[facet.id] || []).includes(option);
              const inputId = `filter-${facet.id}-${option.replace(/\s+/g, '-').toLowerCase()}`;

              return (
                <label key={option} htmlFor={inputId} className="gz-collection-filter-label">
                  <input
                    id={inputId}
                    type="checkbox"
                    className="gz-collection-filter-checkbox"
                    checked={isChecked}
                    onChange={() => onToggle(facet.id, option)}
                  />
                  <span className="text-[13px] font-medium leading-none select-none">
                    {option}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar */}
      <aside className="gz-collection-sidebar" aria-label="Product filters">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-[#e5e5ea]">
          <span className="text-sm font-semibold text-[#1d1d1f] tracking-tight">
            Filters {activeCount > 0 && `(${activeCount})`}
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-medium text-[#0071e3] hover:underline cursor-pointer"
            >
              Clear all
            </button>
          )}
        </div>
        {renderFilterContent()}
      </aside>

      {/* Mobile Drawer Overlay */}
      <div
        className={`gz-collection-drawer-overlay ${mobileOpen ? 'open' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />

      {/* Mobile Slide-Out Drawer */}
      <div
        className={`gz-collection-drawer ${mobileOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Filter products"
      >
        <div className="gz-collection-drawer-header">
          <div className="flex items-center gap-2">
            <h2 className="gz-collection-drawer-title">Filters</h2>
            {activeCount > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#1d1d1f] text-white">
                {activeCount}
              </span>
            )}
          </div>
          <button
            type="button"
            className="gz-collection-drawer-close"
            onClick={onCloseMobile}
            aria-label="Close filters drawer"
          >
            ✕
          </button>
        </div>

        <div className="gz-collection-drawer-body">
          {renderFilterContent()}
        </div>

        <div className="gz-collection-drawer-footer">
          <button
            type="button"
            className="flex-1 min-h-[44px] rounded-full border border-[#d2d2d7] text-sm font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] cursor-pointer"
            onClick={onClear}
            disabled={activeCount === 0}
          >
            Clear all
          </button>
          <button
            type="button"
            className="flex-1 min-h-[44px] rounded-full bg-[#1d1d1f] text-white text-sm font-medium hover:bg-[#333336] cursor-pointer"
            onClick={onCloseMobile}
          >
            Apply Filters
          </button>
        </div>
      </div>
    </>
  );
}
