'use client';

import { useState, useCallback, useMemo } from 'react';

import { safeRedirectPath } from '@/lib/auth/redirect';
import {
  passwordByteLength,
  PASSWORD_MAX_BYTES,
} from '@/lib/auth/validation';

export interface AuthFormProps {
  initialMode?: 'signin' | 'signup';
  redirectTo?: string;
}

/**
 * Clean, minimal Sign In / Sign Up form.
 * Tab-based switcher between email/phone (sign-in) and sign-in/sign-up modes.
 * Matches the Labby-style clean white card aesthetic.
 */
export function AuthForm({ initialMode = 'signin', redirectTo = '/' }: AuthFormProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [inputMode, setInputMode] = useState<'email' | 'phone'>('email');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');

  const isForCheckout = redirectTo.includes('/checkout');

  const passwordRules = useMemo(() => [
    { label: '8+ characters', valid: password.length >= 8 },
    { label: 'A number', valid: /\d/.test(password) },
    { label: 'Uppercase', valid: /[A-Z]/.test(password) },
    { label: 'Special char', valid: /[^A-Za-z0-9]/.test(password) },
  ], [password]);

  const allRulesValid = passwordRules.every(r => r.valid);
  const passwordTooLong = passwordByteLength(password) > PASSWORD_MAX_BYTES;

  const switchMode = useCallback(() => {
    setMode(m => m === 'signin' ? 'signup' : 'signin');
    setError('');
    setPassword('');
    setShowPassword(false);
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError('');

    // Only a same-origin, relative path is ever used as the destination.
    const targetUrl = safeRedirectPath(redirectTo);

    try {
      if (mode === 'signin') {
        const res = await fetch('/api/auth/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setSuccess(true);
          setTimeout(() => { window.location.href = targetUrl; }, 900);
        } else {
          setError(json.error ?? 'Sign in failed.');
          setBusy(false);
        }
      } else {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
            firstName: String(data.get('firstName') ?? ''),
            lastName: String(data.get('lastName') ?? ''),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setSuccess(true);
          setTimeout(() => { window.location.href = targetUrl; }, 900);
        } else {
          setError(json.error ?? 'Sign up failed.');
          setBusy(false);
        }
      }
    } catch {
      setError('Network error — please try again.');
      setBusy(false);
    }
  }, [mode, redirectTo]);

  if (success) {
    return (
      <div className="auth-success">
        <div className="auth-success-icon">
          <svg viewBox="0 0 24 24">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2 className="auth-success-title">
          {mode === 'signin' ? 'Welcome back!' : 'Account created!'}
        </h2>
        <p className="auth-success-text">
          {isForCheckout ? 'Taking you to checkout…' : 'Redirecting you now…'}
        </p>
      </div>
    );
  }

  return (
    <>
      {isForCheckout && (
        <div style={{
          marginBottom: 16,
          padding: '8px 14px',
          background: 'rgba(0, 113, 227, 0.08)',
          borderRadius: 10,
          border: '1px solid rgba(0, 113, 227, 0.2)',
          fontSize: 13,
          color: '#0071e3',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
          </svg>
          <span>{mode === 'signin' ? 'Sign in to continue to Checkout' : 'Create an account to complete your purchase'}</span>
        </div>
      )}

      <h1 className="auth-heading">
        {mode === 'signin' ? 'Sign up or log in' : 'Create your account'}
      </h1>

      {/* Tab switcher — email / phone for sign-in. DISABLED until phone auth
          exists: with only "By email" reachable it is a one-option control,
          and the "By phone" tab would flip `inputMode` to a mode no backend
          can service. Whole block kept verbatim — re-enable by uncommenting.

      {mode === 'signin' && (
        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${inputMode === 'email' ? 'active' : ''}`}
            onClick={() => setInputMode('email')}
          >
            By email
          </button>
          <button
            type="button"
            className={`auth-tab ${inputMode === 'phone' ? 'active' : ''}`}
            onClick={() => setInputMode('phone')}
          >
            By phone
          </button>
        </div>
      )}
      */}

      {error && (
        <div className="auth-error" role="alert">{error}</div>
      )}

      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {mode === 'signup' && (
          <div className="auth-field-row">
            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-firstName">
                First name
              </label>
              <input
                id="auth-firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
                className="auth-input"
                placeholder="First name"
              />
            </div>
            <div className="auth-field">
              <label className="auth-label" htmlFor="auth-lastName">
                Last name
              </label>
              <input
                id="auth-lastName"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
                className="auth-input"
                placeholder="Last name"
              />
            </div>
          </div>
        )}

        {/* Email or Phone input */}
        <div className="auth-field">
          {mode === 'signin' && inputMode === 'phone' ? (
            <>
              <label className="auth-label" htmlFor="auth-phone">
                Phone number
              </label>
              <input
                id="auth-phone"
                name="email"
                type="tel"
                autoComplete="tel"
                required
                className="auth-input"
                placeholder="Phone number"
              />
            </>
          ) : (
            <>
              <label className="auth-label" htmlFor="auth-email">
                Email
              </label>
              <input
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                className="auth-input"
                placeholder="Email"
              />
            </>
          )}
        </div>

        {/* Password field */}
        <div className="auth-field">
          <label className="auth-label" htmlFor="auth-password">
            Password
          </label>
          <div className="auth-password-wrapper">
            <input
              id="auth-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              aria-invalid={passwordTooLong || undefined}
              aria-describedby={
                mode === 'signup' && (password.length > 0 || passwordTooLong)
                  ? 'auth-password-rules'
                  : undefined
              }
              className="auth-input"
              placeholder="Password"
              value={mode === 'signup' ? password : undefined}
              onChange={mode === 'signup' ? (e) => setPassword(e.target.value) : undefined}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {mode === 'signup' && (password.length > 0 || passwordTooLong) && (
            <div className="auth-password-rules" id="auth-password-rules">
              {passwordRules.map((rule) => (
                <div key={rule.label} className={`auth-password-rule ${rule.valid ? 'valid' : ''}`}>
                  <span className="auth-password-rule-dot" />
                  {rule.label}
                </div>
              ))}
              <div className={`auth-password-rule ${passwordTooLong ? 'invalid' : 'valid'}`}>
                <span className="auth-password-rule-dot" />
                At most {PASSWORD_MAX_BYTES} bytes
              </div>
            </div>
          )}
        </div>

        <button
          type="submit"
          className="auth-submit"
          disabled={busy || (mode === 'signup' && password.length > 0 && (!allRulesValid || passwordTooLong))}
          aria-busy={busy}
        >
          {busy && <span className="auth-submit-spinner" />}
          {busy ? 'Please wait…' : 'Continue'}
        </button>
      </form>

      {/* App download row (sign-in only) */}
      {mode === 'signin' && (
        <div className="auth-app-row">
          <div>
            <p>To use as a customer, <strong style={{ color: '#1d1d1f', cursor: 'pointer' }}>Download the app</strong>.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Google Play badge */}
              <svg className="auth-app-badge" viewBox="0 0 135 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="135" height="40" rx="6" fill="#1d1d1f"/>
                <text x="67" y="16" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="system-ui" fontWeight="400">GET IT ON</text>
                <text x="67" y="28" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="system-ui" fontWeight="700">Google Play</text>
              </svg>
              {/* AppGallery badge */}
              <svg className="auth-app-badge" viewBox="0 0 135 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="135" height="40" rx="6" fill="#e4002b"/>
                <text x="67" y="16" textAnchor="middle" fill="#fff" fontSize="7" fontFamily="system-ui" fontWeight="400">EXPLORE IT ON</text>
                <text x="67" y="28" textAnchor="middle" fill="#fff" fontSize="11" fontFamily="system-ui" fontWeight="700">AppGallery</text>
              </svg>
            </div>
          </div>
        </div>
      )}

      <div className="auth-switch">
        {mode === 'signin' ? (
          <>
            Don&apos;t have an account?{' '}
            <button type="button" className="auth-switch-link" onClick={switchMode}>
              Create one
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button type="button" className="auth-switch-link" onClick={switchMode}>
              Sign in
            </button>
          </>
        )}
      </div>
    </>
  );
}
