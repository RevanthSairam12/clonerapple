'use client';

import { useState } from 'react';
import { validatePasswordChange } from '@/lib/store-admin/password-rules';

export function StaffPasswordForm({ forced = false }: { forced?: boolean }) {
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const check = validatePasswordChange(values);
  const liveError = values.confirmPassword && values.newPassword !== values.confirmPassword
    ? 'The two new passwords do not match'
    : values.newPassword && !check.ok ? check.error : '';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!check.ok) { setError(check.error); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/store-admin/profile/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error || 'The password could not be changed.'); return; }
      setValues({ currentPassword: '', newPassword: '', confirmPassword: '' });
      if (forced) window.location.replace('/store-admin?passwordChanged=1');
      else setMessage('Password changed. Other devices were signed out.');
    } catch { setError('The password could not be changed. Please try again.'); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="sa-form-grid">
        {([
          ['currentPassword', forced ? 'Current (temporary) password' : 'Current password'],
          ['newPassword', 'New password'], ['confirmPassword', 'Confirm new password'],
        ] as const).map(([key, label]) => (
          <div className="sa-field" key={key}>
            <label className="sa-label" htmlFor={`staff-${key}`}>{label}</label>
            <input id={`staff-${key}`} className="sa-input" type={visible[key] ? 'text' : 'password'}
              autoComplete={key === 'currentPassword' ? 'current-password' : 'new-password'}
              value={values[key]} required aria-describedby="staff-password-help staff-password-error"
              aria-invalid={Boolean(error || liveError)}
              onChange={(event) => { setValues({ ...values, [key]: event.target.value }); setError(''); }} />
            <button type="button" className="sa-btn sa-btn-quiet sa-btn-small" aria-controls={`staff-${key}`}
              aria-pressed={Boolean(visible[key])} onClick={() => setVisible({ ...visible, [key]: !visible[key] })}>
              {visible[key] ? 'Hide' : 'Show'} {label.toLowerCase()}
            </button>
          </div>
        ))}
      </div>
      <p id="staff-password-help" className="sa-hint">At least 8 characters, at most 72 UTF-8 bytes, and different from your current password.</p>
      <p id="staff-password-error" className="sa-error" role="alert">{error || liveError}</p>
      {message ? <p className="sa-notice" role="status">{message}</p> : null}
      <button className="sa-btn sa-btn-primary" type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change password'}</button>
    </form>
  );
}
