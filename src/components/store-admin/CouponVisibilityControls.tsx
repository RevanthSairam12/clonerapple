'use client';

import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface Selection {
  ids: string[];
  selected: string[];
  busy: boolean;
  toggle: (id: string, checked: boolean) => void;
  selectAll: (checked: boolean) => void;
}

const SelectionContext = createContext<Selection | null>(null);

/** Keeps selection on the current page; the generation endpoint remains separate. */
export function CouponVisibilityControls({
  couponIds,
  canEdit,
  children,
}: {
  couponIds: string[];
  canEdit: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = useRef(false);

  async function updateVisibility(showToAllUsers: boolean) {
    if (!canEdit || pending.current || selected.length === 0) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/coupons/visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected, showToAllUsers }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) {
        setError(body?.error || 'Coupon visibility could not be updated.');
        return;
      }
      setMessage(`${selected.length} selected coupon${selected.length === 1 ? '' : 's'} ${showToAllUsers ? 'made public' : 'hidden from public discovery'}.`);
      setSelected([]);
      router.refresh();
    } catch {
      setError('Coupon visibility could not be updated.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const selection: Selection = {
    ids: couponIds,
    selected,
    busy,
    toggle(id, checked) {
      if (busy || !couponIds.includes(id)) return;
      setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
      setMessage(null);
    },
    selectAll(checked) {
      if (busy) return;
      setSelected(checked ? [...couponIds] : []);
      setMessage(null);
    },
  };

  return (
    <SelectionContext.Provider value={canEdit ? selection : null}>
      {canEdit ? (
        <div className="sa-field" role="group" aria-label="Selected coupon visibility">
          <div className="sa-inline-actions">
            <span className="sa-hint" role="status">{selected.length} selected on this page</span>
            <button
              className="sa-btn sa-btn-quiet sa-btn-small"
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void updateVisibility(true)}
              aria-label="Show selected coupons to all users"
            >
              Show to all users
            </button>
            <button
              className="sa-btn sa-btn-quiet sa-btn-small"
              type="button"
              disabled={busy || selected.length === 0}
              onClick={() => void updateVisibility(false)}
              aria-label="Hide selected coupons from public discovery"
            >
              Hide from public
            </button>
          </div>
          <p className="sa-hint">
            Changes public discovery only, not redemption eligibility or email/group assignments.
            Hidden coupons may still be visible to assigned eligible customers. Archived coupons
            cannot be selected.
          </p>
          {busy ? <p className="sa-hint" role="status">Updating visibility…</p> : null}
          {error ? <p className="sa-error" role="alert">{error}</p> : null}
          {message ? <p className="sa-hint" role="status">{message}</p> : null}
        </div>
      ) : null}
      {children}
    </SelectionContext.Provider>
  );
}

export function CouponSelectAll() {
  const selection = useContext(SelectionContext);
  const input = useRef<HTMLInputElement>(null);
  const allSelected = Boolean(selection?.ids.length) && selection?.selected.length === selection?.ids.length;
  const someSelected = Boolean(selection?.selected.length) && !allSelected;
  useEffect(() => {
    if (input.current) input.current.indeterminate = someSelected;
  }, [someSelected]);
  if (!selection) return null;
  return (
    <input
      ref={input}
      type="checkbox"
      aria-label="Select all non-archived coupons on this page"
      checked={allSelected}
      disabled={selection.busy || selection.ids.length === 0}
      onChange={(event) => selection.selectAll(event.target.checked)}
    />
  );
}

export function CouponSelectionCheckbox({ id, code }: { id: string; code: string }) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  const archived = !selection.ids.includes(id);
  return (
    <input
      type="checkbox"
      aria-label={archived ? `${code} is archived and cannot be selected` : `Select coupon ${code}`}
      checked={selection.selected.includes(id)}
      disabled={selection.busy || archived}
      onChange={(event) => selection.toggle(id, event.target.checked)}
    />
  );
}
