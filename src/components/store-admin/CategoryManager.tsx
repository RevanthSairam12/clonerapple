'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
  navLabel: string;
  title: string;
  subhead: string;
  seoTitle: string;
  seoDescription: string;
}

interface Props {
  initialCategories: CategoryRow[];
  canEdit: boolean;
}

interface CategoryForm {
  id: string;
  name: string;
  slug: string;
  parentId: string;
  title: string;
  subhead: string;
  navLabel: string;
  seoTitle: string;
  seoDescription: string;
  sortOrder: string;
  isActive: boolean;
}

function emptyForm(): CategoryForm {
  return {
    id: '',
    name: '',
    slug: '',
    parentId: '',
    title: '',
    subhead: '',
    navLabel: '',
    seoTitle: '',
    seoDescription: '',
    sortOrder: '0',
    isActive: true,
  };
}

function toForm(category: CategoryRow): CategoryForm {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    parentId: category.parentId ?? '',
    title: category.title,
    subhead: category.subhead,
    navLabel: category.navLabel,
    seoTitle: category.seoTitle,
    seoDescription: category.seoDescription,
    sortOrder: String(category.sortOrder),
    isActive: category.isActive,
  };
}

function depthOf(category: CategoryRow, byId: Map<string, CategoryRow>): number {
  let depth = 0;
  let cursor = category.parentId;
  const seen = new Set<string>([category.id]);
  while (cursor && depth < 5) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const parent = byId.get(cursor);
    depth += 1;
    cursor = parent?.parentId ?? null;
  }
  return depth;
}

/** Category tree: grouping only — a product still belongs to exactly one category. */
export function CategoryManager({ initialCategories, canEdit }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<CategoryForm>(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(initialCategories.map((category) => [category.id, category])),
    [initialCategories],
  );

  // Depth-first order so children sit under their parent.
  const ordered = useMemo(() => {
    const children = new Map<string | null, CategoryRow[]>();
    for (const category of initialCategories) {
      const key = category.parentId && byId.has(category.parentId) ? category.parentId : null;
      const list = children.get(key) ?? [];
      list.push(category);
      children.set(key, list);
    }
    const result: CategoryRow[] = [];
    const walk = (parentId: string | null) => {
      for (const category of children.get(parentId) ?? []) {
        result.push(category);
        walk(category.id);
      }
    };
    walk(null);
    // Orphans (parent archived away) still need a row.
    for (const category of initialCategories) {
      if (!result.includes(category)) result.push(category);
    }
    return result;
  }, [initialCategories, byId]);

  function beginCreate() {
    setForm(emptyForm());
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  function beginEdit(category: CategoryRow) {
    setForm(toForm(category));
    setEditing(true);
    setError(null);
    setNotice(null);
  }

  async function save() {
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/store-admin/catalog/categories', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name,
          slug: form.slug || undefined,
          parentId: form.parentId || null,
          title: form.title,
          subhead: form.subhead,
          navLabel: form.navLabel,
          seoTitle: form.seoTitle,
          seoDescription: form.seoDescription,
          sortOrder: Number(form.sortOrder || 0),
          isActive: form.isActive,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save this category.');
      }
      setNotice(body.created ? 'Category created.' : 'Category saved.');
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this category.');
    } finally {
      setBusy(null);
    }
  }

  async function archive(category: CategoryRow) {
    setBusy(category.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/categories/${encodeURIComponent(category.id)}`,
        { method: 'DELETE' },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not archive this category.',
        );
      }
      setNotice('Category archived.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not archive this category.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="sa-detail-card">
      <h2 className="sa-card-title">Category tree</h2>
      <p className="sa-card-note">
        A parent groups sub-categories in the storefront. Every product still
        belongs to exactly one category — moving a product never moves its
        parent.
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
              <th>Category</th>
              <th>Slug</th>
              <th className="sa-num">Products</th>
              <th className="sa-num">Sort</th>
              <th>Status</th>
              {canEdit ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {ordered.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5} className="sa-empty">
                  No categories yet.
                </td>
              </tr>
            ) : (
              ordered.map((category) => {
                const depth = depthOf(category, byId);
                return (
                  <tr key={category.id} className={depth > 0 ? 'sa-tree-child' : undefined}>
                    <td>
                      <span
                        className="sa-tree-name"
                        style={{ paddingLeft: `${depth * 18}px` }}
                      >
                        {depth > 0 ? (
                          <span className="sa-tree-branch" aria-hidden="true">
                            ↳
                          </span>
                        ) : null}
                        <strong>{category.name}</strong>
                      </span>
                      <div className="sa-row-sub sa-mono">{category.id}</div>
                    </td>
                    <td className="sa-mono">{category.slug}</td>
                    <td className="sa-num">{category.productCount}</td>
                    <td className="sa-num">{category.sortOrder}</td>
                    <td>
                      <span
                        className={
                          category.isActive ? 'sa-status sa-status-on' : 'sa-status'
                        }
                      >
                        {category.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canEdit ? (
                      <td>
                        <button
                          className="sa-btn sa-btn-small"
                          type="button"
                          onClick={() => beginEdit(category)}
                        >
                          Edit
                        </button>{' '}
                        <button
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          type="button"
                          disabled={busy === category.id}
                          title={
                            category.productCount > 0
                              ? 'Move its products to another category first.'
                              : undefined
                          }
                          onClick={() => archive(category)}
                        >
                          Archive
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        editing ? (
          <div className="sa-control-card">
            <h3 className="sa-control-title">
              {form.id ? 'Edit category' : 'New category'}
            </h3>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">
                  Name <span className="sa-hint">required</span>
                </span>
                <input
                  className="sa-input"
                  maxLength={80}
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
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
                  onChange={(event) =>
                    setForm((current) => ({ ...current, slug: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Parent</span>
                <select
                  className="sa-input"
                  value={form.parentId}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, parentId: event.target.value }))
                  }
                >
                  <option value="">Top level</option>
                  {initialCategories
                    .filter((category) => category.id !== form.id)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
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
                  value={form.sortOrder}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, sortOrder: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Nav label</span>
                <input
                  className="sa-input"
                  maxLength={60}
                  value={form.navLabel}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, navLabel: event.target.value }))
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
                Visible in the storefront
              </label>
              <label className="sa-field">
                <span className="sa-label">Page title</span>
                <input
                  className="sa-input"
                  maxLength={140}
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">SEO title</span>
                <input
                  className="sa-input"
                  maxLength={120}
                  value={form.seoTitle}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, seoTitle: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field sa-field-wide">
                <span className="sa-label">Subhead</span>
                <textarea
                  className="sa-input"
                  rows={2}
                  maxLength={300}
                  value={form.subhead}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, subhead: event.target.value }))
                  }
                />
              </label>
              <label className="sa-field sa-field-wide">
                <span className="sa-label">SEO description</span>
                <textarea
                  className="sa-input"
                  rows={2}
                  maxLength={320}
                  value={form.seoDescription}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, seoDescription: event.target.value }))
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
                {busy === 'save' ? 'Saving…' : 'Save category'}
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
              New category
            </button>
          </div>
        )
      ) : (
        <p className="sa-lock-note">Only a store owner can change categories.</p>
      )}
    </section>
  );
}
