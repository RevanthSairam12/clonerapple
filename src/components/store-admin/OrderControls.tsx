'use client';

import { useState } from 'react';

import type { FulfilmentStatus, OrderDetail } from '@/lib/store-admin/orders';
import type { StoreRole } from '@/lib/store-admin/auth';
import { DELIVERY_SLOTS, validateDeliveryDetailsForOnTheWay, type DeliverySlot } from '@/lib/store-admin/delivery';
import { FULFILMENT_STEPS, FULFILMENT_TRANSITIONS } from '@/lib/store-admin/order-rules';
import { fulfilmentLabel } from '@/lib/orders/fulfilment';

interface Props {
  order: OrderDetail;
  role: StoreRole;
}

const ACTION_LABELS: Partial<Record<FulfilmentStatus, string>> = {
  ACCEPTED: 'Accept order', PROCESSING: 'Start preparing',
  ON_THE_WAY: 'Mark pickup done', DELIVERED: 'Mark delivered', CANCELED: 'Cancel order',
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

  const current = order.fulfilmentStatus;
  const readOnly = role === 'store_viewer';
  const terminal = current === 'DELIVERED' || current === 'CANCELED';
  const nextStatuses = FULFILMENT_TRANSITIONS[current] ?? [];
  const saved = order.delivery;
  const readiness = validateDeliveryDetailsForOnTheWay(saved ? {
    ...saved,
    personPhone: saved.personPhone ?? saved.personPhoneMasked,
    scheduledFor: dateValue(saved.scheduledFor) || null,
  } : null);
  const currentIndex = FULFILMENT_STEPS.indexOf(current);

  function blockedReason(target: FulfilmentStatus): string | null {
    if (target === 'ACCEPTED' && order.paymentStatus !== 'PAID') return 'Only paid orders can be accepted.';
    if (target === 'ON_THE_WAY' && !readiness.ok) return `Save shipment details first: ${readiness.error}`;
    if (target === 'CANCELED' && current === 'ON_THE_WAY' && role !== 'store_owner') return 'Only the store owner can cancel after pickup.';
    if (target === 'CANCELED' && !reason.trim()) return 'Enter a cancellation reason.';
    return null;
  }

  async function changeFulfilment(target: FulfilmentStatus) {
    if (busy || readOnly || !nextStatuses.includes(target) || blockedReason(target)) return;
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
          ...(method === 'self'
            ? { personName, personPhone }
            : { courierName, trackingNumber, trackingUrl }),
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
        <p className="sa-note">Current status: <strong>{fulfilmentLabel(current, saved?.method)}</strong></p>
        <ol aria-label="Fulfilment progress" className="sa-note">
          {FULFILMENT_STEPS.map((step, index) => (
            <li key={step} aria-current={step === current ? 'step' : undefined}>
              {fulfilmentLabel(step, saved?.method)} — {step === current ? 'Current' : currentIndex > index ? 'Completed' : current === 'CANCELED' ? 'Not completed' : 'Upcoming'}
            </li>
          ))}
        </ol>
        {readOnly ? <p className="sa-lock-note">Viewer access is read-only. Delivery and fulfilment changes require store admin or owner access.</p> : null}
        {!readOnly && <div className="sa-control-actions">
          {nextStatuses.filter((target) => target !== 'CANCELED').map((target) => (
            <div key={target}>
              <button className="sa-btn sa-btn-quiet" type="button" disabled={busy || Boolean(blockedReason(target))} onClick={() => changeFulfilment(target)}>
                {target === 'ON_THE_WAY' && saved?.method === 'self' ? 'Mark dispatched' : ACTION_LABELS[target]}
              </button>
              {blockedReason(target) ? <p className="sa-note">{blockedReason(target)}</p> : null}
            </div>
          ))}
        </div>}
        {!readOnly && nextStatuses.includes('CANCELED') ? (
          <label className="sa-field sa-control-reason">
            <span className="sa-label">Cancellation reason</span>
            <input className="sa-input" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="Required to cancel" />
            <button className="sa-btn sa-btn-quiet" type="button" disabled={busy || Boolean(blockedReason('CANCELED'))} onClick={() => changeFulfilment('CANCELED')}>Cancel order</button>
            {current === 'ON_THE_WAY' && role !== 'store_owner' ? <span className="sa-note">Only the store owner can cancel after pickup.</span> : null}
          </label>
        ) : null}
      </div>

      {!readOnly && !terminal && <form className="sa-control-card" onSubmit={saveDelivery}>
        <h3 className="sa-control-title">{current === 'ON_THE_WAY' ? 'Update shipment details' : 'Prepare shipment'}</h3>
        <p className="sa-note">Save these details before marking courier pickup or dispatch. Customers see shipping details after pickup. Saving this form does not mark pickup done.</p>
        <div className="sa-control-grid">
          <label className="sa-field"><span className="sa-label">Method</span><select className="sa-input" value={method} onChange={(event) => setMethod(event.target.value as 'self' | 'courier')}><option value="courier">Courier</option><option value="self">Self delivery</option></select></label>
           {method === 'self' ? <>
             <label className="sa-field"><span className="sa-label">Delivery person</span><input className="sa-input" value={personName} onChange={(event) => setPersonName(event.target.value)} maxLength={120} required /></label>
             <label className="sa-field"><span className="sa-label">Delivery person phone</span><input className="sa-input" value={personPhone} onChange={(event) => setPersonPhone(event.target.value)} maxLength={40} required /></label>
           </> : <label className="sa-field"><span className="sa-label">Courier name</span><input className="sa-input" value={courierName} onChange={(event) => setCourierName(event.target.value)} maxLength={120} required /></label>}
          {method === 'courier' && <>
            <label className="sa-field"><span className="sa-label">Tracking number (required)</span><input className="sa-input" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} maxLength={200} required /></label>
            <label className="sa-field"><span className="sa-label">Tracking URL (optional HTTPS)</span><input className="sa-input" type="url" value={trackingUrl} onChange={(event) => setTrackingUrl(event.target.value)} placeholder="https://…" /></label>
          </>}
          <label className="sa-field"><span className="sa-label">Expected delivery date</span><input className="sa-input" type="date" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} required /></label>
           <label className="sa-field"><span className="sa-label">Slot</span><select className="sa-input" value={deliverySlot} onChange={(event) => setDeliverySlot(event.target.value as DeliverySlot)}>{DELIVERY_SLOTS.map((slot) => <option key={slot} value={slot}>{slot}</option>)}</select></label>
        </div>
        <button className="sa-btn sa-btn-primary sa-control-submit" type="submit" disabled={busy}>Save delivery details</button>
      </form>}

      {message ? <p className="sa-error" role="alert">{message}</p> : null}
    </div>
  );
}
