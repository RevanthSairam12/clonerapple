'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ManageDataManager({ email }: { email: string }) {
  const router = useRouter();

  // Export state
  const [exportPassword, setExportPassword] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);

  // Close account state
  const [closeEmail, setCloseEmail] = useState('');
  const [closePassword, setClosePassword] = useState('');
  const [closeConfirmed, setCloseConfirmed] = useState(false);
  const [closeBusy, setCloseBusy] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  async function handleDownloadData(e: React.FormEvent) {
    e.preventDefault();
    setExportBusy(true);
    setExportError(null);
    setExportSuccess(null);

    try {
      const res = await fetch('/api/account/data/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: exportPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setExportError(body?.error || 'Failed to export data.');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'gadzio-customer-data.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setExportPassword('');
      setExportSuccess('Your data download has started.');
    } catch {
      setExportError('Network error downloading data.');
    } finally {
      setExportBusy(false);
    }
  }

  async function handleCloseAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!closeConfirmed) {
      setCloseError('Please check the confirmation box to proceed.');
      return;
    }

    if (!window.confirm('Are you absolutely sure you want to close your account? This action cannot be undone.')) {
      return;
    }

    setCloseBusy(true);
    setCloseError(null);

    try {
      const res = await fetch('/api/account/data/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: closeEmail, password: closePassword }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setCloseError(body?.error || 'Could not close account.');
        setCloseBusy(false);
        return;
      }

      alert('Your account has been closed. You will now be redirected to the homepage.');
      window.location.href = '/';
    } catch {
      setCloseError('Network error closing account.');
      setCloseBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-2xl font-semibold">Manage your data</h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Exercise your privacy rights: download a copy of your personal data or close your account.
        </p>
      </div>

      {/* 1. Download My Data */}
      <section className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold">Download my data</h3>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Download a machine-readable JSON export containing your profile details, saved addresses, complete order history, customer requests, coupon records, and browsing history.
        </p>

        {exportError && (
          <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">
            {exportError}
          </p>
        )}
        {exportSuccess && (
          <p role="alert" className="mt-4 rounded-2xl bg-[#f0fdf4] p-3 text-sm text-[#166534]">
            {exportSuccess}
          </p>
        )}

        <form onSubmit={handleDownloadData} className="mt-6 max-w-md space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase text-[#6e6e73]">
              Confirm your password
            </span>
            <input
              type="password"
              required
              value={exportPassword}
              onChange={(e) => setExportPassword(e.target.value)}
              placeholder="Enter current password"
              className="mt-1 w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
            />
          </label>

          <p className="text-xs text-[#6e6e73]">
            🔒 For security, exports are rate-limited to once every 24 hours and delivered only directly to you.
          </p>

          <button
            type="submit"
            disabled={exportBusy || !exportPassword}
            className="rounded-full bg-[#1d1d1f] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#333336] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
          >
            {exportBusy ? 'Preparing export...' : 'Download data (JSON)'}
          </button>
        </form>
      </section>

      {/* 2. Close My Account */}
      <section className="rounded-3xl border border-red-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-red-700">Close my account</h3>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Closing your account permanently revokes all sessions, removes your saved addresses and browsing history, opts you out of marketing, and replaces your personal details with anonymous placeholders. Past order totals remain stored under an anonymous reference for statutory tax and accounting purposes.
        </p>

        {closeError && (
          <p role="alert" className="mt-4 rounded-2xl bg-red-50 p-3 text-sm text-red-700">
            {closeError}
          </p>
        )}

        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-xs sm:text-sm text-amber-900">
          ⚠️ <strong>Requirements for account closure:</strong> All your orders must be paid and delivered, and there cannot be any open return or cancellation requests.
        </div>

        <form onSubmit={handleCloseAccount} className="mt-6 max-w-md space-y-4">
          <label className="block">
            <span className="block text-xs font-semibold uppercase text-[#6e6e73]">
              Type your email to confirm ({email})
            </span>
            <input
              type="email"
              required
              value={closeEmail}
              onChange={(e) => setCloseEmail(e.target.value)}
              placeholder={email}
              className="mt-1 w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-semibold uppercase text-[#6e6e73]">
              Enter your password
            </span>
            <input
              type="password"
              required
              value={closePassword}
              onChange={(e) => setClosePassword(e.target.value)}
              placeholder="Enter current password"
              className="mt-1 w-full rounded-xl border border-[#d2d2d7] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </label>

          <label className="flex items-start gap-3 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={closeConfirmed}
              onChange={(e) => setCloseConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-[#d2d2d7] text-red-600 focus:ring-red-500"
            />
            <span className="text-xs text-[#6e6e73]">
              I understand that closing my account is permanent and irreversible.
            </span>
          </label>

          <button
            type="submit"
            disabled={closeBusy || !closeConfirmed || !closeEmail || !closePassword}
            className="rounded-full bg-red-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
          >
            {closeBusy ? 'Closing account...' : 'Close my account'}
          </button>
        </form>
      </section>
    </div>
  );
}
