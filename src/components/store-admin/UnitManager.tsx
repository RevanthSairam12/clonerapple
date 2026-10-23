'use client';

import { useState } from 'react';

import type { CatalogUnit } from '@/lib/store-admin/catalog';

interface Props {
  initialUnits: CatalogUnit[];
  canEdit: boolean;
}

const DIMENSIONS = ['mass', 'volume', 'length', 'count'];

interface UnitForm {
  code: string;
  label: string;
  dimension: string;
  base_code: string;
  factor: string;
}

function emptyForm(): UnitForm {
  return { code: '', label: '', dimension: 'count', base_code: '', factor: '1' };
}

function toForm(unit: CatalogUnit): UnitForm {
  return {
    code: unit.code,
    label: unit.label,
    dimension: unit.dimension,
    base_code: unit.baseCode ?? '',
    factor: String(unit.factor),
  };
}

interface ApiUnit {
  id: string;
  code: string;
  label: string;
  dimension: string;
  base_code: string | null;
  factor: string | number;
}

function fromApi(unit: ApiUnit, attributeCount: number): CatalogUnit {
  return {
    id: unit.id,
    code: unit.code,
    label: unit.label,
    dimension: unit.dimension,
    baseCode: unit.base_code,
    factor: Number(unit.factor),
    attributeCount,
  };
}

/**
 * Units of measure. There is no delete: an attribute may point at a unit, and
 * a unit that disappears would leave the value unreadable.
 */
export function UnitManager({ initialUnits, canEdit }: Props) {
  const [units, setUnits] = useState<CatalogUnit[]>(initialUnits);
  const [form, setForm] = useState<UnitForm>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginCreate() {
    setForm(emptyForm());
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  function beginEdit(unit: CatalogUnit) {
    setForm(toForm(unit));
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/catalog/units', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          label: form.label,
          dimension: form.dimension,
          base_code: form.base_code || undefined,
          factor: Number(form.factor || 1),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this unit.');
      }
      const saved = fromApi(
        body.unit as ApiUnit,
        units.find((unit) => unit.code === (body.unit as ApiUnit).code)?.attributeCount ?? 0,
      );
      setUnits((current) => {
        const exists = current.some((unit) => unit.code === saved.code);
        return exists
          ? current.map((unit) => (unit.code === saved.code ? saved : unit))
          : [...current, saved];
      });
      setNotice(body.created ? 'Unit created.' : 'Unit saved.');
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this unit.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Units</h2>
      <p className="sa-card-note">
        Used by numeric attributes. A derived unit names its base unit and the
        factor that converts one base unit into it.
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
              <th>Unit</th>
              <th>Dimension</th>
              <th className="sa-num">Factor</th>
              <th className="sa-num">Attributes</th>
              {canEdit ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {units.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="sa-empty">
                  No units yet.
                </td>
              </tr>
            ) : (
              units.map((unit) => (
                <tr key={unit.code}>
                  <td>
                    <strong>{unit.label}</strong>
                    <div className="sa-row-sub sa-mono">
                      {unit.code}
                      {unit.baseCode ? ` · base ${unit.baseCode}` : ' · base unit'}
                    </div>
                  </td>
                  <td>{unit.dimension}</td>
                  <td className="sa-num">{unit.factor}</td>
                  <td className="sa-num">{unit.attributeCount}</td>
                  {canEdit ? (
                    <td>
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        onClick={() => beginEdit(unit)}
                      >
                        Edit
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
            <h3 className="sa-control-title">Unit</h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Code</span>
                <input
                  className="sa-input"
                  maxLength={16}
                  value={form.code}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, code: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Label</span>
                <input
                  className="sa-input"
                  maxLength={40}
                  value={form.label}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, label: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Dimension</span>
                <select
                  className="sa-input"
                  value={form.dimension}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dimension: event.target.value }))
                  }
                >
                  {DIMENSIONS.map((dimension) => (
                    <option key={dimension} value={dimension}>
                      {dimension}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sa-field">
                <span className="sa-label">
                  Base code <span className="sa-hint">blank for the base unit</span>
                </span>
                <input
                  className="sa-input"
                  maxLength={16}
                  value={form.base_code}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, base_code: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Factor</span>
                <input
                  className="sa-input"
                  type="number"
                  step="any"
                  min={0}
                  value={form.factor}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, factor: event.target.value }))
                  }
                />
              </label>
            </div>
            <div className="sa-inline-actions">
              <button
                className="sa-btn sa-btn-primary"
                type="button"
                disabled={busy || !form.code.trim() || !form.label.trim()}
                onClick={save}
              >
                {busy ? 'Saving…' : 'Save unit'}
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
              New unit
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only a store owner can change units.</p>
      )}
    </section>
  );
}
