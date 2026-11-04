'use client';

import { useEffect, useId, useState } from 'react';
import type { AttributePrimitive, MetadataInput, MetadataReferences } from '@/lib/catalog/product-metadata-rules';
import type { ProductMetadataState } from '@/lib/store-admin/product-metadata';
import { ProductAttributes } from './ProductAttributes';
import { ProductGuide } from './ProductHelp';
import { DeviceReferenceCreator, type CreatedDeviceReference, type DeviceReferenceKind } from './DeviceReferenceCreator';
import { SharedListInlineCreator, type SharedKind, type SharedReference } from './SharedListInlineCreator';

/** Merge a server-issued reference without touching the controlled product draft. */
export function mergeCreatedDeviceReference(references: MetadataReferences, kind: DeviceReferenceKind, reference: CreatedDeviceReference): MetadataReferences {
  return kind === 'brands'
    ? { ...references, brands: [...references.brands.filter(item => item.id !== reference.id), reference as MetadataReferences['brands'][number]] }
    : { ...references, models: [...references.models.filter(item => item.id !== reference.id), reference as MetadataReferences['models'][number]] };
}

export interface MetadataDraft {
  productTypeId: string | null;
  deviceModelIds: string[];
  attributeValues: Record<string, AttributePrimitive>;
}
export const emptyMetadataDraft = (state?: ProductMetadataState | null): MetadataDraft => ({ productTypeId: state?.productTypeId ?? null, deviceModelIds: [...(state?.deviceModelIds ?? [])], attributeValues: {} });
/** Do not send hidden draft values when moving types; the server preserves them. */
export function scopedMetadataInput(draft: MetadataDraft, references: MetadataReferences, categoryId: string): MetadataInput {
  const type = references.types.find(type => type.id === draft.productTypeId && type.categoryId === categoryId && type.isActive);
  return { productTypeId: draft.productTypeId, deviceModelIds: draft.deviceModelIds, attributeValues: Object.fromEntries(Object.entries(draft.attributeValues).filter(([id]) => type?.attributes.some(attribute => attribute.attributeId === id))) };
}

