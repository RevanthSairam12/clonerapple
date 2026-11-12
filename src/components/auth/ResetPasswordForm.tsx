'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordByteLength,
  validatePassword,
} from '@/lib/auth/validation';

function EyeToggleIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function ResetPasswordForm() {
  const [token, setToken] = useState<string>('');
  const [tokenChecked, setTokenChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expiredOrInvalid, setExpiredOrInvalid] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = (params.get('token') ?? '').trim();
    if (urlToken) {
      setToken(urlToken);
    } else {
      setExpiredOrInvalid(true);
      setError('This link is invalid or has expired.');
    }
    if (window.location.search) {
      window.history.replaceState(null, '', '/reset-password');
    }
    setTokenChecked(true);
  }, []);

  const passwordTooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      setError('');

      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      const check = validatePassword(password);
      if (!check.ok) {
        setError(check.error);
        return;
      }

      setBusy(true);
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password, confirmPassword }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          redirectTo?: string;
          error?: string;
        };

        if (res.ok && json.ok) {
          window.location.href = json.redirectTo ?? '/auth?reset=success';
          return;
        }

        const msg = json.error ?? 'Unable to reset password.';
        setError(msg);
        if (msg.toLowerCase().includes('invalid or has expired')) {
          setExpiredOrInvalid(true);
        }
        setBusy(false);
      } catch {
        setError('Network error — please try again.');
        setBusy(false);
      }
    },
    [busy, confirmPassword, password, token],
  );

  if (tokenChecked && expiredOrInvalid) {
    return (
      <>
        <h1 className="auth-heading">Reset link expired</h1>
        <div className="auth-error" role="alert">
          {error || 'This link is invalid or has expired.'}
        </div>
        <a
          href="/forgot-password"
          className="auth-submit"
          style={{ textDecoration: 'none', marginTop: 12 }}
        >
          Request a new link
        </a>
        <div className="auth-switch">
          <a href="/auth" className="auth-switch-link">
            Back to sign in
          </a>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="auth-heading">Choose a new password</h1>
      <p className="auth-subtext">
        Enter a new password for your account ({PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_BYTES} bytes).
      </p>

      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="reset-password">
            New password
          </label>
          <div className="auth-password-wrapper">
            <input
              id="reset-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              aria-invalid={passwordTooLong || undefined}
              className="auth-input"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide new password' : 'Show new password'}
            >
              <EyeToggleIcon visible={showPassword} />
            </button>
          </div>
        </div>

        <div className="auth-field">
          <label className="auth-label" htmlFor="reset-confirm-password">
            Confirm new password
          </label>
          <div className="auth-password-wrapper">
            <input
              id="reset-confirm-password"
              name="confirmPassword"
              type={showConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              aria-invalid={mismatch || undefined}
              className="auth-input"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowConfirm((v) => !v)}
              aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
            >
              <EyeToggleIcon visible={showConfirm} />
            </button>
          </div>
          {mismatch && (
            <p className="auth-error" role="alert" style={{ marginTop: 6, marginBottom: 0 }}>
              Passwords do not match.
            </p>
          )}
        </div>

        <button
          type="submit"
          className="auth-submit"
          disabled={busy || !tokenChecked}
          aria-busy={busy}
        >
          {busy && <span className="auth-submit-spinner" aria-hidden="true" />}
          {busy ? 'Updating password…' : 'Reset password'}
        </button>
      </form>
    </>
  );
}

