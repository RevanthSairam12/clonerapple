'use client';

import { useState } from 'react';

import {
  FILTER_BRANDS,
  FILTER_MATERIALS,
  FILTER_MODELS,
} from './data/products';

interface FilterSidebarProps {
  selectedModels: string[];
  selectedMaterials: string[];
  selectedBrands: string[];
  onToggleModel: (v: string) => void;
  onToggleMaterial: (v: string) => void;
  onToggleBrand: (v: string) => void;
  onClear: () => void;
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="cp-filter-group">
      <div className="cp-filter-group-header" onClick={() => setOpen((o) => !o)}>
        <span className="cp-filter-group-label">{label}</span>
        <span className={`cp-filter-chevron ${open ? 'open' : ''}`} />
      </div>

      {open && (
        <ul className="cp-filter-list">
          {options.map((opt) => {
            const checked = selected.includes(opt);
            return (
              <li
                key={opt}
                className="cp-filter-option"
                onClick={() => onToggle(opt)}
              >
                <span className={`cp-filter-checkbox ${checked ? 'checked' : ''}`} />
                <span>{opt}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function FilterSidebar({
  selectedModels,
  selectedMaterials,
  selectedBrands,
  onToggleModel,
  onToggleMaterial,
  onToggleBrand,
  onClear,
}: FilterSidebarProps) {
  const hasFilters =
    selectedModels.length > 0 ||
    selectedMaterials.length > 0 ||
    selectedBrands.length > 0;

  return (
    <aside className="cp-sidebar">
      <p className="cp-sidebar-title">Filter By</p>

      <FilterGroup
        label="Compatible With"
        options={FILTER_MODELS}
        selected={selectedModels}
        onToggle={onToggleModel}
      />

      <FilterGroup
        label="Material"
        options={FILTER_MATERIALS}
        selected={selectedMaterials}
        onToggle={onToggleMaterial}
      />

      <FilterGroup
        label="Brand"
        options={FILTER_BRANDS}
        selected={selectedBrands}
        onToggle={onToggleBrand}
      />

      {hasFilters && (
        <span className="cp-clear-filters" onClick={onClear}>
          Clear All Filters
        </span>
      )}
    </aside>
  );
}
