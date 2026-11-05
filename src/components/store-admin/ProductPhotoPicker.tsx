'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { ProductField as Field } from './ProductField';

/**
 * Photo selection for a product, backed by the existing store Media library.
 *
 * Photos are no longer pasted as URLs: the editor picks an existing library
 * image or uploads a new one through `/api/store-admin/media`. The Media row
 * keeps the bytes and its own alt text; the product image keeps its own alt
 * text, role, order and optional shared-colour link.
 */

export interface ProductPhoto {
  id?: string;
  key: string;
  url: string;
  alt: string;
  role: string;
  sortOrder: number;
  colourId: string | null;
}

interface MediaItem {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  alt: string;
}

interface Props {
  photos: ProductPhoto[];
  onChange: Dispatch<SetStateAction<ProductPhoto[]>>;
  colours: Array<{ id: string; name: string; hex: string; isActive?: boolean }>;
  canEdit: boolean;
}

function mediaIdOf(url: string): string | null {
  const match = url.match(/^\/api\/media\/([A-Za-z0-9_-]{1,80})$/);
  return match ? match[1] : null;
}

/** Reassign sortOrder from the array position so moves and removals stay ordered. */
function reorder(rows: ProductPhoto[]): ProductPhoto[] {
  return rows.map((row, index) => (row.sortOrder === index ? row : { ...row, sortOrder: index }));
}

