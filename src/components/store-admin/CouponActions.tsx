'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Pause, resume, archive and duplicate from one coupon's page.
 *
 * Every call is a same-origin POST, is checked for the store_admin role by the
 * route and leaves an audit row. Archive asks once because it cannot be undone.
 */

interface Props {
  couponId: string;
  status: string;
}

export function CouponActions({ couponId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, body?: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = (await response.json().catch(() => null)) as
        | { coupon?: { id?: string }; error?: string }
        | null;
      if (!response.ok) {
        setError(payload?.error || 'That action could not be completed.');
        return;
      }
      if (body?.action === 'archive') {
        router.refresh();
      } else if (payload?.coupon?.id && path.endsWith('/duplicate')) {
        router.push(`/store-admin/coupons/${encodeURIComponent(payload.coupon.id)}`);
      } else {
        router.refresh();
      }
    } catch {
      setError('That action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'archived') {
    return (
      <div className="sa-inline-actions">
        <span className="sa-lock-note">Archived coupons are read-only.</span>
      </div>
    );
  }

  return (
    <div>
      <div className="sa-inline-actions">
        {status === 'active' ? (
          <button
            className="sa-btn sa-btn-quiet sa-btn-small"
            type="button"
            disabled={busy}
            onClick={() => void call(`/api/store-admin/coupons/${encodeURIComponent(couponId)}/status`, { action: 'pause' })}
          >
            Pause
          </button>
        ) : (
          <button
            className="sa-btn sa-btn-small"
            type="button"
            disabled={busy}
            onClick={() => void call(`/api/store-admin/coupons/${encodeURIComponent(couponId)}/status`, { action: 'resume' })}
          >
            Resume
          </button>
        )}
        <button
          className="sa-btn sa-btn-quiet sa-btn-small"
          type="button"
          disabled={busy}
          onClick={() => void call(`/api/store-admin/coupons/${encodeURIComponent(couponId)}/duplicate`)}
        >
          Duplicate
        </button>
        <button
          className="sa-btn sa-btn-quiet sa-btn-small"
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Archive this coupon? It stops working immediately and cannot be re-enabled. Its usage history stays.',
              )
            ) {
              void call(`/api/store-admin/coupons/${encodeURIComponent(couponId)}/status`, { action: 'archive' });
            }
          }}
        >
          Archive
        </button>
      </div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
    </div>
  );
}
