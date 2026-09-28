'use client';

import { useState } from 'react';

/**
 * Sign-in form for the admin panel. A client component (not an inline
 * <script>) so React runs the handlers reliably regardless of how the page
 * is reached; submits email + password (+ TOTP code when 2FA is on) to
 * /api/admin/auth/login.
 */
export function AdminLoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        setError('');
        try {
          const res = await fetch('/api/admin/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
              totpCode: String(data.get('totpCode') ?? ''),
            }),
          });
          let json: { error?: string } = {};
          try {
            json = (await res.json()) as { error?: string };
          } catch {
            // non-JSON error body
          }
          if (res.ok) {
            window.location.href = '/admin';
          } else {
            setError(json.error ?? 'Sign-in failed.');
            setBusy(false);
          }
        } catch {
          setError('Network error — try again.');
          setBusy(false);
        }
      }}
    >
      <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="email">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        className="admin-input"
        style={{ marginBottom: 16 }}
      />
      <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        className="admin-input"
        style={{ marginBottom: 16 }}
      />
      <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="totpCode">
        Verification code <span style={{ fontWeight: 400, color: '#6e6e73' }}>(only if 2FA is enabled)</span>
      </label>
      <input
        id="totpCode"
        name="totpCode"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={29}
        placeholder="6-digit code"
        className="admin-input"
        style={{ marginBottom: 20 }}
      />
      {error ? (
        <p className="admin-login-error" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="admin-btn admin-btn-primary"
        disabled={busy}
        style={{ width: '100%', justifyContent: 'center', padding: '11px 0', fontSize: 15 }}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
