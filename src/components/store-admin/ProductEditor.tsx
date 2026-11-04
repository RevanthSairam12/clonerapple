'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type {
  CatalogBrand,
  CatalogProductDetail,
} from '@/lib/store-admin/catalog';

interface Props {
  product: CatalogProductDetail;
  brands: CatalogBrand[];
  conditions: Array<{ id: string; label: string }>;
  canEdit: boolean;
}

interface FormState {
  name: string;
  subtitle: string;
  badge: string;
  material: string;
  brand_id: string;
  condition_id: string;
  sort_order: string;
  cost: string;
  in_stock: boolean;
  description: string;
  seo_title: string;
  seo_description: string;
}

function costInput(paise: number | null | undefined): string {
  return paise === null || paise === undefined ? '' : (paise / 100).toFixed(2);
}

function toForm(product: CatalogProductDetail): FormState {
  return {
    name: product.name,
    subtitle: product.subtitle,
    badge: product.badge ?? '',
    material: product.material,
    brand_id: product.brandId ?? '',
    condition_id: product.conditionId ?? '',
    sort_order: String(product.sortOrder ?? ''),
    cost: costInput(product.costPaise),
    in_stock: product.inStock,
    description: product.description,
    seo_title: product.seoTitle,
    seo_description: product.seoDescription,
  };
}

/**
 * Copy and organisation editor for one product.
 *
 * Price is not a field here: it is edited by `ProductPriceEditor` so every
 * change goes through the price endpoint and appends to `price_history`. The
 * API rejects price keys on this endpoint outright.
 */
