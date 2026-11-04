'use client';

import React, { useState } from 'react';
import { DESCRIPTION_LIMITS, createDescriptionSection, type ProductDescription, type ProductDescriptionSection } from '@/lib/catalog/product-description';
import { ProductGuide } from './ProductHelp';

type SpecificationSection = Extract<ProductDescriptionSection, { type: 'specs' }>;
type SpecificationRows = SpecificationSection['rows'];
export type ProductSpecificationsEditorProps = {
  value: ProductDescription;
  onChange: (value: ProductDescription) => void;
  disabled?: boolean;
};
export type ProductSpecificationRowsProps = {
  value: SpecificationRows;
  onChange: (value: SpecificationRows) => void;
  disabled?: boolean;
};
const buttonClass = 'sa-btn sa-btn-quiet';

/** Controlled rows shared by Basics and Description; only removal undo is local UI state. */
export function ProductSpecificationRows({ value, onChange, disabled = false }: ProductSpecificationRowsProps) {
  const [removed, setRemoved] = useState<{ row: SpecificationRows[number]; index: number }[]>([]);
  const remove = (index: number) => {
    if (disabled) return;
    setRemoved(previous => [...previous, { row: value[index], index }]);
    onChange(value.filter((_, i) => i !== index));
  };
  const undo = () => {
    if (disabled || !removed.length || value.length >= DESCRIPTION_LIMITS.items) return;
    const last = removed[removed.length - 1];
    const next = [...value];
    next.splice(Math.min(last.index, next.length), 0, last.row);
    onChange(next);
    setRemoved(previous => previous.slice(0, -1));
  };
  return <fieldset className="space-y-3" disabled={disabled}>
    <legend className="sr-only">Specification rows</legend>
    {value.map((row, index) => <fieldset key={index} className="space-y-2 rounded border border-gray-200 p-3">
      <legend>Specification {index + 1}</legend>
      {(['label', 'value'] as const).map(key => <label key={key} className="sa-field"><span className="sa-label">{key === 'label' ? 'Label' : 'Value'}</span><input className="sa-input" value={row[key]} maxLength={key === 'label' ? DESCRIPTION_LIMITS.title : DESCRIPTION_LIMITS.text} onChange={event => { if (!disabled) onChange(value.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item)); }} /></label>)}
      <button type="button" className={buttonClass} onClick={() => remove(index)}>Remove specification {index + 1}</button>
    </fieldset>)}
    {!value.length ? <p className="sa-hint">No specification rows. Add a row to enter a verified detail.</p> : null}
    <div className="sa-inline-actions">
      <button type="button" className={buttonClass} disabled={disabled || value.length >= DESCRIPTION_LIMITS.items} onClick={() => { if (!disabled && value.length < DESCRIPTION_LIMITS.items) onChange([...value, { label: '', value: '' }]); }}>Add specification</button>
      {removed.length ? <button type="button" className={buttonClass} disabled={disabled || value.length >= DESCRIPTION_LIMITS.items} onClick={undo}>Undo specification removal</button> : null}
    </div>
    {removed.length ? <p className="sa-hint" role="status">Specification removed. Undo is available while this editor stays open.</p> : null}
  </fieldset>;
}

/** Edits the existing description sections in place; never flattens or converts legacy data. */
export function ProductSpecificationsEditor({ value, onChange, disabled = false }: ProductSpecificationsEditorProps) {
  const sections = value.sections ?? [];
  const specs = sections.filter((section): section is SpecificationSection => section.type === 'specs');
  const update = (id: string, patch: Partial<SpecificationSection>) => {
    if (disabled) return;
    onChange({ ...value, sections: sections.map(section => section.id === id && section.type === 'specs' ? { ...section, ...patch } : section) });
  };
  const add = () => {
    if (disabled || sections.length >= DESCRIPTION_LIMITS.sections) return;
    let suffix = 1;
    while (sections.some(section => section.id === `section-${suffix}`)) suffix++;
    onChange({ ...value, sections: [...sections, createDescriptionSection('specs', `section-${suffix}`)] });
  };
  return <ProductGuide><fieldset className="sa-detail-section space-y-4" disabled={disabled}>
    <legend className="sa-section-title">Specifications</legend>
    <p className="sa-hint">Add verified label and value pairs, such as Material / Silicone or Warranty / 1 year. These are the same specification sections shown in Description; changes here appear there too.</p>
    {value.sections === null ? <p className="sa-notice">The older description is unchanged. Load its converted description before editing if you want to retain older content in section-based specifications.</p> : null}
    {!specs.length ? <p className="sa-hint">No specification sections added. Nothing changes until you explicitly add one.</p> : null}
    {specs.map(section => <fieldset key={section.id} className={`space-y-3 rounded border p-4 ${section.hidden ? 'border-dashed border-gray-400' : 'border-gray-200'}`}>
      <legend>{section.title || 'Specifications'}{section.hidden ? ' — Hidden' : ''}</legend>
      <label className="sa-field"><span className="sa-label">Section title</span><input className="sa-input" value={section.title} maxLength={DESCRIPTION_LIMITS.title} onChange={event => update(section.id, { title: event.target.value })} /></label>
      <label className="sa-check"><input type="checkbox" checked={section.hidden} onChange={event => update(section.id, { hidden: event.target.checked })} />Hide from storefront (keep content)</label>
      <ProductSpecificationRows value={section.rows} disabled={disabled} onChange={rows => update(section.id, { rows })} />
    </fieldset>)}
    <button type="button" className={buttonClass} disabled={disabled || sections.length >= DESCRIPTION_LIMITS.sections} onClick={add}>Add specifications section</button>
  </fieldset></ProductGuide>;
}
