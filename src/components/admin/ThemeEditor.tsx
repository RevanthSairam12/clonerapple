'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { FieldSchema } from '@/lib/admin/collections';

/** Defaults for the site-wide settings (what the site uses when unset). */
const THEME_DEFAULTS: Record<string, string> = {
  fontFamily: 'Inter',
  logoText: 'OPPO',
  appleCopyright: 'Copyright © 2026 Apple Inc. All rights reserved.',
  oppoPrimaryColor: '#006D2E',
  oppoGreenDark: '#005524',
  oppoGreenLight: '#00a040',
};

export function ThemeEditor({
  fields,
  initial,
}: {
  fields: FieldSchema[];
  initial: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ ...THEME_DEFAULTS, ...initial });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const showToast = useCallback((kind: 'success' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3200);
  }, []);

  const dirty = useMemo(
    () => fields.some((f) => (values[f.path] ?? '') !== (THEME_DEFAULTS[f.path] ?? '')),
    [fields, values],
  );

  const changedCount = useMemo(
    () => fields.filter((f) => (values[f.path] ?? '') !== (THEME_DEFAULTS[f.path] ?? '')).length,
    [fields, values],
  );

  if (typeof window !== 'undefined') {
    window.onbeforeunload = dirty ? () => 'You have unsaved changes.' : null;
  }

  const save = async () => {
    setStatus('saving');
    try {
      // send only changed keys — unchanged ones keep their current state
      const changed: Record<string, string> = {};
      for (const f of fields) {
        if ((values[f.path] ?? '') !== (THEME_DEFAULTS[f.path] ?? '')) {
          changed[f.path] = values[f.path] ?? '';
        }
      }
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: changed }),
      });
      if (!res.ok) throw new Error('Save failed.');
      setStatus('saved');
      showToast('success', 'Saved — theme changes are live.');
      router.refresh();
    } catch (e) {
      setStatus('error');
      showToast('error', e instanceof Error ? e.message : 'Save failed.');
    }
  };

  const resetField = async (key: string) => {
    if (!confirm(`Revert "${key}" to its default?`)) return;
    try {
      const res = await fetch(`/api/admin/settings?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Revert failed.');
      setValues((prev) => ({ ...prev, [key]: THEME_DEFAULTS[key] ?? '' }));
      showToast('success', 'Reverted.');
      router.refresh();
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Revert failed.');
    }
  };

  const resetAll = async () => {
    if (!confirm('Reset ALL theme settings to defaults?')) return;
    setStatus('saving');
    try {
      for (const f of fields) {
        if (initial[f.path] !== undefined) {
          await fetch(`/api/admin/settings?key=${encodeURIComponent(f.path)}`, { method: 'DELETE' });
        }
      }
      setValues({ ...THEME_DEFAULTS });
      setStatus('idle');
      showToast('success', 'All theme settings reset.');
      router.refresh();
    } catch (e) {
      setStatus('error');
      showToast('error', e instanceof Error ? e.message : 'Reset failed.');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Theme &amp; Fonts</h1>
          <p style={{ margin: '5px 0 0', fontSize: 13.5, color: '#6e6e73' }}>
            Site-wide settings: fonts, colors, logo text and the footer copyright — applied across every page.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 9 }}>
          {Object.values(initial).some((v) => v) ? (
            <button type="button" className="admin-btn admin-btn-danger" onClick={resetAll}>
              ↺ Reset all
            </button>
          ) : null}
        </div>
      </div>

      <div className="admin-notice admin-notice-info">
        <span>🎨</span>
        <span>
          Values pre-filled with the current site defaults. Fields matching the default have no
          effect until changed{changedCount > 0 ? ` — ${changedCount} changed` : ''}.
        </span>
      </div>

      <div className="admin-theme-grid">
        {fields.map((f) => {
          const value = values[f.path] ?? '';
          const isDefault = value === (THEME_DEFAULTS[f.path] ?? '');
          return (
            <div key={f.path} className="admin-card">
              <div className="admin-field-label-row" style={{ marginBottom: 6 }}>
                <label className="admin-field-label">
                  {f.label} {!isDefault ? <span className="admin-field-changed">• edited</span> : null}
                </label>
                {!isDefault ? (
                  <button type="button" className="admin-field-reset" onClick={() => resetField(f.path)}>
                    reset
                  </button>
                ) : null}
              </div>
              {f.type === 'color' ? (
                <div className="admin-color-row">
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.path]: e.target.value }))}
                    className="admin-color-swatch"
                    aria-label={f.label}
                  />
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => setValues((prev) => ({ ...prev, [f.path]: e.target.value }))}
                    className="admin-input"
                  />
                </div>
              ) : (
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.path]: e.target.value }))}
                  className={`admin-input${!isDefault ? ' changed' : ''}`}
                />
              )}
              {f.hint ? <p className="admin-field-default" style={{ marginTop: 6 }}>{f.hint}</p> : null}
            </div>
          );
        })}
      </div>

      {dirty ? (
        <div className="admin-savebar">
          <span className="admin-savebar-text">
            <span className="admin-savebar-dot" />
            Unsaved theme changes
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => setValues({ ...THEME_DEFAULTS, ...initial })}
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
