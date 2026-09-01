'use client';

import { useState, useMemo } from 'react';

import { GlobalFooter } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalFooter';
import { GlobalNav } from '@/components/sites/www-apple-com-736d3707/root-8a5edab2/GlobalNav';

import { FilterSidebar } from './FilterSidebar';
import { ProductGrid } from './ProductGrid';
import { PRODUCTS, SORT_OPTIONS } from './data/products';

const CATEGORY_LINKS = [
  { label: 'All Accessories', href: 'https://www.apple.com/in/shop/iphone/accessories' },
  { label: 'Cases & Protection', href: '/in/shop/iphone/accessories/cases-protection', active: true },
  { label: 'MagSafe', href: 'https://www.apple.com/in/shop/iphone/accessories/magsafe' },
  { label: 'Power & Cables', href: 'https://www.apple.com/in/shop/iphone/accessories/power-cables' },
  { label: 'Audio', href: 'https://www.apple.com/in/shop/iphone/accessories/audio' },
  { label: 'AirTag', href: 'https://www.apple.com/in/shop/iphone/accessories/airtag' },
  { label: 'Stands & Mounts', href: 'https://www.apple.com/in/shop/iphone/accessories/stands-mounts' },
  { label: 'Health & Fitness', href: 'https://www.apple.com/in/shop/iphone/accessories/health-fitness' },
];

export function CasesProtectionPage() {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('featured');
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const toggle = (list: string[], val: string) =>
    list.includes(val) ? list.filter((v) => v !== val) : [...list, val];

  const clearAll = () => {
    setSelectedModels([]);
    setSelectedMaterials([]);
    setSelectedBrands([]);
  };

  const activeChips = [
    ...selectedModels.map((v) => ({ label: v, remove: () => setSelectedModels((p) => p.filter((x) => x !== v)) })),
    ...selectedMaterials.map((v) => ({ label: v, remove: () => setSelectedMaterials((p) => p.filter((x) => x !== v)) })),
    ...selectedBrands.map((v) => ({ label: v, remove: () => setSelectedBrands((p) => p.filter((x) => x !== v)) })),
  ];

  const filtered = useMemo(() => {
    let out = PRODUCTS;

    if (selectedModels.length > 0) {
      out = out.filter((p) => p.compatibility.some((c) => selectedModels.includes(c)));
    }
    if (selectedMaterials.length > 0) {
      out = out.filter((p) => selectedMaterials.includes(p.material));
    }
    if (selectedBrands.length > 0) {
      out = out.filter((p) => selectedBrands.includes(p.brand));
    }

    if (sortBy === 'price-asc') out = [...out].sort((a, b) => a.price - b.price);
    if (sortBy === 'price-desc') out = [...out].sort((a, b) => b.price - a.price);
    if (sortBy === 'newest') out = [...out].filter((p) => p.badge === 'New').concat(out.filter((p) => p.badge !== 'New'));

    return out;
  }, [selectedModels, selectedMaterials, selectedBrands, sortBy]);

  return (
    <div className="cp-root ac-root">
      {/* ---- Global Nav (reused, not modified) ---- */}
      <GlobalNav bannerVisible={false} />

      {/* ---- Category sub-nav ---- */}
      <nav className="cp-category-nav" aria-label="iPhone Accessories categories" style={{ marginTop: 44 }}>
        <div className="cp-category-nav-inner">
          {CATEGORY_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className={`cp-cat-link ${link.active ? 'active' : ''}`}
            >
              {link.label}
            </a>
          ))}
        </div>
      </nav>

      {/* ---- Breadcrumb ---- */}
      <div className="cp-breadcrumb-bar">
        <nav className="cp-breadcrumb" aria-label="Breadcrumb">
          <span className="cp-breadcrumb-item">
            <a href="https://www.apple.com/in/store">Store</a>
          </span>
          <span className="cp-breadcrumb-sep">›</span>
          <span className="cp-breadcrumb-item">
            <a href="https://www.apple.com/in/shop/buy-iphone">iPhone</a>
          </span>
          <span className="cp-breadcrumb-sep">›</span>
          <span className="cp-breadcrumb-item">
            <a href="https://www.apple.com/in/shop/iphone/accessories">iPhone Accessories</a>
          </span>
          <span className="cp-breadcrumb-sep">›</span>
          <span className="cp-breadcrumb-item" aria-current="page">Cases &amp; Protection</span>
        </nav>
      </div>

      {/* ---- Main body ---- */}
      <div className="cp-main">
        {/* Sidebar (hidden on mobile behind toggle) */}
        <div style={{ display: showMobileFilters || typeof window === 'undefined' ? undefined : undefined }}>
          <FilterSidebar
            selectedModels={selectedModels}
            selectedMaterials={selectedMaterials}
            selectedBrands={selectedBrands}
            onToggleModel={(v) => setSelectedModels((p) => toggle(p, v))}
            onToggleMaterial={(v) => setSelectedMaterials((p) => toggle(p, v))}
            onToggleBrand={(v) => setSelectedBrands((p) => toggle(p, v))}
            onClear={clearAll}
          />
        </div>

        {/* Content */}
        <main className="cp-content" id="main-content">
          {/* Header row */}
          <div className="cp-content-header">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 0, flexWrap: 'wrap' }}>
              <h1 className="cp-page-title">Cases &amp; Protection</h1>
              <span className="cp-product-count">({filtered.length} results)</span>
            </div>

            <div className="cp-sort-bar">
              {/* Mobile filter toggle */}
              <button
                type="button"
                className="cp-mobile-filter-btn"
                onClick={() => setShowMobileFilters((p) => !p)}
                aria-expanded={showMobileFilters}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M0 2h14M3 7h8M5 12h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Filter
              </button>

              <span className="cp-sort-label">Sort by</span>
              <select
                className="cp-sort-select"
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

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="cp-active-filters" role="list" aria-label="Active filters">
              {activeChips.map((chip) => (
                <div key={chip.label} className="cp-active-filter-chip" role="listitem">
                  <span>{chip.label}</span>
                  <button
                    type="button"
                    className="cp-chip-remove"
                    onClick={chip.remove}
                    aria-label={`Remove filter: ${chip.label}`}
                  >
                    ×
                  </button>
                </div>
              ))}
              <span className="cp-clear-filters" onClick={clearAll} style={{ alignSelf: 'center' }}>
                Clear All
              </span>
            </div>
          )}

          {/* Product grid */}
          <ProductGrid products={filtered} onClear={clearAll} />
        </main>
      </div>

      {/* ---- Global Footer (reused, not modified) ---- */}
      <GlobalFooter />
    </div>
  );
}
