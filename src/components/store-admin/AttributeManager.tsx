'use client';

import { useState } from 'react';

import type { CatalogAttribute, CatalogUnit } from '@/lib/store-admin/catalog';

interface Props {
  initialAttributes: CatalogAttribute[];
  units: CatalogUnit[];
  canEdit: boolean;
}

const DATA_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / no' },
  { value: 'enum', label: 'List of options' },
];

interface AttributeForm {
  key: string;
  label: string;
  data_type: string;
  unit_id: string;
  is_filterable: boolean;
  is_variant_option: boolean;
  sort_order: string;
}

function emptyForm(): AttributeForm {
  return {
    key: '',
    label: '',
    data_type: 'text',
    unit_id: '',
    is_filterable: false,
    is_variant_option: false,
    sort_order: '0',
  };
}

function toForm(attribute: CatalogAttribute): AttributeForm {
  return {
    key: attribute.key,
    label: attribute.label,
    data_type: attribute.dataType,
    unit_id: attribute.unitId ?? '',
    is_filterable: attribute.isFilterable,
    is_variant_option: attribute.isVariantOption,
    sort_order: String(attribute.sortOrder),
  };
}

interface ApiAttribute {
  id: string;
  key: string;
  label: string;
  data_type: string;
  unit_id: string | null;
  is_filterable: boolean;
  is_variant_option: boolean;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
}

/**
 * Attributes and their options.
 *
 * An attribute's type cannot change once a product has a value for it — the
 * value lives in a type-specific column, so changing the type would strand it.
 * The server enforces that; the UI shows why the control is disabled.
 */
