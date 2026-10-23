'use client';

import { useState } from 'react';

import type { CatalogBrand } from '@/lib/store-admin/catalog';

interface Props {
  initialBrands: CatalogBrand[];
  canEdit: boolean;
}

interface BrandForm {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  description: string;
  is_active: boolean;
  sort_order: string;
}

function emptyForm(): BrandForm {
  return {
    id: '',
    name: '',
    slug: '',
    logo_url: '',
    description: '',
    is_active: true,
    sort_order: '0',
  };
}

function toForm(brand: CatalogBrand): BrandForm {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logo_url: brand.logoUrl ?? '',
    description: brand.description,
    is_active: brand.isActive,
    sort_order: String(brand.sortOrder),
  };
}

interface ApiBrand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  description: string;
  is_active: boolean;
  sort_order: number;
  deleted_at: string | null;
}

function fromApi(brand: ApiBrand, productCount: number): CatalogBrand {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logo_url,
    description: brand.description,
    isActive: brand.is_active,
    sortOrder: brand.sort_order,
    productCount,
    deletedAt: brand.deleted_at,
  };
}

/** Brands: create, edit, archive. Owner-only on the server. */
export function BrandManager({ initialBrands, canEdit }: Props) {
  const [brands, setBrands] = useState<CatalogBrand[]>(initialBrands);
  const [form, setForm] = useState<BrandForm>(emptyForm);
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

  function beginEdit(brand: CatalogBrand) {
    setForm(toForm(brand));
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/catalog/brands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name,
          slug: form.slug || undefined,
          logo_url: form.logo_url,
          description: form.description,
          is_active: form.is_active,
          sort_order: Number(form.sort_order || 0),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this brand.');
      }
      const saved = fromApi(
        body.brand as ApiBrand,
        brands.find((brand) => brand.id === (body.brand as ApiBrand).id)?.productCount ?? 0,
      );
      setBrands((current) => {
        const exists = current.some((brand) => brand.id === saved.id);
        return exists
          ? current.map((brand) => (brand.id === saved.id ? saved : brand))
          : [...current, saved];
      });
      setNotice(body.created ? 'Brand created.' : 'Brand saved.');
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this brand.');
    } finally {
      setBusy(null);
    }
  }

  async function archive(brand: CatalogBrand) {
    setBusy(brand.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/catalog/brands/${brand.id}`, {
        method: 'DELETE',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not remove this brand.',
        );
      }
      setBrands((current) =>
        current.map((item) =>
          item.id === brand.id
            ? { ...item, isActive: false, deletedAt: new Date().toISOString() }
            : item,
        ),
      );
      setNotice('Brand removed. Saving the same id again restores it.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this brand.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Brands</h2>
      <p className="sa-card-note">
        A brand links products to a brand record. Saving an archived id brings
        the brand back.
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
              <th>Brand</th>
              <th>Slug</th>
              <th className="sa-num">Products</th>
              <th>Status</th>
              {canEdit ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {brands.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="sa-empty">
                  No brands yet.
                </td>
              </tr>
            ) : (
              brands.map((brand) => (
                <tr key={brand.id}>
                  <td>
                    <strong>{brand.name}</strong>
                    <div className="sa-row-sub sa-mono">{brand.id}</div>
                  </td>
                  <td className="sa-mono">{brand.slug}</td>
                  <td className="sa-num">{brand.productCount}</td>
                  <td>
                    <span
                      className={
                        brand.deletedAt
                          ? 'sa-status'
                          : brand.isActive
                            ? 'sa-status sa-status-on'
                            : 'sa-status'
                      }
                    >
                      {brand.deletedAt ? 'Removed' : brand.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  {canEdit ? (
                    <td>
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        onClick={() => beginEdit(brand)}
                      >
                        Edit
                      </button>{' '}
                      {brand.deletedAt ? null : (
                        <button
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          type="button"
                          disabled={busy === brand.id || brand.productCount > 0}
                          title={
                            brand.productCount > 0
                              ? 'Move its products to another brand first.'
                              : undefined
                          }
                          onClick={() => archive(brand)}
                        >
                          Remove
                        </button>
                      )}
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
              {brands.some((brand) => brand.id === form.id) ? 'Edit brand' : 'New brand'}
            </h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">
                  Id <span className="sa-hint">lowercase, hyphenated</span>
                </span>
                <input
                  className="sa-input"
                  value={form.id}
                  maxLength={64}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, id: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Name</span>
                <input
                  className="sa-input"
                  maxLength={120}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">
                  Slug <span className="sa-hint">optional, derived from the name</span>
                </span>
                <input
                  className="sa-input"
                  maxLength={64}
                  value={form.slug}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, slug: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Logo URL</span>
                <input
                  className="sa-input"
                  value={form.logo_url}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, logo_url: event.target.value }))
                  }
                />
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
                  checked={form.is_active}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, is_active: event.target.checked }))
                  }
                />
                Active
              </label>
              <label className="sa-field sa-field-wide">
                <span className="sa-label">Description</span>
                <textarea
                  className="sa-input"
                  rows={2}
                  maxLength={1000}
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
                disabled={busy === 'save' || !form.name.trim()}
                onClick={save}
              >
                {busy === 'save' ? 'Saving…' : 'Save brand'}
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
              New brand
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only a store owner can change brands.</p>
      )}
    </section>
  );
}
