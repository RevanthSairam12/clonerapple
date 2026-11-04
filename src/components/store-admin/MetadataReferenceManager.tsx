'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';
import type { CatalogAttribute } from '@/lib/store-admin/catalog';
import type { ManagementMapping, MetadataManagement } from '@/lib/store-admin/product-metadata';
import { DeviceReferenceCreator } from './DeviceReferenceCreator';

export type ReferenceKind = 'types' | 'brands' | 'models' | 'attributes';
type Draft = { id: string; name: string; categoryId: string; brandId: string; productTypeId: string; attributeId: string; sortOrder: number; isActive: boolean; requiresCompatibility: boolean; isRequired: boolean; showInSpecs: boolean; showInFilters: boolean; showInSearch: boolean };
const empty = (): Draft => ({ id: '', name: '', categoryId: '', brandId: '', productTypeId: '', attributeId: '', sortOrder: 0, isActive: true, requiresCompatibility: false, isRequired: false, showInSpecs: true, showInFilters: false, showInSearch: false });
const labels: Record<ReferenceKind, string> = { types: 'Product types', brands: 'Device brands', models: 'Device models', attributes: 'Type attribute mappings' };
interface Props { references: MetadataReferences; categories: Array<{ id: string; name: string; isActive?: boolean }>; attributes: CatalogAttribute[]; canEdit: boolean; group?: ReferenceKind; management?: MetadataManagement; initialCategory?: string }
export function MetadataReferenceManager({ references, categories, attributes, canEdit, group, management, initialCategory = '' }: Props) {
  const router = useRouter();
  const [selectedKind, setKind] = useState<ReferenceKind>('types');
  const kind = group ?? selectedKind;
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [category, setCategory] = useState(initialCategory);
  const [brand, setBrand] = useState('');
  const [creatorDirty, setCreatorDirty] = useState(false);
  const deviceKind = kind === 'brands' || kind === 'models';
  const unsaved = dirty || creatorDirty;
  useEffect(() => {
    if (!unsaved && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const warnNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.hasAttribute('download') || link.hash && link.pathname === window.location.pathname) return;
      if (busy || !window.confirm('Discard unsaved reference edits?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', warnNavigation, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', warnNavigation, true); };
  }, [unsaved, busy]);
  const suggestedId = (name: string) => `${kind}_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`.slice(0, 80);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setError(null); // A previous near-match confirmation cannot approve an edited name.
    setDirty(true);
    setDraft(current => ({ ...current, [key]: value, ...(key === 'name' && !editing && (!current.id || current.id === suggestedId(current.name)) ? { id: suggestedId(String(value)) } : {}) }));
  };
  const canLeave = () => !busy && (!unsaved || window.confirm('Discard unsaved reference edits?'));
  const types = [...references.types].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const fallbackMappings: ManagementMapping[] = types.flatMap(type => type.attributes.map(attribute => ({ ...attribute, productTypeId: type.id, isActive: true, attributeActive: true })));
  type Row = { id: string; label: string; description: string; active: boolean; categoryId?: string; brandId?: string; values: Partial<Draft> };
  const allRows: Row[] = kind === 'types'
    ? types.map(type => ({ id: type.id, label: type.name, description: `${categories.find(item => item.id === type.categoryId)?.name ?? type.categoryId} · ${type.requiresCompatibility ? 'Verified devices required' : 'Device selection optional'}`, active: type.isActive, categoryId: type.categoryId, values: type }))
    : kind === 'brands'
      ? references.brands.map(item => ({ id: item.id, label: item.name, description: 'Brand of a compatible device, not the product manufacturer', active: item.isActive, values: item }))
      : kind === 'models'
        ? references.models.map(model => {
          const saved = management?.modelStatus.find(item => item.id === model.id);
          return { id: model.id, label: `${model.brandName} ${model.name}`, description: `${saved && !saved.brandActive ? 'Device brand is inactive — unavailable on products' : 'Exact device model'} · Saved model status: ${(saved?.modelActive ?? model.isActive) ? 'active' : 'inactive'} · Effective availability: ${model.isActive ? 'active' : 'inactive'}`, active: model.isActive, brandId: model.brandId, values: { ...model, isActive: saved?.modelActive ?? model.isActive } };
        })
        : (management?.mappings ?? fallbackMappings).map(mapping => {
          const type = types.find(item => item.id === mapping.productTypeId);
          return { id: `${mapping.productTypeId}:${mapping.attributeId}`, label: `${type?.name ?? mapping.productTypeId} / ${mapping.label}`, description: `${mapping.isRequired ? 'Required to publish' : 'Optional detail'}${!mapping.attributeActive ? ' · field definition unavailable' : ''}`, active: mapping.isActive, categoryId: type?.categoryId, values: { ...mapping, id: mapping.attributeId } };
        });
  const rows = allRows.filter(row => (!category || row.categoryId === category || !['types', 'attributes'].includes(kind)) && (!brand || row.brandId === brand || kind !== 'models') && (status === 'all' || row.active === (status === 'active')) && `${row.label} ${row.description}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function save() {
    if (!canEdit || busy || (deviceKind && !editing)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      let confirmDeactivation = false;
      if (deviceKind && !draft.isActive) {
        const affectedModels = kind === 'models' ? references.models.filter(model => model.id === draft.id) : references.models.filter(model => model.brandId === draft.id);
        const labels: string[] = [];
        for (const model of affectedModels) {
          const uses = await fetch(`/api/store-admin/catalog/shared/models/uses?id=${encodeURIComponent(model.id)}`, { cache: 'no-store' });
          if (!uses.ok) throw new Error('Could not check affected products. Retry before deactivating.');
          const result = await uses.json();
          labels.push(...result.rows.map((row: {productName:string;label?:string}) => `${row.productName}${row.label ? ` / ${row.label}` : ''}`));
          if (result.nextCursor) labels.push('More affected options are listed in the shared-list manager.');
        }
        confirmDeactivation = window.confirm(`Hide this reference from new selections? Existing options, orders and stock remain unchanged.\n${labels.length ? labels.slice(0,50).join('\n') : 'No affected product uses found.'}`);
        if (!confirmDeactivation) return;
      }
      const confirmNearMatch = deviceKind && error?.startsWith('Did you mean ') ? window.confirm(`${error}\nSave the name exactly as entered?`) : false;
      const body = { ...draft, id: kind === 'attributes' ? draft.attributeId : draft.id, ...(confirmDeactivation ? { confirmDeactivation:true } : {}), ...(confirmNearMatch ? { confirmNearMatch:true } : {}) };
      const response = await fetch(`/api/store-admin/catalog/metadata/${kind}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save this reference.');
      setNotice('Reference saved. Publication checks and audit completed.');
      setDraft(empty()); setEditing(false); setDirty(false); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save this reference.'); }
    finally { setBusy(false); }
  }
  const select = (key: 'categoryId' | 'brandId' | 'productTypeId' | 'attributeId', label: string, options: Array<{ id: string; name: string }>, locked = false) => <label className="sa-field"><span className="sa-label">{label}</span><select className="sa-input" disabled={busy || locked} value={draft[key]} onChange={event => set(key, event.target.value)}><option value="">Select manually</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>;
  const check = (key: 'isActive' | 'requiresCompatibility' | 'isRequired' | 'showInSpecs' | 'showInFilters' | 'showInSearch', label: string) => <label className="sa-check"><input type="checkbox" checked={draft[key]} disabled={busy} onChange={event => set(key, event.target.checked)} />{label}</label>;
  return <section className="sa-detail-section sa-reference-manager">
    <h2 className="sa-section-title">{labels[kind]}</h2>
    <p className="sa-hint">{kind === 'types' ? 'Create a type inside a category, then assign its detail fields. Compatibility is always chosen deliberately on each product.' : kind === 'attributes' ? 'Choose which defined fields apply to each product type. Required fields block publication when empty.' : 'Device brands and models are separate from product brands. Add only exact device records you can verify.'}</p>
    {!group && <label className="sa-field"><span className="sa-label">Reference group</span><select className="sa-input" value={kind} disabled={busy} onChange={event => { if (!canLeave()) return; setKind(event.target.value as ReferenceKind); setDraft(empty()); setDirty(false); setCreatorDirty(false); setEditing(false); setNotice(null); setError(null); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
    <div className="sa-catalog-filters">
      <label className="sa-field"><span className="sa-label">Search {labels[kind].toLowerCase()}</span><input type="search" className="sa-input" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {['types', 'attributes'].includes(kind) && <label className="sa-field"><span className="sa-label">Category filter</span><select className="sa-input" value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      {kind === 'models' && <label className="sa-field"><span className="sa-label">Device brand filter</span><select className="sa-input" value={brand} onChange={event => setBrand(event.target.value)}><option value="">All device brands</option>{references.brands.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="sa-field"><span className="sa-label">Status</span><select className="sa-input" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Active and inactive</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
    </div>
    <div className="sa-table-wrap"><table className="sa-table"><caption>{labels[kind]} — {rows.length} shown</caption><thead><tr><th>Reference</th><th>Configuration</th><th>Status</th>{canEdit ? <th>Action</th> : null}</tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.label}</td><td>{row.description}</td><td>{row.active ? 'Active' : 'Inactive'}</td>{canEdit ? <td><button className="sa-btn sa-btn-quiet sa-btn-small" type="button" disabled={busy} onClick={() => { if (!canLeave()) return; setDraft({ ...empty(), ...row.values }); setDirty(false); setCreatorDirty(false); setEditing(true); setError(null); setNotice(null); }}>Edit</button></td> : null}</tr>)}</tbody></table></div>
    {!rows.length && <p className="sa-empty">{allRows.length ? 'No references match these filters. Clear the search or change the status/category filter.' : kind === 'attributes' ? 'No fields assigned yet. Create a field definition, then assign it to a product type.' : 'No records configured yet. An owner can add the first record below.'}</p>}
    {error && <p className="sa-error" role="alert">{error}</p>}{notice && <p className="sa-notice" role="status">{notice}</p>}
    {canEdit && deviceKind && !editing ? <DeviceReferenceCreator key={kind} kind={kind} brands={references.brands} canManage={canEdit} onBusyChange={setBusy} onDirtyChange={setCreatorDirty} onCreated={() => { setNotice('Device reference created. Refreshing the catalogue list.'); router.refresh(); }} /> : canEdit ? <fieldset disabled={busy}><legend>{editing ? 'Edit reference' : 'New reference'}</legend><div className="sa-control-grid">
      {kind !== 'attributes' && <label className="sa-field"><span className="sa-label">Name</span><input className="sa-input" value={draft.name} maxLength={kind === 'brands' ? 100 : 120} onChange={event => set('name', event.target.value)} /></label>}
      {kind === 'types' && <>{select('categoryId', 'Category', categories.map(item => ({ ...item, name: `${item.name}${item.isActive === false ? ' (inactive)' : ''}` })), editing)}{check('requiresCompatibility', 'Require verified compatible devices before publishing')}</>}
      {kind === 'models' && <>{select('brandId', 'Device brand (cannot change after creation)', references.brands.map(item => ({ id: item.id, name: `${item.name}${item.isActive ? '' : ' (inactive)'}` })), editing)}<p className="sa-hint">Active edits the saved model status. An inactive device brand still makes the model unavailable on products. Create a new model to use another brand.</p></>}
      {kind === 'attributes' && <>{select('productTypeId', 'Product type', types.map(type => ({ id: type.id, name: `${categories.find(item => item.id === type.categoryId)?.name ?? type.categoryId} / ${type.name}` })), editing)}{select('attributeId', 'Detail field definition', attributes.filter(item => (item.isActive && !item.deletedAt && item.key !== 'model') || item.id === draft.attributeId).map(item => ({ id: item.id, name: `${item.label}${item.isActive && !item.deletedAt ? '' : ' (unavailable)'}` })), editing)}{check('isRequired', 'Required to publish')}</>}
      {check('isActive', 'Active')}
    </div><details className="sa-catalog-advanced"><summary>Advanced settings{kind !== 'attributes' && !editing ? ' — review the suggested stable ID' : ''}</summary><div className="sa-control-grid">
      {kind !== 'attributes' && <label className="sa-field"><span className="sa-label">Stable ID (required)</span><input className="sa-input" value={draft.id} maxLength={80} disabled={editing} onChange={event => set('id', event.target.value)} /><span className="sa-hint">Letters, numbers, dashes and underscores. Cannot change after creation.</span></label>}
      <label className="sa-field"><span className="sa-label">Display order</span><input className="sa-input" type="number" min={0} max={9999} step={1} value={draft.sortOrder} onChange={event => set('sortOrder', Number(event.target.value))} /></label>
      {kind === 'attributes' && <>{check('showInSpecs', 'Show in specifications')}{check('showInFilters', 'Show in filters')}{check('showInSearch', 'Include in search')}</>}
    </div></details><div className="sa-inline-actions"><button className="sa-btn sa-btn-primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save reference'}</button><button className="sa-btn sa-btn-quiet" type="button" disabled={busy} onClick={() => { if (canLeave()) { setDraft(empty()); setEditing(false); setDirty(false); } }}>New / reset</button></div>{dirty && <p className="sa-hint" role="status">Unsaved reference edits. Save or reset before leaving this page.</p>}</fieldset> : <p className="sa-lock-note">Only store owners can manage metadata references.</p>}
  </section>;
}
