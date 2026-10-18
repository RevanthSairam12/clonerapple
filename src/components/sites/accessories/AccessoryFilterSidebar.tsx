'use client';

import { useId, useState } from 'react';

import type { FacetDef } from './data/types';

interface AccessoryFilterSidebarProps {
  /** Filter group definitions from the category config. */
  filters: FacetDef[];
  /** Facet id -> selected values. */
  selected: Record<string, string[]>;
  /** Toggle a value within a facet group. */
  onToggle: (facetId: string, value: string) => void;
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
  const listId = useId();

  return (
    <div className="cp-filter-group">
      <button
        type="button"
        className="cp-filter-group-header"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="cp-filter-group-label">{label}</span>
        <span className={`cp-filter-chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <ul className="cp-filter-list" id={listId}>
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

export function AccessoryFilterSidebar({
  filters,
  selected,
  onToggle,
  onClear,
}: AccessoryFilterSidebarProps) {
  const hasFilters = Object.values(selected).some((vals) => vals.length > 0);

  return (
    <aside className="cp-sidebar">
      <p className="cp-sidebar-title">Filter By</p>

      {filters.map((facet) => (
        <FilterGroup
          key={facet.id}
          label={facet.label}
          options={facet.options}
          selected={selected[facet.id] ?? []}
          onToggle={(v) => onToggle(facet.id, v)}
        />
      ))}

      {hasFilters && (
        <span className="cp-clear-filters" onClick={onClear}>
          Clear All Filters
        </span>
      )}
    </aside>
  );
}
