'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { CatalogVariant } from '@/lib/store-admin/catalog';

interface Props {
  productId: string;
  basePricePaise: number;
  initialVariants: CatalogVariant[];
  canEdit: boolean;
}

interface VariantForm {
  id: string;
  sku: string;
  optionName: string;
  optionValue: string;
  optionHex: string;
  priceOverride: string;
  sortOrder: string;
  isActive: boolean;
}

function emptyForm(): VariantForm {
  return {
    id: '',
    sku: '',
    optionName: 'Colour',
    optionValue: '',
    optionHex: '',
    priceOverride: '',
    sortOrder: '0',
    isActive: true,
  };
}

function toForm(variant: CatalogVariant): VariantForm {
  return {
    id: variant.id,
    sku: variant.sku ?? '',
    optionName: variant.optionName,
    optionValue: variant.optionValue,
    optionHex: variant.optionHex ?? '',
    priceOverride:
      variant.pricePaiseOverride === null
        ? ''
        : (variant.pricePaiseOverride / 100).toFixed(2),
    sortOrder: String(variant.sortOrder),
    isActive: variant.isActive,
  };
}

function money(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/** Variants (colour, size, capacity) with an optional price override. */
export function VariantEditor({ productId, basePricePaise, initialVariants, canEdit }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<VariantForm>(emptyForm);
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

  function beginEdit(variant: CatalogVariant) {
    setForm(toForm(variant));
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      let priceOverridePaise: number | null = null;
      if (form.priceOverride.trim()) {
        const value = Math.round(Number(form.priceOverride) * 100);
        if (!Number.isFinite(value) || value <= 0) {
          throw new Error('The price override must be a positive amount, or blank.');
        }
        priceOverridePaise = value;
      }

      const response = await fetch(
        `/api/store-admin/catalog/products/${encodeURIComponent(productId)}/variants`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: form.id || undefined,
            sku: form.sku || null,
            optionName: form.optionName,
            optionValue: form.optionValue,
            optionHex: form.optionHex || null,
            priceOverridePaise,
            sortOrder: Number(form.sortOrder || 0),
            isActive: form.isActive,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this variant.');
      }
      setNotice(body.created ? 'Variant created.' : 'Variant saved.');
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this variant.');
    } finally {
      setBusy(null);
    }
  }

  async function archive(variant: CatalogVariant) {
    setBusy(variant.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variant.id)}`,
        { method: 'DELETE' },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not archive this variant.',
        );
      }
      setNotice('Variant archived. Past orders keep resolving to it.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not archive this variant.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-section">
      <h2 className="sa-section-title">Variants</h2>
      <p className="sa-card-note">
        Colour, size or capacity. A price override replaces the product price
        for that variant, and each change is written to the price history.
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
              <th>Variant</th>
              <th>SKU</th>
              <th className="sa-num">Price</th>
              <th>Status</th>
              {canEdit ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {initialVariants.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="sa-empty">
                  No variants yet.
                </td>
              </tr>
            ) : (
              initialVariants.map((variant) => (
                <tr key={variant.id}>
                  <td>
                    <span className="sa-variant">
                      <span
                        className="sa-swatch"
                        style={{ background: variant.optionHex ?? 'transparent' }}
                        aria-hidden="true"
                      />
                      {variant.optionValue}
                    </span>
                    <div className="sa-row-sub">{variant.optionName}</div>
                  </td>
                  <td className="sa-mono">{variant.sku ?? '—'}</td>
                  <td className="sa-num">
                    {money(variant.pricePaiseOverride ?? basePricePaise)}
                    {variant.pricePaiseOverride === null ? (
                      <span className="sa-row-sub">base price</span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={
                        variant.isActive ? 'sa-status sa-status-on' : 'sa-status'
                      }
                    >
                      {variant.isActive ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        onClick={() => beginEdit(variant)}
                      >
                        Edit
                      </button>{' '}
                      {variant.isActive ? (
                        <button
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          type="button"
                          disabled={busy === variant.id}
                          onClick={() => archive(variant)}
                        >
                          Archive
                        </button>
                      ) : null}
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
              {form.id ? 'Edit variant' : 'New variant'}
            </h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">SKU</span>
                <input
                  className="sa-input sa-mono"
                  maxLength={64}
                  placeholder="GAD-20W-BLK"
                  value={form.sku}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sku: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Option</span>
                <input
                  className="sa-input"
                  maxLength={40}
                  value={form.optionName}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, optionName: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Value</span>
                <input
                  className="sa-input"
                  maxLength={60}
                  value={form.optionValue}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, optionValue: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Colour hex</span>
                <input
                  className="sa-input sa-mono"
                  maxLength={7}
                  placeholder="#1f2937"
                  value={form.optionHex}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, optionHex: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">
                  Price override ₹ <span className="sa-hint">blank uses the base price</span>
                </span>
                <input
                  className="sa-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.priceOverride}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, priceOverride: event.target.value }))
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
            </div>
            <div className="sa-inline-actions">
              <button
                className="sa-btn sa-btn-primary"
                type="button"
                disabled={busy === 'save' || !form.optionValue.trim()}
                onClick={save}
              >
                {busy === 'save' ? 'Saving…' : 'Save variant'}
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
              New variant
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only an owner or admin can change variants.</p>
      )}
    </section>
  );
}
