'use client';

import { useEffect, useRef, useState } from 'react';

import type { SharedKind, SharedReference } from '@/lib/catalog/shared-list-rules';
export type { SharedKind, SharedReference, SharedSnapshot } from '@/lib/catalog/shared-list-rules';
interface Props {
  kind: SharedKind;
  brands: SharedReference[];
  canCreate?: boolean;
  disabled?: boolean;
  onCreated: (kind: SharedKind, reference: SharedReference) => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
export function validSharedReference(kind: SharedKind, value: unknown): value is SharedReference {
  if (!value || typeof value !== 'object') return false;
  const item = value as SharedReference;
  return typeof item.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(item.id)
    && typeof item.name === 'string' && !!item.name.trim() && item.name.length <= 120 && !/[\u0000-\u001f\u007f]/.test(item.name)
    && typeof item.isActive === 'boolean' && Number.isInteger(item.sortOrder) && item.sortOrder >= 0 && item.sortOrder <= 9999
    && (kind === 'models' ? typeof item.brandId === 'string' && !!item.brandId : typeof item.hex === 'string' && /^#[0-9A-F]{6}$/.test(item.hex));
}
export function inlineSharedPayload(kind: SharedKind, name: string, detail: string, brands: SharedReference[]): { name: string; brandId?: string; hex?: string } {
  if (!name.trim() || name.trim().length > 120 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Enter a name of up to 120 characters without control characters.');
  if (kind === 'models' && !brands.some(brand => brand.id === detail && brand.isActive)) throw new Error('Choose an active device brand. Only an owner can add a brand.');
  if (kind === 'colours' && !/^#[0-9a-fA-F]{6}$/.test(detail.trim())) throw new Error('Enter a six-digit hex colour, including #.');
  return { name: name.trim(), ...(kind === 'models' ? { brandId: detail } : { hex: detail.trim().toUpperCase() }) };
}
const unknownOutcome = 'The create outcome is unknown. Do not create it again. Use Check saved shared list; your product draft and input are kept.';

/** Create-only, with no product association, navigation, nested form or automatic selection. */
export function SharedListInlineCreator({ kind, brands, canCreate = false, disabled = false, onCreated, onBusyChange, onDirtyChange }: Props) {
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nearWarning, setNearWarning] = useState(false);
  const [confirmNearMatch, setConfirmNearMatch] = useState(false);
  function changed() { setDirty(true); setNearWarning(false); setConfirmNearMatch(false); }
  const pending = useRef(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const locked = disabled || busy || ambiguous || !canCreate;
  function saved(reference: SharedReference) {
    setName(''); if (kind === 'colours') setDetail(''); setDirty(false); setAmbiguous(false); setNearWarning(false); setConfirmNearMatch(false); setError('');
    setNotice(`${reference.name} saved to the shared list, not selected or bound to this product.`);
    try { onCreated(kind, reference); }
    catch { setNotice('Reference saved, but local choices could not be updated. Reload catalogue choices only; do not create it again.'); }
  }
  async function create() {
    if (locked || pending.current || (nearWarning && !confirmNearMatch)) return;
    let payload: ReturnType<typeof inlineSharedPayload>;
    try { payload = inlineSharedPayload(kind, name, detail, brands); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check your input.'); return; }
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/store-admin/catalog/shared/${kind}/inline`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, ...(confirmNearMatch ? { confirmNearMatch: true } : {}) }) });
      const body = await response.json().catch(() => null);
      if ([400, 401, 403, 409, 422, 429].includes(response.status)) { setError(typeof body?.error === 'string' ? body.error : 'Reference was not created. Check the input and permissions.'); if (response.status === 409) { setNearWarning(body?.code === 'SHARED_NEAR_MATCH' || /near match/i.test(body?.error ?? '')); setConfirmNearMatch(false); } return; }
      const reference: unknown = body?.reference;
      if (!response.ok || !validSharedReference(kind, reference) || reference.name !== payload.name || !reference.isActive || (kind === 'models' ? reference.brandId !== payload.brandId : reference.hex !== payload.hex)) throw new Error('Unknown outcome');
      saved(reference);
    } catch { setAmbiguous(true); setError(unknownOutcome); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function checkSaved() {
    if (pending.current || disabled || !canCreate) return;
    pending.current = true; setBusy(true); onBusyChange?.(true);
    try {
      const response = await fetch(`/api/store-admin/catalog/shared/${kind}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body?.snapshot?.[kind])) throw new Error('Unavailable');
      const match = body.snapshot[kind].find((item: unknown) => validSharedReference(kind, item) && item.name === name.trim() && item.isActive && (kind === 'models' ? item.brandId === detail : item.hex === detail.trim().toUpperCase()));
      if (match) saved(match);
      else setError('No exact active match was found. The outcome is still unverified; do not repeat the create. Ask an owner to check the shared list. Your draft is kept.');
    } catch { setError('Could not check the shared list. Do not create it again. Your input and product draft are kept.'); }
    finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  if (!canCreate) return null;
  return <fieldset aria-busy={busy} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type !== 'checkbox') event.preventDefault(); }}>
    <legend>New shared {kind === 'models' ? 'device model' : 'colour'}</legend>
    <p className="sa-hint">Create a reusable reference only. This does not save this product, select a device, or bind a colour to an option.</p>
    <label className="sa-field"><span className="sa-label">{kind === 'models' ? 'Device model name' : 'Colour name'}</span><input className="sa-input" disabled={locked} maxLength={120} value={name} onChange={event => { setName(event.target.value); changed(); }} /></label>
    {kind === 'models' ? <label className="sa-field"><span className="sa-label">Device brand</span><select className="sa-input" disabled={locked} value={detail} onChange={event => { setDetail(event.target.value); changed(); }}><option value="">Choose an active device brand</option>{brands.filter(brand => brand.isActive).map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label> : <label className="sa-field"><span className="sa-label">Hex colour (#RRGGBB)</span><input className="sa-input" disabled={locked} maxLength={7} value={detail} placeholder="#RRGGBB" onChange={event => { setDetail(event.target.value); changed(); }} /></label>}
    {kind === 'models' && !brands.some(brand => brand.isActive) ? <p className="sa-hint">An owner must create or activate a device brand first. Admins cannot create brands.</p> : null}
    {error ? <p className="sa-error" role="alert">{error}</p> : null}{notice ? <p className="sa-notice" role="status">{notice}</p> : null}
    {nearWarning ? <label className="sa-check"><input type="checkbox" disabled={locked} checked={confirmNearMatch} onChange={event => setConfirmNearMatch(event.target.checked)} />Create as entered after reviewing near matches. Do not merge or correct the name.</label> : null}
    <div className="sa-inline-actions"><button type="button" className="sa-btn sa-btn-small" disabled={locked || (nearWarning && !confirmNearMatch)} onClick={create}>{busy ? 'Working…' : `Create ${kind === 'models' ? 'device model' : 'colour'}`}</button><button type="button" className="sa-btn sa-btn-quiet" disabled={locked} onClick={() => { setName(''); setDetail(''); setDirty(false); setNearWarning(false); setConfirmNearMatch(false); setError(''); setNotice(''); }}>Reset shared input</button>{ambiguous ? <button type="button" className="sa-btn" disabled={disabled || busy} onClick={checkSaved}>Check saved shared list</button> : null}</div>
    {dirty ? <p className="sa-hint">Unsaved shared-list input. Finish or reset it before saving this product.</p> : null}
  </fieldset>;
}
