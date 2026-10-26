'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { MediaRow } from '@/lib/store-admin/media';

interface Props {
  items: MediaRow[];
  canEdit: boolean;
  storageReady: boolean;
}

type Filter = 'all' | 'image' | 'video';

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function shortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * The shared media library. Uploads are checked server-side by content
 * (magic bytes), not by extension, and a file that a product or brand still
 * points at cannot be deleted.
 */
export function MediaLibrary({ items, canEdit, storageReady }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [alt, setAlt] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  const visible = items.filter((item) =>
    filter === 'all' ? true : filter === 'video' ? item.mimeType.startsWith('video/') : item.mimeType.startsWith('image/'),
  );

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setBusy('upload');
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.set('file', file);
      if (alt.trim()) form.set('alt', alt.trim());

      const response = await fetch('/api/store-admin/media', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not upload the file.');
      }
      setNotice(`${file.name} uploaded.`);
      setAlt('');
      if (fileRef.current) fileRef.current.value = '';
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload the file.');
    } finally {
      setBusy(null);
    }
  }

  async function saveAlt(id: string) {
    if (!editing) return;
    setBusy(`alt:${id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/media/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alt: editing.value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the alt text.');
      }
      setNotice('Alt text saved.');
      setEditing(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the alt text.');
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: MediaRow) {
    if (!window.confirm(`Delete ${item.filename}? The file stops resolving everywhere it is used.`)) {
      return;
    }
    setBusy(`del:${item.id}`);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/store-admin/media/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not delete the file.');
      }
      setNotice(`${item.filename} deleted.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the file.');
    } finally {
      setBusy(null);
    }
  }

  async function copy(item: MediaRow) {
    const absolute = `${window.location.origin}${item.url}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setNotice('URL copied to the clipboard.');
    } catch {
      setError(`Copy manually: ${absolute}`);
    }
  }

  return (
    <>
      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="sa-notice sa-success" role="status">
          {notice}
        </p>
      ) : null}

      {canEdit ? (
        <section className="sa-detail-card">
          <h2 className="sa-card-title">Upload</h2>
          <form className="sa-upload-form" onSubmit={upload}>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">File</span>
              <input
                ref={fileRef}
                className="sa-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif,video/webm,video/mp4"
              />
              <span className="sa-hint">
                Images or video, up to 25 MB. The file type is verified from its content.
              </span>
            </label>
            <label className="sa-field sa-field-wide">
              <span className="sa-label">
                Alt text <span className="sa-hint">describe the image for screen readers</span>
              </span>
              <input
                className="sa-input"
                maxLength={300}
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                placeholder="GaN charger, front view"
              />
            </label>
            <div className="sa-inline-actions">
              <button
                className="sa-btn sa-btn-primary"
                type="submit"
                disabled={busy !== null || !storageReady}
              >
                {busy === 'upload' ? 'Uploading…' : 'Upload file'}
              </button>
            </div>
          </form>
          {!storageReady ? (
            <p className="sa-lock-note">
              Storage is not configured. Set the Supabase URL and service role
              key in the environment to enable uploads.
            </p>
          ) : null}
        </section>
      ) : (
        <p className="sa-lock-note">Only an owner or admin can upload or delete files.</p>
      )}

      <div className="sa-chip-row">
        {(['all', 'image', 'video'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`sa-chip${filter === key ? ' is-active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {key === 'all' ? 'All files' : key === 'image' ? 'Images' : 'Video'}
          </button>
        ))}
        <span className="sa-chip sa-chip-static">{items.length} files</span>
      </div>

      {visible.length === 0 ? (
        <p className="sa-empty">
          {items.length === 0
            ? 'Nothing uploaded yet. Files you add here can be used on any product.'
            : 'No files match this filter.'}
        </p>
      ) : (
        <div className="sa-media-grid">
          {visible.map((item) => {
            const isVideo = item.mimeType.startsWith('video/');
            return (
              <article className="sa-media-card" key={item.id}>
                <div className={`sa-media-thumb${isVideo ? ' is-video' : ''}`}>
                  {isVideo ? (
                    <span>{item.mimeType.replace('video/', '').toUpperCase()}</span>
                  ) : (
                    <img src={item.url} alt={item.alt} loading="lazy" />
                  )}
                </div>
                <div className="sa-media-body">
                  <strong title={item.filename}>{item.filename}</strong>
                  <span className="sa-media-meta">
                    {item.mimeType.replace(/^(image|video)\//, '')}
                    {item.width && item.height ? ` · ${item.width}×${item.height}` : ''}
                    {` · ${sizeLabel(item.size)}`}
                  </span>
                  <span className="sa-media-meta">Uploaded {shortDate(item.createdAt)}</span>

                  {editing?.id === item.id ? (
                    <div className="sa-media-alt-edit">
                      <input
                        className="sa-input"
                        maxLength={300}
                        value={editing.value}
                        onChange={(event) =>
                          setEditing({ id: item.id, value: event.target.value })
                        }
                        placeholder="Alt text"
                      />
                      <div className="sa-inline-actions">
                        <button
                          type="button"
                          className="sa-btn sa-btn-small sa-btn-primary"
                          disabled={busy !== null}
                          onClick={() => saveAlt(item.id)}
                        >
                          {busy === `alt:${item.id}` ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-small"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="sa-media-alt">
                      {item.alt || <em>No alt text</em>}
                    </span>
                  )}

                  <div className="sa-inline-actions sa-media-actions">
                    <button
                      type="button"
                      className="sa-btn sa-btn-small"
                      onClick={() => copy(item)}
                    >
                      Copy URL
                    </button>
                    {canEdit ? (
                      <>
                        <button
                          type="button"
                          className="sa-btn sa-btn-small"
                          onClick={() => setEditing({ id: item.id, value: item.alt })}
                        >
                          Alt
                        </button>
                        <button
                          type="button"
                          className="sa-btn sa-btn-small sa-btn-danger"
                          disabled={busy !== null || item.usageCount > 0}
                          title={
                            item.usageCount > 0
                              ? `Used by ${item.usageCount} product image or brand logo`
                              : 'Delete this file'
                          }
                          onClick={() => remove(item)}
                        >
                          {busy === `del:${item.id}` ? 'Deleting…' : 'Delete'}
                        </button>
                      </>
                    ) : null}
                  </div>
                  {item.usageCount > 0 ? (
                    <span className="sa-media-usage">
                      In use · {item.usageCount} {item.usageCount === 1 ? 'reference' : 'references'}
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
