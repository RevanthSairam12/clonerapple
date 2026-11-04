'use client';

import { useEffect, useRef, useState } from 'react';
import type { DeviceBrand, DeviceModel } from '@/lib/catalog/product-metadata-rules';

export type DeviceReferenceKind = 'brands' | 'models';
export type CreatedDeviceReference = DeviceBrand | DeviceModel;
export interface DeviceReferenceCreatorProps {
  kind: DeviceReferenceKind;
  brands: DeviceBrand[];
  canManage?: boolean;
  disabled?: boolean;
  initialBrandId?: string;
  onCreated: (kind: DeviceReferenceKind, reference: CreatedDeviceReference) => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
export interface DeviceReferenceDraft { name: string; brandId: string; sortOrder: string; isActive: boolean }
export interface DeviceReferencePayload { name: string; sortOrder: number; isActive: boolean; brandId?: string; confirmNearMatch?: boolean }
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
const cleanName = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(value);

/** Explicit whitelist: creation never sends client IDs or product associations. */
export function deviceReferencePayload(kind: DeviceReferenceKind, draft: DeviceReferenceDraft, brands: DeviceBrand[]): DeviceReferencePayload {
  const max = kind === 'brands' ? 100 : 120;
  if (!cleanName(draft.name, max)) throw new Error(`Enter a device ${kind === 'brands' ? 'brand' : 'model'} name (maximum ${max} characters).`);
  if (!/^\d+$/.test(draft.sortOrder) || Number(draft.sortOrder) > 9999) throw new Error('Display order must be a whole number from 0 to 9999.');
  if (kind === 'models' && !brands.some(brand => brand.id === draft.brandId && brand.isActive)) throw new Error('Select an active device brand.');
  return { name: draft.name.trim(), sortOrder: Number(draft.sortOrder), isActive: draft.isActive, ...(kind === 'models' ? { brandId: draft.brandId } : {}) };
}

/** Validate the 201 envelope before any consumer can merge a new reference. */
export function createdDeviceReference(kind: DeviceReferenceKind, body: unknown): CreatedDeviceReference | null {
  if (!body || typeof body !== 'object' || !('reference' in body)) return null;
  const ref = body.reference;
  if (!ref || typeof ref !== 'object' || !('id' in ref) || typeof ref.id !== 'string' || !ID.test(ref.id)
    || !('name' in ref) || !cleanName(ref.name, kind === 'brands' ? 100 : 120) || ref.name !== ref.name.trim()
    || !('isActive' in ref) || typeof ref.isActive !== 'boolean'
    || !('sortOrder' in ref) || typeof ref.sortOrder !== 'number' || !Number.isInteger(ref.sortOrder) || ref.sortOrder < 0 || ref.sortOrder > 9999) return null;
  const base: DeviceBrand = { id: ref.id, name: ref.name, isActive: ref.isActive, sortOrder: ref.sortOrder };
  if (kind === 'brands') return 'brandId' in ref ? null : base;
  if (!('brandId' in ref) || typeof ref.brandId !== 'string' || !ID.test(ref.brandId) || !('brandName' in ref) || !cleanName(ref.brandName, 100)) return null;
  return { ...base, brandId: ref.brandId, brandName: ref.brandName };
}
export class DeviceReferenceCreateError extends Error {
  constructor(message: string, public readonly ambiguous = false) { super(message); }
}
const unknownOutcome = 'The create outcome is unknown. Do not submit again. Check Device models in a separate tab, then reload this page before trying another create. Your input has been kept.';

/** One POST only: transport, server and malformed-success failures may follow a commit. */
export async function postDeviceReference(kind: DeviceReferenceKind, payload: DeviceReferencePayload, fetcher: typeof fetch = fetch): Promise<CreatedDeviceReference> {
  let response: Response;
  try {
    response = await fetcher(`/api/store-admin/catalog/metadata/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  } catch { throw new DeviceReferenceCreateError(unknownOutcome, true); }
  const body: unknown = await response.json().catch(() => null);
  if (response.status === 201) {
    const ref = createdDeviceReference(kind, body);
    if (!ref || ref.name !== payload.name || ref.sortOrder !== payload.sortOrder || ref.isActive !== payload.isActive || (kind === 'models' && (!('brandId' in ref) || ref.brandId !== payload.brandId))) throw new DeviceReferenceCreateError(unknownOutcome, true);
    return ref;
  }
  if ([400, 401, 403, 409, 422].includes(response.status)) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The device reference was not created. Check your input and permissions.';
    throw new DeviceReferenceCreateError(message);
  }
  throw new DeviceReferenceCreateError(unknownOutcome, true);
}

/** A fragment, not a form: safe inside the product workflow's existing form. */
export function DeviceReferenceCreator({ kind, brands, canManage = false, disabled = false, initialBrandId = '', onCreated, onBusyChange, onDirtyChange }: DeviceReferenceCreatorProps) {
  const [draft, setDraft] = useState<DeviceReferenceDraft>({ name: '', brandId: initialBrandId, sortOrder: '0', isActive: true });
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmNearMatch, setConfirmNearMatch] = useState(false);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const locked = disabled || busy || ambiguous || !canManage;
  function change<K extends keyof DeviceReferenceDraft>(key: K, value: DeviceReferenceDraft[K]) {
    setDraft(current => ({ ...current, [key]: value })); setDirty(true); setConfirmNearMatch(false); setError(null);
  }
  async function create() {
    if (locked || pending.current) return;
    let payload: DeviceReferencePayload;
    try { payload = { ...deviceReferencePayload(kind, draft, brands), ...(confirmNearMatch ? { confirmNearMatch: true } : {}) }; }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Check your input.'); return; }
    pending.current = true; setBusy(true); onBusyChange?.(true); setError(null); setNotice(null);
    try {
      const reference = await postDeviceReference(kind, payload);
      setDraft(current => ({ name: '', brandId: current.brandId, sortOrder: '0', isActive: true })); setDirty(false);
      setNotice('Device reference saved. It has not been selected for any product.');
      try { onCreated(kind, reference); }
      catch { setNotice('Device reference saved, but the local list could not be updated. Reload the references before continuing; do not create it again.'); }
    } catch (caught) {
      setError(caught instanceof DeviceReferenceCreateError ? caught.message : unknownOutcome);
      if (!(caught instanceof DeviceReferenceCreateError) || caught.ambiguous) setAmbiguous(true);
    } finally { pending.current = false; setBusy(false); onBusyChange?.(false); }
  }
  if (!canManage) return <p className="sa-lock-note">Only store owners can create device references.</p>;
  return <fieldset disabled={locked} aria-busy={busy} onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <legend>New device {kind === 'brands' ? 'brand' : 'model'}</legend>
    <p className="sa-hint">Create a reusable device record only. Product compatibility is selected separately.</p>
    <div className="sa-control-grid">
      {kind === 'models' && <label className="sa-field"><span className="sa-label">Device brand</span><select className="sa-input" value={draft.brandId} onChange={event => change('brandId', event.target.value)}><option value="">Select an active device brand</option>{brands.filter(brand => brand.isActive).map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>}
      <label className="sa-field"><span className="sa-label">Device {kind === 'brands' ? 'brand' : 'model'} name</span><input className="sa-input" value={draft.name} maxLength={kind === 'brands' ? 100 : 120} onChange={event => change('name', event.target.value)} /></label>
      <label className="sa-field"><span className="sa-label">Display order</span><input className="sa-input" type="number" min={0} max={9999} step={1} value={draft.sortOrder} onChange={event => change('sortOrder', event.target.value)} /></label>
      <label className="sa-check"><input type="checkbox" checked={draft.isActive} onChange={event => change('isActive', event.target.checked)} />Active</label>
    </div>
    {kind === 'models' && !brands.some(brand => brand.isActive) && <p className="sa-hint">An owner must create or activate a device brand before adding models.</p>}
    {error?.startsWith('Did you mean ') && <label className="sa-check"><input type="checkbox" checked={confirmNearMatch} onChange={event => setConfirmNearMatch(event.target.checked)} />Create as entered after reviewing the similar names</label>}
    {error && <p className="sa-error" role="alert">{error}</p>}{notice && <p className="sa-notice" role="status">{notice}</p>}
    <div className="sa-inline-actions"><button className="sa-btn sa-btn-primary" type="button" disabled={locked || (kind === 'models' && !brands.some(brand => brand.isActive))} onClick={create}>{busy ? 'Creating…' : `Create device ${kind === 'brands' ? 'brand' : 'model'}`}</button><button className="sa-btn sa-btn-quiet" type="button" disabled={locked} onClick={() => { setDraft({ name: '', brandId: initialBrandId, sortOrder: '0', isActive: true }); setDirty(false); setError(null); setNotice(null); }}>Reset</button></div>
    {dirty && <p className="sa-hint">Unsaved device reference input.</p>}
  </fieldset>;
}
