'use client';

import type { AttributePrimitive, TypeAttribute } from '@/lib/catalog/product-metadata-rules';
import type { SavedAttribute } from '@/lib/store-admin/product-metadata';
import { ProductGuide } from './ProductHelp';

interface Props {
  attributes: TypeAttribute[];
  savedValues: SavedAttribute[];
  changes: Record<string, AttributePrimitive>;
  disabled: boolean;
  onChange: (id: string, value: AttributePrimitive) => void;
}

/** Only the selected type's mapped attributes are editable. No global fallback. */
export function ProductAttributes({ attributes, savedValues, changes, disabled, onChange }: Props) {
  const hidden = savedValues.filter(value => value.archived || !attributes.some(a => a.attributeId === value.attributeId));
  return (
    <ProductGuide><div>
      <h3 className="sa-card-title">Details for this product type</h3>
      <p className="sa-hint">Fill in the details for your chosen type. Saved details for other types are kept.</p>
      <p className="sa-hint">Clear removes a detail from use but keeps its saved value. Use Restore saved value or enter a new value to use it again.</p>
      {attributes.length === 0 ? <p className="sa-empty">Choose a product type with details to fill in. Only details for the selected type appear here.</p> : null}
      <div className="sa-control-grid">
        {attributes.map(attribute => {
          const stored = savedValues.find(value => value.attributeId === attribute.attributeId);
          const changed = Object.hasOwn(changes, attribute.attributeId);
          const value = changed ? changes[attribute.attributeId] : stored && !stored.archived ? stored.value : null;
          const raw = value === null || value === undefined ? '' : String(value);
          const input = (text: string) => onChange(attribute.attributeId, text === '' ? null : attribute.dataType === 'boolean' ? text === 'true' : attribute.dataType === 'number' ? Number(text) : text);
          return <div className="sa-field" key={attribute.attributeId}>
            <label className="sa-field" data-product-help={`${attribute.label}: ${attribute.dataType === 'enum' ? `choose one of the configured choices (${attribute.options.join(', ')}).` : attribute.dataType === 'boolean' ? 'choose Yes, No or Not set.' : attribute.dataType === 'number' ? 'enter a number, or leave blank if not required.' : 'enter the product detail, or leave blank if not required.'} ${attribute.isRequired ? 'Required before publishing.' : 'Optional.'} Clearing keeps the previous saved value for later restoration.`}>
              <span className="sa-label">{attribute.label}{attribute.isRequired ? ' (required to publish)' : ''}</span>
              {attribute.dataType === 'enum' || attribute.dataType === 'boolean' ? <select className="sa-input" disabled={disabled} value={raw} onChange={event => input(event.target.value)}>
                <option value="">Not set</option>
                {attribute.dataType === 'boolean' ? <><option value="true">Yes</option><option value="false">No</option></> : attribute.options.map(option => <option key={option} value={option}>{option}</option>)}
              </select> : <input className="sa-input" disabled={disabled} type={attribute.dataType === 'number' ? 'number' : 'text'} step={attribute.dataType === 'number' ? 'any' : undefined} maxLength={2000} value={raw} onChange={event => input(event.target.value)} />}
            </label>
            {!disabled ? <div className="sa-inline-actions">
              <button className="sa-btn sa-btn-quiet sa-btn-small" type="button" onClick={() => onChange(attribute.attributeId, null)}>Clear</button>
              {stored && stored.archived && stored.value !== null ? <button className="sa-btn sa-btn-quiet sa-btn-small" type="button" onClick={() => onChange(attribute.attributeId, stored.value)}>Restore saved value</button> : null}
            </div> : null}
          </div>;
        })}
      </div>
      {hidden.length > 0 ? <details>
        <summary>Saved details not in use ({hidden.length})</summary>
        <p className="sa-hint">These details cannot be edited here. Choose their product type to restore or clear them.</p>
        <dl className="sa-meta">{hidden.map(value => <div key={value.attributeId}><dt>{value.label}</dt><dd>{String(value.value ?? 'Not set')} · {value.archived ? 'cleared — saved value kept' : 'for another product type'}</dd></div>)}</dl>
      </details> : null}
    </div></ProductGuide>
  );
}