export function ProductEditor({ product, brands, conditions, canEdit }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const [duplicateSlug, setDuplicateSlug] = useState('');

  async function duplicate() {
    setSaving(true); setError(null); setSaved(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/products/${encodeURIComponent(product.id)}/duplicate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: duplicateName.trim(), slug: duplicateSlug.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.id !== 'string') throw new Error(result.error || 'Could not duplicate this product.');
      router.push(`/store-admin/products/${encodeURIComponent(result.id)}`);
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not duplicate this product.'); }
    finally { setSaving(false); }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setSaved(null);
  }

  /** Only send what actually changed, so the audit row is a real diff. */
  function changes(): Record<string, unknown> {
    const initial = toForm(product);
    const patch: Record<string, unknown> = {};

    if (form.name.trim() !== initial.name) patch.name = form.name.trim();
    if (form.subtitle.trim() !== initial.subtitle) patch.subtitle = form.subtitle.trim();
    if (form.badge.trim() !== initial.badge) patch.badge = form.badge.trim() || null;
    if (form.material.trim() !== initial.material) patch.material = form.material.trim();
    if (form.description.trim() !== initial.description) {
      patch.description = form.description.trim();
    }
    if (form.seo_title.trim() !== initial.seo_title) {
      patch.seo_title = form.seo_title.trim();
    }
    if (form.seo_description.trim() !== initial.seo_description) {
      patch.seo_description = form.seo_description.trim();
    }
    if (form.brand_id !== initial.brand_id) {
      patch.brand_id = form.brand_id || null;
    }
    if (form.condition_id !== initial.condition_id) {
      patch.condition_id = form.condition_id || null;
    }
    if (Number(form.sort_order) !== product.sortOrder) {
      patch.sort_order = Number(form.sort_order || 0);
    }
    if (form.cost.trim() !== costInput(product.costPaise)) {
      const raw = form.cost.trim();
      patch.cost_paise = raw === '' ? null : Math.round(Number(raw) * 100);
    }
    if (form.in_stock !== initial.in_stock) patch.in_stock = form.in_stock;

    return patch;
  }

  async function save() {
    const patch = changes();
    if (Object.keys(patch).length === 0) {
      setNotice('Nothing has changed yet.');
      return;
    }
    if (typeof patch.cost_paise === 'number' && !Number.isFinite(patch.cost_paise)) {
      setError('Unit cost must be a number of rupees, for example 1299.00.');
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not save this product.',
        );
      }
      setSaved('Product saved.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this product.');
    } finally {
      setSaving(false);
    }
  }

  function setNotice(message: string) {
    setSaved(message);
    setError(null);
  }

  return (
    <section className="sa-detail-section">
      <h2 className="sa-section-title">Details</h2>

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="sa-notice" role="status">
          {saved}
        </p>
      ) : null}

      <div className="sa-form-grid">
        <label className="sa-field">
          <span className="sa-label">Name</span>
          <input
            className="sa-input"
            maxLength={120}
            value={form.name}
            disabled={!canEdit || saving}
            onChange={(event) => update('name', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">Subtitle</span>
          <input
            className="sa-input"
            maxLength={160}
            value={form.subtitle}
            disabled={!canEdit || saving}
            onChange={(event) => update('subtitle', event.target.value)}
          />
        </label>

        <p className="sa-hint">Category and publication are edited together with product metadata below.</p>

        <label className="sa-field">
          <span className="sa-label">Brand</span>
          <select
            className="sa-input"
            value={form.brand_id}
            disabled={!canEdit || saving}
            onChange={(event) => update('brand_id', event.target.value)}
          >
            <option value="">No brand</option>
            {brands
              .filter((brand) => !brand.deletedAt)
              .map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
          </select>
        </label>

        <label className="sa-field">
          <span className="sa-label">Condition</span>
          <select
            className="sa-input"
            value={form.condition_id}
            disabled={!canEdit || saving}
            onChange={(event) => update('condition_id', event.target.value)}
          >
            <option value="">Not set</option>
            {conditions.map((condition) => (
              <option key={condition.id} value={condition.id}>
                {condition.label}
              </option>
            ))}
          </select>
        </label>

        <label className="sa-field">
          <span className="sa-label">
            Badge <span className="sa-hint">optional, e.g. New</span>
          </span>
          <input
            className="sa-input"
            maxLength={40}
            value={form.badge}
            disabled={!canEdit || saving}
            onChange={(event) => update('badge', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">Material</span>
          <input
            className="sa-input"
            maxLength={60}
            value={form.material}
            disabled={!canEdit || saving}
            onChange={(event) => update('material', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">Sort order</span>
          <input
            className="sa-input"
            type="number"
            min={0}
            max={100000}
            value={form.sort_order}
            disabled={!canEdit || saving}
            onChange={(event) => update('sort_order', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">
            Unit cost ₹ <span className="sa-hint">internal, not shown to customers</span>
          </span>
          <input
            className="sa-input"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={form.cost}
            placeholder="Not set"
            disabled={!canEdit || saving}
            onChange={(event) => update('cost', event.target.value)}
          />
        </label>

        <div className="sa-field">
          <span className="sa-label">Visibility</span>
          <label className="sa-check">
            <input
              type="checkbox"
              checked={form.in_stock}
              disabled={!canEdit || saving}
              onChange={(event) => update('in_stock', event.target.checked)}
            />
            Shown as in stock
          </label>
        </div>

        <label className="sa-field sa-field-wide">
          <span className="sa-label">Description</span>
          <textarea
            className="sa-input"
            rows={5}
            maxLength={5000}
            value={form.description}
            disabled={!canEdit || saving}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">SEO title</span>
          <input
            className="sa-input"
            maxLength={120}
            value={form.seo_title}
            disabled={!canEdit || saving}
            onChange={(event) => update('seo_title', event.target.value)}
          />
        </label>

        <label className="sa-field">
          <span className="sa-label">SEO description</span>
          <input
            className="sa-input"
            maxLength={320}
            value={form.seo_description}
            disabled={!canEdit || saving}
            onChange={(event) => update('seo_description', event.target.value)}
          />
        </label>
      </div>

      {canEdit ? (
        <div className="sa-inline-actions">
          <button
            className="sa-btn sa-btn-primary"
            type="button"
            disabled={saving}
            onClick={save}
          >
            {saving ? 'Saving…' : 'Save details'}
          </button>
          <button
            className="sa-btn sa-btn-quiet"
            type="button"
            disabled={saving}
            onClick={() => {
              setForm(toForm(product));
              setSaved(null);
              setError(null);
            }}
          >
            Reset
          </button>
        </div>
      ) : (
        <p className="sa-lock-note">Viewers cannot change product details.</p>
      )}
      {canEdit ? <details>
        <summary>Duplicate as a draft</summary>
        <p className="sa-hint">Duplicates the saved product, not unsaved edits. Supply a new name and unique slug. The copy starts unpublished and compatibility must be reviewed before publishing.</p>
        <div className="sa-control-grid">
          <label className="sa-field"><span className="sa-label">New product name</span><input className="sa-input" value={duplicateName} maxLength={140} disabled={saving} onChange={event => setDuplicateName(event.target.value)} /></label>
          <label className="sa-field"><span className="sa-label">Fresh unique slug</span><input className="sa-input" value={duplicateSlug} maxLength={80} disabled={saving} onChange={event => setDuplicateSlug(event.target.value)} /></label>
        </div>
        <button className="sa-btn sa-btn-quiet" type="button" disabled={saving || !duplicateName.trim() || !duplicateSlug.trim() || duplicateSlug.trim() === product.slug} onClick={duplicate}>{saving ? 'Working…' : 'Create draft duplicate'}</button>
      </details> : null}
    </section>
  );
}
