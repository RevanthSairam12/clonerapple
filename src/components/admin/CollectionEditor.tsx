'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { CollectionSchema, FieldSchema, ListSchema } from '@/lib/admin/collections';
import { getByPath, setByPath } from './json-path';

/* --------------------------------------------------------------- inputs */

/** Shared upload logic for image and video fields. */
function useMediaUpload(onChange: (url: string) => void, accept: string) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/media', { method: 'POST', body: fd });
      const json = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error || 'Upload failed.');
      onChange(json.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  return { fileRef, uploading, error, dragOver, upload, setDragOver };
}

function ImageField({
  field,
  value,
  defaultValue,
  currentArt,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  defaultValue?: string;
  /** Original artwork for this slot — display-only preview, never saved. */
  currentArt?: string;
  onChange: (v: string) => void;
}) {
  const { fileRef, uploading, error, dragOver, upload, setDragOver } = useMediaUpload(onChange, 'image/*');
  const preview = value || currentArt;

  return (
    <div>
      <label className="admin-field-label">{field.label}</label>
      <div
        className={`admin-image-preview${dragOver ? ' admin-image-drop' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        title={value ? 'Your uploaded image' : currentArt ? 'Currently on the site — upload to replace' : 'Drop an image here'}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" />
        ) : (
          <span style={{ fontSize: 12, color: '#a1a1a6' }}>No image</span>
        )}
      </div>
      <div className="admin-image-row">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={currentArt && !value ? 'Keep current image' : 'https://… or upload →'}
          className="admin-input"
        />
        <button
          type="button"
          className="admin-image-upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {!value && currentArt ? (
        <p className="admin-field-default">Showing the current site image. Upload to replace; leave blank to keep it.</p>
      ) : null}
      {field.hint ? <p className="admin-field-default">{field.hint}</p> : null}
      {error ? <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c00' }}>{error}</p> : null}
    </div>
  );
}

function VideoField({
  field,
  value,
  defaultValue,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
}) {
  const { fileRef, uploading, error, dragOver, upload, setDragOver } = useMediaUpload(onChange, 'video/*');

  return (
    <div>
      <label className="admin-field-label">{field.label}</label>
      <div
        className={`admin-image-preview${dragOver ? ' admin-image-drop' : ''}`}
        style={{ aspectRatio: 'auto', minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        title="Drop a video here"
      >
        {value ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={value} controls muted playsInline style={{ maxWidth: '100%', maxHeight: 140 }} />
        ) : (
          <span style={{ fontSize: 12, color: '#a1a1a6' }}>No video</span>
        )}
      </div>
      <div className="admin-image-row">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultValue ? '' : 'https://… or upload →'}
          className="admin-input"
        />
        <button
          type="button"
          className="admin-image-upload-btn"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/webm,video/mp4,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = '';
          }}
        />
      </div>
      {field.hint ? <p className="admin-field-default">{field.hint}</p> : null}
      {error ? <p style={{ margin: '4px 0 0', fontSize: 12, color: '#c00' }}>{error}</p> : null}
    </div>
  );
}

function FieldInput({
  field,
  value,
  defaultValue,
  currentValue,
  changed,
  onReset,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  defaultValue: unknown;
  /** Original value at this path from the currentArt map (image preview only). */
  currentValue: unknown;
  changed: boolean;
  onReset: () => void;
  onChange: (v: unknown) => void;
}) {
  const str = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const defStr =
    typeof defaultValue === 'string'
      ? defaultValue
      : defaultValue === undefined || defaultValue === null
        ? ''
        : String(defaultValue);
  const curStr = typeof currentValue === 'string' ? currentValue : '';

  if (field.type === 'image') {
    return <ImageField field={field} value={str} defaultValue={defStr} currentArt={curStr || undefined} onChange={onChange} />;
  }

  if (field.type === 'video') {
    return <VideoField field={field} value={str} defaultValue={defStr} onChange={onChange} />;
  }

  if (field.type === 'boolean') {
    const isChecked = typeof value === 'boolean' ? value : defaultValue !== false;
    return (
      <div className="admin-field">
        <div className="admin-field-label-row">
          <label className="admin-field-label">
            {field.label} {changed ? <span className="admin-field-changed">• edited</span> : null}
          </label>
          {changed ? (
            <button
              type="button"
              className="admin-field-reset"
              onClick={onReset}
              title={`Back to: ${defaultValue === false ? 'Disabled' : 'Enabled'}`}
            >
              reset
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
          <button
            type="button"
            role="switch"
            aria-checked={isChecked}
            className={`admin-switch${isChecked ? '' : ' off'}`}
            onClick={() => onChange(!isChecked)}
          >
            <span className="admin-switch-knob" />
          </button>
          <span style={{ fontSize: 13, fontWeight: 500, color: isChecked ? '#1d1d1f' : '#86868b' }}>
            {isChecked ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        {field.hint ? <p className="admin-field-default">{field.hint}</p> : null}
      </div>
    );
  }

  return (
    <div className="admin-field">
      <div className="admin-field-label-row">
        <label className="admin-field-label">
          {field.label} {changed ? <span className="admin-field-changed">• edited</span> : null}
        </label>
        {changed ? (
          <button type="button" className="admin-field-reset" onClick={onReset} title={`Back to: ${defStr.slice(0, 80)}`}>
            reset
          </button>
        ) : null}
      </div>
      {field.type === 'textarea' ? (
        <textarea
          value={str}
          onChange={(e) => onChange(e.target.value)}
          className={`admin-textarea${changed ? ' changed' : ''}`}
        />
      ) : (
        <input
          type={field.type === 'color' ? 'color' : 'text'}
          value={str}
          placeholder=""
          onChange={(e) => onChange(e.target.value)}
          className={`admin-input${changed ? ' changed' : ''}`}
        />
      )}
      {!changed && defStr ? <p className="admin-field-default">Currently: {defStr}</p> : null}
      {field.hint ? <p className="admin-field-default">{field.hint}</p> : null}
    </div>
  );
}

/* --------------------------------------------------------------- editor */

/** Path of one field of one list item. Empty itemField path = the item itself (plain-string lists). */
const itemFieldPath = (list: ListSchema, index: number, fieldPath: string) =>
  fieldPath ? `${list.path}[${index}].${fieldPath}` : `${list.path}[${index}]`;

export function CollectionEditor({
  collection,
  initialValue,
  defaults,
  currentArt,
}: {
  collection: CollectionSchema;
  /** Current stored value (null = never edited → the site shows defaults). */
  initialValue: Record<string, unknown> | null;
  /** What the site renders today when no override exists (pre-filled values). */
  defaults: Record<string, unknown> | null;
  /** Original artwork per image slot (display-only preview; same shape as defaults). */
  currentArt?: Record<string, unknown> | null;
}) {
  const router = useRouter();
  // Start from the live present data: saved override if any, else defaults.
  const [value, setValue] = useState<Record<string, unknown>>(() => initialValue ?? defaults ?? {});
  const [savedSnapshot, setSavedSnapshot] = useState<string>(JSON.stringify(initialValue ?? defaults ?? {}));
  const [status, setStatus] = useState<'idle' | 'saving' | 'error' | 'saved'>('idle');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const artMap = currentArt ?? {};

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const dirty = useMemo(() => JSON.stringify(value) !== savedSnapshot, [value, savedSnapshot]);

  const effectiveDefaults = defaults ?? {};

  // field-level: changed vs the effective default
  const fieldChanged = useCallback(
    (path: string) => {
      const cur = getByPath(value, path);
      const def = getByPath(effectiveDefaults, path);
      if (cur === undefined) return false;
      return JSON.stringify(cur ?? null) !== JSON.stringify(def ?? null);
    },
    [value, effectiveDefaults],
  );

  /* Lists: current array (value first, defaults fallback) and default array. */
  const listState = useCallback(
    (list: ListSchema) => {
      const cur = getByPath(value, list.path);
      const def = getByPath(effectiveDefaults, list.path);
      const items = Array.isArray(cur)
        ? cur
        : Array.isArray(def)
          ? def
          : [];
      const defItems = Array.isArray(def) ? def : [];
      return { items, defItems };
    },
    [value, effectiveDefaults],
  );

  const changedFieldCount = useMemo(() => {
    let n = collection.fields.filter((f) => fieldChanged(f.path)).length;
    for (const list of collection.lists ?? []) {
      const { items, defItems } = listState(list);
      if (items.length !== defItems.length) n += 1;
      for (let i = 0; i < items.length; i++) {
        for (const f of list.itemFields) {
          if (fieldChanged(itemFieldPath(list, i, f.path))) n += 1;
        }
      }
    }
    return n;
  }, [collection, fieldChanged, listState]);

  const enabled = collection.disablable ? isEnabled(value) : true;
  const enabledChanged = collection.disablable && !enabled;

  const toggleEnabled = () => setValue((prev) => setByPath(prev, 'enabled', !isEnabled(prev)));

  // Warn before leaving with unsaved changes.
  if (typeof window !== 'undefined') {
    window.onbeforeunload = dirty ? () => 'You have unsaved changes.' : null;
  }

  const save = async () => {
    setStatus('saving');
    try {
      const res = await fetch('/api/admin/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: collection.key, value }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Save failed.');
      setSavedSnapshot(JSON.stringify(value));
      setStatus('saved');
      showToast('success', 'Saved — changes are live on the site.');
      router.refresh();
    } catch (e) {
      setStatus('error');
      showToast('error', e instanceof Error ? e.message : 'Save failed.');
    }
  };

  const resetToDefaults = async () => {
    if (!confirm('Reset this collection to the original defaults? The saved override will be deleted and the site will immediately show the default content.')) return;
    setStatus('saving');
    try {
      const res = await fetch(`/api/admin/content?key=${encodeURIComponent(collection.key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Reset failed.');
      setValue(effectiveDefaults);
      setSavedSnapshot(JSON.stringify(effectiveDefaults));
      setStatus('idle');
      showToast('success', 'Reset — the site is back on defaults.');
      router.refresh();
    } catch (e) {
      setStatus('error');
      showToast('error', e instanceof Error ? e.message : 'Reset failed.');
    }
  };

  const resetField = (path: string) => {
    setValue((prev) => setByPath(prev, path, getByPath(effectiveDefaults, path)));
  };

  /* List mutations: operate on a copy of the array and write it back whole. */
  const mutateList = (list: ListSchema, mutate: (arr: unknown[]) => unknown[]) => {
    setValue((prev) => {
      const cur = getByPath(prev, list.path);
      const def = getByPath(effectiveDefaults, list.path);
      const base = Array.isArray(cur) ? cur : Array.isArray(def) ? def : [];
      return setByPath(prev, list.path, mutate([...base]));
    });
  };

  const addListItem = (list: ListSchema) => {
    mutateList(list, (arr) => {
      if (arr.length >= list.maxItems) return arr;
      // Template the new item on the last one so structure/links carry over.
      const template = arr.length ? arr[arr.length - 1] : null;
      const fresh = template === null || template === undefined ? '' : structuredClone(template);
      // Give the new item a blank headline-ish first field so it reads as new.
      if (fresh && typeof fresh === 'object' && !Array.isArray(fresh)) {
        const first = list.itemFields.find((f) => f.type === 'text');
        if (first && first.path) (fresh as Record<string, unknown>)[first.path] = '';
      }
      return [...arr, fresh];
    });
  };

  const removeListItem = (list: ListSchema, index: number) => {
    mutateList(list, (arr) => (arr.length <= list.minItems ? arr : (arr.splice(index, 1), arr)));
  };

  const moveListItem = (list: ListSchema, index: number, delta: -1 | 1) => {
    mutateList(list, (arr) => {
      const to = index + delta;
      if (to < 0 || to >= arr.length) return arr;
      [arr[index], arr[to]] = [arr[to], arr[index]];
      return arr;
    });
  };

  const restoreListItem = (list: ListSchema, index: number) => {
    const def = getByPath(effectiveDefaults, list.path);
    if (!Array.isArray(def) || def[index] === undefined) return;
    mutateList(list, (arr) => {
      arr[index] = structuredClone(def[index]);
      return arr;
    });
  };

  // group scalar fields by the first path segment for scannable sections
  const groups = useMemo(() => {
    const map = new Map<string, FieldSchema[]>();
    for (const f of collection.fields) {
      const root = f.path.replace(/\[.*$/, '');
      const list = map.get(root) ?? [];
      list.push(f);
      map.set(root, list);
    }
    return [...map.entries()];
  }, [collection]);

  const sectionLabel = (root: string) =>
    root.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();

  const isSectionOpen = (key: string) => openSections[key] ?? true;

  /** Short human summary of a list item for its card header. */
  const itemSummary = (list: ListSchema, item: unknown) => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      for (const f of list.itemFields) {
        if (f.type !== 'image') {
          const v = f.path ? getByPath(item, f.path) : item;
          if (typeof v === 'string' && v.trim()) return v.trim();
          if (typeof v === 'number') return String(v);
        }
      }
    }
    return '';
  };

  return (
    <div>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{collection.label}</h1>
          {collection.description ? (
            <p style={{ margin: '5px 0 0', fontSize: 13.5, color: '#6e6e73' }}>{collection.description}</p>
          ) : null}
          <p style={{ margin: '7px 0 0', fontSize: 12, color: '#a1a1a6' }}>
            key: <code>{collection.key}</code>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
          {collection.sitePaths[0] ? (
            <a href={collection.sitePaths[0]} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn-ghost">
              View on site ↗
            </a>
          ) : null}
          {initialValue !== null ? (
            <button type="button" className="admin-btn admin-btn-danger" onClick={resetToDefaults}>
              ↺ Reset to defaults
            </button>
          ) : null}
        </div>
      </div>

      {/* enable / disable */}
      {collection.disablable ? (
        <div className={`admin-toggle-card${enabled ? '' : ' off'}`}>
          <div>
            <strong>{enabled ? 'Section is visible on the site' : 'Section is hidden from the site'}</strong>
            <p>
              {enabled
                ? 'Turn off to remove this section from the page without deleting its content.'
                : 'Turn on to show this section again. Its content is kept exactly as edited.'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            className={`admin-switch${enabled ? '' : ' off'}`}
            onClick={toggleEnabled}
          >
            <span className="admin-switch-knob" />
          </button>
        </div>
      ) : null}

      {/* status notices */}
      {initialValue === null ? (
        <div className="admin-notice admin-notice-info">
          <span>ℹ️</span>
          <span>
            <strong>Showing current live content.</strong> Nothing is overridden yet — fields are
            pre-filled with what visitors see today. Change anything and save to create an override.
          </span>
        </div>
      ) : (
        <div className="admin-notice admin-notice-warn">
          <span>✏️</span>
          <span>
            <strong>This collection has saved edits</strong> ({changedFieldCount} change{changedFieldCount === 1 ? '' : 's'} currently differs from the defaults).
            Reset to defaults to go back to the original content.
          </span>
        </div>
      )}

      <div style={enabled ? undefined : { opacity: 0.55, pointerEvents: 'none' }}>
        {/* scalar field sections */}
        {groups.map(([root, fields]) => {
          const open = isSectionOpen(root);
          const changedInSection = fields.filter((f) => fieldChanged(f.path)).length;
          return (
            <section key={root} className="admin-editor-section">
              <button
                type="button"
                className="admin-editor-section-header"
                onClick={() => setOpenSections((p) => ({ ...p, [root]: !open }))}
                aria-expanded={open}
              >
                <span className="admin-editor-section-title">
                  <span className="admin-editor-section-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                  {sectionLabel(root)}
                  {changedInSection > 0 ? (
                    <span className="admin-badge admin-badge-edited">{changedInSection} changed</span>
                  ) : null}
                </span>
                <span className="admin-editor-section-count">{fields.length} fields</span>
              </button>
              {open ? (
                <div className="admin-editor-section-body">
                  {fields.map((f) => (
                    <FieldInput
                      key={f.path}
                      field={f}
                      value={getByPath(value, f.path)}
                      defaultValue={getByPath(effectiveDefaults, f.path)}
                      currentValue={getByPath(artMap, f.path)}
                      changed={fieldChanged(f.path)}
                      onReset={() => resetField(f.path)}
                      onChange={(v) => setValue((prev) => setByPath(prev, f.path, v))}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        {/* list sections (add / remove / reorder items) */}
        {(collection.lists ?? []).map((list) => {
          const { items, defItems } = listState(list);
          const open = isSectionOpen(`list:${list.path}`);
          const changedItems = items.reduce((n, _item, i) => {
            const itemChanged =
              i >= defItems.length ||
              list.itemFields.some((f) => fieldChanged(itemFieldPath(list, i, f.path)));
            return n + (itemChanged ? 1 : 0);
          }, 0);
          return (
            <section key={list.path} className="admin-editor-section">
              <button
                type="button"
                className="admin-editor-section-header"
                onClick={() => setOpenSections((p) => ({ ...p, [`list:${list.path}`]: !open }))}
                aria-expanded={open}
              >
                <span className="admin-editor-section-title">
                  <span className="admin-editor-section-chevron" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                  {sectionLabel(list.path)}
                  {changedItems > 0 ? (
                    <span className="admin-badge admin-badge-edited">{changedItems} item{changedItems === 1 ? '' : 's'} changed</span>
                  ) : null}
                </span>
                <span className="admin-editor-section-count">
                  {items.length} {items.length === 1 ? list.itemLabel.toLowerCase() : `${list.itemLabel.toLowerCase()}s`}
                  {list.maxItems > list.minItems ? ` · max ${list.maxItems}` : ''}
                </span>
              </button>
              {open ? (
                <div className="admin-editor-section-body">
                  <div className="admin-list">
                    {items.map((item, i) => {
                      const itemKey = `list:${list.path}[${i}]`;
                      const itemOpen = openSections[itemKey] ?? i === 0;
                      const isNew = i >= defItems.length;
                      const itemChanged =
                        isNew || list.itemFields.some((f) => fieldChanged(itemFieldPath(list, i, f.path)));
                      return (
                        <div key={itemKey} className="admin-list-item">
                          <div className="admin-list-item-header">
                            <button
                              type="button"
                              className="admin-list-item-title"
                              onClick={() => setOpenSections((p) => ({ ...p, [itemKey]: !itemOpen }))}
                              aria-expanded={itemOpen}
                            >
                              <span className="admin-editor-section-chevron" style={{ transform: itemOpen ? 'rotate(90deg)' : 'none', fontSize: 10 }}>▶</span>
                              {list.itemLabel} {i + 1}
                              <span className="admin-list-item-summary">{itemSummary(list, item)}</span>
                              {isNew ? <span className="admin-badge admin-badge-edited">new</span> : null}
                              {!isNew && itemChanged ? <span className="admin-badge admin-badge-edited">edited</span> : null}
                            </button>
                            <div className="admin-list-item-actions">
                              <button type="button" className="admin-icon-btn" title="Move up" disabled={i === 0} onClick={() => moveListItem(list, i, -1)}>↑</button>
                              <button type="button" className="admin-icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => moveListItem(list, i, 1)}>↓</button>
                              {!isNew && itemChanged ? (
                                <button type="button" className="admin-icon-btn" title="Restore this item to default" onClick={() => restoreListItem(list, i)}>↺</button>
                              ) : null}
                              <button
                                type="button"
                                className="admin-icon-btn admin-icon-btn-danger"
                                title={items.length <= list.minItems ? `At least ${list.minItems} item${list.minItems === 1 ? '' : 's'} required` : 'Remove'}
                                disabled={items.length <= list.minItems}
                                onClick={() => removeListItem(list, i)}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                          {itemOpen ? (
                            <div className="admin-list-item-body">
                              {list.itemFields.map((f) => {
                                const p = itemFieldPath(list, i, f.path);
                                return (
                                  <FieldInput
                                    key={f.path || '_self'}
                                    field={f}
                                    value={getByPath(value, p)}
                                    defaultValue={getByPath(effectiveDefaults, p)}
                                    currentValue={getByPath(artMap, p)}
                                    changed={fieldChanged(p)}
                                    onReset={() => resetField(p)}
                                    onChange={(v) => setValue((prev) => setByPath(prev, p, v))}
                                  />
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      className="admin-btn admin-btn-secondary admin-list-add"
                      disabled={items.length >= list.maxItems}
                      onClick={() => addListItem(list)}
                    >
                      + Add {list.itemLabel.toLowerCase()}
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>

      {/* sticky save bar */}
      {dirty ? (
        <div className="admin-savebar">
          <span className="admin-savebar-text">
            <span className="admin-savebar-dot" />
            Unsaved changes
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => {
                setValue(JSON.parse(savedSnapshot));
              }}
              disabled={status === 'saving'}
            >
              Discard
            </button>
            <button type="button" className="admin-btn admin-btn-primary" onClick={save} disabled={status === 'saving'}>
              {status === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : null}

      {toast ? <div className={`admin-toast admin-toast-${toast.kind}`}>{toast.text}</div> : null}
    </div>
  );
}

/** A collection is enabled unless its value explicitly says enabled: false. */
function isEnabled(value: Record<string, unknown>): boolean {
  return value.enabled !== false;
}
