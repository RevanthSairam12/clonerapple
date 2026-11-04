'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MetadataReferences } from '@/lib/catalog/product-metadata-rules';
import type { ProductMetadataState } from '@/lib/store-admin/product-metadata';
import { emptyMetadataDraft, ProductMetadataFields, scopedMetadataInput } from './ProductMetadataFields';

interface Props {
  productId: string;
  categoryId: string;
  isActive: boolean;
  categories: Array<{ id: string; name: string; isActive: boolean }>;
  references: MetadataReferences;
  state: ProductMetadataState;
  canEdit: boolean;
}
export function ProductMetadataEditor(props: Props) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(props.categoryId);
  const [isActive, setIsActive] = useState(props.isActive);
  const [draft, setDraft] = useState(() => emptyMetadataDraft(props.state));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/products/${encodeURIComponent(props.productId)}/metadata`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scopedMetadataInput(draft, props.references, categoryId), categoryId, isActive }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save product metadata.');
      setNotice('Category, publication and metadata saved together.');
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save product metadata.'); }
    finally { setBusy(false); }
  }
  return <section className="sa-detail-section">
    <h2 className="sa-section-title">Classification, attributes & publication</h2>
    <p className="sa-hint">Category, type, compatibility, attribute changes and visibility are saved in one transaction. To resolve incomplete metadata, save as a draft first. Drafts are not visible in the storefront.</p>
    {error ? <p className="sa-error" role="alert">{error}</p> : null}
    {notice ? <p className="sa-notice" role="status">{notice}</p> : null}
    {props.state.problems.length > 0 ? <div className="sa-notice"><strong>Metadata needs review</strong><ul>{props.state.problems.map(problem => <li key={problem}>{problem}</li>)}</ul></div> : null}
    <label className="sa-field"><span className="sa-label">Category</span><select className="sa-input" value={categoryId} disabled={!props.canEdit || busy} onChange={event => {
      if ((props.state.attributes.length || Object.keys(draft.attributeValues).length || draft.productTypeId || draft.deviceModelIds.length) && !window.confirm('Change category? The type selection will be cleared. Saved and draft values are preserved but may be outside the new scope. Device selections remain for review. Category and metadata are saved together only when you press Save.')) return;
      setCategoryId(event.target.value);
      setDraft(current => ({ ...current, productTypeId: null }));
    }}>{props.categories.filter(category => category.isActive || category.id === props.categoryId).map(category => <option key={category.id} value={category.id}>{category.name}{category.isActive ? '' : ' (inactive)'}</option>)}</select></label>
    <ProductMetadataFields references={props.references} state={props.state} categoryId={categoryId} value={draft} onChange={setDraft} disabled={!props.canEdit || busy} />
    <label className="sa-check"><input type="checkbox" checked={isActive} disabled={!props.canEdit || busy} onChange={event => setIsActive(event.target.checked)} />Published in the storefront (requires complete metadata)</label>
    {props.canEdit ? <div className="sa-inline-actions"><button className="sa-btn sa-btn-primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save classification & publication'}</button><button className="sa-btn sa-btn-quiet" type="button" disabled={busy} onClick={() => { setCategoryId(props.categoryId); setIsActive(props.isActive); setDraft(emptyMetadataDraft(props.state)); setNotice(null); setError(null); }}>Reset</button></div> : <p className="sa-lock-note">Viewers cannot change metadata.</p>}
  </section>;
}
