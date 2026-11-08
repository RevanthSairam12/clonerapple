'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function CommunicationPreferencesManager({
  initialMarketingOptIn,
}: {
  initialMarketingOptIn: boolean;
}) {
  const router = useRouter();
  const [optIn, setOptIn] = useState(initialMarketingOptIn);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketingOptIn: optIn }),
      });
      if (res.ok) {
        setMessage('Preferences saved successfully.');
        router.refresh();
      } else {
        setMessage('Failed to save preferences. Please try again.');
      }
    } catch {
      setMessage('Error updating preferences.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Communication preferences</h2>
        <p className="mt-1 text-sm text-[#6e6e73]">
          Choose what emails you receive from Gadzio.
        </p>
      </div>

      {message && (
        <p role="alert" className="rounded-2xl bg-[#f0fdf4] p-3 text-sm text-[#166534]">
          {message}
        </p>
      )}

      <form onSubmit={handleSave} className="rounded-3xl border border-[#e5e5ea] bg-white p-6 shadow-sm space-y-6">
        <label className="flex cursor-pointer items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="font-semibold text-sm sm:text-base">Marketing and promotional emails</p>
            <p className="text-xs sm:text-sm text-[#6e6e73]">
              Receive occasional updates about new product launches, flash sales, and exclusive private discounts.
            </p>
          </div>
          <input
            type="checkbox"
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
            className="mt-1 h-5 w-5 rounded border-[#d2d2d7] text-[#1d1d1f] focus:ring-[#1d1d1f]"
          />
        </label>

        <div className="rounded-2xl bg-[#f5f5f7] p-4 text-xs sm:text-sm text-[#6e6e73]">
          <p>
            ℹ️ <strong>Transactional messages:</strong> Essential emails concerning your orders, payments, delivery tracking, refunds, and security alerts are always sent regardless of marketing preference.
          </p>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-full bg-[#1d1d1f] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#333336] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#1d1d1f]"
        >
          {busy ? 'Saving...' : 'Save preferences'}
        </button>
      </form>
    </div>
  );
}
