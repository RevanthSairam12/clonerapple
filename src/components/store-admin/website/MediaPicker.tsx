'use client';

import { useEffect, useMemo, useState } from 'react';

interface PickerMedia {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  alt: string;
}

/** Slide-over that picks an existing file from the Store Admin media library. */
export function MediaPicker({
  kind,
  current,
  onPick,
  onClose,
}: {
  kind: 'image' | 'video';
  current: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<PickerMedia[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/store-admin/media', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(payload.media)) {
          throw new Error(typeof payload.error === 'string' ? payload.error : 'The media library could not be loaded.');
        }
        if (!cancelled) setItems(payload.media as PickerMedia[]);
      })
      .catch((failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'The media library could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        item.mimeType.startsWith(`${kind}/`) &&
        (!needle || item.filename.toLowerCase().includes(needle) || item.alt.toLowerCase().includes(needle)),
    );
  }, [items, kind, query]);

  const title = kind === 'image' ? 'Choose an image' : 'Choose a video';

  return (
    <div className="sa-quickview" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" className="sa-quickview-backdrop" aria-label="Close" onClick={onClose} />
      <aside className="sa-quickview-panel">
        <button type="button" className="sa-quickview-close sa-icon-btn" aria-label="Close" onClick={onClose}>
          ✕
        </button>
        <div className="sa-quickview-head">
          <div>
            <h2 className="sa-section-title">{title}</h2>
            <p className="sa-card-note">From the media library. Upload new files from the field or the library.</p>
          </div>
        </div>
        <div className="sa-quickview-body">
          <input
            className="sa-input"
            type="search"
            placeholder="Search by file name or alt text"
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
          />
          {error ? <p className="sa-error" role="alert">{error}</p> : null}
          {!items && !error ? <p className="sa-note">Loading…</p> : null}
          {items && visible.length === 0 ? (
            <p className="sa-note">
              {query ? 'No files match your search.' : `The library has no ${kind === 'image' ? 'images' : 'videos'} yet.`}
            </p>
          ) : null}
          <div className="sa-media-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {visible.map((item) => {
              const selected = item.url === current;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="sa-media-card"
                  aria-pressed={selected}
                  style={{
                    padding: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    outline: selected ? '2px solid var(--sa-accent, #0b6cf0)' : undefined,
                  }}
                  onClick={() => onPick(item.url)}
                >
                  {kind === 'image' ? (
                    <div className="sa-media-thumb">
                      {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of a library file */}
                      <img src={item.url} alt={item.alt} loading="lazy" />
                    </div>
                  ) : (
                    <div className="sa-media-thumb is-video">VIDEO</div>
                  )}
                  <div className="sa-media-body">
                    <span className="sa-row-strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.filename}
                    </span>
                    <span className="sa-media-meta">
                      {item.width && item.height ? `${item.width}×${item.height}` : item.mimeType}
                      {selected ? ' · in use here' : ''}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
