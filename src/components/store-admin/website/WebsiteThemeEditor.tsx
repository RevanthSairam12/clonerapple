'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { FONT_LOADERS } from '@/lib/fontLoaders';
import { DEFAULT_SITE_FONT, type SiteFontName } from '@/lib/fonts';
import type { FieldSchema } from '@/lib/website/collections';

/** Defaults for the site-wide settings (what the site uses when unset). */
const THEME_DEFAULTS: Record<string, string> = {
  homepageUiMode: 'new',
  fontFamily: DEFAULT_SITE_FONT,
  logoText: 'OPPO',
  appleCopyright: '',
  oppoPrimaryColor: '#006D2E',
  oppoGreenDark: '#005524',
  oppoGreenLight: '#00a040',
};

/** Text the font previews are set in — shows x-height and digit shapes. */
const FONT_PREVIEW_SAMPLE = 'Everyday tech, better choices — 0123456789 ₹';

interface Props {
  fields: FieldSchema[];
  /** Live values from site_settings (saved overrides only). */
  initial: Record<string, string>;
  /** Who last saved each key, when available. */
  overrides: Array<{ key: string; updatedAt: string; updatedBy: string | null }>;
  canEdit: boolean;
}

/**
 * Theme & fonts editor — the Store Admin skin over site_settings.
 *
 * Values pre-fill with the coded defaults; only changed keys are sent. A
 * single-key revert archives that row (never deletes it), and saves are
 * owner-only, audited and applied to every page at once.
 */
