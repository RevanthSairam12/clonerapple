'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { validateShippingRupees, type SettingField } from '@/lib/store-admin/settings-rules';
import { formatRupees } from '@/lib/store-admin/money';
import { quoteShipping } from '@/lib/checkout/shipping-rules';

function inputValue(field: SettingField, initial: Record<string, string>): string {
  const stored = initial[field.key] ?? field.default;
  // Match the runtime automation cap without silently rewriting legacy settings.
  if (field.key === 'default_fulfilment_status' && (stored === 'ON_THE_WAY' || stored === 'DELIVERED')) return 'PROCESSING';
  return field.kind === 'money' && stored !== '' ? (Number(stored) / 100).toFixed(2) : stored;
}

interface Props {
  fields: readonly SettingField[];
  initial: Record<string, string>;
  canEdit: boolean;
  /** Shown above the form when the section has a note, e.g. owner-only keys. */
  note?: string;
}

/**
 * One settings section. Every field is saved together in a single request, and
 * only values that actually changed are sent.
 */
export function SettingsForm({ fields, initial, canEdit, note }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {};
    for (const field of fields) draft[field.key] = inputValue(field, initial);
    return draft;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const changed = useMemo(
    () =>
      fields
        // A locked field is shown but never written: its value is fixed by the
        // server, and sending it would only be refused.
        .filter((field) => !field.locked)
        .filter((field) => inputValue(field, initial) !== values[field.key])
        .map((field) => ({ key: field.key, value: values[field.key], ...(field.kind === 'money' ? { unit: 'rupees' } : {}) })),
    [fields, initial, values],
  );

  const shippingExample = useMemo(() => {
    if (!fields.some((field) => field.key === 'shipping_charge_paise')) return null;
    const charge = validateShippingRupees('shipping_charge_paise', values.shipping_charge_paise);
    const threshold = validateShippingRupees('free_shipping_threshold_paise', values.free_shipping_threshold_paise);
    if (!charge.ok || !threshold.ok) return 'Enter valid rupee amounts to preview checkout shipping.';
    const policy = {
      enabled: values.shipping_enabled === 'on',
      chargePaise: Number(charge.value),
      freeShippingThresholdPaise: threshold.value === '' ? null : Number(threshold.value),
    };
    return `Live example (before coupons): ${[49900, 89900, 99900, 149900].map((subtotal) =>
      `${formatRupees(subtotal)} of items → ${formatRupees(quoteShipping(subtotal, policy).shippingPaise)} shipping`,
    ).join('; ')}. A valid free-shipping coupon waives the charge.`;
  }, [fields, values]);

  function set(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/store-admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: changed }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Settings could not be saved.');
      }
      const count = Array.isArray(payload.changes) ? payload.changes.length : 0;
      setMessage(count === 0 ? 'No changes to save.' : `${count} setting(s) saved.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Settings could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sa-edit-form" onSubmit={save}>
      {note ? <p className="sa-note">{note}</p> : null}
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <div className="sa-control-grid">
        {fields.map((field) => {
          const id = `setting-${field.key}`;
          // A locked field always renders its fixed value, even if a legacy
          // row still holds something else.
          const value = field.locked
            ? (field.lockedValue ?? field.default)
            : (values[field.key] ?? '');
          const locked = field.locked === true;
          const common = {
            id,
            className: 'sa-input',
            disabled: !canEdit || busy || locked,
          };

          return (
            <label
              className={`sa-field${field.kind === 'textarea' ? ' sa-field-wide' : ''}`}
              key={field.key}
            >
              <span className="sa-label">
                {field.label}
                {locked ? <span className="sa-hint"> — not editable</span> : null}
                {!locked && field.kind !== 'toggle' && field.kind !== 'select' ? (
                  <span className="sa-hint"> up to {field.limit}</span>
                ) : null}
              </span>

              {field.kind === 'textarea' ? (
                <textarea
                  {...common}
                  rows={3}
                  maxLength={field.limit}
                  value={value}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              ) : field.kind === 'select' ? (
                <select
                  {...common}
                  value={value}
                  onChange={(event) => set(field.key, event.target.value)}
                >
                  {(field.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.kind === 'toggle' ? (
                <span className="sa-checkbox">
                  <input
                    id={id}
                    type="checkbox"
                    disabled={!canEdit || busy || locked}
                    checked={value === 'on'}
                    onChange={(event) => set(field.key, event.target.checked ? 'on' : 'off')}
                  />
                  <span>{value === 'on' ? 'On' : 'Off'}</span>
                </span>
              ) : (
                <input
                  {...common}
                  type={
                    field.kind === 'email'
                      ? 'email'
                      : field.kind === 'number'
                        ? 'number'
                        : field.kind === 'datetime'
                          ? 'datetime-local'
                          : 'text'
                  }
                  inputMode={field.kind === 'money' ? 'decimal' : undefined}
                  min={field.kind === 'number' ? 0 : undefined}
                  maxLength={field.kind === 'number' || field.kind === 'datetime' ? undefined : field.limit}
                  value={value}
                  onChange={(event) => set(field.key, event.target.value)}
                />
              )}

              {field.help ? <span className="sa-hint">{field.help}</span> : null}
            </label>
          );
        })}
      </div>

      {shippingExample ? <p className="sa-note" aria-live="polite">{shippingExample}</p> : null}

      <div className="sa-edit-actions">
        {canEdit ? (
          <button className="sa-btn sa-btn-primary" type="submit" disabled={busy || changed.length === 0}>
            {busy ? 'Saving…' : changed.length === 0 ? 'Saved' : `Save ${changed.length} change(s)`}
          </button>
        ) : (
          <span className="sa-lock-note">Read-only access.</span>
        )}
        <span className="sa-note">Every save writes one audit row per changed setting.</span>
      </div>
    </form>
  );
}
