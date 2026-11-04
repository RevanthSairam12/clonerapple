'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { safeSharedCsv, type SharedInput, type SharedKind, type SharedPlan, type SharedReference, type SharedRow, type SharedSnapshot } from '@/lib/catalog/shared-list-rules';

interface Preview { plan: SharedPlan; token: string }
interface UseRow { productId: string; productName: string; variantId?: string; label?: string; sku?: string; active: boolean }
interface Draft { id: string; name: string; hex: string; sortOrder: string; isActive: boolean }
const emptyDraft = (): Draft => ({ id: '', name: '', hex: '', sortOrder: '0', isActive: true });
export async function decodeSharedUpload(file: Pick<File, 'size' | 'arrayBuffer'>): Promise<string> {
  if (file.size > 262144) throw new Error('Input must be at most 256 KiB, including the header, BOM and line endings.');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 262144) throw new Error('Input must be at most 256 KiB.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('Upload a valid UTF-8 file. Invalid bytes are not replaced.'); }
}
function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}
export function sharedErrorsCsv(rows: SharedRow[]): string {
  return safeSharedCsv([['row', 'status', 'name', 'reason', 'suggestions'], ...rows.filter(row => row.status === 'invalid' || row.status === 'near').map(row => [row.row, row.status, row.name, row.reason, row.suggestions.join('; ')])]);
}
/** Bounded owner workflows; every import confirmation uses a server-issued preview token. */
export function SharedListManager({ kind, snapshot: initialSnapshot, canManage = false }: { kind: SharedKind; snapshot: SharedSnapshot; canManage?: boolean }) {
  const inputId = useId();
  const inputHelpId = `${inputId}-help`;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [format, setFormat] = useState<'csv' | 'paste'>('paste');
  const [text, setText] = useState('');
  const [brandId, setBrandId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [acknowledged, setAcknowledged] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [warning, setWarning] = useState(false);
  const [nearWarning, setNearWarning] = useState(false);
  const [confirmNearMatch, setConfirmNearMatch] = useState(false);
  function edited() { setWarning(false); setNearWarning(false); setConfirmNearMatch(false); }
  const [uses, setUses] = useState<UseRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [usesLoaded, setUsesLoaded] = useState(false);
  const pending = useRef(false);
  useEffect(() => { setSnapshot(initialSnapshot); }, [initialSnapshot]);
  useEffect(() => {
    const dirty = !!text || !!draft.id || !!draft.name;
    function beforeUnload(event: BeforeUnloadEvent) { if (dirty || pending.current) { event.preventDefault(); event.returnValue = ''; } }
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [text, draft]);
  const endpoint = `/api/store-admin/catalog/shared/${kind}`;
  const input: SharedInput = { kind, format, text, ...(kind === 'models' && format === 'paste' && brandId ? { brandId } : {}) };
  const references = snapshot[kind];
  const near = preview?.plan.rows.filter(row => row.status === 'near') ?? [];
  function invalidate() { setPreview(null); setAcknowledged([]); setError(''); setNotice(''); }
  async function json(url: string, method = 'GET', body?: unknown) {
    const response = await fetch(url, { method, cache: 'no-store', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (result?.code === 'SHARED_NEAR_MATCH') { setNearWarning(true); setConfirmNearMatch(false); }
      const stale = response.status === 409 && url.endsWith('/apply');
      if (stale) { setPreview(null); setAcknowledged([]); }
      throw new Error(stale ? 'The catalogue or preview changed. Your input is kept. Refresh the preview before confirming again.' : typeof result?.error === 'string' ? result.error : 'The request could not be completed. Your input is kept.');
    }
    return result;
  }
  async function run(action: () => Promise<void>) {
    if (pending.current || !canManage) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (caught) { setError(caught instanceof Error ? caught.message : 'The request could not be completed. Your input is kept.'); }
    finally { pending.current = false; setBusy(false); }
  }
  async function refresh() {
    const result = await json(endpoint);
    if (!result?.snapshot || !['brands', 'models', 'colours'].every(key => Array.isArray(result.snapshot[key]))) throw new Error('Could not reload shared choices. Retry before making another change.');
    setSnapshot(result.snapshot);
  }
  async function makePreview() {
    setPreview(null); setAcknowledged([]);
    const result = await json(`${endpoint}/preview`, 'POST', input);
    if (!Array.isArray(result?.plan?.rows) || typeof result?.token !== 'string' || !result.token) throw new Error('Preview was unavailable. Your input is kept; try Preview again.');
    setPreview(result);
  }
  async function apply() {
    if (!preview || near.some(row => !acknowledged.includes(row.row))) return;
    const confirmed = preview; setPreview(null); setAcknowledged([]);
    let result;
    try { result = await json(`${endpoint}/apply`, 'POST', { input, token: confirmed.token, acknowledgedRows: acknowledged }); }
    catch (caught) { throw new Error(`${caught instanceof Error ? caught.message : 'Apply outcome is unknown.'} Reload shared choices and preview the same input before another confirmation; do not assume nothing was saved.`); }
    setNotice(`Created ${result.created}; already in the list ${result.existing}; invalid ${result.invalid}.${result.noop ? ' No catalogue changes.' : ''} Existing records are never overwritten.`);
    await refresh();
  }
  async function csvDownload(action: 'template' | 'export') {
    const response = await fetch(`${endpoint}/${action}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('CSV download is unavailable. Check your permissions and try again.');
    download(await response.text(), `${kind}-${action}.csv`);
  }
  async function loadUses(id: string, next?: string) {
    const result = await json(`${endpoint}/uses?id=${encodeURIComponent(id)}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`);
    if (!Array.isArray(result?.rows) || !(result.nextCursor === null || typeof result.nextCursor === 'string')) throw new Error('Affected uses are unavailable; deactivation has not been confirmed.');
    setUses(current => next ? [...current, ...result.rows] : result.rows); setCursor(result.nextCursor); setUsesLoaded(true);
  }
  function edit(reference: SharedReference) {
    setDraft({ id: reference.id, name: reference.name, hex: reference.hex ?? '', sortOrder: String(reference.sortOrder), isActive: reference.isActive });
    edited(); setUses([]); setCursor(null); setUsesLoaded(false); setError(''); setNotice('');
  }
  async function save(confirmDeactivation = false) {
    if (nearWarning && !confirmNearMatch) return;
    const existing = references.find(item => item.id === draft.id);
    if (!draft.name.trim() || draft.name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(draft.name)) throw new Error('Enter a name of up to 120 characters without control characters.');
    if (!/^\d+$/.test(draft.sortOrder) || Number(draft.sortOrder) > 9999) throw new Error('Display order must be a whole number from 0 to 9999.');
    if (kind === 'colours' && !/^#[0-9a-fA-F]{6}$/.test(draft.hex.trim())) throw new Error('Enter a six-digit hex colour including #.');
    if (existing?.isActive && !draft.isActive && !confirmDeactivation) { setWarning(true); await loadUses(existing.id); return; }
    if (confirmDeactivation && (!warning || !usesLoaded || !existing?.isActive || draft.isActive)) return;
    const payload = { ...(draft.id ? { id: draft.id } : {}), ...(kind === 'models' ? { brandId: existing?.brandId } : {}), name: draft.name.trim(), ...(kind === 'colours' ? { hex: draft.hex.trim().toUpperCase() } : {}), sortOrder: Number(draft.sortOrder), isActive: draft.isActive, ...(confirmDeactivation ? { confirmDeactivation: true } : {}), ...(confirmNearMatch ? { confirmNearMatch: true } : {}) };
    await json(endpoint, draft.id ? 'PUT' : 'POST', payload);
    setDraft(emptyDraft()); edited(); setNotice('Shared reference saved. No product selections or saved option identities were changed.'); await refresh();
  }
  return <section className="sa-card" aria-busy={busy}>
    <h2 className="sa-card-title">Shared {kind === 'models' ? 'device models' : 'colours'}</h2>
    <p className="sa-hint">Active choices are available for new selections. Inactive references remain visible here for review; existing saved identities are not rewritten.</p>
    {!canManage ? <p className="sa-lock-note">Browse only. Owners manage shared lists; admins can create models and colours inline while editing a product.</p> : null}
    {error ? <p className="sa-error" role="alert">{error}</p> : null}{notice ? <p className="sa-notice" role="status">{notice}</p> : null}
    <ul className="sa-meta">{references.map(reference => <li key={reference.id} style={{ overflowWrap: 'anywhere' }}>
      {kind === 'models' ? `${snapshot.brands.find(brand => brand.id === reference.brandId)?.name ?? 'Unavailable brand'} — ` : null}
      {kind === 'colours' && /^#[0-9A-F]{6}$/.test(reference.hex ?? '') ? <span aria-hidden="true" style={{ display: 'inline-block', width: 16, height: 16, marginRight: 6, border: '1px solid currentColor', backgroundColor: reference.hex }} /> : null}
      {reference.name}{reference.hex ? ` (${reference.hex})` : ''} — {reference.isActive ? 'Active' : 'Inactive — review'}{kind === 'models' && !snapshot.brands.some(brand => brand.id === reference.brandId && brand.isActive) ? ' (brand inactive — review)' : ''}
      {canManage ? <button type="button" className="sa-btn sa-btn-small" disabled={busy} onClick={() => edit(reference)}>Edit {reference.name}</button> : null}
    </li>)}</ul>
    {!references.length ? <p className="sa-empty">No shared {kind} have been added.</p> : null}
    {canManage ? <>
      {kind === 'models' ? <p className="sa-hint">Use the existing owner manager above to add individual models and brands. Bulk import never creates a missing brand.</p> : null}
      {kind === 'colours' || draft.id ? <fieldset disabled={busy} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault(); }}><legend>{draft.id ? 'Edit shared reference' : 'Add shared colour'}</legend>
        <label className="sa-field"><span className="sa-label">Name</span><input className="sa-input" maxLength={120} value={draft.name} onChange={event => { setDraft({ ...draft, name: event.target.value }); edited(); }} /></label>
        {kind === 'colours' ? <label className="sa-field"><span className="sa-label">Hex (#RRGGBB)</span><input className="sa-input" maxLength={7} value={draft.hex} onChange={event => { setDraft({ ...draft, hex: event.target.value }); edited(); }} /></label> : null}
        <label className="sa-field"><span className="sa-label">Display order</span><input className="sa-input" type="number" min={0} max={9999} step={1} value={draft.sortOrder} onChange={event => { setDraft({ ...draft, sortOrder: event.target.value }); edited(); }} /></label>
        <label className="sa-check"><input type="checkbox" checked={draft.isActive} onChange={event => { setDraft({ ...draft, isActive: event.target.checked }); edited(); }} />Active</label>
        {nearWarning ? <label className="sa-check"><input type="checkbox" checked={confirmNearMatch} onChange={event => setConfirmNearMatch(event.target.checked)} />Create as entered after reviewing near matches. Keep this exact name; do not merge or correct it.</label> : null}
        <div className="sa-inline-actions"><button type="button" className="sa-btn" disabled={nearWarning && !confirmNearMatch} onClick={() => run(() => save())}>Save shared reference</button><button type="button" className="sa-btn sa-btn-quiet" onClick={() => { setDraft(emptyDraft()); edited(); }}>Cancel reference edit</button></div>
      </fieldset> : null}
      {warning ? <div role="region" aria-label="Confirm deactivation"><h3>Review affected products and options</h3><p className="sa-notice">Deactivation removes this reference from new choices. Saved options may retain their existing reference. No options, orders or stock will be rewritten. Review the named uses before confirming.</p>
        <ul>{uses.map((use, index) => <li key={`${use.productId}-${use.variantId ?? ''}-${index}`}>{use.productName}{use.label ? ` — ${use.label}` : ''}{use.sku ? ` (SKU ${use.sku})` : ''} — {use.active ? 'active' : 'inactive'}</li>)}</ul>
        {usesLoaded && !uses.length ? <p>No affected uses were found.</p> : null}
        {cursor ? <button type="button" className="sa-btn" disabled={busy} onClick={() => run(() => loadUses(draft.id, cursor))}>Load more affected uses</button> : null}
        {!usesLoaded ? <button type="button" className="sa-btn" disabled={busy} onClick={() => run(() => loadUses(draft.id))}>Retry affected uses</button> : null}
        <button type="button" className="sa-btn" disabled={busy || !usesLoaded} onClick={() => run(() => save(true))}>Confirm deactivation</button><button type="button" className="sa-btn" disabled={busy} onClick={() => setWarning(false)}>Cancel deactivation</button>
      </div> : null}
      <details><summary>Import, preview and downloads</summary>
        <p className="sa-hint">Maximum 500 data records (CSV header and blank paste lines excluded). Input is limited to 256 KiB including BOM/header/line endings; the entire JSON request, including escaping and the confirmation token, must also fit 262,144 bytes. A file near the limit may therefore need splitting into smaller batches. Server validation is authoritative. Preview does not write. Existing records, including inactive records, are never overwritten.</p>
        <p className="sa-hint">{kind === 'models' ? 'Paste one model per line with a selected brand, or Brand, Model per line. CSV requires brand,model; optional sort_order,active. Unknown brands must be created explicitly by an owner first.' : 'Paste Name #RRGGBB per line. CSV requires name,hex; optional sort_order,active. Name/hex disagreements are conflicts, never guessed matches.'}</p>
        <div className="sa-inline-actions"><button type="button" className="sa-btn" disabled={busy} onClick={() => run(() => csvDownload('template'))}>Download header-only template</button><button type="button" className="sa-btn" disabled={busy} onClick={() => run(() => csvDownload('export'))}>Export shared list CSV</button><button type="button" className="sa-btn" disabled={busy} onClick={() => run(refresh)}>Reload shared choices</button></div>
        <label className="sa-field"><span className="sa-label">Input format</span><select className="sa-input" disabled={busy} value={format} onChange={event => { setFormat(event.target.value as 'csv' | 'paste'); invalidate(); }}><option value="paste">Paste</option><option value="csv">CSV</option></select></label>
        {kind === 'models' && format === 'paste' ? <label className="sa-field"><span className="sa-label">Brand for model-only lines (optional)</span><select className="sa-input" disabled={busy} value={brandId} onChange={event => { setBrandId(event.target.value); invalidate(); }}><option value="">Each line supplies Brand, Model</option>{snapshot.brands.filter(brand => brand.isActive).map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label> : null}
        <label className="sa-field"><span className="sa-label">UTF-8 CSV file</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(async () => { const decoded = await decodeSharedUpload(file); setText(decoded); setFormat('csv'); setBrandId(''); invalidate(); }); }} /></label>
        <div className="sa-field">
          <label className="sa-label" htmlFor={inputId}>Shared-list input</label>
          <p id={inputHelpId} className="sa-hint">Enter or upload the list, then preview it before confirming new rows.</p>
          <textarea id={inputId} aria-describedby={inputHelpId} className="sa-input" rows={8} style={{ width: '100%', maxWidth: '100%' }} disabled={busy} value={text} onChange={event => { setText(event.target.value); invalidate(); }} />
        </div>
        <button type="button" className="sa-btn" disabled={busy || !text.trim()} onClick={() => run(makePreview)}>Preview shared list</button>
        {preview ? <div><h3>Preview — not yet saved</h3><p>{Object.entries(preview.plan.counts).map(([key, count]) => `${key}: ${count}`).join('; ')}</p>
          <ol>{preview.plan.rows.map(row => <li key={row.row} style={{ overflowWrap: 'anywhere' }}><strong>Row {row.row}: {row.status === 'existing' ? 'Already in the list' : row.status === 'near' ? 'Near match' : row.status === 'new' ? 'New' : 'Invalid'}</strong> — {row.name}{row.hex ? ` ${row.hex}` : ''}. {row.reason}{row.suggestions.length ? ` Suggestions: ${row.suggestions.join(', ')}.` : ''}
            {row.status === 'near' ? <label className="sa-check"><input type="checkbox" disabled={busy} checked={acknowledged.includes(row.row)} onChange={event => setAcknowledged(current => event.target.checked ? [...current, row.row] : current.filter(value => value !== row.row))} />I reviewed row {row.row} and want to create this exact name; do not merge or correct it.</label> : null}
          </li>)}</ol>
          <button type="button" className="sa-btn" disabled={busy} onClick={() => { try { download(sharedErrorsCsv(preview.plan.rows), `${kind}-preview-errors.csv`); } catch { setError('Could not prepare the safe error CSV. Your input is kept.'); } }}>Download invalid / near-match report</button>
          <button type="button" className="sa-btn sa-btn-primary" disabled={busy || near.some(row => !acknowledged.includes(row.row))} onClick={() => run(apply)}>Confirm valid new rows</button>
        </div> : null}
      </details>
    </> : null}
  </section>;
}
