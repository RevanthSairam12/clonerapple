'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  CUSTOMER_GROUPS,
  CUSTOMER_GROUP_LABELS,
  type CustomerSettings,
} from '@/lib/store-admin/customer-rules';

export function CustomerSettingsForm({ settings }: { settings: CustomerSettings }) {
  const router = useRouter();
  const [values, setValues] = useState<CustomerSettings>({ ...settings });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const keys = Object.keys(values) as Array<keyof CustomerSettings>;
  const changed = keys.filter((key) => values[key] !== settings[key]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      for (const key of changed) {
        const response = await fetch('/api/store-admin/customers/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: values[key] }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error || 'The setting could not be saved.');
          return;
        }
      }
      setNotice(changed.length === 0 ? 'Nothing to save.' : 'Settings saved.');
      router.refresh();
    } catch {
      setError('The setting could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sa-control-card">
      <p className="sa-control-title">Checkout and accounts</p>
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">Guest checkout</span>
          <select
            className="sa-input"
            value={values.guest_checkout}
            onChange={(event) =>
              setValues((current) => ({ ...current, guest_checkout: event.target.value }))
            }
            disabled={busy}
          >
            <option value="off">Off — an account is required</option>
            <option value="on">On — guests can pay without an account</option>
          </select>
          <span className="sa-hint">
            Guest orders appear in the customer list as guest rows, grouped by
            email. They cannot be opened, blocked or anonymised.
          </span>
        </label>

        <label className="sa-field">
          <span className="sa-label">Default customer group</span>
          <select
            className="sa-input"
            value={values.default_customer_group}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                default_customer_group: event.target.value,
              }))
            }
            disabled={busy}
          >
            {CUSTOMER_GROUPS.map((group) => (
              <option key={group} value={group}>
                {CUSTOMER_GROUP_LABELS[group]}
              </option>
            ))}
          </select>
          <span className="sa-hint">
            Applied to new sign-ups. It does not change pricing.
          </span>
        </label>

        <label className="sa-field">
          <span className="sa-label">Checkout offer opt-in</span>
          <select
            className="sa-input"
            value={values.checkout_marketing_optin}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                checkout_marketing_optin: event.target.value,
              }))
            }
            disabled={busy}
          >
            <option value="off">Hidden</option>
            <option value="on">Show “Email me offers” at checkout</option>
          </select>
          <span className="sa-hint">
            An opt-in adds the checkout email to Subscribers with the source
            “Checkout opt-in”. Unticked checkboxes are never recorded.
          </span>
        </label>
      </div>

      <div className="sa-inline-actions">
        <button
          type="button"
          className="sa-btn sa-btn-primary sa-btn-small"
          onClick={save}
          disabled={busy || changed.length === 0}
        >
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        {changed.length > 0 && !busy ? (
          <span className="sa-hint">{changed.length} unsaved change(s)</span>
        ) : null}
        {error ? <span className="sa-error">{error}</span> : null}
        {notice ? <span className="sa-success">{notice}</span> : null}
      </div>
    </div>
  );
}
