'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { CollectionSchema, FieldSchema, ListSchema } from '@/lib/website/collections';
import { getByPath, setByPath } from '@/lib/website/json-path';

import { BooleanField, ImageField, SelectField, VideoField } from './WebsiteFields';

/* Path of one field of one list item. Empty itemField path = the item itself. */
const itemFieldPath = (list: ListSchema, index: number, fieldPath: string) =>
  fieldPath ? `${list.path}[${index}].${fieldPath}` : `${list.path}[${index}]`;

/** A collection is enabled unless its value explicitly says enabled: false. */
function isEnabled(value: Record<string, unknown>): boolean {
  return value.enabled !== false;
}

/** Group scalar fields by the first path segment for scannable sections. */
function sectionLabel(root: string): string {
  return root.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

interface Props {
  collection: CollectionSchema;
  /** Saved override (null = the site renders its coded defaults). */
  initialValue: Record<string, unknown> | null;
  /** What the site renders today when no override exists (pre-filled). */
  defaults: Record<string, unknown> | null;
  /** Original artwork per image slot (display-only preview). */
  currentArt?: Record<string, unknown> | null;
  canEdit: boolean;
}

/**
 * Website content editor — the Store Admin skin over the collection schema.
 *
 * Behaviour is identical to the removed legacy editor: fields pre-fill from
 * the live defaults, a save PUTs the whole value through the owner-guarded
 * route (commerce-boundary checked server-side), and Reset archives the
 * override instead of deleting it.
 */
export function WebsiteContentEditor({
  collection,
  initialValue,
  defaults,
  currentArt,
  canEdit,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState<Record<string, unknown>>(() => initialValue ?? defaults ?? {});
  const [savedSnapshot, setSavedSnapshot] = useState<string>(
    JSON.stringify(initialValue ?? defaults ?? {}),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const artMap = currentArt ?? {};

  const effectiveDefaults = defaults ?? {};
  const dirty = useMemo(() => JSON.stringify(value) !== savedSnapshot, [value, savedSnapshot]);

  const fieldChanged = useCallback(
    (path: string) => {
      const cur = getByPath(value, path);
      const def = getByPath(effectiveDefaults, path);
      if (cur === undefined) return false;
      return JSON.stringify(cur ?? null) !== JSON.stringify(def ?? null);
    },
    [value, effectiveDefaults],
  );

  const listState = useCallback(
    (list: ListSchema) => {
      const cur = getByPath(value, list.path);
      const def = getByPath(effectiveDefaults, list.path);
      const items = Array.isArray(cur) ? cur : Array.isArray(def) ? def : [];
      const defItems = Array.isArray(def) ? def : [];
      return { items, defItems };
    },
    [value, effectiveDefaults],
  );

  const enabled = collection.disablable ? isEnabled(value) : true;

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

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function save() {
    setBusy('save');
    resetFeedback();
    try {
      const response = await fetch(
        `/api/store-admin/website/content/${encodeURIComponent(collection.key)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Save failed.');
      }
      setSavedSnapshot(JSON.stringify(value));
      setMessage('Saved — the change is live on the site.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Save failed.');
    } finally {
      setBusy(null);
    }
  }

  async function resetToDefaults() {
    if (
      !window.confirm(
        'Reset this section to the built-in defaults? The saved override is archived and the site shows the default content immediately. Saving again restores your edits.',
      )
    ) {
      return;
    }
    setBusy('reset');
    resetFeedback();
    try {
      const response = await fetch(
        `/api/store-admin/website/content/${encodeURIComponent(collection.key)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Reset failed.');
      }
      setValue(effectiveDefaults);
      setSavedSnapshot(JSON.stringify(effectiveDefaults));
      setMessage('Reset — the site is back on its built-in content.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Reset failed.');
    } finally {
      setBusy(null);
    }
  }

  const resetField = (path: string) =>
    setValue((prev) => setByPath(prev, path, getByPath(effectiveDefaults, path)));

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
      const template = arr.length ? arr[arr.length - 1] : null;
      const fresh = template === null || template === undefined ? '' : structuredClone(template);
      if (fresh && typeof fresh === 'object' && !Array.isArray(fresh)) {
        const first = list.itemFields.find((f) => f.type === 'text');
        if (first && first.path) (fresh as Record<string, unknown>)[first.path] = '';
      }
      return [...arr, fresh];
    });
  };

  const removeListItem = (list: ListSchema, index: number) =>
    mutateList(list, (arr) => (arr.length <= list.minItems ? arr : (arr.splice(index, 1), arr)));

  const moveListItem = (list: ListSchema, index: number, delta: -1 | 1) =>
    mutateList(list, (arr) => {
      const to = index + delta;
      if (to < 0 || to >= arr.length) return arr;
      [arr[index], arr[to]] = [arr[to], arr[index]];
      return arr;
    });

  const restoreListItem = (list: ListSchema, index: number) => {
    const def = getByPath(effectiveDefaults, list.path);
    if (!Array.isArray(def) || def[index] === undefined) return;
    mutateList(list, (arr) => {
      arr[index] = structuredClone(def[index]);
      return arr;
    });
  };

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

  const renderField = (field: FieldSchema, path: string, key: string) => {
    const str = (v: unknown) =>
      typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
    switch (field.type) {
      case 'image':
        return (
          <ImageField
            key={key}
            field={field}
            value={str(getByPath(value, path))}
            currentArt={str(getByPath(artMap, path)) || undefined}
            disabled={!canEdit || busy !== null}
            onChange={(v) => setValue((prev) => setByPath(prev, path, v))}
          />
        );
      case 'video':
        return (
          <VideoField
            key={key}
            field={field}
            value={str(getByPath(value, path))}
            disabled={!canEdit || busy !== null}
            onChange={(v) => setValue((prev) => setByPath(prev, path, v))}
          />
        );
      case 'boolean':
        return (
          <BooleanField
            key={key}
            field={field}
            value={getByPath(value, path)}
            defaultValue={getByPath(effectiveDefaults, path)}
            disabled={!canEdit || busy !== null}
            onChange={(v) => setValue((prev) => setByPath(prev, path, v))}
          />
        );
      case 'select':
        return (
          <SelectField
            key={key}
            field={field}
            value={str(getByPath(value, path))}
            disabled={!canEdit || busy !== null}
            onChange={(v) => setValue((prev) => setByPath(prev, path, v))}
          />
        );
      default: {
        const cur = str(getByPath(value, path));
        const def = str(getByPath(effectiveDefaults, path));
        const changed = fieldChanged(path);
        return (
          <div className="sa-field sa-field-wide" key={key}>
            <div className="sa-edit-head">
              <span className="sa-label">
                {field.label}
                {changed ? <span className="sa-chip sa-chip-count">edited</span> : null}
              </span>
              {changed ? (
                <button
                  className="sa-btn sa-btn-small sa-btn-quiet"
                  type="button"
                  onClick={() => resetField(path)}
                  title={`Back to: ${def.slice(0, 80)}`}
                >
                  Reset field
                </button>
              ) : null}
            </div>
            {field.type === 'textarea' ? (
              <textarea
                className="sa-input"
                rows={3}
                value={cur}
                disabled={!canEdit || busy !== null}
                onChange={(event) => setValue((prev) => setByPath(prev, path, event.target.value))}
              />
            ) : (
              <input
                className="sa-input"
                type={field.type === 'color' ? 'color' : field.type === 'url' ? 'url' : 'text'}
                value={cur}
                disabled={!canEdit || busy !== null}
                onChange={(event) => setValue((prev) => setByPath(prev, path, event.target.value))}
              />
            )}
            {!changed && def ? <span className="sa-hint">Currently: {def.slice(0, 120)}</span> : null}
            {field.hint ? <span className="sa-hint">{field.hint}</span> : null}
          </div>
        );
      }
    }
  };

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
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">{collection.label}</h1>
          <p className="sa-page-sub">
            {collection.description ?? 'Storefront content section.'}{' '}
            <span className="sa-mono">{collection.key}</span>
          </p>
        </div>
        <div className="sa-inline-actions">
          {collection.sitePaths[0] ? (
            <a
              className="sa-btn sa-btn-quiet sa-btn-small"
              href={collection.sitePaths[0]}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on site ↗
            </a>
          ) : null}
          {canEdit && initialValue !== null ? (
            <button
              className="sa-btn sa-btn-danger sa-btn-small"
              type="button"
              onClick={resetToDefaults}
              disabled={busy !== null}
            >
              {busy === 'reset' ? 'Resetting…' : 'Reset to defaults'}
            </button>
          ) : null}
        </div>
      </div>

      {!canEdit ? (
        <p className="sa-note">
          Read-only for your role. Only the store owner can change what customers see.
        </p>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      {initialValue === null ? (
        <p className="sa-note">
          <strong>Showing current live content.</strong> Nothing is overridden yet — fields are
          pre-filled with what visitors see today. Change anything and save to create an override.
        </p>
      ) : (
        <p className="sa-note">
          <strong>This section has saved edits</strong> ({changedFieldCount} field
          {changedFieldCount === 1 ? '' : 's'} currently differ from the defaults). Reset to
          defaults to go back to the built-in content.
        </p>
      )}

      {collection.disablable ? (
        <section className="sa-detail-card">
          <label className="sa-check">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || busy !== null}
              onChange={() => setValue((prev) => setByPath(prev, 'enabled', !isEnabled(prev)))}
            />
            Section visible on the site
          </label>
          <span className="sa-hint">
            {enabled
              ? 'Untick to hide this section without deleting its content.'
              : 'Tick to show the section again. Its content is kept exactly as edited.'}
          </span>
        </section>
      ) : null}

      <div style={enabled ? undefined : { opacity: 0.55, pointerEvents: canEdit ? 'none' : undefined }}>
        {groups.map(([root, fields]) => (
          <section className="sa-detail-card" key={root} style={{ marginBottom: 14 }}>
            <h2 className="sa-card-title">
              {sectionLabel(root)}
              {fields.filter((f) => fieldChanged(f.path)).length > 0 ? (
                <span className="sa-chip sa-chip-count" style={{ marginLeft: 8 }}>
                  {fields.filter((f) => fieldChanged(f.path)).length} changed
                </span>
              ) : null}
            </h2>
            <div className="sa-control-grid">
              {fields.map((f) => renderField(f, f.path, f.path))}
            </div>
          </section>
        ))}

        {(collection.lists ?? []).map((list) => {
          const { items, defItems } = listState(list);
          return (
            <section className="sa-detail-card" key={list.path} style={{ marginBottom: 14 }}>
              <div className="sa-edit-head">
                <h2 className="sa-card-title">
                  {sectionLabel(list.path)}
                  <span className="sa-chip sa-chip-count" style={{ marginLeft: 8 }}>
                    {items.length} · max {list.maxItems}
                  </span>
                </h2>
                {canEdit ? (
                  <button
                    className="sa-btn sa-btn-quiet sa-btn-small"
                    type="button"
                    disabled={items.length >= list.maxItems || busy !== null}
                    onClick={() => addListItem(list)}
                  >
                    + Add {list.itemLabel.toLowerCase()}
                  </button>
                ) : null}
              </div>
              {items.map((item, i) => {
                const isNew = i >= defItems.length;
                const itemChanged =
                  isNew || list.itemFields.some((f) => fieldChanged(itemFieldPath(list, i, f.path)));
                return (
                  <details className="sa-edit-card" key={`list:${list.path}[${i}]`} open={i === 0}>
                    <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="sa-row-strong">
                        {list.itemLabel} {i + 1}
                      </span>
                      <span className="sa-muted" style={{ fontSize: 13 }}>
                        {itemSummary(list, item).slice(0, 60)}
                      </span>
                      {isNew ? <span className="sa-chip sa-chip-count">new</span> : null}
                      {!isNew && itemChanged ? <span className="sa-chip sa-chip-count">edited</span> : null}
                      {canEdit ? (
                        <span className="sa-inline-actions" style={{ marginLeft: 'auto' }}>
                          <button
                            className="sa-btn sa-btn-small sa-btn-quiet"
                            type="button"
                            title="Move up"
                            disabled={i === 0 || busy !== null}
                            onClick={(event) => { event.preventDefault(); moveListItem(list, i, -1); }}
                          >
                            ↑
                          </button>
                          <button
                            className="sa-btn sa-btn-small sa-btn-quiet"
                            type="button"
                            title="Move down"
                            disabled={i === items.length - 1 || busy !== null}
                            onClick={(event) => { event.preventDefault(); moveListItem(list, i, 1); }}
                          >
                            ↓
                          </button>
                          {!isNew && itemChanged ? (
                            <button
                              className="sa-btn sa-btn-small sa-btn-quiet"
                              type="button"
                              title="Restore this item to default"
                              onClick={(event) => { event.preventDefault(); restoreListItem(list, i); }}
                            >
                              ↺
                            </button>
                          ) : null}
                          <button
                            className="sa-btn sa-btn-small sa-btn-danger"
                            type="button"
                            title={
                              items.length <= list.minItems
                                ? `At least ${list.minItems} item${list.minItems === 1 ? '' : 's'} required`
                                : 'Remove'
                            }
                            disabled={items.length <= list.minItems || busy !== null}
                            onClick={(event) => { event.preventDefault(); removeListItem(list, i); }}
                          >
                            ✕
                          </button>
                        </span>
                      ) : null}
                    </summary>
                    <div className="sa-control-grid" style={{ marginTop: 12 }}>
                      {list.itemFields.map((f) => renderField(f, itemFieldPath(list, i, f.path), f.path || '_self'))}
                    </div>
                  </details>
                );
              })}
              {items.length === 0 ? <p className="sa-empty">No items.</p> : null}
            </section>
          );
        })}
      </div>

      {canEdit && dirty ? (
        <div className="sa-edit-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--sa-card)', padding: 12, borderTop: '1px solid var(--sa-line)' }}>
          <span className="sa-note">Unsaved changes</span>
          <button
            className="sa-btn sa-btn-quiet"
            type="button"
            disabled={busy !== null}
            onClick={() => setValue(JSON.parse(savedSnapshot))}
          >
            Discard
          </button>
          <button
            className="sa-btn sa-btn-primary"
            type="button"
            disabled={busy !== null}
            onClick={save}
          >
            {busy === 'save' ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
