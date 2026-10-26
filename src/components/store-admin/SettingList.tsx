'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { ListField, ListRow } from '@/lib/store-admin/setting-lists';

interface Props {
  listKey: string;
  label: string;
  fields: readonly ListField[];
  rows: ListRow[];
  canEdit: boolean;
  /** Fixed rows (page SEO) can be edited but never added. */
  fixedRows?: boolean;
}

function fieldValue(row: ListRow | null, field: ListField): string {
  if (!row) {
    if (field.defaultValue) return field.defaultValue;
    return field.kind === 'toggle' ? (field.column === 'is_active' ? 'on' : 'off') : '';
  }
  return row.values[field.column] ?? '';
}

function display(field: ListField, value: string): string {
  if (field.kind === 'toggle') return value === 'on' ? 'On' : 'Off';
  if (field.kind === 'money') return `₹${value}`;
  if (field.kind === 'select') {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  return value || '—';
}

/**
 * One configuration list: a read-only table with inline edit and hide
 * controls. Rows are never deleted — hiding keeps old orders readable.
 */
export function SettingList({ listKey, label, fields, rows, canEdit, fixedRows }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Long-form text stays in the editor; the table shows the identifying fields.
  const tableFields = fields.filter(
    (field) => field.column !== 'is_active' && field.kind !== 'textarea',
  );
  const hasActive = fields.some((field) => field.column === 'is_active');

  function startEdit(row: ListRow | null) {
    const values: Record<string, string> = {};
    for (const field of fields) values[field.column] = fieldValue(row, field);
    setDraft(values);
    setEditing(row ? row.id : 'new');
    setError(null);
  }

  async function save(id: string | null, values: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/store-admin/settings/lists/${encodeURIComponent(listKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(id ? { id, values } : { values }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The row could not be saved.');
      }
      setEditing(null);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The row could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function toggleActive(row: ListRow) {
    const values = { ...row.values };
    if (hasActive) values.is_active = row.isActive ? 'off' : 'on';
    void save(row.id, values);
  }

  const editingRow = editing && editing !== 'new' ? rows.find((row) => row.id === editing) : null;

  return (
    <section className="sa-detail-card">
      <div className="sa-detail-head">
        <h2>{label}</h2>
        {canEdit && !fixedRows ? (
          <button
            type="button"
            className="sa-btn"
            onClick={() => startEdit(null)}
            disabled={busy || editing === 'new'}
          >
            Add
          </button>
        ) : null}
      </div>

      {error ? <p className="sa-error" role="alert">{error}</p> : null}

      {rows.length === 0 ? (
        <p className="sa-note">Nothing here yet.</p>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                {tableFields.slice(0, 5).map((field) => (
                  <th key={field.column}>{field.label}</th>
                ))}
                {hasActive ? <th>Status</th> : null}
                {canEdit ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={row.isActive ? undefined : 'sa-row-muted'}>
                  {tableFields.slice(0, 5).map((field) => (
                    <td key={field.column}>{display(field, row.values[field.column] ?? '')}</td>
                  ))}
                  {hasActive ? (
                    <td>
                      <span className={row.isActive ? 'sa-status sa-status-on' : 'sa-status sa-status-off'}>
                        {row.isActive ? 'On' : 'Hidden'}
                      </span>
                    </td>
                  ) : null}
                  {canEdit ? (
                    <td className="sa-row-actions">
                      <button type="button" className="sa-link" onClick={() => startEdit(row)} disabled={busy}>
                        Edit
                      </button>
                      {hasActive ? (
                        <button
                          type="button"
                          className="sa-link"
                          onClick={() => toggleActive(row)}
                          disabled={busy}
                        >
                          {row.isActive ? 'Hide' : 'Show'}
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <form
          className="sa-edit-form sa-inline-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save(editing === 'new' ? null : editing, draft);
          }}
        >
          <div className="sa-control-grid">
            {fields.map((field) => {
              const disabledKey = Boolean(field.createOnly && editing !== 'new');
              const value = draft[field.column] ?? '';
              const id = `${listKey}-${editing}-${field.column}`;
              return (
                <label className="sa-field" key={field.column} htmlFor={id}>
                  <span className="sa-label">
                    {field.label}
                    {field.createOnly && editing !== 'new' ? (
                      <span className="sa-hint"> fixed</span>
                    ) : null}
                  </span>
                  {field.kind === 'toggle' ? (
                    <span className="sa-checkbox">
                      <input
                        id={id}
                        type="checkbox"
                        checked={value === 'on'}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            [field.column]: event.target.checked ? 'on' : 'off',
                          }))
                        }
                      />
                      <span>{value === 'on' ? 'On' : 'Off'}</span>
                    </span>
                  ) : field.kind === 'textarea' ? (
                    <textarea
                      id={id}
                      className="sa-input"
                      rows={4}
                      maxLength={field.max}
                      value={value}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.column]: event.target.value }))
                      }
                    />
                  ) : field.kind === 'select' ? (
                    <select
                      id={id}
                      className="sa-input"
                      value={value}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.column]: event.target.value }))
                      }
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={id}
                      className="sa-input"
                      type={field.kind === 'number' || field.kind === 'money' ? 'number' : 'text'}
                      step={field.kind === 'money' ? '0.01' : undefined}
                      min={field.kind === 'number' || field.kind === 'money' ? 0 : undefined}
                      maxLength={field.max}
                      value={value}
                      disabled={busy || disabledKey}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.column]: event.target.value }))
                      }
                    />
                  )}
                  {field.help ? <span className="sa-hint">{field.help}</span> : null}
                </label>
              );
            })}
          </div>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : editing === 'new' ? 'Create' : 'Save'}
            </button>
            <button
              className="sa-btn"
              type="button"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </button>
            {editingRow ? <span className="sa-note">Editing {editingRow.id}</span> : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
