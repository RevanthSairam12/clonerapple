'use client';

import { useState } from 'react';

import {
  SETTING_KEYS,
  SETTING_LABELS,
  SETTING_LIMITS,
  type StoreSettingKey,
} from '@/lib/store-admin/settings-rules';

interface Props {
  initial: Record<StoreSettingKey, string>;
  canEdit: boolean;
}

export function StoreSettingsForm({ initial, canEdit }: Props) {
  const [values, setValues] = useState<Record<string, string>>({ ...initial });
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function save(key: StoreSettingKey) {
    setSaving(key);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch('/api/store-admin/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key, value: values[key] ?? '' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this setting.');
      }
      setSaved(SETTING_LABELS[key]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this setting.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {saved ? <p className="sa-notice" role="status">{saved} saved.</p> : null}

      <div className="sa-detail-grid">
        {SETTING_KEYS.map((key) => {
          const isLong = key === 'address' || key === 'receipt_footer';
          const limit = SETTING_LIMITS[key];
          return (
            <section className="sa-detail-card" key={key}>
              <h2 className="sa-card-title">{SETTING_LABELS[key]}</h2>
              <label className="sa-field">
                <span className="sa-label">
                  {SETTING_LABELS[key]} <span className="sa-hint">up to {limit} characters</span>
                </span>
                {isLong ? (
                  <textarea
                    className="sa-input"
                    rows={3}
                    maxLength={limit}
                    value={values[key] ?? ''}
                    disabled={!canEdit || saving === key}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                ) : (
                  <input
                    className="sa-input"
                    maxLength={limit}
                    value={values[key] ?? ''}
                    disabled={!canEdit || saving === key}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                    }
                  />
                )}
              </label>
              {canEdit ? (
                <button
                  className="sa-btn sa-btn-primary"
                  type="button"
                  disabled={saving === key}
                  onClick={() => save(key)}
                >
                  {saving === key ? 'Saving…' : `Save ${SETTING_LABELS[key].toLowerCase()}`}
                </button>
              ) : (
                <p className="sa-lock-note">Only a store owner can change settings.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