export function WebsiteThemeEditor({ fields, initial, overrides, canEdit }: Props) {
  const router = useRouter();
  const baseline = useMemo(() => ({ ...THEME_DEFAULTS, ...initial }), [initial]);
  const [values, setValues] = useState<Record<string, string>>(baseline);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const overrideByKey = useMemo(() => new Map(overrides.map((row) => [row.key, row])), [overrides]);
  const editedFields = useMemo(
    () => fields.filter((f) => (values[f.path] ?? '') !== (baseline[f.path] ?? '')),
    [fields, values, baseline],
  );
  const changedFields = editedFields.filter(
    (f) => (values[f.path] ?? '') !== (THEME_DEFAULTS[f.path] ?? ''),
  );
  // Set back to the default while a saved row exists: archive it rather than
  // saving the default, so the site falls back to the coded value.
  const staleOverrides = editedFields
    .filter((f) => overrideByKey.has(f.path) && (values[f.path] ?? '') === (THEME_DEFAULTS[f.path] ?? ''))
    .map((f) => f.path);
  const dirty = editedFields.length > 0;

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function save() {
    setBusy('save');
    resetFeedback();
    try {
      const changed: Record<string, string> = {};
      for (const f of changedFields) changed[f.path] = values[f.path] ?? '';
      if (changedFields.length > 0) {
        const response = await fetch('/api/store-admin/website/theme', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ values: changed }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof payload.error === 'string' ? payload.error : 'Save failed.');
        }
      }
      // Archive rows that were set back to their default, so the site falls
      // back to the coded value instead of keeping a stale override.
      for (const key of staleOverrides) {
        const response = await fetch(
          `/api/store-admin/website/theme?key=${encodeURIComponent(key)}`,
          { method: 'DELETE' },
        );
        if (!response.ok) throw new Error(`Could not revert ${key}.`);
      }
      setMessage('Saved — theme changes are live on every page.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Save failed.');
    } finally {
      setBusy(null);
    }
  }

  async function resetField(key: string) {
    if (!window.confirm(`Revert "${key}" to its default?`)) return;
    setBusy(`reset:${key}`);
    resetFeedback();
    try {
      const response = await fetch(
        `/api/store-admin/website/theme?key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Revert failed.');
      }
      setValues((prev) => ({ ...prev, [key]: THEME_DEFAULTS[key] ?? '' }));
      setMessage('Reverted to the default.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Revert failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="sa-detail-head">
        <div>
          <h1 className="sa-page-title">Theme &amp; fonts</h1>
          <p className="sa-page-sub">
            Site-wide appearance: storefront UI version, typeface, logo text, footer copyright and
            the OPPO palette. Applied across every storefront page at once.
          </p>
        </div>
      </div>

      {!canEdit ? (
        <p className="sa-note">
          Read-only for your role. Only the store owner can change the theme.
        </p>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <p className="sa-note">
        Values pre-fill with the site defaults. Fields matching the default have no effect until
        changed{dirty ? ` — ${editedFields.length} unsaved` : ''}.
      </p>

      <div className="sa-detail-grid">
        {fields.map((f) => {
          const value = values[f.path] ?? '';
          const isDefault = value === (THEME_DEFAULTS[f.path] ?? '');
          const saved = overrideByKey.get(f.path);
          return (
            <div className="sa-detail-card" key={f.path}>
              <div className="sa-edit-head">
                <span className="sa-label">
                  {f.label}
                  {!isDefault ? <span className="sa-chip sa-chip-count" style={{ marginLeft: 6 }}>edited</span> : null}
                </span>
                {canEdit && !isDefault ? (
                  <button
                    className="sa-btn sa-btn-small sa-btn-quiet"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => resetField(f.path)}
                  >
                    {busy === `reset:${f.path}` ? 'Reverting…' : 'Revert'}
                  </button>
                ) : null}
              </div>
              {f.type === 'color' ? (
                <div className="sa-inline-actions">
                  <input
                    className="sa-swatch"
                    type="color"
                    value={value}
                    aria-label={f.label}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) => setValues((prev) => ({ ...prev, [f.path]: event.target.value }))}
                  />
                  <input
                    className="sa-input sa-mono"
                    style={{ maxWidth: 140 }}
                    type="text"
                    value={value}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) => setValues((prev) => ({ ...prev, [f.path]: event.target.value }))}
                  />
                </div>
              ) : f.type === 'select' ? (
                <>
                  <select
                    className="sa-input"
                    value={value}
                    aria-label={f.label}
                    disabled={!canEdit || busy !== null}
                    onChange={(event) => setValues((prev) => ({ ...prev, [f.path]: event.target.value }))}
                  >
                    {f.options?.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {f.path === 'fontFamily' ? (
                    <div className="sa-plain-list">
                      {f.options?.map((option) => {
                        const face = FONT_LOADERS[option as SiteFontName];
                        const active = option === value;
                        return (
                          <button
                            key={option}
                            type="button"
                            disabled={!canEdit || busy !== null}
                            onClick={() => setValues((prev) => ({ ...prev, [f.path]: option }))}
                            className={face?.className}
                            aria-pressed={active}
                            data-active={active ? 'true' : undefined}
                            style={{
                              display: 'block',
                              width: '100%',
                              textAlign: 'left',
                              background: 'none',
                              border: 'none',
                              borderBottom: '1px solid var(--sa-line)',
                              padding: '10px 4px',
                              cursor: canEdit ? 'pointer' : 'default',
                            }}
                          >
                            <span className="sa-row-strong" style={{ display: 'block', fontSize: 13 }}>
                              {option}
                              {option === DEFAULT_SITE_FONT ? ' · default' : ''}
                              {active ? ' ✓' : ''}
                            </span>
                            <span className="sa-muted" style={{ fontSize: 15 }}>
                              {FONT_PREVIEW_SAMPLE}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                <input
                  className="sa-input"
                  type="text"
                  value={value}
                  disabled={!canEdit || busy !== null}
                  onChange={(event) => setValues((prev) => ({ ...prev, [f.path]: event.target.value }))}
                />
              )}
              {f.hint ? <span className="sa-hint">{f.hint}</span> : null}
              {saved ? (
                <span className="sa-hint">
                  Last saved {new Date(saved.updatedAt).toLocaleString('en-IN')}
                  {saved.updatedBy ? ` by ${saved.updatedBy}` : ''}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {canEdit && dirty ? (
        <div className="sa-edit-actions" style={{ position: 'sticky', bottom: 0, background: 'var(--sa-card)', padding: 12, borderTop: '1px solid var(--sa-line)' }}>
          <span className="sa-note">Unsaved theme changes</span>
          <button
            className="sa-btn sa-btn-quiet"
            type="button"
            disabled={busy !== null}
            onClick={() => setValues(baseline)}
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
