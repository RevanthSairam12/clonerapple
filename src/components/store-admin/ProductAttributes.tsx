'use client';

import { useState } from 'react';

import type {
  CatalogAttribute,
  CatalogProductAttributeValue,
} from '@/lib/store-admin/catalog';

interface Props {
  productId: string;
  attributes: CatalogAttribute[];
  values: CatalogProductAttributeValue[];
  canEdit: boolean;
}

function initialDraft(values: CatalogProductAttributeValue[]): Record<string, string> {
  const draft: Record<string, string> = {};
  for (const value of values) {
    if (value.valueBool !== null) draft[value.attributeId] = String(value.valueBool);
    else if (value.valueNumber !== null) draft[value.attributeId] = String(value.valueNumber);
    else if (value.optionValue !== null) draft[value.attributeId] = value.optionValue;
    else draft[value.attributeId] = value.valueText ?? '';
  }
  return draft;
}

/**
 * Product attribute values.
 *
 * The input shape follows the attribute's declared type; the server checks the
 * same thing again before writing, because the type lives in the database.
 */
export function ProductAttributes({ productId, attributes, values, canEdit }: Props) {
  const [draft, setDraft] = useState<Record<string, string>>(() => initialDraft(values));
  const [saved, setSaved] = useState<Record<string, string>>(() => initialDraft(values));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const active = attributes.filter(
    (attribute) => attribute.isActive && attribute.deletedAt === null,
  );

  async function save(attribute: CatalogAttribute) {
    const raw = (draft[attribute.id] ?? '').trim();
    if (!raw) {
      setError(`Enter a value for ${attribute.label} first.`);
      setNotice(null);
      return;
    }

    const value =
      attribute.dataType === 'boolean'
        ? raw === 'true'
        : attribute.dataType === 'number'
          ? Number(raw)
          : raw;

    setBusy(attribute.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/products/${productId}/attributes`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ attributeId: attribute.id, value }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not save this value.',
        );
      }
      setSaved((current) => ({ ...current, [attribute.id]: raw }));
      setNotice(`${attribute.label} saved.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this value.');
    } finally {
      setBusy(null);
    }
  }

  async function clear(attribute: CatalogAttribute) {
    setBusy(attribute.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/products/${productId}/attributes?attributeId=${encodeURIComponent(attribute.id)}`,
        { method: 'DELETE' },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not clear this value.',
        );
      }
      setDraft((current) => ({ ...current, [attribute.id]: '' }));
      setSaved((current) => ({ ...current, [attribute.id]: '' }));
      setNotice(`${attribute.label} cleared.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not clear this value.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-section">
      <h2 className="sa-section-title">Attributes</h2>

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

      {active.length === 0 ? (
        <p className="sa-empty">
          No attributes are defined yet. Add them under Catalogue data.
        </p>
      ) : (
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Attribute</th>
                <th>Value</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {active.map((attribute) => {
                const set = Boolean(saved[attribute.id]);
                const dirty = (draft[attribute.id] ?? '') !== (saved[attribute.id] ?? '');
                return (
                  <tr key={attribute.id}>
                    <td>
                      <strong>{attribute.label}</strong>
                      <div className="sa-row-sub sa-mono">
                        {attribute.key}
                        {attribute.unitLabel ? ` · ${attribute.unitLabel}` : ''}
                        {attribute.dataType === 'enum' ? ' · list' : ` · ${attribute.dataType}`}
                      </div>
                    </td>
                    <td>
                      {attribute.dataType === 'enum' ? (
                        <select
                          className="sa-input"
                          value={draft[attribute.id] ?? ''}
                          disabled={!canEdit || busy === attribute.id}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          {attribute.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.value}
                            </option>
                          ))}
                        </select>
                      ) : attribute.dataType === 'boolean' ? (
                        <select
                          className="sa-input"
                          value={draft[attribute.id] ?? ''}
                          disabled={!canEdit || busy === attribute.id}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">—</option>
                          <option value="true">Yes</option>
                          <option value="false">No</option>
                        </select>
                      ) : (
                        <input
                          className="sa-input"
                          type={attribute.dataType === 'number' ? 'number' : 'text'}
                          step={attribute.dataType === 'number' ? 'any' : undefined}
                          maxLength={attribute.dataType === 'number' ? undefined : 200}
                          value={draft[attribute.id] ?? ''}
                          disabled={!canEdit || busy === attribute.id}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              [attribute.id]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </td>
                    <td>
                      {canEdit ? (
                        <div className="sa-inline-actions">
                          <button
                            className="sa-btn sa-btn-primary sa-btn-small"
                            type="button"
                            disabled={busy === attribute.id || !dirty}
                            onClick={() => save(attribute)}
                          >
                            {busy === attribute.id ? 'Saving…' : 'Save'}
                          </button>
                          {set ? (
                            <button
                              className="sa-btn sa-btn-quiet sa-btn-small"
                              type="button"
                              disabled={busy === attribute.id}
                              onClick={() => clear(attribute)}
                            >
                              Clear
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="sa-row-sub">read only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