interface Props {
  references: MetadataReferences;
  state?: ProductMetadataState | null;
  categoryId: string;
  value: MetadataDraft;
  onChange: (value: MetadataDraft) => void;
  onReferencesChange?: (references: MetadataReferences) => void;
  disabled?: boolean;
  canManageDevices?: boolean;
  canCreateShared?: boolean;
  onDeviceBusyChange?: (busy: boolean) => void;
  onDeviceDirtyChange?: (dirty: boolean) => void;
}
export function ProductMetadataFields({ references: initialReferences, state, categoryId, value, onChange, onReferencesChange, disabled = false, canManageDevices = false, canCreateShared = false, onDeviceBusyChange, onDeviceDirtyChange }: Props) {
  const [references, setReferences] = useState(initialReferences);
  const [search, setSearch] = useState('');
  const [compatibilityEnabled, setCompatibilityEnabled] = useState(value.deviceModelIds.length > 0);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState('');
  const [reloadNotice, setReloadNotice] = useState('');
  const [creatorBusy, setCreatorBusy] = useState(false);
  const [createdNotice, setCreatedNotice] = useState('');
  const [brandBusy, setBrandBusy] = useState(false);
  const [modelDirty, setModelDirty] = useState(false);
  const [brandDirty, setBrandDirty] = useState(false);
  const [colourBusy, setColourBusy] = useState(false);
  const [colourDirty, setColourDirty] = useState(false);
  const [createdColours, setCreatedColours] = useState<SharedReference[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(!!value.productTypeId || !!state?.attributes.length || !!Object.keys(value.attributeValues).length);
  useEffect(() => { onDeviceDirtyChange?.(modelDirty || brandDirty || colourDirty); }, [modelDirty, brandDirty, colourDirty, onDeviceDirtyChange]);
  useEffect(() => { setReferences(initialReferences); }, [initialReferences]);
  useEffect(() => { onDeviceBusyChange?.(creatorBusy || brandBusy || colourBusy || reloading); }, [creatorBusy, brandBusy, colourBusy, reloading, onDeviceBusyChange]);
  const compatibilityId = useId();
  const categoryTypes = references.types.filter(type => type.categoryId === categoryId);
  const types = categoryTypes.filter(type => type.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const type = types.find(type => type.id === value.productTypeId);
  const activeBrands = references.brands.filter(brand => brand.isActive);
  const activeModels = references.models.filter(model => model.isActive && activeBrands.some(brand => brand.id === model.brandId));
  const matchingModels = activeModels.filter(model => `${activeBrands.find(brand => brand.id === model.brandId)?.name} ${model.name}`.toLowerCase().includes(search.trim().toLowerCase()));
  const availableModels = matchingModels.filter(model => !value.deviceModelIds.includes(model.id));
  const selected = references.models.filter(model => value.deviceModelIds.includes(model.id));
  const unknown = value.deviceModelIds.filter(id => !references.models.some(model => model.id === id));
  const typeNotice = !categoryId ? 'Choose a category first to see its optional product types.' : categoryTypes.length === 0 ? 'No product types are configured for this category. You can leave the type unset; an owner can add optional type detail fields later.' : types.length === 0 ? 'All product types for this category are inactive. You can leave the type unset, or ask an owner to activate a suitable type.' : '';
  const deviceNotice = activeModels.length === 0 ? 'No active device models are available. A model and its parent device brand must both be active; ask an owner to configure them.' : matchingModels.length === 0 ? 'No devices match your search. Try another brand or model name.' : availableModels.length === 0 ? 'All matching device models are already selected.' : '';
  const categoryQuery = categoryId ? `&category=${encodeURIComponent(categoryId)}` : '';
  async function reloadChoices(created?: { kind: DeviceReferenceKind; reference: CreatedDeviceReference }) {
    if (reloading || ((creatorBusy || brandBusy || colourBusy) && !created)) return;
    setReloading(true); onDeviceBusyChange?.(true); setReloadError(''); setReloadNotice('');
    try {
      const response = await fetch('/api/store-admin/catalog/metadata/types', { method: 'GET', cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result?.references || !Array.isArray(result.references.types) || !Array.isArray(result.references.brands) || !Array.isArray(result.references.models)) throw new Error('Could not reload catalogue choices. Your draft and previous choices are unchanged. Try again.');
      const refreshed = created ? mergeCreatedDeviceReference(result.references, created.kind, created.reference) : result.references;
      setReferences(refreshed);
      onReferencesChange?.(refreshed);
      setReloadNotice('Catalogue choices reloaded. Your draft and selected IDs are unchanged; review any unavailable selections.');
    } catch {
      setReloadError(created ? 'Device reference saved, but catalogue choices could not be reloaded. The saved reference is kept in these choices and is not selected. Retry Reload catalogue choices; do not create it again.' : 'Could not reload catalogue choices. Your draft and previous choices are unchanged. Try again.');
    } finally { setReloading(false); }
  }
  function deviceCreated(kind: DeviceReferenceKind, reference: CreatedDeviceReference) {
    const merged = mergeCreatedDeviceReference(references, kind, reference);
    setReferences(merged);
    onReferencesChange?.(merged);
    setCreatedNotice(`${reference.name} saved to the device catalogue, not selected for this product. Choose it explicitly only after verifying compatibility.`);
    void reloadChoices({ kind, reference });
  }
  function sharedCreated(kind: SharedKind, reference: SharedReference) {
    if (kind === 'models' && reference.brandId) {
      deviceCreated('models', { ...reference, brandId: reference.brandId, brandName: references.brands.find(brand => brand.id === reference.brandId)?.name ?? 'Unavailable brand' });
    } else if (kind === 'colours') {
      setCreatedColours(current => [...current.filter(item => item.id !== reference.id), reference]);
      setCreatedNotice(`${reference.name} (${reference.hex}) saved to shared colours. It is not selected or bound to any product option.`);
    }
  }
  const toggle = (id: string) => onChange({ ...value, deviceModelIds: value.deviceModelIds.includes(id) ? value.deviceModelIds.filter(item => item !== id) : [...value.deviceModelIds, id] });
  return <ProductGuide><div>
    <h2 className="sa-card-title">Product details & compatible devices</h2>
    <details open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
    <summary>Advanced: optional product type and detail fields</summary>
    <p className="sa-hint">Product type describes what you sell, such as a case or charger, and controls its detail fields. It is optional; leave it unset if you do not need mapped detail fields. Changing type keeps saved details and draft edits.</p>
    <p className="sa-hint">Product brand is the accessory maker. Device brand and model describe what it fits, not who made the accessory. Select only verified compatible devices; none are selected automatically.</p>
    <div className="sa-inline-actions">
      <a href={`/store-admin/catalog?section=types${categoryQuery}`} target="_blank" rel="noopener noreferrer">Manage product types (new tab)</a>
      <a href="/store-admin/catalog?section=devices" target="_blank" rel="noopener noreferrer">Manage device brands and models (new tab)</a>
      <a href={`/store-admin/catalog?section=details${categoryQuery}`} target="_blank" rel="noopener noreferrer">Manage type detail fields (new tab)</a>
      <button type="button" className="sa-btn sa-btn-small" disabled={reloading || creatorBusy || brandBusy || colourBusy || disabled} onClick={() => reloadChoices()}>{reloading ? 'Reloading catalogue choices…' : 'Reload catalogue choices'}</button>
    </div>
    <p className="sa-hint">Catalogue management opens in a new tab to keep this unsaved product draft here. Only an owner can change catalogue records. After changes, return here and reload catalogue choices, not the page.</p>
    <label className="sa-field">
      <span className="sa-label">Product type</span>
      <select className="sa-input" value={value.productTypeId ?? ''} disabled={disabled} onChange={event => {
        if ((state?.attributes.length || Object.keys(value.attributeValues).length || value.deviceModelIds.length) && !window.confirm('Change product type? Saved and draft values are preserved, but fields outside the new type become read-only and are not submitted. Cleared values stay archived until explicitly restored. Device selections are retained for your review.')) return;
        onChange({ ...value, productTypeId: event.target.value || null });
      }}>
        <option value="">No type selected (optional)</option>
        {value.productTypeId && !type ? <option value={value.productTypeId}>Saved type unavailable in this category — select another</option> : null}
        {types.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
    </label>
    {typeNotice ? <p className="sa-notice">{typeNotice}</p> : null}
    <ProductAttributes attributes={type?.attributes ?? []} savedValues={state?.attributes ?? []} changes={value.attributeValues} disabled={disabled} onChange={(id, primitive) => onChange({ ...value, attributeValues: { ...value.attributeValues, [id]: primitive } })} />
    {Object.keys(value.attributeValues).some(id => !type?.attributes.some(attribute => attribute.attributeId === id)) ? <details>
      <summary>Draft details kept for other product types</summary>
      <p className="sa-hint">These edits are kept while you switch types, but are not sent when you save a different type. Switch back to their product type to edit and save them.</p>
      <dl className="sa-meta">{Object.entries(value.attributeValues).filter(([id]) => !type?.attributes.some(attribute => attribute.attributeId === id)).map(([id, primitive]) => <div key={id}><dt>{references.types.flatMap(item => item.attributes).find(attribute => attribute.attributeId === id)?.label ?? id}</dt><dd>{primitive === null ? 'Clear requested' : String(primitive)}</dd></div>)}</dl>
    </details> : null}
    </details>
    {reloadError ? <p className="sa-error" role="alert">{reloadError}</p> : null}
    {reloadNotice ? <p className="sa-notice" role="status">{reloadNotice}</p> : null}
    {createdNotice ? <p className="sa-notice" role="status">{createdNotice}</p> : null}
    {canCreateShared ? <details>
      <summary>Add New Model</summary>
      <SharedListInlineCreator kind="models" brands={references.brands} canCreate={canCreateShared} disabled={disabled || reloading || brandBusy || colourBusy} onCreated={sharedCreated} onBusyChange={setCreatorBusy} onDirtyChange={setModelDirty} />
      {canManageDevices ? <details><summary>Add device brand first (owner only)</summary><DeviceReferenceCreator kind="brands" brands={references.brands} canManage={canManageDevices} disabled={disabled || reloading || creatorBusy || colourBusy} onCreated={deviceCreated} onBusyChange={setBrandBusy} onDirtyChange={setBrandDirty} /></details> : <p className="sa-hint">Only an owner can create device brands.</p>}
    </details> : null}
    {canCreateShared ? <details><summary>Add shared colour (reference only)</summary>
      <SharedListInlineCreator kind="colours" brands={references.brands} canCreate={canCreateShared} disabled={disabled || reloading || creatorBusy || brandBusy || colourBusy} onCreated={sharedCreated} onBusyChange={setColourBusy} onDirtyChange={setColourDirty} />
      <p className="sa-hint">Shared colour creation is available now; binding colours to product options is deferred. No default selection is made. <a href="/store-admin/colours" target="_blank" rel="noopener noreferrer">View shared colours (new tab)</a></p>
      {createdColours.length ? <ul>{createdColours.map(colour => <li key={colour.id}>{colour.name} ({colour.hex}) — saved, not selected</li>)}</ul> : null}
    </details> : null}
    <h3 className="sa-card-title">Compatible device models</h3>
    <p className="sa-hint">{type?.requiresCompatibility ? 'At least one active compatible device is required to publish.' : 'Optional. Select only models you have verified; nothing is selected automatically.'} {state ? state.reviewed ? 'Compatibility has been reviewed.' : 'Compatibility has not yet been reviewed.' : ''}</p>
    <label className="sa-check"><input type="checkbox" role="switch" checked={compatibilityEnabled} disabled={disabled} aria-controls={compatibilityId} aria-expanded={compatibilityEnabled} onChange={event => {
      const enabled = event.target.checked;
      if (!enabled && value.deviceModelIds.length && !window.confirm('Turn off compatible devices and clear the selected models? Active sub-items mapped to a device must be archived or replaced before saving.')) return;
      setCompatibilityEnabled(enabled);
      if (!enabled) onChange({ ...value, deviceModelIds: [] });
    }} />Compatible devices active</label>
    <p className="sa-hint">Turn on to choose verified compatible devices from the dropdown. Turning off clears this draft selection when you save; it never means universal compatibility.</p>
    {compatibilityEnabled ? <div id={compatibilityId}>
      <label className="sa-field"><span className="sa-label">Search device brands and models</span><input className="sa-input" type="search" disabled={disabled} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search verified compatible devices" /></label>
      <label className="sa-field"><span className="sa-label">Add compatible device</span><select className="sa-input" disabled={disabled} value="" onChange={event => { if (event.target.value && !value.deviceModelIds.includes(event.target.value)) toggle(event.target.value); }}>
        <option value="">Choose a compatible device</option>
        {activeBrands.map(brand => {
          const models = availableModels.filter(model => model.brandId === brand.id);
          return models.length ? <optgroup key={brand.id} label={brand.name}>{models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</optgroup> : null;
        })}
      </select></label>
      <div className="sa-category-strip" aria-label="Selected compatible devices">
        {selected.map(model => <label className="sa-check" key={model.id}><input type="checkbox" checked disabled={disabled} onChange={() => toggle(model.id)} />{model.brandName} {model.name}{!model.isActive ? ' (inactive — review)' : ''}{!activeBrands.some(brand => brand.id === model.brandId) ? ' (device brand inactive or unavailable — review)' : ''}</label>)}
        {unknown.map(id => <label className="sa-check" key={id}><input type="checkbox" checked disabled={disabled} onChange={() => toggle(id)} />{id} (unavailable — review)</label>)}
        {value.deviceModelIds.length === 0 ? <span className="sa-hint">No models selected.</span> : null}
      </div>
      {deviceNotice ? <p className="sa-empty">{deviceNotice}</p> : null}
    </div> : null}
  </div></ProductGuide>;
}
