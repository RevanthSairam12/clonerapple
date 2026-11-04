'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CATALOG_STARTER_TEMPLATES, type CatalogStarterPreview, type CatalogStarterSelection } from '@/lib/catalog/catalog-starter-rules';

interface Props { categories: Array<{ id: string; name: string; slug: string; isActive: boolean }>; available: boolean }
const statusLabels = { create: 'Create', reuse: 'Already configured', conflict: 'Conflict', missing: 'Missing prerequisite' };
export function CatalogStarterSetup({ categories, available }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selections, setSelections] = useState<CatalogStarterSelection[]>([]);
  const [preview, setPreview] = useState<CatalogStarterPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  function change(next: CatalogStarterSelection[]) { setSelections(next); setPreview(null); setError(null); setNotice(null); }
  async function submit(apply: boolean) {
    if (apply && !preview?.canApply) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/setup/${apply ? 'apply' : 'preview'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selections, ...(apply ? { fingerprint: preview?.fingerprint } : {}) }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { if (apply) setPreview(null); throw new Error(body.error || 'Could not prepare catalogue setup. Retry without changing existing records.'); }
      setPreview(body.preview);
      if (apply) {
        const counts = body.applied;
        setNotice(body.noop ? 'These references are already configured. No changes were needed.' : `Setup complete: ${counts.types} types, ${counts.attributes} detail fields, ${counts.mappings} assignments created. No products or devices changed.`);
        setPreview(null); router.refresh();
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not complete catalogue setup.'); }
    finally { setBusy(false); }
  }
  return <section className="sa-catalog-starter" aria-label="Suggested catalogue setup">
    <div className="sa-inline-actions"><strong>Need a starting point?</strong><button className="sa-btn" type="button" disabled={!available || busy} aria-expanded={open} onClick={() => { setOpen(!open); setPreview(null); }}>Preview starter setup</button></div>
    <p className="sa-hint">Suggested product types and optional details only. No automatic product assignments or device compatibility.</p>
    {!available && <p className="sa-notice">Starter setup needs categories, units, fields and metadata references to load successfully. Retry the page first.</p>}
    {open && <div>
      <p>Select the groups you want, then review the exact changes. Nothing is written until you confirm a valid preview.</p>
      <fieldset disabled={busy}><legend>Suggested types</legend>{CATALOG_STARTER_TEMPLATES.map(template => {
        const selection = selections.find(item => item.templateId === template.id);
        const match = categories.find(category => category.isActive && category.slug === template.categorySlug);
        return <div className="sa-catalog-template" key={template.id}>
          <label className="sa-check"><input type="checkbox" checked={!!selection} onChange={event => change(event.target.checked ? [...selections, { templateId: template.id }] : selections.filter(item => item.templateId !== template.id))} />{template.name}</label>
          <p className="sa-hint">Details: {template.attributes.map(attribute => `${attribute.label} (${attribute.dataType})`).join(', ')}. {template.requiresCompatibility ? 'Verified compatible devices required before publication.' : 'Compatible devices optional, never assumed.'} Detail values are optional.</p>
          {selection && <label className="sa-field"><span className="sa-label">Category for {template.name}</span><select className="sa-input" value={selection.categoryId ?? ''} onChange={event => change(selections.map(item => item.templateId === template.id ? { templateId: item.templateId, ...(event.target.value ? { categoryId: event.target.value } : {}) } : item))}><option value="">{match ? `Exact category match: ${match.name}` : `No active exact match for ${template.categorySlug} — select or skip`}</option>{categories.filter(category => category.isActive).map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
        </div>;
      })}</fieldset>
      <button type="button" className="sa-btn" disabled={busy || !selections.length} onClick={() => submit(false)}>{busy ? 'Working…' : 'Review selected setup'}</button>
      {preview && <div className="sa-detail-card">
        <h3 className="sa-card-title">Review before creating references</h3>
        <p>Creates {preview.summary.types} types, {preview.summary.attributes} fields and {preview.summary.mappings} assignments. Existing records are never overwritten or reactivated.</p>
        <div className="sa-table-wrap"><table className="sa-table"><caption>Proposed reference changes</caption><thead><tr><th>Reference</th><th>Result</th><th>Details</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.templateId}:${row.kind}:${row.id}:${index}`}><td>{row.label}<span className="sa-row-sub">{row.kind}{row.dataType ? ` · ${row.dataType}` : ''}{row.unitId ? ` · unit ${row.unitId}` : ''}</span></td><td>{statusLabels[row.status]}</td><td>{row.message}{row.options?.length ? ` Existing options: ${row.options.join(', ')}` : ''}</td></tr>)}</tbody></table></div>
        <p className="sa-hint">New details: optional, shown in specifications, not added to filters/search. No device records, product values, prices or stock are changed.</p>
        {(preview.schema.missing.length > 0 || preview.schema.rlsDisabled.length > 0) && <p className="sa-notice">Catalogue schema or security prerequisites are not ready. Ask the owner to check the required migrations separately. This setup does not install migrations or change database security.</p>}
        {!preview.canApply && <p className="sa-notice">Resolve the listed conflicts/prerequisites or deselect those groups, then preview again.</p>}
        <div className="sa-inline-actions"><button className="sa-btn sa-btn-primary" type="button" disabled={busy || !preview.canApply} onClick={() => submit(true)}>Confirm reference setup</button><button className="sa-btn sa-btn-quiet" type="button" disabled={busy} onClick={() => setPreview(null)}>Cancel preview</button></div>
      </div>}
    </div>}
    {error && <p className="sa-error" role="alert">{error}</p>}{notice && <p className="sa-notice" role="status">{notice}</p>}
  </section>;
}
