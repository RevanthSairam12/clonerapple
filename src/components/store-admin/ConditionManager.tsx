'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface ConditionRow {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
}

interface Props {
  initialConditions: ConditionRow[];
  canEdit: boolean;
}

interface ConditionForm {
  id: string;
  label: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
}

function emptyForm(): ConditionForm {
  return { id: '', label: '', description: '', sortOrder: '0', isActive: true };
}

function toForm(condition: ConditionRow): ConditionForm {
  return {
    id: condition.id,
    label: condition.label,
    description: condition.description,
    sortOrder: String(condition.sortOrder),
    isActive: condition.isActive,
  };
}

/** Product conditions: New / Refurbished / Used. Owner-only on the server. */
export function ConditionManager({ initialConditions, canEdit }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<ConditionForm>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginCreate() {
    setForm(emptyForm());
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  function beginEdit(condition: ConditionRow) {
    setForm(toForm(condition));
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/catalog/conditions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          label: form.label,
          description: form.description,
          sortOrder: Number(form.sortOrder || 0),
          isActive: form.isActive,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this condition.');
      }
      setNotice(body.created ? 'Condition created.' : 'Condition saved.');
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this condition.');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(condition: ConditionRow) {
    setBusy(condition.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/conditions/${encodeURIComponent(condition.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isActive: !condition.isActive }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not change this condition.',
        );
      }
      setNotice(condition.isActive ? 'Condition hidden.' : 'Condition shown.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change this condition.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Conditions</h2>
      <p className="sa-card-note">
        The condition a product is sold in. A hidden condition stays on products
        that already use it; it just stops being offered for new ones.
      </p>

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="sa-notice" role="status">
          {notice}
        </p>
      ) : null}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Condition</th>
              <th className="sa-num">Sort</th>
              <th>Status</th>
              {canEdit ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {initialConditions.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 4 : 3} className="sa-empty">
                  No conditions yet.
                </td>
              </tr>
            ) : (
              initialConditions.map((condition) => (
                <tr key={condition.id}>
                  <td>
                    <strong>{condition.label}</strong>
                    <div className="sa-row-sub">
                      {condition.description || condition.id}
                    </div>
                  </td>
                  <td className="sa-num">{condition.sortOrder}</td>
                  <td>
                    <span
                      className={
                        condition.isActive ? 'sa-status sa-status-on' : 'sa-status'
                      }
                    >
                      {condition.isActive ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        onClick={() => beginEdit(condition)}
                      >
                        Edit
                      </button>{' '}
                      <button
                        className="sa-btn sa-btn-quiet sa-btn-small"
                        type="button"
                        disabled={busy === condition.id}
                        onClick={() => toggle(condition)}
                      >
                        {condition.isActive ? 'Hide' : 'Show'}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        editing ? (
          <div className="sa-control-card">
            <h3 className="sa-control-title">
              {form.id ? 'Edit condition' : 'New condition'}
            </h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Label</span>
                <input
                  className="sa-input"
                  maxLength={80}
                  value={form.label}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, label: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Sort order</span>
                <input
                  className="sa-input"
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              </label>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, isActive: event.target.checked }))
                  }
                />
                Active
              </label>
              <label className="sa-field sa-field-wide">
                <span className="sa-label">Description</span>
                <textarea
                  className="sa-input"
                  rows={2}
                  maxLength={300}
                  value={form.description}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, description: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="sa-inline-actions">
              <button
                className="sa-btn sa-btn-primary"
                type="button"
                disabled={busy === 'save' || !form.label.trim()}
                onClick={save}
              >
                {busy === 'save' ? 'Saving…' : 'Save condition'}
              </button>
              <button
                className="sa-btn sa-btn-quiet"
                type="button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="sa-inline-actions">
            <button className="sa-btn sa-btn-primary" type="button" onClick={beginCreate}>
              New condition
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only a store owner can change conditions.</p>
      )}
    </section>
  );
}
