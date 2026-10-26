'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  txnid: string;
  maskedName: string;
  maskedEmail: string;
  maskedPhone: string;
  hasAddress: boolean;
}

const EMPTY = {
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'IN',
};

/**
 * Correct the customer contact block and shipping address after an order is
 * placed. Values are write-only here: the page only knows the masked forms, so
 * a blank field means "keep the current value". Items and amounts are not
 * editable — the gateway amount is captured at payment time.
 */
export function OrderEditForm({ txnid, maskedName, maskedEmail, maskedPhone, hasAddress }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [values, setValues] = useState({ ...EMPTY });
  const [reason, setReason] = useState('');

  function set(field: keyof typeof EMPTY, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const body: Record<string, unknown> = { reason };
    if (values.customerName.trim()) body.customerName = values.customerName.trim();
    if (values.customerEmail.trim()) body.customerEmail = values.customerEmail.trim();
    if (values.customerPhone.trim()) body.customerPhone = values.customerPhone.trim();

    const addressFields: Record<string, string> = {};
    for (const key of ['fullName', 'phone', 'line1', 'line2', 'city', 'state', 'postalCode', 'country'] as const) {
      const value = values[key].trim();
      if (value) addressFields[key] = value;
    }
    if (Object.keys(addressFields).length > 0) body.shipTo = addressFields;

    try {
      const response = await fetch(`/api/store-admin/orders/${encodeURIComponent(txnid)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The order could not be updated.');
      }
      setValues({ ...EMPTY });
      setReason('');
      setOpen(false);
      setMessage(`Saved ${Array.isArray(payload.changedFields) ? payload.changedFields.length : 1} change(s).`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The order could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-edit-card">
      <div className="sa-edit-head">
        <div>
          <h2 className="sa-card-title">Edit order details</h2>
          <p className="sa-note">
            Correct a contact number, email or delivery address. Blank fields keep
            the current value; full values are never shown back to you.
          </p>
        </div>
        <button
          className="sa-btn sa-btn-quiet"
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {open ? 'Cancel' : 'Edit details'}
        </button>
      </div>

      {message ? <p className="sa-success" role="status">{message}</p> : null}

      {open ? (
        <form className="sa-edit-form" onSubmit={submit}>
          <fieldset className="sa-edit-fieldset">
            <legend>Customer contact</legend>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Name <span className="sa-hint">current {maskedName}</span></span>
                <input className="sa-input" value={values.customerName} onChange={(event) => set('customerName', event.target.value)} maxLength={120} placeholder="Leave blank to keep" />
              </label>
              <label className="sa-field">
                <span className="sa-label">Email <span className="sa-hint">current {maskedEmail}</span></span>
                <input className="sa-input sa-mono" type="email" value={values.customerEmail} onChange={(event) => set('customerEmail', event.target.value)} maxLength={254} placeholder="Leave blank to keep" />
              </label>
              <label className="sa-field">
                <span className="sa-label">Phone <span className="sa-hint">current {maskedPhone}</span></span>
                <input className="sa-input sa-mono" value={values.customerPhone} onChange={(event) => set('customerPhone', event.target.value)} maxLength={40} placeholder="Leave blank to keep" />
              </label>
            </div>
          </fieldset>

          <fieldset className="sa-edit-fieldset" disabled={!hasAddress}>
            <legend>Shipping address</legend>
            {!hasAddress ? (
              <p className="sa-note">This order has no shipping address on file, so there is nothing to correct.</p>
            ) : (
              <div className="sa-control-grid">
                <label className="sa-field"><span className="sa-label">Recipient</span><input className="sa-input" value={values.fullName} onChange={(event) => set('fullName', event.target.value)} maxLength={120} placeholder="Leave blank to keep" /></label>
                <label className="sa-field"><span className="sa-label">Delivery phone</span><input className="sa-input sa-mono" value={values.phone} onChange={(event) => set('phone', event.target.value)} maxLength={40} placeholder="Leave blank to keep" /></label>
                <label className="sa-field sa-field-wide"><span className="sa-label">Address line 1</span><input className="sa-input" value={values.line1} onChange={(event) => set('line1', event.target.value)} maxLength={200} placeholder="Leave blank to keep" /></label>
                <label className="sa-field sa-field-wide"><span className="sa-label">Address line 2 <span className="sa-hint">optional</span></span><input className="sa-input" value={values.line2} onChange={(event) => set('line2', event.target.value)} maxLength={200} placeholder="Leave blank to keep" /></label>
                <label className="sa-field"><span className="sa-label">City</span><input className="sa-input" value={values.city} onChange={(event) => set('city', event.target.value)} maxLength={120} placeholder="Leave blank to keep" /></label>
                <label className="sa-field"><span className="sa-label">State</span><input className="sa-input" value={values.state} onChange={(event) => set('state', event.target.value)} maxLength={120} placeholder="Leave blank to keep" /></label>
                <label className="sa-field"><span className="sa-label">Postal code</span><input className="sa-input sa-mono" value={values.postalCode} onChange={(event) => set('postalCode', event.target.value)} maxLength={16} placeholder="Leave blank to keep" /></label>
                <label className="sa-field"><span className="sa-label">Country</span><input className="sa-input" value={values.country} onChange={(event) => set('country', event.target.value)} maxLength={60} /></label>
              </div>
            )}
          </fieldset>

          <label className="sa-field">
            <span className="sa-label">Reason for the edit</span>
            <input className="sa-input" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={200} required placeholder="e.g. Customer gave the wrong PIN code at checkout" />
          </label>

          {error ? <p className="sa-error" role="alert">{error}</p> : null}

          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || reason.trim().length < 10}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <span className="sa-note">Every edit is written to an append-only log and audited.</span>
          </div>
        </form>
      ) : null}
    </section>
  );
}
