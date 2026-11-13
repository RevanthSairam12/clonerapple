'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { TotpState } from '@/lib/store-admin/totp';

interface Props {
  state: TotpState;
}

interface SetupPieces {
  secret: string;
  otpauthUrl: string;
  qr: string;
}

/** Group a base32 key in fours so it is easy to type into an authenticator app. */
function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Two-factor authentication for the signed-in staff account.
 *
 * The QR code, setup key and backup codes are shown once and never returned
 * again: everything here lives in component state only, nothing is written to
 * storage or the URL.
 */
export function TotpPanel({ state }: Props) {
  const router = useRouter();
  const [setup, setSetup] = useState<SetupPieces | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function beginSetup() {
    setBusy('setup');
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/profile/totp/setup', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Setup could not be started.');
      }
      setBackupCodes(null);
      setConfirmCode('');
      setSetup({ secret: payload.secret, otpauthUrl: payload.otpauthUrl, qr: payload.qr });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Setup could not be started.');
    } finally {
      setBusy(null);
    }
  }

  async function confirmSetup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('confirm');
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/profile/totp/enable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: confirmCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'That code was not accepted.');
      }
      setSetup(null);
      setConfirmCode('');
      setBackupCodes(Array.isArray(payload.backupCodes) ? payload.backupCodes : []);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That code was not accepted.');
    } finally {
      setBusy(null);
    }
  }

  async function disable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm('Turn off two-factor authentication for your account?')) return;
    setBusy('disable');
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/profile/totp/disable', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, code: disableCode }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Two-factor could not be turned off.');
      }
      setPassword('');
      setDisableCode('');
      setBackupCodes(null);
      setMessage('Two-factor authentication is now off for your account.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Two-factor could not be turned off.');
    } finally {
      setBusy(null);
    }
  }

  async function copyCodes(codes: string[]) {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setMessage('Backup codes copied to the clipboard.');
    } catch {
      setError('Copy failed. Select the codes and save them yourself.');
    }
  }

  return (
    <section id="security" className="sa-detail-card">
      <h2 className="sa-card-title">Two-factor authentication</h2>
      <p className="sa-card-note">
        Adds a 6-digit code from an authenticator app to your password. Recommended for every staff
        account; ask an owner to reset it if you lose your device.
      </p>

      {error ? <p className="sa-error">{error}</p> : null}
      {message ? <p className="sa-success">{message}</p> : null}

      {backupCodes ? (
        <div>
          <p className="sa-note">
            Save these {backupCodes.length} one-time backup codes somewhere safe. Each works once, and
            they will not be shown again.
          </p>
          <ol className="sa-mono" style={{ columns: 2, margin: '12px 0' }}>
            {backupCodes.map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ol>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-quiet" type="button" onClick={() => copyCodes(backupCodes)}>
              Copy codes
            </button>
            <button className="sa-btn sa-btn-primary" type="button" onClick={() => setBackupCodes(null)}>
              I have saved them
            </button>
          </div>
        </div>
      ) : setup ? (
        <div>
          <p className="sa-note">
            Scan this code with your authenticator app, or enter the setup key by hand, then type the
            6-digit code the app shows.
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start', margin: '12px 0' }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- one-time data URI, never cached */}
            <img src={setup.qr} alt="Two-factor setup QR code" width={180} height={180} />
            <div>
              <span className="sa-label">Setup key</span>
              <p className="sa-mono" style={{ margin: '4px 0', letterSpacing: '0.08em' }}>
                {groupKey(setup.secret)}
              </p>
              <span className="sa-hint">Keep this key private until the code is confirmed.</span>
            </div>
          </div>
          <form className="sa-edit-form" onSubmit={confirmSetup}>
            <label className="sa-field">
              <span className="sa-label">Code from the app</span>
              <input
                className="sa-input sa-input-small"
                value={confirmCode}
                onChange={(event) => setConfirmCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                required
              />
            </label>
            <div className="sa-edit-actions">
              <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>
                {busy === 'confirm' ? 'Checking…' : 'Turn on two-factor'}
              </button>
              <button
                className="sa-btn sa-btn-quiet"
                type="button"
                onClick={() => {
                  setSetup(null);
                  setConfirmCode('');
                  resetFeedback();
                }}
                disabled={busy !== null}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : state.enabled ? (
        <div>
          <p className="sa-success">
            Two-factor authentication is on. {state.backupCodesRemaining} backup code
            {state.backupCodesRemaining === 1 ? '' : 's'} left.
          </p>
          <form className="sa-edit-form" onSubmit={disable}>
            <p className="sa-card-note">
              To turn it off, confirm your password and a current authenticator or backup code.
            </p>
            <div className="sa-control-grid">
              <label className="sa-field">
                <span className="sa-label">Current password</span>
                <input
                  className="sa-input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="sa-field">
                <span className="sa-label">Authenticator or backup code</span>
                <input
                  className="sa-input"
                  value={disableCode}
                  onChange={(event) => setDisableCode(event.target.value.trim())}
                  autoComplete="one-time-code"
                  required
                />
              </label>
            </div>
            <div className="sa-edit-actions">
              <button className="sa-btn sa-btn-danger" type="submit" disabled={busy !== null}>
                {busy === 'disable' ? 'Turning off…' : 'Turn off two-factor'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div>
          <p className="sa-note">
            {state.pending
              ? 'A setup was started but never confirmed. Start again to get a fresh key.'
              : 'Two-factor authentication is off for your account.'}
          </p>
          <div className="sa-edit-actions">
            <button
              className="sa-btn sa-btn-primary"
              type="button"
              onClick={beginSetup}
              disabled={busy !== null}
            >
              {busy === 'setup' ? 'Preparing…' : 'Set up two-factor'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
