'use client';

import { useState, useEffect, useCallback } from 'react';

import { formatPaise } from '@/lib/store-admin/amount';

interface ShiftSummary {
  id: number;
  staffName: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingFloatPaise: number;
  expectedCashPaise: number | null;
  countedCashPaise: number | null;
  variancePaise: number | null;
  notes: string;
  totalsByMethod: Record<string, number>;
  salesCount: number;
}

export function PosEndOfDay() {
  const [shift, setShift] = useState<ShiftSummary | null>(null);
  const [countedCash, setCountedCash] = useState('');
  const [busy, setBusy] = useState<{ open: boolean; close: boolean }>({ open: false, close: false });
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/store-admin/pos/shift');
    const body = await response.json().catch(() => ({}));
    if (response.ok && typeof body.shift === 'object') setShift(body.shift ?? null);
    else setMessage(body.error || 'Could not read the shift.');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openShift() {
    setBusy({ ...busy, open: true });
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/pos/shift', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openingFloatPaise: 0 }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not open.');
      await load();
      setMessage('Shift opened.');
      setTimeout(() => setMessage(null), 2500);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Could not open the shift.');
    } finally {
      setBusy({ ...busy, open: false });
    }
  }

  async function closeShift() {
    const counted = Number(countedCash);
    if (!Number.isFinite(counted) || counted < 0) {
      setMessage('Enter a non-negative counted cash.');
      return;
    }
    setBusy({ ...busy, close: true });
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/pos/shift', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ countedCashPaise: Math.trunc(counted) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not close.');
      await load();
      setCountedCash('');
      setMessage('Shift closed.');
      setTimeout(() => setMessage(null), 2500);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Could not close the shift.');
    } finally {
      setBusy({ ...busy, close: false });
    }
  }

  const isOpen = Boolean(shift && shift.status === 'OPEN');

  return (
    <div>
      {message ? <p className="sa-notice" role="status">{message}</p> : null}

      <section className="sa-detail-card">
        <h2 className="sa-card-title">Current shift</h2>
        {!shift ? (
          <p className="sa-empty">No shift record is available.</p>
        ) : (
          <>
            <dl className="sa-meta">
              <div><dt>Staff</dt><dd>{shift.staffName}</dd></div>
              <div><dt>Status</dt><dd className="sa-mono">{shift.status}</dd></div>
              <div><dt>Opened</dt><dd>{shift.openedAt}</dd></div>
              <div><dt>Closed</dt><dd>{shift.closedAt ?? '—'}</dd></div>
              <div><dt>Opening float</dt><dd>{formatPaise(shift.openingFloatPaise)}</dd></div>
              <div><dt>Expected cash</dt><dd className="sa-mono">{shift.expectedCashPaise === null ? '—' : formatPaise(shift.expectedCashPaise)}</dd></div>
              <div><dt>Counted cash</dt><dd className="sa-mono">{shift.countedCashPaise === null ? '—' : formatPaise(shift.countedCashPaise)}</dd></div>
              <div><dt>Variance</dt><dd className="sa-mono">{shift.variancePaise === null ? '—' : formatPaise(Math.abs(shift.variancePaise))}</dd></div>
            </dl>
            {shift.salesCount !== undefined && shift.totalsByMethod && Object.keys(shift.totalsByMethod).length ? (
              <dl className="sa-meta sa-method-totals">
                <div><dt>Sales this shift</dt><dd>{shift.salesCount}</dd></div>
                {Object.entries(shift.totalsByMethod).map(([method, total]) => (
                  <div key={method}><dt>{method}</dt><dd className="sa-num">{formatPaise(total)}</dd></div>
                ))}
                <div><dt className="sa-total-label">Total</dt><dd className="sa-num sa-total-value">{formatPaise(Object.values(shift.totalsByMethod).reduce((sum, t) => sum + t, 0))}</dd></div>
              </dl>
            ) : null}
            {!isOpen ? (
              <p className="sa-lock-note">
                A closed shift cannot take sales. Open a new shift from the POS till.
              </p>
            ) : null}
            <button
              className="sa-btn sa-btn-primary"
              type="button"
              disabled={busy.open}
              onClick={openShift}
            >
              {busy.open ? 'Opening…' : 'Open this shift'}
            </button>
            {isOpen && shift.closedAt === null ? (
              <>
                <label className="sa-field sa-close-field">
                  <span className="sa-label">Counted cash in drawer</span>
                  <input
                    className="sa-input"
                    type="number"
                    min={0}
                    value={countedCash}
                    disabled={busy.close || !isOpen}
                    onChange={(event) => setCountedCash(event.target.value)}
                  />
                </label>
                <button
                  className="sa-btn sa-btn-quiet"
                  type="button"
                  disabled={busy.close || !isOpen}
                  onClick={closeShift}
                >
                  {busy.close ? 'Closing…' : 'Close this shift'}
                </button>
              </>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
