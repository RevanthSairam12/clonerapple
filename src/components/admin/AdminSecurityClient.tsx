'use client';

import { useState } from 'react';

/**
 * Interactive half of /admin/security — the TOTP enrollment/disable flow.
 * Lives in a client component (not an inline <script>) so it survives
 * client-side navigation from the sidebar; React never executes script tags
 * it renders on the client.
 */

type Phase = 'idle' | 'qr' | 'recovery';

export function AdminSecurityClient({ enabled }: { enabled: boolean }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let json: Record<string, unknown> = {};
      try {
        json = (await res.json()) as Record<string, unknown>;
      } catch {
        // non-JSON error body
      }
      return { ok: res.ok, json };
    } catch {
      return { ok: false, json: { error: 'Network error — try again.' } as Record<string, unknown> };
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const res = await post('/api/admin/totp/setup');
    if (!res.ok) {
      setError(String(res.json.error ?? 'Setup failed.'));
      return;
    }
    const url = String(res.json.url ?? '');
    setQr(String(res.json.qr ?? ''));
    setSecret(url.match(/secret=([A-Z2-7]+)/)?.[1] ?? '');
    setPhase('qr');
  }

  async function confirm(code: string) {
    const res = await post('/api/admin/totp/enable', { code });
    if (!res.ok) {
      setError(String(res.json.error ?? 'Enable failed.'));
      return;
    }
    setRecoveryCode(String(res.json.recoveryCode ?? ''));
    setPhase('recovery');
  }

  async function disable(code: string, password: string) {
    const res = await post('/api/admin/totp/disable', { code, password });
    if (!res.ok) {
      setError(String(res.json.error ?? 'Disable failed.'));
      return;
    }
    window.location.reload();
  }

  const errorBox =
    error && error !== '' ? (
      <p className="admin-login-error" role="alert">
        {error}
      </p>
    ) : null;

  if (enabled) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          void disable(
            (form.elements.namedItem('disable-code') as HTMLInputElement).value,
            (form.elements.namedItem('disable-password') as HTMLInputElement).value,
          );
        }}
        style={{ maxWidth: 360 }}
      >
        <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="disable-code">
          Current 6-digit code
        </label>
        <input id="disable-code" name="disable-code" className="admin-input" inputMode="numeric" maxLength={6} placeholder="123456" style={{ marginBottom: 12 }} />
        <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="disable-password">
          Password
        </label>
        <input id="disable-password" name="disable-password" type="password" className="admin-input" autoComplete="current-password" style={{ marginBottom: 16 }} />
        {errorBox}
        <button type="submit" className="admin-btn admin-btn-danger" disabled={busy}>
          {busy ? 'Turning off…' : 'Turn off 2FA'}
        </button>
      </form>
    );
  }

  if (phase === 'recovery') {
    return (
      <div>
        <p style={{ fontWeight: 700, color: '#1d1d1f', marginBottom: 6 }}>✅ Two-factor authentication enabled</p>
        <p className="admin-hint" style={{ marginBottom: 8 }}>
          Save this one-time recovery code now. It is the only way to sign in if you lose your
          device — it will never be shown again.
        </p>
        <code
          style={{
            display: 'inline-block',
            background: '#fff',
            border: '1px solid #d2d2d7',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: 1,
            userSelect: 'all',
            marginBottom: 16,
          }}
        >
          {recoveryCode}
        </code>
        <div>
          <button type="button" className="admin-btn admin-btn-secondary" onClick={() => window.location.reload()}>
            I saved my recovery code
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'qr') {
    return (
      <div>
        <ol className="admin-hint" style={{ paddingLeft: 20, marginBottom: 16 }}>
          <li>Scan the QR code with your authenticator app.</li>
          <li>
            Or enter this secret manually: <code style={{ userSelect: 'all', fontWeight: 700 }}>{secret}</code>
          </li>
          <li>Enter the 6-digit code the app shows to confirm.</li>
        </ol>
        <div style={{ background: '#fff', border: '1px solid #d2d2d7', borderRadius: 10, padding: 12, width: 'fit-content', marginBottom: 16 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code for your authenticator app" width={240} height={240} />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm((e.currentTarget.elements.namedItem('enable-code') as HTMLInputElement).value);
          }}
          style={{ maxWidth: 360 }}
        >
          <label className="admin-field-label" style={{ display: 'block', marginBottom: 6 }} htmlFor="enable-code">
            6-digit code from your app
          </label>
          <input id="enable-code" name="enable-code" className="admin-input" inputMode="numeric" maxLength={6} placeholder="123456" style={{ marginBottom: 16 }} />
          {errorBox}
          <button type="submit" className="admin-btn admin-btn-primary" disabled={busy}>
            {busy ? 'Verifying…' : 'Confirm & enable'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div>
      <button type="button" className="admin-btn admin-btn-primary" onClick={() => void start()} disabled={busy}>
        {busy ? 'Generating…' : 'Set up authenticator'}
      </button>
      {errorBox}
    </div>
  );
}
