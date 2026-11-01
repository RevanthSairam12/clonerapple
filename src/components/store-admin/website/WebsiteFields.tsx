'use client';

import { useRef, useState } from 'react';

import type { FieldSchema } from '@/lib/website/collections';

/* --------------------------------------------------------------- upload */

/**
 * Shared upload for image and video fields.
 *
 * Uploads go through the Store Admin media library (POST /api/store-admin/
 * media), so every website image is content-sniffed, size-checked, audited
 * and listed in the same library the catalogue uses. The stored URL is
 * /api/media/<id>, which resolves without a staff session.
 */
function useMediaUpload(onChange: (url: string) => void, disabled: boolean) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (disabled) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      const response = await fetch('/api/store-admin/media', { method: 'POST', body: form });
      const payload = await response.json().catch(() => ({}));
      const url = payload?.media?.url;
      if (!response.ok || typeof url !== 'string') {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Upload failed.');
      }
      onChange(url);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return { fileRef, uploading, error, upload };
}

/* ---------------------------------------------------------------- fields */

function FieldFrame({
  label,
  changed,
  hint,
  error,
  onReset,
  resetTitle,
  children,
}: {
  label: string;
  changed: boolean;
  hint?: string;
  error?: string | null;
  onReset?: () => void;
  resetTitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sa-field sa-field-wide">
      <div className="sa-edit-head">
        <span className="sa-label">
          {label}
          {changed ? <span className="sa-chip sa-chip-count">edited</span> : null}
        </span>
        {changed && onReset ? (
          <button className="sa-btn sa-btn-small sa-btn-quiet" type="button" onClick={onReset} title={resetTitle}>
            Reset field
          </button>
        ) : null}
      </div>
      {children}
      {hint ? <span className="sa-hint">{hint}</span> : null}
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function ImageField({
  field,
  value,
  currentArt,
  disabled,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  /** Artwork the site shows today (display-only preview when nothing saved). */
  currentArt?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { fileRef, uploading, error, upload } = useMediaUpload(onChange, disabled);
  const preview = value || currentArt;

  return (
    <FieldFrame label={field.label} changed={false} hint={field.hint} error={error}>
      {preview ? (
        <div className="sa-media-thumb" style={{ maxWidth: 280, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--sa-line)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an uploaded file */}
          <img src={preview} alt="" />
        </div>
      ) : null}
      <div className="sa-inline-actions" style={{ alignItems: 'center' }}>
        <input
          className="sa-input"
          style={{ flex: 1, minWidth: 220 }}
          type="text"
          value={value}
          placeholder={currentArt && !value ? 'Keep current image' : 'https://… or upload →'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="sa-btn sa-btn-quiet sa-btn-small"
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
      {!value && currentArt ? (
        <span className="sa-hint">Showing the image the site uses now. Upload to replace it; leave blank to keep it.</span>
      ) : null}
    </FieldFrame>
  );
}

export function VideoField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { fileRef, uploading, error, upload } = useMediaUpload(onChange, disabled);

  return (
    <FieldFrame label={field.label} changed={false} hint={field.hint} error={error}>
      {value ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- staff preview
        <video src={value} controls muted playsInline style={{ maxWidth: 280, borderRadius: 8 }} />
      ) : null}
      <div className="sa-inline-actions" style={{ alignItems: 'center' }}>
        <input
          className="sa-input"
          style={{ flex: 1, minWidth: 220 }}
          type="text"
          value={value}
          placeholder="https://… or upload →"
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="sa-btn sa-btn-quiet sa-btn-small"
          type="button"
          disabled={disabled || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/webm,video/mp4,video/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
    </FieldFrame>
  );
}

export function BooleanField({
  field,
  value,
  defaultValue,
  disabled,
  onChange,
}: {
  field: FieldSchema;
  value: unknown;
  defaultValue: unknown;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const checked = typeof value === 'boolean' ? value : defaultValue !== false;
  return (
    <div className="sa-field sa-field-wide">
      <label className="sa-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {field.label} — {checked ? 'shown on the site' : 'hidden from the site'}
      </label>
      {field.hint ? <span className="sa-hint">{field.hint}</span> : null}
    </div>
  );
}

export function SelectField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: FieldSchema;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <FieldFrame label={field.label} changed={false} hint={field.hint}>
      <select
        className="sa-input"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}
