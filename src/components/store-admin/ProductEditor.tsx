'use client';

import { useState } from 'react';

import type {
  CatalogBrand,
  CatalogCategoryOption,
  CatalogProductDetail,
} from '@/lib/store-admin/catalog';

interface Props {
  product: CatalogProductDetail;
  categories: CatalogCategoryOption[];
  brands: CatalogBrand[];
  canEdit: boolean;
}

interface FormState {
  name: string;
  subtitle: string;
  badge: string;
  material: string;
  category_id: string;
  brand_id: string;
  sort_order: string;
  is_active: boolean;
  in_stock: boolean;
  description: string;
  seo_title: string;
  seo_description: string;
}

function toForm(product: CatalogProductDetail): FormState {
  return {
    name: product.name,
    subtitle: product.subtitle,
    badge: product.badge ?? '',
    material: product.material,
    category_id: product.categoryId,
    brand_id: product.brandId ?? '',
    sort_order: String(product.sortOrder ?? ''),
    is_active: product.isActive,
    in_stock: product.inStock,
    description: product.description,
    seo_title: product.seoTitle,
    seo_description: product.seoDescription,
  };
}

/**
 * Copy and organisation editor for one product.
 *
 * Price is not a field here. It is shown on the page as a locked value, and
 * the API refuses a price key outright, because checkout still prices from the
 * code catalogue.
 */
export function ProductEditor({ product, categories, brands, canEdit }: Props) {
  const [form, setForm] = useState<FormState>(() => toForm(product));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

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
    if (form.category_id !== initial.category_id) patch.category_id = form.category_id;
    if (form.brand_id !== initial.brand_id) {
      patch.brand_id = form.brand_id || null;
    }
    if (Number(form.sort_order) !== product.sortOrder) {
      patch.sort_order = Number(form.sort_order || 0);
    }
    if (form.is_active !== initial.is_active) patch.is_active = form.is_active;
    if (form.in_stock !== initial.in_stock) patch.in_stock = form.in_stock;

    return patch;
  }

  async function save() {
    const patch = changes();
    if (Object.keys(patch).length === 0) {
      setNotice('Nothing has changed yet.');
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
      setForm(toForm(body.product as CatalogProductDetail));
      setSaved('Product saved.');
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

        <label className="sa-field">
          <span className="sa-label">Category</span>
          <select
            className="sa-input"
            value={form.category_id}
            disabled={!canEdit || saving}
            onChange={(event) => update('category_id', event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.isActive ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </label>

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

        <div className="sa-field">
          <span className="sa-label">Visibility</span>
          <label className="sa-check">
            <input
              type="checkbox"
              checked={form.is_active}
              disabled={!canEdit || saving}
              onChange={(event) => update('is_active', event.target.checked)}
            />
            Listed in the store
          </label>
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
    </section>
  );
}
