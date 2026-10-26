'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import type { SettingField } from '@/lib/store-admin/settings-rules';

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
    for (const field of fields) draft[field.key] = initial[field.key] ?? field.default;
    return draft;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const changed = useMemo(
    () =>
      fields
        .filter((field) => (initial[field.key] ?? field.default) !== values[field.key])
        .map((field) => ({ key: field.key, value: values[field.key] })),
    [fields, initial, values],
  );

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
          const value = values[field.key] ?? '';
          const common = {
            id,
            className: 'sa-input',
            disabled: !canEdit || busy,
          };

          return (
            <label
              className={`sa-field${field.kind === 'textarea' ? ' sa-field-wide' : ''}`}
              key={field.key}
            >
              <span className="sa-label">
                {field.label}
                {field.kind !== 'toggle' && field.kind !== 'select' ? (
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
                    disabled={!canEdit || busy}
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
