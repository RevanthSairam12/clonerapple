'use client';

import { useState } from 'react';

import type { CatalogImage } from '@/lib/store-admin/catalog';

interface Props {
  productId: string;
  productName: string;
  initialImages: CatalogImage[];
  canEdit: boolean;
}

const ROLES = [
  { value: 'primary', label: 'Primary' },
  { value: 'hover', label: 'Hover' },
  { value: 'gallery', label: 'Gallery' },
];

interface Draft {
  url: string;
  alt: string;
  role: string;
  sort_order: string;
}

function emptyDraft(): Draft {
  return { url: '', alt: '', role: 'gallery', sort_order: '0' };
}

/**
 * Gallery manager.
 *
 * Setting a primary or hover image demotes the current holder to gallery
 * inside the same transaction, so the one-primary / one-hover rule is enforced
 * without the operator having to clear the old image first.
 */
export function ProductGallery({ productId, productName, initialImages, canEdit }: Props) {
  const [images, setImages] = useState<CatalogImage[]>(initialImages);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function beginEdit(image: CatalogImage) {
    setEditing(image.id);
    setEdit({
      url: image.url,
      alt: image.alt,
      role: image.role,
      sort_order: String(image.sortOrder),
    });
    setError(null);
    setNotice(null);
  }

  function replaceImage(next: CatalogImage) {
    setImages((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  async function call(id: string, init: RequestInit, message: string) {
    setBusy(id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/products/${productId}/images/${id}`,
        init,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : message);
      }
      return body as { image: CatalogImage };
    } finally {
      setBusy(null);
    }
  }

  async function addImage() {
    setBusy('new');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/store-admin/catalog/products/${productId}/images`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: draft.url.trim(),
            alt: draft.alt.trim(),
            role: draft.role,
            sort_order: Number(draft.sort_order || 0),
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === 'string' ? body.error : 'Could not add this image.',
        );
      }
      const added = body.image as CatalogImage;
      setImages((current) => [...current, added]);
      setDraft(emptyDraft());
      setNotice('Image added.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add this image.');
    } finally {
      setBusy(null);
    }
  }

  async function saveImage(image: CatalogImage) {
    try {
      const body = await call(
        image.id,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            url: edit.url.trim(),
            alt: edit.alt.trim(),
            role: edit.role,
            sort_order: Number(edit.sort_order || 0),
          }),
        },
        'Could not save this image.',
      );
      replaceImage(body.image);
      setEditing(null);
      setNotice('Image saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save this image.');
    }
  }

  async function archiveImage(image: CatalogImage) {
    try {
      const body = await call(image.id, { method: 'DELETE' }, 'Could not remove this image.');
      replaceImage(body.image);
      setNotice('Image removed. It can be restored from the same card.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove this image.');
    }
  }

  async function restoreImage(image: CatalogImage) {
    try {
      const body = await call(image.id, { method: 'POST' }, 'Could not restore this image.');
      replaceImage(body.image);
      setNotice('Image restored.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not restore this image.');
    }
  }

  return (
    <section className="sa-detail-section">
      <h2 className="sa-section-title">Images</h2>

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

      {images.length === 0 ? (
        <p className="sa-empty">No images recorded.</p>
      ) : (
        <div className="sa-image-grid">
          {images.map((image) => {
            const archived = image.deletedAt !== null;
            return (
              <figure
                key={image.id}
                className={archived ? 'sa-image-card sa-image-card-off' : 'sa-image-card'}
              >
                {/* Local static asset; no remote image optimisation needed. */}
                <img src={image.url} alt={image.alt || productName} />
                <figcaption>
                  <span className="sa-chip">{image.role}</span>
                  {archived ? <span className="sa-chip">removed</span> : null}
                  <span className="sa-mono sa-break">{image.url}</span>
                  {image.alt ? <span className="sa-row-sub">{image.alt}</span> : null}
                </figcaption>

                {canEdit ? (
                  archived ? (
                    <div className="sa-image-actions">
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        disabled={busy === image.id}
                        onClick={() => restoreImage(image)}
                      >
                        {busy === image.id ? 'Restoring…' : 'Restore'}
                      </button>
                    </div>
                  ) : editing === image.id ? (
                    <div className="sa-image-edit">
                      <label className="sa-field">
                        <span className="sa-label">URL</span>
                        <input
                          className="sa-input"
                          value={edit.url}
                          onChange={(event) =>
                            setEdit((current) => ({ ...current, url: event.target.value }))
                          }
                        />
                      </label>
                      <label className="sa-field">
                        <span className="sa-label">Alt text</span>
                        <input
                          className="sa-input"
                          maxLength={200}
                          value={edit.alt}
                          onChange={(event) =>
                            setEdit((current) => ({ ...current, alt: event.target.value }))
                          }
                        />
                      </label>
                      <label className="sa-field">
                        <span className="sa-label">Role</span>
                        <select
                          className="sa-input"
                          value={edit.role}
                          onChange={(event) =>
                            setEdit((current) => ({ ...current, role: event.target.value }))
                          }
                        >
                          {ROLES.map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="sa-field">
                        <span className="sa-label">Sort</span>
                        <input
                          className="sa-input"
                          type="number"
                          min={0}
                          value={edit.sort_order}
                          onChange={(event) =>
                            setEdit((current) => ({
                              ...current,
                              sort_order: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <div className="sa-inline-actions">
                        <button
                          className="sa-btn sa-btn-primary sa-btn-small"
                          type="button"
                          disabled={busy === image.id}
                          onClick={() => saveImage(image)}
                        >
                          {busy === image.id ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          className="sa-btn sa-btn-quiet sa-btn-small"
                          type="button"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="sa-image-actions">
                      <button
                        className="sa-btn sa-btn-small"
                        type="button"
                        onClick={() => beginEdit(image)}
                      >
                        Edit
                      </button>
                      <button
                        className="sa-btn sa-btn-quiet sa-btn-small"
                        type="button"
                        disabled={busy === image.id}
                        onClick={() => archiveImage(image)}
                      >
                        Remove
                      </button>
                    </div>
                  )
                ) : null}
              </figure>
            );
          })}
        </div>
      )}

      {canEdit ? (
        <div className="sa-control-card sa-image-add">
          <h3 className="sa-control-title">Add an image</h3>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">
                URL <span className="sa-hint">/sites/... or https://</span>
              </span>
              <input
                className="sa-input"
                value={draft.url}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, url: event.target.value }))
                }
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Alt text</span>
              <input
                className="sa-input"
                maxLength={200}
                value={draft.alt}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, alt: event.target.value }))
                }
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Role</span>
              <select
                className="sa-input"
                value={draft.role}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, role: event.target.value }))
                }
              >
                {ROLES.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="sa-field">
              <span className="sa-label">Sort</span>
              <input
                className="sa-input"
                type="number"
                min={0}
                value={draft.sort_order}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, sort_order: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="sa-inline-actions">
            <button
              className="sa-btn sa-btn-primary"
              type="button"
              disabled={busy === 'new' || !draft.url.trim()}
              onClick={addImage}
            >
              {busy === 'new' ? 'Adding…' : 'Add image'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
