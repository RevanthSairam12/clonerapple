'use client';

import { useState } from 'react';

/**
 * Sign-in form for the store admin panel. Posts to the store-admin login API;
 * the browser never stores any credential beyond the httpOnly session cookie
 * the server sets in response.
 */
export function StoreAdminLoginForm() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        setBusy(true);
        setError('');

        try {
          const res = await fetch('/api/store-admin/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
              totpCode: String(data.get('totpCode') ?? ''),
            }),
          });

          let json: { error?: string; mustChangePassword?: boolean } = {};
          try {
            json = (await res.json()) as { error?: string; mustChangePassword?: boolean };
          } catch {
            // non-JSON error body
          }

          if (res.ok) {
            // A temporary password lands on the profile page so it is replaced
            // before the person starts working.
            window.location.href = json.mustChangePassword
              ? '/store-admin/profile'
              : '/store-admin';
            return;
          }

          setError(json.error ?? 'Sign-in failed.');
          setBusy(false);
        } catch {
          setError('Network error — try again.');
          setBusy(false);
        }
      }}
    >
      <div className="sa-field">
        <label className="sa-label" htmlFor="sa-email">
          Email
        </label>
        <input
          id="sa-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="sa-input"
        />
      </div>

      <div className="sa-field">
        <label className="sa-label" htmlFor="sa-password">
          Password
        </label>
        <input
          id="sa-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="sa-input"
        />
      </div>

      <div className="sa-field">
        <label className="sa-label" htmlFor="sa-totp">
          Verification code <span className="sa-hint">(if enabled)</span>
        </label>
        <input
          id="sa-totp"
          name="totpCode"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={29}
          placeholder="6-digit code"
          className="sa-input"
        />
      </div>

      {error ? (
        <p className="sa-error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" className="sa-btn sa-btn-primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
