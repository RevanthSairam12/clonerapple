'use client';

import { useState } from 'react';

export function ProfileManager({ firstName, lastName, phone }: { firstName: string; lastName: string; phone?: string | null }) {
  const [profile, setProfile] = useState({ firstName, lastName, phone: phone || '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function updateProfile(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    const response = await fetch('/api/account/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || 'Could not update profile.'); return; }
    setMessage('Profile updated.');
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    const response = await fetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(passwords) });
    const data = await response.json(); setBusy(false);
    if (!response.ok) { setError(data.error || 'Could not change password.'); return; }
    setPasswords({ currentPassword: '', newPassword: '' }); setMessage('Password changed. Other sessions were signed out.');
  }

  async function signOut() { await fetch('/api/auth/signout', { method: 'POST' }); window.location.href = '/auth'; }

  return <div className="space-y-6"><div><h2 className="text-2xl font-semibold">Profile</h2><p className="mt-1 text-sm text-[#6e6e73]">Manage your name, phone, password, and sessions.</p></div>{(message || error) && <p role="alert" className={`rounded-2xl p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-[#f0fdf4] text-[#166534]'}`}>{error || message}</p>}<form onSubmit={updateProfile} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm"><h3 className="text-lg font-semibold">Personal details</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">{(['firstName', 'lastName', 'phone'] as const).map((field) => <label key={field}><span className="mb-1 block text-xs font-semibold uppercase text-[#6e6e73]">{field === 'phone' ? 'Phone' : field === 'firstName' ? 'First name' : 'Last name'}</span><input value={profile[field]} onChange={(event) => setProfile({ ...profile, [field]: event.target.value })} className="w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]" /></label>)}</div><button disabled={busy} className="mt-5 rounded-full bg-[#1d1d1f] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save profile</button></form><form onSubmit={changePassword} className="rounded-3xl border border-[#e5e5ea] bg-white p-5 shadow-sm"><h3 className="text-lg font-semibold">Change password</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-semibold uppercase text-[#6e6e73]">Current password</span><input required type="password" value={passwords.currentPassword} onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })} className="w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]" /></label><label><span className="mb-1 block text-xs font-semibold uppercase text-[#6e6e73]">New password</span><input required minLength={8} type="password" value={passwords.newPassword} onChange={(event) => setPasswords({ ...passwords, newPassword: event.target.value })} className="w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0071e3]" /></label></div><button disabled={busy} className="mt-5 rounded-full border border-[#d2d2d7] px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Change password</button></form><button type="button" onClick={signOut} className="rounded-full border border-[#d2d2d7] px-5 py-2.5 text-sm font-semibold">Sign out</button></div>;
}
