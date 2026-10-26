'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ROLE_LABELS,
  ROLE_SUMMARIES,
  STAFF_ROLES,
  type StaffMember,
} from '@/lib/store-admin/staff-rules';

interface Props {
  staff: StaffMember[];
  canManage: boolean;
  currentAdminId: string;
}

interface CreateDraft {
  name: string;
  email: string;
  phone: string;
  role: 'store_owner' | 'store_admin' | 'store_viewer';
}

interface EditDraft {
  id: string;
  name: string;
  phone: string;
  role: StaffMember['role'];
}

interface CredentialNotice {
  name: string;
  email: string;
  password: string;
  context: 'created' | 'reset';
}

const EMPTY_CREATE: CreateDraft = {
  name: '',
  email: '',
  phone: '',
  role: 'store_admin',
};

function formatWhen(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-IN');
}

/**
 * Staff management. Owner-only writes; admins can read the list. A temporary
 * password is shown once, in this component, and never stored in the browser.
 */
export function StaffManager({ staff, canManage, currentAdminId }: Props) {
  const router = useRouter();
  const [create, setCreate] = useState<CreateDraft>(EMPTY_CREATE);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [credential, setCredential] = useState<CredentialNotice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function resetFeedback() {
    setError(null);
    setMessage(null);
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('create');
    resetFeedback();
    try {
      const response = await fetch('/api/store-admin/staff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(create),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'The account could not be created.',
        );
      }
      const created = payload.staff as StaffMember;
      setCredential({
        name: created.name,
        email: created.email,
        password: String(payload.temporaryPassword ?? ''),
        context: 'created',
      });
      setCreate(EMPTY_CREATE);
      setMessage('Account created. Copy the temporary password now — it is not shown again.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The account could not be created.');
    } finally {
      setBusy(null);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    setBusy(`edit:${edit.id}`);
    resetFeedback();
    try {
      const response = await fetch(`/api/store-admin/staff/${encodeURIComponent(edit.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: edit.name, phone: edit.phone, role: edit.role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'The account could not be saved.',
        );
      }
      setEdit(null);
      setMessage(
        payload.sessionsRevoked
          ? 'Saved. That account was signed out because its role changed.'
          : 'Saved.',
      );
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The account could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function toggleActive(member: StaffMember) {
    const next = !member.isActive;
    const prompt = next
      ? `Reactivate ${member.name}?`
      : `Deactivate ${member.name}? Every session is signed out immediately.`;
    if (!window.confirm(prompt)) return;

    setBusy(`active:${member.id}`);
    resetFeedback();
    try {
      const response = await fetch(`/api/store-admin/staff/${encodeURIComponent(member.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: member.name,
          phone: member.phone,
          role: member.role,
          isActive: next,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'The account could not be updated.',
        );
      }
      setMessage(next ? 'Account reactivated.' : 'Account deactivated and signed out.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The account could not be updated.');
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword(member: StaffMember) {
    if (
      !window.confirm(
        `Reset ${member.name}'s password? They are signed out everywhere and must choose a new password at next sign-in.`,
      )
    ) {
      return;
    }
    setBusy(`password:${member.id}`);
    resetFeedback();
    try {
      const response = await fetch(
        `/api/store-admin/staff/${encodeURIComponent(member.id)}/password`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'The password could not be reset.',
        );
      }
      setCredential({
        name: member.name,
        email: member.email,
        password: String(payload.temporaryPassword ?? ''),
        context: 'reset',
      });
      setMessage('Password reset. Copy the temporary password now — it is not shown again.');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The password could not be reset.');
    } finally {
      setBusy(null);
    }
  }

  async function signOutEverywhere(member: StaffMember) {
    if (!window.confirm(`Sign ${member.name} out of every device?`)) return;
    setBusy(`sessions:${member.id}`);
    resetFeedback();
    try {
      const response = await fetch(
        `/api/store-admin/staff/${encodeURIComponent(member.id)}/sessions`,
        { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === 'string' ? payload.error : 'Sessions could not be revoked.',
        );
      }
      setMessage(`${payload.sessionsRevoked ?? 0} session(s) signed out.`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sessions could not be revoked.');
    } finally {
      setBusy(null);
    }
  }

  async function copyPassword() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.password);
      setMessage('Temporary password copied.');
    } catch {
      setMessage('Copy failed — select the password and copy it manually.');
    }
  }

  return (
    <div>
      {error ? <p className="sa-error" role="alert">{error}</p> : null}
      {message ? <p className="sa-success" role="status">{message}</p> : null}

      {credential ? (
        <div className="sa-notice" role="status">
          <strong>
            {credential.context === 'created' ? 'Temporary password' : 'New temporary password'} for{' '}
            {credential.name}
          </strong>
          <p className="sa-note">
            Hand this to {credential.email}. It is shown once, is not stored anywhere, and must be
            changed at first sign-in.
          </p>
          <p className="sa-mono sa-revealed">{credential.password}</p>
          <div className="sa-inline-actions">
            <button className="sa-btn sa-btn-small sa-btn-quiet" type="button" onClick={copyPassword}>
              Copy password
            </button>
            <button
              className="sa-btn sa-btn-small sa-btn-quiet"
              type="button"
              onClick={() => setCredential(null)}
            >
              I have saved it
            </button>
          </div>
        </div>
      ) : null}

      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last sign-in</th>
              <th className="sa-num">Sessions</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member, index) => (
              <tr key={member.id} className={member.isActive ? undefined : 'sa-row-muted'}>
                <td className="sa-num">{index + 1}</td>
                <td>
                  {member.name}
                  {member.id === currentAdminId ? <span className="sa-row-sub">You</span> : null}
                  {member.mustChangePassword ? (
                    <span className="sa-row-sub">Must change password</span>
                  ) : null}
                </td>
                <td>{member.email}</td>
                <td>{member.phone || <span className="sa-muted">—</span>}</td>
                <td>
                  <span className="sa-status">{ROLE_LABELS[member.role]}</span>
                </td>
                <td>
                  <span className={member.isActive ? 'sa-status sa-status-on' : 'sa-status'}>
                    {member.isActive ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>{formatWhen(member.lastLoginAt)}</td>
                <td className="sa-num">{member.sessionCount}</td>
                <td>
                  {canManage ? (
                    <div className="sa-review-buttons">
                      <button
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        type="button"
                        onClick={() => {
                          setEdit({
                            id: member.id,
                            name: member.name,
                            phone: member.phone,
                            role: member.role,
                          });
                          resetFeedback();
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        type="button"
                        onClick={() => toggleActive(member)}
                        disabled={busy !== null}
                      >
                        {member.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button
                        className="sa-btn sa-btn-small sa-btn-quiet"
                        type="button"
                        onClick={() => resetPassword(member)}
                        disabled={busy !== null}
                      >
                        Reset password
                      </button>
                      {member.sessionCount > 0 ? (
                        <button
                          className="sa-btn sa-btn-small sa-btn-quiet"
                          type="button"
                          onClick={() => signOutEverywhere(member)}
                          disabled={busy !== null}
                        >
                          Sign out
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="sa-note">Owner only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {staff.length === 0 ? <p className="sa-empty">No staff accounts yet.</p> : null}
      </div>

      {canManage && edit ? (
        <form className="sa-edit-form" onSubmit={saveEdit}>
          <h2 className="sa-card-title">Edit account</h2>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Name</span>
              <input
                className="sa-input"
                value={edit.name}
                maxLength={100}
                required
                onChange={(event) => setEdit((current) => (current ? { ...current, name: event.target.value } : current))}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Phone</span>
              <input
                className="sa-input"
                value={edit.phone}
                maxLength={40}
                onChange={(event) => setEdit((current) => (current ? { ...current, phone: event.target.value } : current))}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Role</span>
              <select
                className="sa-input"
                value={edit.role}
                onChange={(event) =>
                  setEdit((current) =>
                    current ? { ...current, role: event.target.value as StaffMember['role'] } : current,
                  )
                }
              >
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <span className="sa-hint">{ROLE_SUMMARIES[edit.role]}</span>
            </label>
          </div>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>
              {busy?.startsWith('edit:') ? 'Saving…' : 'Save changes'}
            </button>
            <button className="sa-btn sa-btn-quiet" type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
            <span className="sa-note">Changing a role signs that account out everywhere.</span>
          </div>
        </form>
      ) : null}

      {canManage ? (
        <form className="sa-edit-form" onSubmit={submitCreate}>
          <h2 className="sa-card-title">Add staff</h2>
          <div className="sa-control-grid">
            <label className="sa-field">
              <span className="sa-label">Name</span>
              <input
                className="sa-input"
                value={create.name}
                maxLength={100}
                required
                onChange={(event) => setCreate((current) => ({ ...current, name: event.target.value }))}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Email</span>
              <input
                className="sa-input"
                type="email"
                value={create.email}
                maxLength={254}
                required
                onChange={(event) => setCreate((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Phone</span>
              <input
                className="sa-input"
                value={create.phone}
                maxLength={40}
                onChange={(event) => setCreate((current) => ({ ...current, phone: event.target.value }))}
              />
            </label>
            <label className="sa-field">
              <span className="sa-label">Role</span>
              <select
                className="sa-input"
                value={create.role}
                onChange={(event) =>
                  setCreate((current) => ({
                    ...current,
                    role: event.target.value as CreateDraft['role'],
                  }))
                }
              >
                {STAFF_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <span className="sa-hint">{ROLE_SUMMARIES[create.role]}</span>
            </label>
          </div>
          <div className="sa-edit-actions">
            <button className="sa-btn sa-btn-primary" type="submit" disabled={busy !== null}>
              {busy === 'create' ? 'Creating…' : 'Create account'}
            </button>
            <span className="sa-note">
              A temporary password is generated and shown once. There is no emailed invitation yet —
              hand it over in person or through your usual secure channel.
            </span>
          </div>
        </form>
      ) : (
        <p className="sa-lock-note">Only an owner can add or change staff accounts.</p>
      )}
    </div>
  );
}
