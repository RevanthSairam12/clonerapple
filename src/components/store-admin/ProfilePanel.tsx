'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ROLE_LABELS, type StaffMember, type StaffSession } from '@/lib/store-admin/staff-rules';

interface Props {
  profile: StaffMember;
  sessions: StaffSession[];
}

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN');
}

/** Self-service account screen: name, phone, password and signed-in devices. */
export function ProfilePanel({ profile, sessions }: Props) {
  const router = useRouter();
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy('password');
    try {
      const response = await fetch('/api/store-admin/profile/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'The password could not be changed.');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(
        payload.sessionsRevoked
          ? `Password changed. ${payload.sessionsRevoked} other session(s) were signed out.`
          : 'Password changed.',
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The password could not be changed.');
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
      {profile.mustChangePassword ? (
        <p className="sa-notice" role="status">
          You are signed in with a temporary password. Choose a new one below — the rest of the
          panel stays available, but the password should be changed now.
        </p>
      ) : null}

      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      <section className="sa-detail-card">
        <h2 className="sa-card-title">Your details</h2>
        <p className="sa-card-note">
          {profile.email} · {ROLE_LABELS[profile.role]} · joined {formatWhen(profile.createdAt)}
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
        <form className="sa-edit-form" onSubmit={savePassword}>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Current password</span>
              <input
                className="sa-input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                required
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">New password</span>
              <input
                className="sa-input"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                required
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <span className="sa-hint">At least 8 characters and at most 72 bytes.</span>
            </label>
            <label className="sa-field">
              <span className="sa-label">Confirm new password</span>
              <input
                className="sa-input"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                required
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          </div>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>
              {busy === 'password' ? 'Changing…' : 'Change password'}
            </button>
            <span className="sa-note">Other devices are signed out after a password change.</span>
          </div>
        </form>
      </section>

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
                  <td>{formatWhen(session.createdAt)}</td>
                  <td>{formatWhen(session.expiresAt)}</td>
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