export function AttributeManager({ initialAttributes, units, canEdit }: Props) {
  const [attributes, setAttributes] = useState<CatalogAttribute[]>(initialAttributes);
  const [form, setForm] = useState<AttributeForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginCreate() {
    setForm(emptyForm());
    setEditingId('new');
    setError(null);
    setNotice(null);
  }

  function beginEdit(attribute: CatalogAttribute) {
    setForm(toForm(attribute));
    setEditingId(attribute.id);
    setError(null);
    setNotice(null);
  }

  function replaceAttribute(next: CatalogAttribute) {
    setAttributes((current) =>
      current.map((attribute) => (attribute.id === next.id ? next : attribute)),
    );
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/catalog/attributes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: form.key,
          label: form.label,
          data_type: form.data_type,
          unit_id: form.unit_id || undefined,
          is_filterable: form.is_filterable,
          is_variant_option: form.is_variant_option,
          sort_order: Number(form.sort_order || 0),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not save this attribute.',
        );
      }

      const row = body.attribute as ApiAttribute;
      const previous = attributes.find((attribute) => attribute.key === row.key);
      const saved: CatalogAttribute = {
        id: row.id,
        key: row.key,
        label: row.label,
        dataType: row.data_type,
        unitId: row.unit_id,
        unitLabel: units.find((unit) => unit.id === row.unit_id)?.label ?? null,
        isFilterable: row.is_filterable,
        isVariantOption: row.is_variant_option,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        deletedAt: row.deleted_at,
        options: previous?.options ?? [],
        productCount: previous?.productCount ?? 0,
      };

      setAttributes((current) => {
        const exists = current.some((attribute) => attribute.id === saved.id);
        return exists
          ? current.map((attribute) => (attribute.id === saved.id ? saved : attribute))
          : [...current, saved];
      });
      setNotice(body.created ? 'Attribute created.' : 'Attribute saved.');
      setEditingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this attribute.');
    } finally {
      setBusy(null);
    }
  }

  async function archive(attribute: CatalogAttribute) {
    setBusy(attribute.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/attributes/${attribute.id}`, {
        method: 'DELETE',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not remove this attribute.',
        );
      }
      replaceAttribute({
        ...attribute,
        isActive: false,
        deletedAt: new Date().toISOString(),
      });
      setNotice('Attribute removed. Saving the same key again restores it.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this attribute.');
    } finally {
      setBusy(null);
    }
  }

  async function addOption(attribute: CatalogAttribute) {
    const value = (optionDrafts[attribute.id] ?? '').trim();
    if (!value) return;

    setBusy(`option-${attribute.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/attributes/${attribute.id}/options`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value, sortOrder: attribute.options.length }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not add this option.');
      }
      replaceAttribute({
        ...attribute,
        options: [
          ...attribute.options,
          { value, sortOrder: attribute.options.length },
        ],
      });
      setOptionDrafts((current) => ({ ...current, [attribute.id]: '' }));
      setNotice(`Option “${value}” added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add this option.');
    } finally {
      setBusy(null);
    }
  }

  async function removeOption(attribute: CatalogAttribute, value: string) {
    setBusy(`option-${attribute.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/attributes/${attribute.id}/options?value=${encodeURIComponent(value)}`,
        { method: 'DELETE' },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not remove this option.',
        );
      }
      replaceAttribute({
        ...attribute,
        options: attribute.options.filter((option) => option.value !== value),
      });
      setNotice(`Option “${value}” removed.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this option.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Attributes</h2>
      <p className="sa-card-note">
        Attributes describe products. A list attribute&apos;s options are the
        only accepted values for it.
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

      {attributes.length === 0 ? (
        <p className="sa-empty">No attributes yet.</p>
      ) : (
        <div className="sa-attr-list">
          {attributes.map((attribute) => {
            const typeChanged =
              editingId === attribute.id && attribute.dataType !== form.data_type;
            return (
              <div key={attribute.id} className="sa-attr-row">
                <div className="sa-attr-head">
                  <div>
                    <strong>{attribute.label}</strong>
                    <div className="sa-row-sub sa-mono">
                      {attribute.key} · {attribute.dataType}
                      {attribute.unitLabel ? ` · ${attribute.unitLabel}` : ''}
                      {attribute.isFilterable ? ' · filterable' : ''}
                      {attribute.isVariantOption ? ' · variant option' : ''}
                    </div>
                  </div>
                  <div className="sa-inline-actions">
                    <span
                      className={
                        attribute.deletedAt
                          ? 'sa-status'
                          : attribute.isActive
                            ? 'sa-status sa-status-on'
                            : 'sa-status'
                      }
                    >
                      {attribute.deletedAt
                        ? 'Removed'
                        : attribute.isActive
                          ? 'Active'
                          : 'Inactive'}
                    </span>
                    {canEdit && !attribute.deletedAt ? (
                      <>
                        <button
                          className="sa-btn sa-btn-small"
                          type="button"
                          onClick={() => beginEdit(attribute)}
                        >
                          Edit
                        </button>
                        <button
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          type="button"
                          disabled={busy === attribute.id || attribute.productCount > 0}
                          title={
                            attribute.productCount > 0
                              ? 'Clear product values for this attribute first.'
                              : undefined
                          }
                          onClick={() => archive(attribute)}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>

                {attribute.dataType === 'enum' ? (
                  <div className="sa-attr-options">
                    {attribute.options.length === 0 ? (
                      <span className="sa-row-sub">No options yet.</span>
                    ) : (
                      attribute.options.map((option) => (
                        <span key={option.value} className="sa-chip">
                          {option.value}
                          {canEdit ? (
                            <button
                              className="sa-chip-x"
                              type="button"
                              aria-label={`Remove ${option.value}`}
                              disabled={busy === `option-${attribute.id}`}
                              onClick={() => removeOption(attribute, option.value)}
                            >
                              ×
                            </button>
                          ) : null}
                        </span>
                      ))
                    )}
                    {canEdit ? (
                      <span className="sa-attr-add">
                        <input
                          className="sa-input sa-input-small"
                          placeholder="New option"
                          maxLength={80}
                          value={optionDrafts[attribute.id] ?? ''}
                          onChange={(event) =>
                            setOptionDrafts((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addOption(attribute);
                            }
                          }}
                        />
                        <button
                          className="sa-btn sa-btn-small"
                          type="button"
                          disabled={
                            busy === `option-${attribute.id}` ||
                            !(optionDrafts[attribute.id] ?? '').trim()
                          }
                          onClick={() => addOption(attribute)}
                        >
                          Add
                        </button>
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {typeChanged ? (
                  <p className="sa-lock-note">
                    This attribute has product values, so its type is fixed.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {canEdit ? (
        editingId !== null ? (
          <div className="sa-control-card">
            <h3 className="sa-control-title">Attribute</h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Key</span>
                <input
                  className="sa-input"
                  maxLength={48}
                  value={form.key}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, key: event.target.value }))
                  }
                />
              </label>
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
                <span className="sa-label">Type</span>
                <select
                  className="sa-input"
                  value={form.data_type}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, data_type: event.target.value }))
                  }
                >
                  {DATA_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sa-field">
                <span className="sa-label">
                  Unit <span className="sa-hint">numbers only</span>
                </span>
                <select
                  className="sa-input"
                  value={form.unit_id}
                  disabled={form.data_type !== 'number'}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, unit_id: event.target.value }))
                  }
                >
                  <option value="">No unit</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.label} ({unit.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="sa-field">
                <span className="sa-label">Sort order</span>
                <input
                  className="sa-input"
                  type="number"
                  min={0}
                  value={form.sort_order}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sort_order: event.target.value }))
                  }
                />
              </label>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={form.is_filterable}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_filterable: event.target.checked,
                    }))
                  }
                />
                Show as a filter
              </label>
              <label className="sa-check">
                <input
                  type="checkbox"
                  checked={form.is_variant_option}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      is_variant_option: event.target.checked,
                    }))
                  }
                />
                Used for variant options
              </label>
            </div>
            <div className="sa-inline-actions">
              <button
                className="sa-btn sa-btn-primary"
                type="button"
                disabled={busy === 'save' || !form.key.trim() || !form.label.trim()}
                onClick={save}
              >
                {busy === 'save' ? 'Saving…' : 'Save attribute'}
              </button>
              <button
                className="sa-btn sa-btn-quiet"
                type="button"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="sa-inline-actions">
            <button className="sa-btn sa-btn-primary" type="button" onClick={beginCreate}>
              New attribute
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only a store owner can change attributes.</p>
      )}
    </section>
  );
}
