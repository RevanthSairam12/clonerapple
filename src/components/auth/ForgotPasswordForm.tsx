'use client';

import { useCallback, useState } from 'react';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [submittedMessage, setSubmittedMessage] = useState('');

  const handleSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError('');

      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: string;
        };

        if (res.ok) {
          setSubmittedMessage(
            json.message ??
              'If an account exists for that email address, we have sent a password reset link.',
          );
        } else {
          setError(json.error ?? 'Unable to process request right now.');
        }
      } catch {
        setError('Network error — please try again.');
      } finally {
        setBusy(false);
      }
    },
    [busy, email],
  );

  if (submittedMessage) {
    return (
      <div className="auth-success" role="status">
        <div className="auth-success-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="auth-success-title">Check your email</h1>
        <p className="auth-success-text">{submittedMessage}</p>
        <div className="auth-switch" style={{ marginTop: 20 }}>
          <a href="/auth" className="auth-switch-link">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1 className="auth-heading">Forgot password</h1>
      <p className="auth-subtext">
        Enter the email address for your account and we&apos;ll send you a link to reset your password.
      </p>

      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <div className="auth-field">
          <label className="auth-label" htmlFor="forgot-email">
            Email address
          </label>
          <input
            id="forgot-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            className="auth-input"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        <button
          type="submit"
          className="auth-submit"
          disabled={busy || !email.trim()}
          aria-busy={busy}
        >
          {busy && <span className="auth-submit-spinner" aria-hidden="true" />}
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <div className="auth-switch">
        Remembered your password?{' '}
        <a href="/auth" className="auth-switch-link">
          Sign in
        </a>
      </div>
    </>
  );
}

