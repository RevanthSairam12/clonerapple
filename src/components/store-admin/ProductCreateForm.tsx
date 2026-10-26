'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Option {
  id: string;
  name: string;
}

interface Props {
  categories: Option[];
  brands: Option[];
  conditions: Option[];
}

interface Form {
  name: string;
  slug: string;
  categoryId: string;
  subtitle: string;
  price: string;
  compareAt: string;
  brandId: string;
  brand: string;
  conditionId: string;
  material: string;
  badge: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  isActive: boolean;
  trackInventory: boolean;
  initialOnHand: string;
}

function emptyForm(categoryId: string): Form {
  return {
    name: '',
    slug: '',
    categoryId,
    subtitle: '',
    price: '',
    compareAt: '',
    brandId: '',
    brand: '',
    conditionId: '',
    material: '',
    badge: '',
    description: '',
    seoTitle: '',
    seoDescription: '',
    isActive: true,
    trackInventory: false,
    initialOnHand: '0',
  };
}

function toPaise(rupees: string): number | null {
  const value = Number(rupees);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * Create a Product. The server writes the product, its opening price-history
 * row and its stock row together, so a saved product is always sellable.
 */
export function ProductCreateForm({ categories, brands, conditions }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(emptyForm(categories[0]?.id ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const pricePaise = toPaise(form.price);
      if (pricePaise === null) throw new Error('Enter a selling price above zero.');

      const response = await fetch('/api/store-admin/catalog/products', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          slug: form.slug || undefined,
          categoryId: form.categoryId,
          subtitle: form.subtitle,
          pricePaise,
          compareAtPaise: form.compareAt ? toPaise(form.compareAt) : null,
          brandId: form.brandId || null,
          brand: form.brand,
          conditionId: form.conditionId || null,
          material: form.material,
          badge: form.badge,
          description: form.description,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription,
          isActive: form.isActive,
          trackInventory: form.trackInventory,
          initialOnHand: Number(form.initialOnHand || 0),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not create this product.');
      }
      const id = (body.product as { id?: string } | undefined)?.id;
      router.push(id ? `/store-admin/products/${encodeURIComponent(id)}` : '/store-admin/products');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create this product.');
      setBusy(false);
    }
  }

  return (
    <div className="sa-detail-card">
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}

      <h2 className="sa-card-title">Basics</h2>
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">
            Name <span className="sa-hint">required</span>
          </span>
          <input
            className="sa-input"
            maxLength={140}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">
            Slug <span className="sa-hint">derived from the name if blank</span>
          </span>
          <input
            className="sa-input"
            maxLength={80}
            value={form.slug}
            onChange={(event) => update('slug', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">Category</span>
          <select
            className="sa-input"
            value={form.categoryId}
            onChange={(event) => update('categoryId', event.target.value)}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span className="sa-label">Subtitle</span>
          <input
            className="sa-input"
            maxLength={200}
            value={form.subtitle}
            onChange={(event) => update('subtitle', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">Brand record</span>
          <select
            className="sa-input"
            value={form.brandId}
            onChange={(event) => {
              const brandId = event.target.value;
              const brand = brands.find((item) => item.id === brandId)?.name ?? '';
              setForm((current) => ({ ...current, brandId, brand: brand || current.brand }));
            }}
          >
            <option value="">No brand record</option>
            {brands.map((brand) => (
              <option key={brand.id} value={brand.id}>
                {brand.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span className="sa-label">
            Brand label <span className="sa-hint">shown on the product</span>
          </span>
          <input
            className="sa-input"
            maxLength={80}
            value={form.brand}
            onChange={(event) => update('brand', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">Condition</span>
          <select
            className="sa-input"
            value={form.conditionId}
            onChange={(event) => update('conditionId', event.target.value)}
          >
            <option value="">Not set</option>
            {conditions.map((condition) => (
              <option key={condition.id} value={condition.id}>
                {condition.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sa-field">
          <span className="sa-label">Material</span>
          <input
            className="sa-input"
            maxLength={120}
            value={form.material}
            onChange={(event) => update('material', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">Badge</span>
          <input
            className="sa-input"
            maxLength={40}
            placeholder="New"
            value={form.badge}
            onChange={(event) => update('badge', event.target.value)}
          />
        </label>
        <label className="sa-field sa-field-wide">
          <span className="sa-label">Description</span>
          <textarea
            className="sa-input"
            rows={4}
            maxLength={5000}
            value={form.description}
            onChange={(event) => update('description', event.target.value)}
          />
        </label>
      </div>

      <h2 className="sa-card-title">Price</h2>
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">
            Selling price ₹ <span className="sa-hint">required</span>
          </span>
          <input
            className="sa-input"
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(event) => update('price', event.target.value)}
          />
        </label>
        <label className="sa-field">
          <span className="sa-label">
            Compare-at ₹ <span className="sa-hint">optional, not below the price</span>
          </span>
          <input
            className="sa-input"
            type="number"
            min={0}
            step="0.01"
            value={form.compareAt}
            onChange={(event) => update('compareAt', event.target.value)}
          />
        </label>
        <p className="sa-field-wide sa-card-note">
          Every price change is written to the immutable price history with the
          staff account that made it.
        </p>
      </div>

      <h2 className="sa-card-title">Stock</h2>
      <div className="sa-control-grid">
        <label className="sa-check">
          <input
            type="checkbox"
            checked={form.trackInventory}
            onChange={(event) => update('trackInventory', event.target.checked)}
          />
          Track inventory for this product
        </label>
        <label className="sa-field">
          <span className="sa-label">Opening stock</span>
          <input
            className="sa-input"
            type="number"
            min={0}
            disabled={!form.trackInventory}
            value={form.initialOnHand}
            onChange={(event) => update('initialOnHand', event.target.value)}
          />
        </label>
        <label className="sa-check">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => update('isActive', event.target.checked)}
          />
          Visible in the storefront
        </label>
      </div>

      <h2 className="sa-card-title">SEO</h2>
      <div className="sa-control-grid">
        <label className="sa-field">
          <span className="sa-label">SEO title</span>
          <input
            className="sa-input"
            maxLength={120}
            value={form.seoTitle}
            onChange={(event) => update('seoTitle', event.target.value)}
          />
        </label>
        <label className="sa-field sa-field-wide">
          <span className="sa-label">SEO description</span>
          <textarea
            className="sa-input"
            rows={2}
            maxLength={320}
            value={form.seoDescription}
            onChange={(event) => update('seoDescription', event.target.value)}
          />
        </label>
      </div>

      <div className="sa-inline-actions">
        <button
          className="sa-btn sa-btn-primary"
          type="button"
          disabled={busy || !form.name.trim() || !form.categoryId || !form.price}
          onClick={create}
        >
          {busy ? 'Creating…' : 'Create product'}
        </button>
        <button
          className="sa-btn sa-btn-quiet"
          type="button"
          onClick={() => router.push('/store-admin/products')}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
