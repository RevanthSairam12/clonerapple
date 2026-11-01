'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StaffPasswordForm } from './StaffPasswordForm';
import { TotpPanel } from './TotpPanel';

import { ROLE_LABELS, type StaffMember, type StaffSession } from '@/lib/store-admin/staff-rules';
import type { TotpState } from '@/lib/store-admin/totp';

interface Props {
  profile: StaffMember;
  timeZone: string;
  sessions: StaffSession[];
  totp: TotpState;
}

function formatWhen(value: string, timeZone: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN', { timeZone });
}

/** Self-service account screen: name, phone, password and signed-in devices. */
export function ProfilePanel({ profile, sessions, timeZone, totp }: Props) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('profile');
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Your profile could not be saved.');
      }
      setMessage('Profile saved.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your profile could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(session: StaffSession) {
    if (!window.confirm('Sign this device out?')) return;
    await revokeRequest({ sessionId: session.id }, 'sessions');
  }

  async function revokeOthers() {
    if (!window.confirm('Sign out every other device?')) return;
    await revokeRequest({}, 'others');
  }

  async function revokeRequest(body: Record<string, unknown>, key: string) {
    setBusy(key);
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/profile/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The session could not be ended.');
      }
      setMessage(`${payload.sessionsRevoked ?? 0} session(s) signed out.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The session could not be ended.');
    } finally {
      setBusy(null);
    }
  }

  const others = sessions.filter((session) => !session.current);

  return (
    <div>
      <section className="sa-detail-card">
        <h2 className="sa-card-title">Your details</h2>
        <p className="sa-card-note">
          {profile.email} · {ROLE_LABELS[profile.role]} · joined {formatWhen(profile.createdAt, timeZone)}
        </p>
        <form className="sa-edit-form" onSubmit={saveProfile}>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Name</span>
              <input
                className="sa-input"
                value={name}
                maxLength={100}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Phone</span>
              <input
                className="sa-input"
                value={phone}
                maxLength={40}
                onChange={(event) => setPhone(event.target.value)}
              />
            </label>
          </div>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>
              {busy === 'profile' ? 'Saving…' : 'Save details'}
            </button>
            <span className="sa-note">Your role and status can only be changed by an owner.</span>
          </div>
        </form>
      </section>

      <section className="sa-detail-card">
        <h2 className="sa-card-title">Change password</h2>
        <StaffPasswordForm />
      </section>

      <TotpPanel state={totp} />

      <section className="sa-detail-card">
        <h2 className="sa-card-title">Signed-in devices</h2>
        <div className="sa-table-wrap">
          <table className="sa-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Signed in</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session, index) => (
                <tr key={session.id}>
                  <td>
                    {session.current ? 'This device' : `Device ${index + 1}`}
                    <span className="sa-row-sub sa-mono">{session.id}</span>
                  </td>
                  <td>{formatWhen(session.createdAt, timeZone)}</td>
                  <td>{formatWhen(session.expiresAt, timeZone)}</td>
                  <td>
                    {session.current ? (
                      <span className="sa-note">Current session</span>
                    ) : (
                      <button
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        type="button"
                        onClick={() => revoke(session)}
                        disabled={busy !== null}
                      >
                        Sign out
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sessions.length === 0 ? <p className="sa-empty">No active sessions.</p> : null}
        </div>
        {others.length > 0 ? (
          <div className="sa-edit-actions">
            <button
              className="sa-btn sa-btn-quiet"
              type="button"
              onClick={revokeOthers}
              disabled={busy !== null}
            >
              {busy === 'others' ? 'Signing out…' : `Sign out ${others.length} other device(s)`}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
