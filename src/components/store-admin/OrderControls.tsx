'use client';

import { useState } from 'react';

import type { FulfilmentStatus, OrderDetail } from '@/lib/store-admin/orders';
import type { StoreRole } from '@/lib/store-admin/auth';
import { DELIVERY_SLOTS, type DeliverySlot } from '@/lib/store-admin/delivery';

interface Props {
  order: OrderDetail;
  role: StoreRole;
}

// Keep the client control surface in step with the server validation table.
const NEXT_STATUSES: Record<FulfilmentStatus, readonly FulfilmentStatus[]> = {
  PENDING: ['ACCEPTED', 'CANCELED'],
  ACCEPTED: ['PROCESSING', 'CANCELED'],
  PROCESSING: ['ON_THE_WAY', 'CANCELED'],
  ON_THE_WAY: ['DELIVERED', 'CANCELED'],
  DELIVERED: [],
  CANCELED: [],
};

function dateValue(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export function OrderControls({ order, role }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'self' | 'courier'>(order.delivery?.method ?? 'courier');
  const [personName, setPersonName] = useState(order.delivery?.personName ?? '');
  const [personPhone, setPersonPhone] = useState(order.delivery?.personPhone ?? '');
  const [courierName, setCourierName] = useState(order.delivery?.courierName ?? order.delivery?.carrier ?? '');
  const [trackingNumber, setTrackingNumber] = useState(order.delivery?.trackingNumber ?? '');
  const [trackingUrl, setTrackingUrl] = useState(order.delivery?.trackingUrl ?? '');
  const [scheduledFor, setScheduledFor] = useState(dateValue(order.delivery?.scheduledFor ?? order.scheduledFor));
  const [deliverySlot, setDeliverySlot] = useState<DeliverySlot>(order.delivery?.deliverySlot ?? DELIVERY_SLOTS[0]);

  if (role === 'store_viewer') {
    return <p className="sa-lock-note">Viewer access is read-only. Delivery and fulfilment changes require store admin or owner access.</p>;
  }

  const current = order.fulfilmentStatus;
  const nextStatuses = NEXT_STATUSES[current] ?? [];

  async function changeFulfilment(target: FulfilmentStatus) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(order.txnid)}/fulfilment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
           body: JSON.stringify({ target, reason: target === 'CANCELED' ? reason : undefined }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not update fulfilment.');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update fulfilment.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDelivery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(order.txnid)}/delivery`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
           deliveryMethod: method,
           personName,
           personPhone,
           courierName,
           trackingNumber,
          trackingUrl,
          date: scheduledFor,
          slot: deliverySlot,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not save delivery details.');
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save delivery details.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-controls">
      <div className="sa-control-card">
        <h3 className="sa-control-title">Fulfilment</h3>
        <p className="sa-note">Current status: <strong>{current}</strong></p>
        <div className="sa-control-actions">
          {nextStatuses.map((target) => (
            <button className="sa-btn sa-btn-quiet" type="button" key={target} disabled={busy} onClick={() => changeFulfilment(target)}>
              Move to {target.replace('_', ' ')}
            </button>
          ))}
        </div>
        {nextStatuses.includes('CANCELED') ? (
          <label className="sa-field sa-control-reason">
            <span className="sa-label">Cancellation reason</span>
            <input className="sa-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="Required to cancel" />
          </label>
        ) : null}
      </div>

      <form className="sa-control-card" onSubmit={saveDelivery}>
        <h3 className="sa-control-title">Delivery details</h3>
        <div className="sa-control-grid">
          <label className="sa-field"><span className="sa-label">Method</span><select className="sa-input" value={method} onChange={(event) => setMethod(event.target.value as 'self' | 'courier')}><option value="courier">Courier</option><option value="self">Self delivery</option></select></label>
           {method === 'self' ? <>
             <label className="sa-field"><span className="sa-label">Delivery person</span><input className="sa-input" value={personName} onChange={(event) => setPersonName(event.target.value)} maxLength={120} required /></label>
             <label className="sa-field"><span className="sa-label">Delivery person phone</span><input className="sa-input" value={personPhone} onChange={(event) => setPersonPhone(event.target.value)} maxLength={40} required /></label>
           </> : <label className="sa-field"><span className="sa-label">Courier name</span><input className="sa-input" value={courierName} onChange={(event) => setCourierName(event.target.value)} maxLength={120} required /></label>}
          <label className="sa-field"><span className="sa-label">Tracking number</span><input className="sa-input" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} maxLength={200} /></label>
          <label className="sa-field"><span className="sa-label">Tracking URL</span><input className="sa-input" type="url" value={trackingUrl} onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://…" /></label>
          <label className="sa-field"><span className="sa-label">Date</span><input className="sa-input" type="date" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} required /></label>
           <label className="sa-field"><span className="sa-label">Slot</span><select className="sa-input" value={deliverySlot} onChange={(event) => setDeliverySlot(event.target.value as DeliverySlot)}>{DELIVERY_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label>
        </div>
        <button className="sa-btn sa-btn-primary sa-control-submit" type="submit" disabled={busy}>Save delivery details</button>
      </form>

      {message ? <p className="sa-error" role="alert">{message}</p> : null}
    </div>
  );
}