export function ProductPhotoPicker({ photos, onChange, colours, canEdit }: Props) {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaState, setMediaState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [uploadAlt, setUploadAlt] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/store-admin/media');
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('Media library unavailable.');
        if (!cancelled) {
          setMedia(Array.isArray(body.media) ? body.media : []);
          setMediaState('ready');
        }
      } catch {
        if (!cancelled) setMediaState('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const images = media.filter((item) => item.mimeType.startsWith('image/'));

  function update(key: string, patch: Partial<ProductPhoto>) {
    onChange((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addFromLibrary(item: MediaItem) {
    setError('');
    setNotice('');
    onChange((current) => reorder([
      ...current,
      {
        key: `photo-${crypto.randomUUID()}`,
        url: item.url,
        alt: item.alt || '',
        role: current.some((row) => row.role === 'primary') ? 'gallery' : 'primary',
        sortOrder: current.length,
        colourId: null,
      },
    ]));
  }

  async function upload(file: File) {
    setBusy('upload');
    setError('');
    setNotice('');
    try {
      const form = new FormData();
      form.set('file', file);
      if (uploadAlt.trim()) form.set('alt', uploadAlt.trim());
      const response = await fetch('/api/store-admin/media', { method: 'POST', body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.media?.url !== 'string') {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not upload the photo.');
      }
      const item: MediaItem = {
        id: String(body.media.id),
        filename: file.name,
        url: body.media.url,
        mimeType: file.type || 'image/*',
        alt: uploadAlt.trim(),
      };
      setMedia((current) => [item, ...current]);
      addFromLibrary(item);
      setUploadAlt('');
      setNotice(`${file.name} uploaded and added.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload the photo.');
    } finally {
      setBusy(null);
    }
  }

  async function saveAltToLibrary(row: ProductPhoto) {
    const id = mediaIdOf(row.url);
    if (!id) return;
    setBusy(`alt:${row.key}`);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/store-admin/media/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ alt: row.alt }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not save the Media alt text.');
      setMedia((current) => current.map((item) => (item.id === id ? { ...item, alt: row.alt } : item)));
      setNotice('Media alt text saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the Media alt text.');
    } finally {
      setBusy(null);
    }
  }

  function setMain(key: string) {
    onChange((current) => current.map((row) => row.key === key
      ? { ...row, role: 'primary' }
      : row.role === 'primary' ? { ...row, role: 'gallery' } : row));
  }

  function move(key: string, direction: -1 | 1) {
    onChange((current) => {
      const index = current.findIndex((row) => row.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return reorder(next);
    });
  }

  return (
    <div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {notice ? <p className="sa-notice sa-success" role="status">{notice}</p> : null}

      {photos.length === 0 ? (
        <p className="sa-empty">No photos yet. Choose from the Media library or upload the first photo.</p>
      ) : null}

      {photos.map((photo, index) => {
        const mediaId = mediaIdOf(photo.url);
        const known = media.some((item) => item.url === photo.url);
        return (
          <fieldset key={photo.key} className="sa-detail-card">
            <legend>Photo {index + 1}{photo.role === 'primary' ? ' · main' : photo.role === 'hover' ? ' · hover' : ''}</legend>
            <div className="sa-photo-row">
              <div className="sa-photo-thumb">{photo.url ? <img src={photo.url} alt="" /> : <span>No photo chosen</span>}</div>
              <div className="sa-control-grid">
                <Field label={`Photo ${index + 1} from Media`} help="Choose an uploaded photo. Upload a new one below if it is not in the library yet.">
                  <select aria-label={`Photo ${index + 1} from Media`} className="sa-input" value={photo.url} onChange={(event) => {
                    const item = media.find((candidate) => candidate.url === event.target.value);
                    update(photo.key, { url: event.target.value, ...(item && !photo.alt.trim() ? { alt: item.alt } : {}) });
                  }}>
                    {!photo.url ? <option value="">Choose a photo</option> : null}
                    {photo.url && !known ? <option value={photo.url}>Current: {mediaId ? 'Media file' : photo.url}</option> : null}
                    {images.map((item) => <option key={item.id} value={item.url}>{item.filename}</option>)}
                  </select>
                </Field>
                <Field label={`Photo ${index + 1} description (alt text)`} help="Describe what is visible for customers using a screen reader.">
                  <input aria-label={`Photo ${index + 1} description`} className="sa-input" maxLength={200} value={photo.alt} onChange={(event) => update(photo.key, { alt: event.target.value })} />
                </Field>
                <Field label={`Photo ${index + 1} use`} help="Colour photos use the gallery role; a colour without photos falls back to the main gallery.">
                  <select aria-label={`Photo ${index + 1} use`} className="sa-input" value={photo.role} onChange={(event) => {
                    const role = event.target.value;
                    onChange((current) => current.map((row) => row.key === photo.key
                      ? { ...row, role }
                      : row.role === role && role !== 'gallery' ? { ...row, role: 'gallery' } : row));
                  }}>
                    <option value="primary">Main photo</option><option value="hover">Hover photo</option><option value="gallery">Gallery photo</option>
                  </select>
                </Field>
                <Field label={`Photo ${index + 1} colour`} help="Show this photo only when that colour is picked. Leave blank for all colours.">
                  <select aria-label={`Photo ${index + 1} colour`} className="sa-input" value={photo.colourId ?? ''} onChange={(event) => {
                    const colourId = event.target.value || null;
                    update(photo.key, { colourId, ...(colourId && photo.role !== 'gallery' ? { role: 'gallery' } : {}) });
                  }}>
                    <option value="">All colours (main gallery)</option>
                    {colours.filter((colour) => colour.isActive !== false || colour.id === photo.colourId).map((colour) => <option key={colour.id} value={colour.id}>{colour.name} ({colour.hex})</option>)}
                  </select>
                </Field>
              </div>
            </div>
            <div className="sa-inline-actions">
              <button className="sa-btn sa-btn-small" type="button" disabled={photo.role === 'primary'} onClick={() => setMain(photo.key)}>Set as main photo</button>
              <button className="sa-btn sa-btn-small" type="button" disabled={index === 0} onClick={() => move(photo.key, -1)}>Move up</button>
              <button className="sa-btn sa-btn-small" type="button" disabled={index === photos.length - 1} onClick={() => move(photo.key, 1)}>Move down</button>
              {mediaId && photo.alt.trim() ? <button className="sa-btn sa-btn-small" type="button" disabled={busy !== null} onClick={() => saveAltToLibrary(photo)}>{busy === `alt:${photo.key}` ? 'Saving…' : 'Save alt to Media'}</button> : null}
              <button className="sa-btn sa-btn-small sa-btn-quiet" type="button" onClick={() => onChange((current) => reorder(current.filter((row) => row.key !== photo.key)))}>Remove photo {index + 1}</button>
            </div>
          </fieldset>
        );
      })}

      <div className="sa-inline-actions">
        <button className="sa-btn" type="button" onClick={() => { setPickerOpen((open) => !open); setError(''); }}>{pickerOpen ? 'Close photo library' : 'Add photos from Media'}</button>
      </div>

      {pickerOpen ? (
        <fieldset className="sa-detail-card">
          <legend>Media library</legend>
          {mediaState === 'loading' ? <p className="sa-hint">Loading the library…</p> : null}
          {mediaState === 'unavailable' ? <p className="sa-notice">The Media library is unavailable. Uploads are still possible when storage is configured; otherwise paste a URL under “Advanced”.</p> : null}
          {mediaState === 'ready' && images.length === 0 ? <p className="sa-empty">No images in the library yet. Upload the first one below.</p> : null}
          {images.length > 0 ? <div className="sa-media-grid">{images.map((item) => <article className="sa-media-card" key={item.id}><div className="sa-media-thumb"><img src={item.url} alt={item.alt} loading="lazy" /></div><div className="sa-media-body"><strong title={item.filename}>{item.filename}</strong><span className="sa-media-meta">{item.alt || 'No alt text'}</span><div className="sa-inline-actions"><button className="sa-btn sa-btn-small sa-btn-primary" type="button" onClick={() => addFromLibrary(item)}>Use this photo</button></div></div></article>)}</div> : null}
          {canEdit ? <form className="sa-upload-form" onSubmit={(event) => { event.preventDefault(); const file = event.currentTarget.elements.namedItem('file'); if (file instanceof HTMLInputElement && file.files?.[0]) void upload(file.files[0]); else setError('Choose a file to upload.'); }}>
            <label className="sa-field sa-field-wide"><span className="sa-label">Upload a new photo</span><input name="file" className="sa-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml,image/avif" /><span className="sa-hint">Up to 25 MB. The file type is verified from its content.</span></label>
            <label className="sa-field sa-field-wide"><span className="sa-label">Media alt text <span className="sa-hint">optional</span></span><input className="sa-input" maxLength={300} value={uploadAlt} onChange={(event) => setUploadAlt(event.target.value)} /></label>
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>{busy === 'upload' ? 'Uploading…' : 'Upload and add'}</button>
          </form> : <p className="sa-lock-note">Only an owner or admin can upload files.</p>}
          <details><summary>Advanced: paste an image URL</summary><div className="sa-control-grid"><Field label="Image URL" help="Only for an image that is not in the Media library, such as a static storefront asset."><input className="sa-input" maxLength={2048} value={pasteUrl} placeholder="https://… or /media/…" onChange={(event) => setPasteUrl(event.target.value)} /></Field></div><button className="sa-btn" type="button" onClick={() => {
            const url = pasteUrl.trim();
            if (!url) { setError('Paste an image URL first.'); return; }
            onChange((current) => reorder([...current, { key: `photo-${crypto.randomUUID()}`, url, alt: '', role: current.some((row) => row.role === 'primary') ? 'gallery' : 'primary', sortOrder: current.length, colourId: null }]));
            setPasteUrl('');
          }}>Add this URL</button></details>
        </fieldset>
      ) : null}

      {colours.length === 0 ? <p className="sa-hint">No shared colours yet. Add colours under Shared lists in Basics to give each colour its own photos.</p> : null}
      <p className="sa-hint">Photo changes are staged until you save the product. A colour with no photos uses the main gallery.</p>
    </div>
  );
}
